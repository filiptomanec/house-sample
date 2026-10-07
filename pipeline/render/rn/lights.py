"""Lamps from render-inputs.json (lights.items): one Blender light per lamp, scaled per shot by the group level."""
from __future__ import annotations

import math

from mathutils import Vector

from .util import log


def kelvin_to_rgb(k):
    """Linear RGB of a black body (Tanner Helland's fit), normalised so that the largest channel is 1."""
    t = max(1000.0, min(40000.0, k)) / 100.0
    r = 255.0 if t <= 66 else 329.698727446 * ((t - 60) ** -0.1332047592)
    g = 99.4708025861 * math.log(t) - 161.1195681661 if t <= 66 else 288.1221695283 * ((t - 60) ** -0.0755148492)
    b = 255.0 if t >= 66 else (0.0 if t <= 19 else 138.5177312231 * math.log(t - 10) - 305.0447927307)
    srgb = [max(0.0, min(255.0, c)) / 255.0 for c in (r, g, b)]
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb]
    m = max(lin)
    return tuple(c / m for c in lin)


class Lamps:
    def __init__(self, inputs, cfg):
        import bpy
        self.cfg = cfg
        self.items = []
        self._last = {}
        col = bpy.data.collections.new("lamps")
        bpy.context.scene.collection.children.link(col)
        self.collection = col
        for i, it in enumerate(inputs["lights"]["items"]):
            spot = it.get("spot")
            data = bpy.data.lights.new("lamp_%03d_%s" % (i, it["kind"]), "SPOT" if spot else "POINT")
            mix = float(cfg["lampColorMix"])
            data.color = tuple(1.0 + (c - 1.0) * mix for c in kelvin_to_rgb(it["kelvin"]))
            data.shadow_soft_size = float(it.get("radius", 0.05))
            if spot:
                data.spot_size = math.radians(min(179.0, float(spot["coneDeg"])))
                data.spot_blend = float(spot["blend"])
            ob = bpy.data.objects.new(data.name, data)
            ob.location = it["pos"]
            if spot:
                ob.rotation_mode = "QUATERNION"
                ob.rotation_quaternion = Vector(spot["direction"]).to_track_quat("-Z", "Y")
            # a lamp is not seen by the camera (the glow of fixtures comes from the geometry) but lights everything
            ob.visible_camera = False
            col.objects.link(ob)
            self.items.append((ob, it))

    def apply(self, interior, exterior):
        """Levels 0..1 of the two groups (shot.lights); below 2 percent a group is off. Only the power is changed: toggling the
        visibility of lights makes Cycles rebuild the whole scene (about 30 s), a change of power costs nothing."""
        scale = float(self.cfg["lampScale"])
        n_on = 0
        for i, (ob, it) in enumerate(self.items):
            level = interior if it["group"] == "interior" else exterior
            energy = float(it["watts"]) * scale * level if level > 0.02 else 0.0
            if self._last.get(i) != energy:
                ob.data.energy = energy
                self._last[i] = energy
            n_on += energy > 0
        return n_on
