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
        ev += lk["categoryEv"].get(shot.get("category") or "", 0.0)
        # a room lit by lamps in daylight (a garage shot) needs more exposure than the lamps alone would give
        if shot["lights"]["interior"] > 0.5 and shot["sun"]["elevationDeg"] > 10:
            ev += lk["daylightLampsEv"]
        self.sc.view_settings.exposure = lk["exposure"] + ev
        n = self.lamps.apply(shot["lights"]["interior"], shot["lights"]["exterior"])
        if self.blinds:
            self.blinds.apply(shot["blinds"])
        return "sun %.1f deg, ev %+.2f, %d lamps" % (shot["sun"]["elevationDeg"], ev, n)
