"""Terrain: one mesh from `terrain.grid` (two triangles per cell), a far-ground frame that falls away to the horizon, ground
zones as material slots, and the face attribute `grass` that the lawn scatter reads. Never recomputes the height of the
ground: heights come from the grid (the kernel's graded terrain, cut under every slab); objects are placed with a ray cast on
the finished mesh (`Terrain.z`).

Zones (slot order `ZONES`): `lawn` (the plot), `verge` (the green strip between the fence and the pavement), `street`
(pavement and carriageway: no grass at all, the paving is draped on top), `neighbour` (the neighbour gardens: a mown-grass
texture, no blades), `field`, `meadow` (the rest of the near ground). The ground is sunk inside the house footprint (below the
plinth) and inside every ground void (the pool basins, `derived.groundVoids`).
"""
from __future__ import annotations

import math

import numpy as np

from . import ground_materials as GM
from .util import log

ZONES = ("lawn", "verge", "street", "neighbour", "field", "meadow")
PAVED_ROLES = ("terrace_paving", "drive_paving", "path", "deck", "pool_coping")


def _pip(poly, px, py):
    """Vectorised point-in-polygon (even-odd) for arrays px, py."""
    inside = np.zeros(np.shape(px), dtype=bool)
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i][0], poly[i][1]
        xj, yj = poly[j][0], poly[j][1]
        cond = (yi > py) != (yj > py)
        with np.errstate(divide="ignore", invalid="ignore"):
            xint = (xj - xi) * (py - yi) / (yj - yi) + xi
        inside ^= cond & (px < xint)
        j = i
    return inside


def rect_poly(r):
    x0, y0, x1, y1 = r
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


class Terrain:
    def __init__(self, inputs, cfg, c3):
        import bpy
        self.inputs, self.cfg, self.c3 = inputs, cfg, c3
        t = inputs["terrain"]["grid"]
        self.x0, self.y0, self.step, self.nx, self.ny = t["x0"], t["y0"], t["step"], t["nx"], t["ny"]
        self.h = np.array(t["heightsMm"], dtype=np.float64).reshape(self.ny, self.nx) / 1000.0
        self.x1 = self.x0 + (self.nx - 1) * self.step
        self.y1 = self.y0 + (self.ny - 1) * self.step
        self.voids = [rect_poly(r) if len(r) == 4 and not isinstance(r[0], (list, tuple)) else r for r in c3.ground_voids()]
        self.paved_polys = [s["polygon"] for s in inputs["site"]["surfaces"] if s["role"] in PAVED_ROLES]
        self.collection = bpy.data.collections.new("terrain")
        bpy.context.scene.collection.children.link(self.collection)
        self.near = self._build_near()
        self.far = self._build_far()
        self._bvh()

    # ------------------------------------------------------------------ lookups
    def grid_z(self, x, y):
        """Bilinear height of the grid (clamped at its edge); only for the far ground, objects use `z`."""
        fx = np.clip((np.asarray(x) - self.x0) / self.step, 0, self.nx - 1.000001)
        fy = np.clip((np.asarray(y) - self.y0) / self.step, 0, self.ny - 1.000001)
        i, j = fx.astype(int), fy.astype(int)
        u, v = fx - i, fy - j
        h = self.h
        return (h[j, i] * (1 - u) * (1 - v) + h[j, i + 1] * u * (1 - v) + h[j + 1, i] * (1 - u) * v + h[j + 1, i + 1] * u * v)

    def z(self, x, y, default=0.0):
        """Exact height of the rendered terrain mesh (ray cast down)."""
        from mathutils import Vector
        hit = self.bvh.ray_cast(Vector((x, y, 500.0)), Vector((0, 0, -1)), 1000.0)
        return hit[0].z if hit[0] is not None else default

    def paved(self, x, y):
        """True on a paved surface (any site surface of a paved role) or inside the house footprint."""
        px, py = np.array([x]), np.array([y])
        if _pip(self.inputs["house"]["footprint"], px, py)[0]:
            return True
        return any(_pip(p, px, py)[0] for p in self.paved_polys)

    def _bvh(self):
        from mathutils.bvhtree import BVHTree
        import bmesh
        bm = bmesh.new()
        bm.from_mesh(self.near.data)
        bm.from_mesh(self.far.data)
        bmesh.ops.triangulate(bm, faces=bm.faces)
        self.bvh = BVHTree.FromBMesh(bm)
        bm.free()

    # ------------------------------------------------------------------ zones and the grass attribute
    def zone_index(self, cx, cy):
        s = self.inputs["site"]
        z = s["zones"]
        st = self.c3.street()
        idx = np.full(np.shape(cx), ZONES.index("meadow"), dtype=np.int32)
        for np_ in z["neighbourPlots"]:
            idx[_pip(np_["polygon"], cx, cy)] = ZONES.index("neighbour")
        idx[_pip(s["plot"]["polygon"], cx, cy)] = ZONES.index("lawn")
        idx[_pip(z["field"], cx, cy)] = ZONES.index("field")
        idx[_pip(st.get("green") or st["verge"], cx, cy)] = ZONES.index("verge")
        if st.get("pavement"):
            idx[_pip(st["pavement"], cx, cy)] = ZONES.index("street")
        idx[_pip(st["carriageway"], cx, cy)] = ZONES.index("street")
        return idx

    def _grass(self, cx, cy, zone):
        """0..1 density factor per face: the plot lawn and the green verge, faded far from the house. Paving, beds and the
        pool are cut out precisely per blade by the scatter (lawn.py), not by this coarse 0.5 m attribute."""
        g = self.cfg["ground"]
        c = self.inputs["house"]["center"]
        d = np.hypot(cx - c[0], cy - c[1])
        fade = 1.0 - np.clip((d - g["grassFullRadiusM"]) / (g["grassFadeRadiusM"] - g["grassFullRadiusM"]), 0, 1)
        fade = fade * fade * (3 - 2 * fade)
        m = np.where(zone == ZONES.index("lawn"), 1.0, np.where(zone == ZONES.index("verge"), float(g.get("verge", 1.0)), 0.0))
        inside = _pip(self.inputs["house"]["footprint"], cx, cy)
        for v in self.voids:
            inside |= _pip(v, cx, cy)
        return np.where(inside, 0.0, m * fade)

    # ------------------------------------------------------------------ near mesh
    def _build_near(self):
        import bpy
        nx, ny = self.nx, self.ny
        xs = self.x0 + np.arange(nx) * self.step
        ys = self.y0 + np.arange(ny) * self.step
        X, Y = np.meshgrid(xs, ys)
        h = self.h.copy()
        # the floor of the house is at z = 0: sink the ground inside the footprint (below the plinth) so that it is never
        # coplanar with the floors, and inside the ground voids (pool basins) below their floor
        inside = _pip(self.inputs["house"]["footprint"], X.ravel(), Y.ravel()).reshape(h.shape)
        h[inside] = np.minimum(h[inside], -0.6)
        floor = min([p["floorZ"] for p in self.c3.pools()] or [-1.5])
        for v in self.voids:
            iv = _pip(v, X.ravel(), Y.ravel()).reshape(h.shape)
            h[iv] = np.minimum(h[iv], floor - 0.3)
        verts = np.stack([X, Y, h], axis=-1).reshape(-1, 3)
        idx = np.arange(nx * ny).reshape(ny, nx)
        a, b, c, d = idx[:-1, :-1].ravel(), idx[:-1, 1:].ravel(), idx[1:, 1:].ravel(), idx[1:, :-1].ravel()
        tris = np.concatenate([np.stack([a, b, c], 1), np.stack([a, c, d], 1)])        # two triangles per cell
        cx = (verts[tris[:, 0], 0] + verts[tris[:, 1], 0] + verts[tris[:, 2], 0]) / 3
        cy = (verts[tris[:, 0], 1] + verts[tris[:, 1], 1] + verts[tris[:, 2], 1]) / 3
        zone = self.zone_index(cx, cy)
        grass = self._grass(cx, cy, zone)
        me = bpy.data.meshes.new("terrain")
        me.vertices.add(len(verts))
        me.vertices.foreach_set("co", verts.astype(np.float32).ravel())
        me.loops.add(len(tris) * 3)
        me.polygons.add(len(tris))
        me.loops.foreach_set("vertex_index", tris.astype(np.int32).ravel())
        me.polygons.foreach_set("loop_start", np.arange(0, len(tris) * 3, 3, dtype=np.int32))
        me.polygons.foreach_set("material_index", zone.astype(np.int32))
        me.polygons.foreach_set("use_smooth", np.ones(len(tris), dtype=bool))
        me.update(calc_edges=True)
        me.validate()
        att = me.attributes.new("grass", "FLOAT", "FACE")
        att.data.foreach_set("value", grass.astype(np.float32))
        mats = GM.ground_materials(self.cfg, self.inputs, self.c3)
        for z in ZONES:
            me.materials.append(mats[z])
        ob = bpy.data.objects.new("terrain", me)
        self.collection.objects.link(ob)
        self.zone_counts = {z: int((zone == i).sum()) for i, z in enumerate(ZONES)}
        log("terrain: %d triangles, faces with grass: %d, street faces without: %d"
            % (len(tris), int((grass > 0).sum()), self.zone_counts["street"]))
        return ob

    # ------------------------------------------------------------------ far ground
    def _build_far(self):
        """Square rings around the grid: the first ring shares the boundary vertices of the near mesh (watertight), the others go
        outwards geometrically to `farGroundRadiusM` (beyond the visible horizon of an eye-level camera); the height follows
        the edge height and sinks with the curvature of the earth. The aerial haze (sky.py) fades it into the sky."""
        import bpy
        reach = float(self.cfg["ground"]["farGroundRadiusM"])
        offs = [0.0, 2.5, 6, 12, 24, 48, 90, 160, 300, 550, 1000, 1800, 3200, 6000, reach]
        offs = sorted({o for o in offs if o < reach} | {reach})
        n = self.nx
        pts, nrm = [], []
        for i in range(n - 1):
            pts.append((self.x0 + i * self.step, self.y0)); nrm.append((0, -1))
        for j in range(self.ny - 1):
            pts.append((self.x1, self.y0 + j * self.step)); nrm.append((1, 0))
        for i in range(n - 1):
            pts.append((self.x1 - i * self.step, self.y1)); nrm.append((0, 1))
        for j in range(self.ny - 1):
            pts.append((self.x0, self.y1 - j * self.step)); nrm.append((-1, 0))
        pts = np.array(pts)
        nrm = np.array(nrm, dtype=float)
        m = len(pts)
        corner = [0, n - 1, 2 * (n - 1), 3 * (n - 1)]
        for c in corner:
            v = nrm[c - 1] + nrm[c]
            nrm[c] = v / np.linalg.norm(v)
        verts, rings = [], []
        for d in offs:
            P = pts + nrm * d
            for c in corner:
                P[c] = pts[c] + nrm[c] * d * math.sqrt(2.0)
            z0 = self.grid_z(np.clip(P[:, 0], self.x0, self.x1), np.clip(P[:, 1], self.y0, self.y1))
            drop = d * d / (2.0 * 6.371e6)                 # the curvature of the earth: 18 m at 15 km
            z = z0 - drop
            rings.append(len(verts))
            verts += [(P[k, 0], P[k, 1], z[k]) for k in range(m)]
        faces = []
        for r in range(len(offs) - 1):
            for k in range(m):
                k2 = (k + 1) % m
                a, b = rings[r] + k, rings[r] + k2
                c, d = rings[r + 1] + k2, rings[r + 1] + k
                faces.append((a, d, c))
                faces.append((a, c, b))
        me = bpy.data.meshes.new("far_ground")
        me.from_pydata(verts, [], faces)
        for p in me.polygons:
            p.use_smooth = True
        me.update()
        me.materials.append(GM.farmland(self.cfg, self.inputs, self.c3))
        ob = bpy.data.objects.new("far_ground", me)
        self.collection.objects.link(ob)
        return ob
