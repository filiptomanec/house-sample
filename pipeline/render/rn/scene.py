"""The render scene: builds everything once, then `apply(shot)` changes only camera, sky, exposure, lamps and blinds."""
from __future__ import annotations

import time

from . import assemble, cameras, cycles_setup
from . import sky as SKY
from . import lights as LIGHTS
from .util import log


class Scene:
    def __init__(self, inputs, cfg, mode, device=None):
        import bpy
        self.inputs, self.cfg, self.mode = inputs, cfg, mode
        t0 = time.time()
        self.house = assemble.build_house(inputs)
        self.terrain = None
        from .extras import skipped
        self.furniture = [] if "furniture" in skipped() else assemble.import_furniture(inputs)
        self.device = cycles_setup.setup(cfg, device)
        self.glare = cycles_setup.setup_glare(cfg)
        self.sky = SKY.Sky(inputs, cfg)
        self.cam = cameras.make_camera()
        self.lamps = LIGHTS.Lamps(inputs, cfg)
        self.extras = []
        self.blinds = None
        self._add_extras()
        log("scene built in %.1f s; device %s; glare %s" % (time.time() - t0, self.device, self.glare))
        self.sc = bpy.context.scene

    def _add_extras(self):
        """Terrain, vegetation, neighbours, blinds, PV and screens (modules of this package)."""
        from . import extras
        extras.build_all(self)

    def apply(self, shot, size):
        """Puts the scene into the state of `shot` (camera, sun, exposure, lamps, blinds). Returns a short text for the log."""
        cameras.apply_camera(self.cam, shot["camera"], size)
        ev = self.sky.apply(shot["sun"])
        lk = self.cfg["look"]
        auto = lk["autoExposure"]
        n = self.lamps.apply(shot["lights"]["interior"], shot["lights"]["exterior"])
        if self.blinds:
            self.blinds.apply(shot["blinds"])
        if shot.get("category") in auto["categories"]:
            # rooms: the camera is inside, so the dusk boost of the sky does not apply; the exposure is measured instead
            self.sc.view_settings.exposure = 0.0
            ev = self.measure_ev(size)
        self.sc.view_settings.exposure = lk["exposure"] + ev
        return "sun %.1f deg, ev %+.2f, %d lamps" % (shot["sun"]["elevationDeg"], ev, n)

    def measure_ev(self, size):
        """Auto exposure of a room shot: a small linear preview (no denoising, few samples); the exposure that puts the
        median luminance on `target` (config look.autoExposure)."""
        import math
        import os
        import tempfile
        import bpy
        import numpy as np
        a = self.cfg["look"]["autoExposure"]
        sc, cy, rd = self.sc, self.sc.cycles, self.sc.render
        saved = (rd.resolution_x, rd.resolution_y, cy.samples, cy.use_denoising, cy.use_adaptive_sampling,
                 rd.image_settings.file_format, rd.image_settings.color_depth, rd.filepath, rd.use_motion_blur)
        w = int(a["previewWidth"])
        rd.resolution_x, rd.resolution_y = w, max(2, int(round(w * size[1] / size[0])))
        cy.samples, cy.use_denoising, cy.use_adaptive_sampling = int(a["previewSamples"]), False, False
        rd.image_settings.file_format, rd.image_settings.color_depth = "OPEN_EXR", "32"
        rd.use_motion_blur = False
        tmp = os.path.join(tempfile.gettempdir(), "render_ev_%d.exr" % os.getpid())
        rd.filepath = tmp
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(tmp)
        px = np.array(img.pixels[:], dtype=np.float32).reshape(-1, 4)
        bpy.data.images.remove(img)
        try:
            os.remove(tmp)
        except OSError:
            pass
        (rd.resolution_x, rd.resolution_y, cy.samples, cy.use_denoising, cy.use_adaptive_sampling,
         rd.image_settings.file_format, rd.image_settings.color_depth, rd.filepath, rd.use_motion_blur) = saved
        lum = 0.2126 * px[:, 0] + 0.7152 * px[:, 1] + 0.0722 * px[:, 2]
        med = float(np.percentile(lum, a.get("percentile", 50)))
        ev = math.log2(a["target"] / max(med, 1e-6))
        return max(a["minEv"], min(a["maxEv"], ev))
