"""The render scene: builds everything once, then `apply(shot)` changes only the camera, the sky, the exposure and white
balance, the lamp power and the movable parts (blinds, louvres, gates, garage door; their meshes are rebuilt only when their
state changes)."""
from __future__ import annotations

import time

from . import assemble, cameras, cycles_setup
from . import sky as SKY
from . import lights as LIGHTS
from .c3 import C3, shot_state
from .util import log


class Scene:
    def __init__(self, inputs, cfg, mode, device=None):
        import bpy
        self.inputs, self.cfg, self.mode = inputs, cfg, mode
        self.c3 = C3(inputs)
        t0 = time.time()
        self.house = assemble.build_house(inputs)
        self.terrain = None
        from .extras import skipped
        self.furniture = [] if "furniture" in skipped() else assemble.import_furniture(inputs)
        self.device = cycles_setup.setup(cfg, device)
        self.glare = cycles_setup.setup_glare(cfg)
        self.sky = SKY.Sky(inputs, cfg)
        self.cam = cameras.make_camera()
        self.blinds = None
        self.movables = []                 # objects with apply(shot_state, shot) (louvres, gates, garage door)
        self._add_extras()
        t = self.terrain
        self.lamps = LIGHTS.Lamps(inputs, cfg, self.c3, ground=(t.z if t else None), covered=(t.paved if t else None))
        n_link = self.lamps.exclude_from_room_lamps([o for o in (t.near, t.far) if o] if t else [])
        log("scene built in %.1f s; device %s; glare %s; %d lamps (%d derived garden lights), %d room lamps skip the ground"
            % (time.time() - t0, self.device, self.glare, len(self.lamps.items), self.lamps.fallback, n_link))
        self.sc = bpy.context.scene

    def _add_extras(self):
        """Terrain, surfaces, street, fences and gates, pool, vegetation, neighbours, blinds, louvres, PV (extras.py)."""
        from . import extras
        extras.build_all(self)

    def apply(self, shot, size):
        """Puts the scene into the state of `shot`. Returns a short text for the log."""
        cameras.apply_camera(self.cam, shot["camera"], size, float(self.cfg["ground"]["farGroundRadiusM"]) * 1.05)
        ev = self.sky.apply(shot["sun"])
        dusk = self.sky.dusk
        lk = self.cfg["look"]
        auto = lk["autoExposure"]
        cat = shot.get("category") or "exterior"
        indoor = cat in auto["categories"]
        # rooms: the camera is inside, the dusk exposure does not apply and the lamps get no dusk boost
        n = self.lamps.apply(shot["lights"]["interior"], shot["lights"]["exterior"], 0.0 if indoor else dusk)
        state = shot_state(shot)
        if self.blinds:
            self.blinds.apply(shot["blinds"])
        for m in self.movables:
            m.apply(state, shot)
        self.white_balance(cat, dusk)
        if indoor:
            self.sc.view_settings.exposure = 0.0
            ev = self.measure_ev(size)
        elif self.covered(shot["camera"]["position"]):
            ev += float(lk.get("coveredEv", 0.0))     # an exterior camera under the roof (the covered terrace, a porch)
        ev += float(shot.get("ev") or 0.0)            # optional per-shot correction (C3)
        self.sc.view_settings.exposure = lk["exposure"] + ev
        return "sun %.1f deg, dusk %.2f, ev %+.2f, %d lamps" % (shot["sun"]["elevationDeg"], dusk, ev, n)

    def covered(self, p):
        """True when the point is under a roof (inside its eave rectangle, below the eave) but outside the house footprint:
        the sky there is mostly hidden, so the camera needs `look.coveredEv` more exposure than the open garden."""
        from .terrain import _pip
        import numpy as np
        x, y, z = (float(c) for c in p)
        if _pip(self.inputs["house"]["footprint"], np.array([x]), np.array([y]))[0]:
            return False
        for r in self.inputs["house"]["roofs"]:
            x0, y0, x1, y1 = r["eaveRect"]
            if x0 < x < x1 and y0 < y < y1 and z < float(r["eaveHeight"]):
                return True
        return False

    def white_balance(self, category, dusk):
        """`look.whiteBalance` of the category (exterior when unknown), blended towards `dusk` in the twilight."""
        wb = self.cfg["look"].get("whiteBalance") or {}
        vs = self.sc.view_settings
        if not wb or not hasattr(vs, "use_white_balance"):
            return
        a = wb.get(category) or wb.get("exterior") or {"temperature": 6500, "tint": 0}
        b = wb.get("dusk", a) if category not in self.cfg["look"]["autoExposure"]["categories"] else a
        t = float(a["temperature"]) + (float(b["temperature"]) - float(a["temperature"])) * dusk
        ti = float(a["tint"]) + (float(b["tint"]) - float(a["tint"])) * dusk
        vs.use_white_balance = True
        vs.white_balance_temperature = t
        vs.white_balance_tint = ti

    def measure_ev(self, size):
        """Auto exposure of a room shot: a small linear preview (no denoising, few samples); the exposure that puts the
        `percentile` luminance on `target` (config look.autoExposure)."""
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
