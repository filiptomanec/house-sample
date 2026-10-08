"""Movable parts of the house per shot (C3): the louvre walls and the garage door.

* Louvres (`derived.screens[]` with `blades`): the static blades of the house GLB (role `screen_slats`) are hidden and drawn
  here at the shot's angle `screens.angleDeg` (default: the rest angle `restDeg`), clamped to `[closedDeg, openDeg]`. The
  convention of the model: 0 = blades in the plane of the wall, 90 = square to it; a blade turns about its vertical axis,
  counter-clockwise seen from above from the wall direction (`from` -> `to`).
* Garage door (GLB role `garage_door`, openings of kind `garage`): `garageDoor` 0..1 lifts the leaf by that share of its height
  along the track of a sectional door: up in the opening, then horizontal under the garage ceiling (class doc).
Meshes and transforms change only when the state changes.
"""
from __future__ import annotations

import math

from mathutils import Vector

from .util import log

RAIL = 0.05          # blades stop this far from the rails at z0 / z1


def _objects_with(scn, matname, only=True):
    out = []
    for ob in scn.house["house"].all_objects:
        if ob.type != "MESH":
            continue
        names = [m.name for m in ob.data.materials if m]
        if matname in names and (not only or all(n == matname for n in names)):
            out.append(ob)
    return out


class Louvres:
    def __init__(self, scn):
        import bpy
        self.scn = scn
        self.walls = scn.c3.louvres()
        hidden = _objects_with(scn, "screen_slats")
        for ob in hidden:
            ob.hide_render = True
        mat = bpy.data.materials.get("screen_slats") or bpy.data.materials.get("wood_cladding")
        col = bpy.data.collections.new("louvres")
        bpy.context.scene.collection.children.link(col)
        self.obs = []
        for k, s in enumerate(self.walls):
            me = bpy.data.meshes.new("louvre_%d" % k)
            if mat:
                me.materials.append(mat)
            ob = bpy.data.objects.new(me.name, me)
            col.objects.link(ob)
            self.obs.append(ob)
        self.state = [None] * len(self.walls)
        log("louvres: %d walls, %d static GLB meshes hidden" % (len(self.walls), len(hidden)))

    @staticmethod
    def frame(s):
        """(at, axis sign, z0, z1) of a louvre wall in either shape: the derived one (`at`, scalar `from`/`to`, `z0`/`z1`) or the
        render-inputs one (`from`/`to` points, `baseZ` + `height`). Blade positions are coordinates along the wall axis."""
        v = s.get("orient") == "v"
        a, b = s["from"], s["to"]
        if isinstance(a, (list, tuple)):
            at = float(a[0] if v else a[1])
            fa, fb = float(a[1] if v else a[0]), float(b[1] if v else b[0])
        else:
            at, fa, fb = float(s["at"]), float(a), float(b)
        z0 = float(s["z0"]) if "z0" in s else float(s.get("baseZ", 0.0))
        z1 = float(s["z1"]) if "z1" in s else z0 + float(s.get("height", 2.5))
        return at, (1.0 if fb >= fa else -1.0), z0, z1

    def _mesh(self, s, deg):
        b = s["blades"]
        chord, th = float(b["chord"]), float(b["thickness"])
        at, sign, z0, z1 = self.frame(s)
        z0, z1 = z0 + RAIL, z1 - RAIL
        axis = (Vector((0, 1, 0)) if s.get("orient") == "v" else Vector((1, 0, 0))) * sign
        a = math.radians(deg)
        cd = Vector((axis.x * math.cos(a) - axis.y * math.sin(a), axis.x * math.sin(a) + axis.y * math.cos(a), 0))
        td = Vector((-cd.y, cd.x, 0))
        up = Vector((0, 0, 1))
        v, f = [], []
        for pos in b["positions"]:
            c = Vector((at, float(pos), (z0 + z1) / 2)) if s.get("orient") == "v" else Vector((float(pos), at, (z0 + z1) / 2))
            i0 = len(v)
            for sz in (-1, 1):
                for (sx, sy) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                    v.append(c + cd * (sx * chord / 2) + td * (sy * th / 2) + up * (sz * (z1 - z0) / 2))
            for q in [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]:
                f.append(tuple(i0 + j for j in q))
        return v, f

    def apply(self, state, shot):
        for k, s in enumerate(self.walls):
            want = state.get("screenDeg")
            deg = float(s.get("restDeg", 60) if want is None else want)
            deg = max(float(s.get("closedDeg", 0)), min(float(s.get("openDeg", 90)), deg))
            if self.state[k] == round(deg, 2):
                continue
            self.state[k] = round(deg, 2)
            v, f = self._mesh(s, deg)
            me = self.obs[k].data
            me.clear_geometry()
            me.from_pydata([tuple(p) for p in v], [], f)
            me.update()
            # box UVs along the blade height for the timber texture
            uvl = me.uv_layers.new(name="UVMap") if not me.uv_layers else me.uv_layers[0]
            for poly in me.polygons:
                for li in poly.loop_indices:
                    co = me.vertices[me.loops[li].vertex_index].co
                    uvl.data[li].uv = ((co.x + co.y) / 1.8, co.z / 1.8)


class GarageDoor:
    """Sectional garage door: the leaf vertices follow the door track. Lifted by `garageDoor` x the leaf height, the part that
    rises above the head turns into the horizontal track under the ceiling (inwards, the outer face up), so the open door
    reads as a sectional door stored under the garage ceiling, never as a panel through the roof."""

    def __init__(self, scn):
        import numpy as np
        self.np = np
        self.parts = []                       # (object, vertex indices, base coordinates)
        self.ops = scn.c3.garage_openings()
        objs = _objects_with(scn, "garage_door", only=False)
        self.n = None
        if objs and self.ops:
            o = self.ops[0]
            az = math.radians(float(o.get("azimuth") or 0.0))
            self.n = np.array((math.sin(az), math.cos(az), 0.0))          # outward normal (house frame)
        for ob in objs:
            me = ob.data
            mi = [i for i, m in enumerate(me.materials) if m and m.name == "garage_door"]
            idx = sorted({v for p in me.polygons if p.material_index in mi for v in p.vertices})
            if not idx:
                continue
            co = np.empty(len(me.vertices) * 3, dtype=np.float64)
            me.vertices.foreach_get("co", co)
            co = co.reshape(-1, 3)
            mw = np.array(ob.matrix_world)
            world = co @ mw[:3, :3].T + mw[:3, 3]
            self.parts.append((ob, np.array(idx), world, mw))
        self.state = None
        log("garage door: %d objects%s" % (len(self.parts), "" if self.parts else " (no garage_door role in the house build)"))

    def positions(self, world, idx, t):
        """New world coordinates of the leaf vertices `idx` for the open fraction `t`."""
        np = self.np
        n = self.n
        leaf = world[idx]
        out_d = leaf[:, :2] @ n[:2]
        face = out_d.max()                                  # the outer face plane (largest offset along n)
        depth = face - out_d                                # 0 on the outer face, the leaf thickness on the inner one
        z0, z1 = leaf[:, 2].min(), leaf[:, 2].max()
        zl = leaf[:, 2] + t * (z1 - z0)
        over = np.maximum(zl - z1, 0.0)
        new = leaf.copy()
        on_plane = leaf[:, :2] + np.outer(depth, n[:2])     # the vertex moved onto the outer face plane
        horiz = over > 0
        new[:, 2] = np.where(horiz, z1 - depth, zl)
        new[horiz, :2] = on_plane[horiz] - np.outer(over[horiz], n[:2])
        return new

    def apply(self, state, shot):
        np = self.np
        t = round(float(state.get("garageDoor", 0.0)), 3)
        if self.n is None or t == self.state:
            return
        self.state = t
        for ob, idx, world, mw in self.parts:
            co = world.copy()
            co[idx] = self.positions(world, idx, t)
            inv = np.linalg.inv(mw)
            local = co @ inv[:3, :3].T + inv[:3, 3]
            ob.data.vertices.foreach_set("co", local.astype(np.float32).ravel())
            ob.data.update()
