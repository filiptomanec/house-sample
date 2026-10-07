"""Terrain: one mesh from `terrain.grid` (two triangles per cell), a far-ground frame that falls away to the horizon, ground
zones (lawn, street, field) as material slots, and draped surfaces (paving, gravel, mulch). Never recomputes the height of
the ground: heights come from the grid; objects are placed with a ray cast on the finished mesh (`Terrain.z`)."""
from __future__ import annotations

import math

import numpy as np

from . import ground_materials as GM
from .util import log

ZONES = ("lawn", "verge", "field", "meadow")      # material slot order of the near mesh


def _pip(poly, px, py):
    """Vectorised point-in-polygon (even-odd) for arrays px, py."""
    inside = np.zeros(px.shape, dtype=bool)
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        cond = (yi > py) != (yj > py)
        with np.errstate(divide="ignore", invalid="ignore"):
            xint = (xj - xi) * (py - yi) / (yj - yi) + xi
        inside ^= cond & (px < xint)
        j = i
    return inside


class Terrain:
    def __init__(self, inputs, cfg):
        import bpy
        self.inputs, self.cfg = inputs, cfg
        t = inputs["terrain"]["grid"]
        self.x0, self.y0, self.step, self.nx, self.ny = t["x0"], t["y0"], t["step"], t["nx"], t["ny"]
        self.h = np.array(t["heightsMm"], dtype=np.float64).reshape(self.ny, self.nx) / 1000.0
        self.x1 = self.x0 + (self.nx - 1) * self.step
        self.y1 = self.y0 + (self.ny - 1) * self.step
        self.collection = bpy.data.collections.new("terrain")
        bpy.context.scene.collection.children.link(self.collection)
        self.near = self._build_near()
        self.far = self._build_far()
        self._bvh()

    # ------------------------------------------------------------------ height lookups
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

    def _bvh(self):
        from mathutils.bvhtree import BVHTree
        import bmesh
        bm = bmesh.new()
        bm.from_mesh(self.near.data)
        bm.from_mesh(self.far.data)
        bmesh.ops.triangulate(bm, faces=bm.faces)
        self.bvh = BVHTree.FromBMesh(bm)
        bm.free()

    # ------------------------------------------------------------------ near mesh
    def _zone_index(self, cx, cy):
        s = self.inputs["site"]
        z = s["zones"]
        idx = np.full(cx.shape, ZONES.index("meadow"), dtype=np.int32)
        for np_ in z["neighbourPlots"]:
            idx[_pip(np_["polygon"], cx, cy)] = ZONES.index("lawn")
        idx[_pip(s["plot"]["polygon"], cx, cy)] = ZONES.index("lawn")
        idx[_pip(z["field"], cx, cy)] = ZONES.index("field")
        idx[_pip(z["street"]["verge"], cx, cy)] = ZONES.index("verge")
        idx[_pip(z["street"]["carriageway"], cx, cy)] = ZONES.index("verge")      # the asphalt is a draped surface (fences.py)
        return idx

    def _grass_mask(self, cx, cy, zone):
        """0..1 density factor per cell: lawn only, fading out with the distance from the house, nothing under paving."""
        g = self.cfg["ground"]
        c = self.inputs["house"]["center"]
        d = np.hypot(cx - c[0], cy - c[1])
        fade = 1.0 - np.clip((d - g["grassFullRadiusM"]) / (g["grassFadeRadiusM"] - g["grassFullRadiusM"]), 0, 1)
        fade = fade * fade * (3 - 2 * fade)
        m = np.where(zone == ZONES.index("lawn"), 1.0, np.where(zone == ZONES.index("verge"), 0.5, 0.0)) * fade
        covered = np.zeros(cx.shape, dtype=bool)
        for s in self.inputs["site"]["surfaces"]:
            covered |= _pip(self._grow(s["polygon"], 0.25), cx, cy)
        covered |= _pip(self._grow(self.inputs["house"]["footprint"], 0.6), cx, cy)
        return np.where(covered, 0.0, m)

    @staticmethod
    def _grow(poly, d):
        """Polygon pushed outwards by d (simple vertex offset about the centroid direction; good enough for a mask)."""
        cx = sum(p[0] for p in poly) / len(poly)
        cy = sum(p[1] for p in poly) / len(poly)
        out = []
        for x, y in poly:
            vx, vy = x - cx, y - cy
            n = math.hypot(vx, vy) or 1.0
            out.append((x + vx / n * d, y + vy / n * d))
        return out

    def _build_near(self):
        import bpy
        nx, ny = self.nx, self.ny
        xs = self.x0 + np.arange(nx) * self.step
        ys = self.y0 + np.arange(ny) * self.step
        X, Y = np.meshgrid(xs, ys)
        # the floor of the house is at z = 0, the same as the plateau: sink the ground inside the footprint (below the plinth)
        # so that it is never coplanar with the floors (black z-fighting) and the lawn cannot grow through them
        h = self.h.copy()
        inside = _pip(self.inputs["house"]["footprint"], X.ravel(), Y.ravel()).reshape(h.shape)
        h[inside] = np.minimum(h[inside], -0.6)
        verts = np.stack([X, Y, h], axis=-1).reshape(-1, 3)
        idx = np.arange(nx * ny).reshape(ny, nx)
        a, b, c, d = idx[:-1, :-1].ravel(), idx[:-1, 1:].ravel(), idx[1:, 1:].ravel(), idx[1:, :-1].ravel()
        tris = np.concatenate([np.stack([a, b, c], 1), np.stack([a, c, d], 1)])        # two triangles per cell
        # triangle centres decide the zone
        cx = (verts[tris[:, 0], 0] + verts[tris[:, 1], 0] + verts[tris[:, 2], 0]) / 3
        cy = (verts[tris[:, 0], 1] + verts[tris[:, 1], 1] + verts[tris[:, 2], 1]) / 3
        zone = self._zone_index(cx, cy)
        grass = self._grass_mask(cx, cy, zone)
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
        mats = GM.ground_materials(self.cfg, self.inputs)
        for z in ZONES:
            me.materials.append(mats[z])
        ob = bpy.data.objects.new("terrain", me)
        self.collection.objects.link(ob)
        ob.visible_shadow = True
        log("terrain: %d triangles, lawn faces with grass: %d" % (len(tris), int((grass > 0).sum())))
        return ob

    # ------------------------------------------------------------------ far ground
    def _build_far(self):
        """Square rings around the grid: the first ring shares the boundary vertices of the near mesh (watertight), the others go
        outwards geometrically; the height follows the edge height and sinks slowly (curvature) towards the horizon."""
        import bpy
        reach = float(self.cfg["ground"]["farGroundRadiusM"])
        offs = [0.0, 2.5, 6, 12, 24, 48, 90, 160, 300, 550, 1000, reach]
        n = self.nx
        # boundary loop of the near grid, counter-clockwise, with outward normals
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
        # diagonal corners get a pushed-out direction: smooth the normals over the neighbours at the corners
        m = len(pts)
        corner = [0, n - 1, 2 * (n - 1), 3 * (n - 1)]
        for c in corner:
            a, b = nrm[c - 1], nrm[c]
            v = a + b
            nrm[c] = v / np.linalg.norm(v)
        verts, rings = [], []
        base = float(self.h.mean())
        for d in offs:
            P = pts + nrm * d
            # corners move along the diagonal by sqrt(2) so that the ring stays a square at distance d
            for c in corner:
                P[c] = pts[c] + nrm[c] * d * math.sqrt(2.0)
            z0 = self.grid_z(np.clip(P[:, 0], self.x0, self.x1), np.clip(P[:, 1], self.y0, self.y1))
            drop = 3.0 * (1.0 - math.exp(-d / 400.0))
            z = z0 - drop
            rings.append(len(verts))
            verts += [(P[k, 0], P[k, 1], z[k]) for k in range(m)]
        faces = []
        for r in range(len(offs) - 1):
            for k in range(m):
                k2 = (k + 1) % m
                a, b = rings[r] + k, rings[r] + k2
                c, d = rings[r + 1] + k2, rings[r + 1] + k
                faces.append((a, d, c))      # both counter-clockwise seen from above (the loop runs counter-clockwise)
                faces.append((a, c, b))
        me = bpy.data.meshes.new("far_ground")
        me.from_pydata(verts, [], faces)
        for p in me.polygons:
            p.use_smooth = True
        me.update()
        me.materials.append(GM.farmland(self.cfg, self.inputs))
        ob = bpy.data.objects.new("far_ground", me)
        self.collection.objects.link(ob)
        return ob
