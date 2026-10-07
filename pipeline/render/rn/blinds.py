"""External blinds (raffstore): headrail box and guide rails are fixed, the slats are rebuilt for the state of each shot
(`shot.blinds[i] = {drop, slatAngleDeg}` for `blinds.items[i]`)."""
from __future__ import annotations

import math

from mathutils import Vector

from .util import hex_to_linear, log


def _material():
    import bpy
    m = bpy.data.materials.new("blind")
    m.use_nodes = True
    bs = m.node_tree.nodes.get("Principled BSDF")
    bs.inputs["Base Color"].default_value = (*hex_to_linear("#575c61"), 1)
    bs.inputs["Metallic"].default_value = 0.55
    bs.inputs["Roughness"].default_value = 0.38
    return m


def _box_geometry(center, ax, ay, az, size):
    """8 vertices and 6 quads of a box with the given axes (unit vectors) and size (along ax, ay, az)."""
    c = Vector(center)
    hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
    v = []
    for sz in (-1, 1):
        for (sx, sy) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            v.append(c + ax * (sx * hx) + ay * (sy * hy) + az * (sz * hz))
    q = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    return v, q


class Blinds:
    def __init__(self, scn):
        import bpy
        self.scn = scn
        inp = scn.inputs["blinds"]
        self.items = inp["items"]
        self.d = inp["details"]
        self.mat = _material()
        self.col = bpy.data.collections.new("blinds")
        bpy.context.scene.collection.children.link(self.col)
        self.fixed = []
        self.slats = []
        self.state = [None] * len(self.items)
        for it in self.items:
            self.fixed.append(self._fixed(it))
            self.slats.append(self._empty_mesh_object("blind_slats_%s" % it["openingId"]))
        log("blinds: %d openings" % len(self.items))

    def _empty_mesh_object(self, name):
        import bpy
        me = bpy.data.meshes.new(name)
        me.materials.append(self.mat)
        ob = bpy.data.objects.new(name, me)
        self.col.objects.link(ob)
        return ob

    def _axes(self, it):
        n = Vector(it["normal"]).normalized()
        along = Vector(it.get("along") or (-n.y, n.x, 0)).normalized()
        return along, n

    def _fixed(self, it):
        """Headrail box and the two guide rails."""
        import bpy
        along, n = self._axes(it)
        up = Vector((0, 0, 1))
        verts, faces = [], []
        b = it["box"]
        parts = [(b["center"], b["size"])]
        rw, rd = self.d["railWidth"], self.d["railDepth"]
        face = Vector(it["faceCenter"])
        for s in (-1, 1):
            c = face + along * (s * (it["width"] / 2 - rw / 2)) + n * (self.d["standoff"] + rd / 2)
            c.z = (it["sill"] + it["head"]) / 2
            parts.append((c, (rw, rd, it["head"] - it["sill"])))
        for center, size in parts:
            v, q = _box_geometry(center, along, n, up, size)
            i0 = len(verts)
            verts.extend(v)
            faces.extend(tuple(i0 + j for j in f) for f in q)
        me = bpy.data.meshes.new("blind_fixed_%s" % it["openingId"])
        me.from_pydata(verts, [], faces)
        me.materials.append(self.mat)
        me.update()
        ob = bpy.data.objects.new(me.name, me)
        self.col.objects.link(ob)
        return ob

    def _slat_mesh(self, it, drop, angle_deg):
        """Slats from the headrail down over `drop` of the opening height, tilted by angle (0 = horizontal)."""
        along, n = self._axes(it)
        up = Vector((0, 0, 1))
        d = self.d
        height = it["head"] - it["sill"]
        covered = max(0.0, min(1.0, drop)) * height
        count = int(covered / d["slatPitch"])
        if count <= 0:
            return [], []
        a = math.radians(angle_deg)
        chord, th = d["slatWidth"], max(d["slatThickness"], 0.002)
        width = it["width"] - 2 * d["railWidth"] - 0.01
        face = Vector(it["faceCenter"])
        centre = face + n * (d["standoff"] + d["railDepth"] / 2)
        # a slat is a thin box: its chord direction is tilted from `n` (horizontal) towards `up` by the angle
        cd = n * math.cos(a) + up * math.sin(a)
        td = (-n * math.sin(a) + up * math.cos(a))
        verts, faces = [], []
        for i in range(count):
            z = it["head"] - d["slatPitch"] * (i + 0.5)
            c = Vector((centre.x, centre.y, z))
            v, q = _box_geometry(c, along, cd, td, (width, chord, th))
            i0 = len(verts)
            verts.extend(v)
            faces.extend(tuple(i0 + j for j in f) for f in q)
        return verts, faces

    def apply(self, states):
        """`states` = shot.blinds (one {drop, slatAngleDeg} per item)."""
        for i, (it, st) in enumerate(zip(self.items, states)):
            key = (round(st["drop"], 3), round(st["slatAngleDeg"], 1))
            if key == self.state[i]:
                continue
            self.state[i] = key
            ob = self.slats[i]
            me = ob.data
            v, f = self._slat_mesh(it, st["drop"], st["slatAngleDeg"])
            me.clear_geometry()
            if v:
                me.from_pydata(v, [], f)
                me.update()
                for p in me.polygons:
                    p.use_smooth = False
