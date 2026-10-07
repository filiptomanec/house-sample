"""Polygon collector: geometry is accumulated per node (role, id, toggle) and turned into Blender objects at the end.

Faces keep their own vertices (flat shading, like the glTF export wants). UVs are stored in metres and scaled per role
when the Blender mesh is made, so a material's texture tile size is a property of the material, not of the geometry.
"""
from __future__ import annotations

from . import geom as G


class Node:
    __slots__ = ("role", "id", "toggle", "verts", "faces", "uvs", "extras")

    def __init__(self, role, id=None, toggle=None):
        self.role, self.id, self.toggle = role, id, toggle
        self.verts = []
        self.faces = []
        self.uvs = []          # per face: list of (u, v) in metres
        self.extras = {}

    @property
    def name(self):
        return self.role if self.id is None else "%s_%s" % (self.role, self.id)

    def triangles(self):
        return sum(len(f) - 2 for f in self.faces)


def box_uv(p, n):
    """Box projection in metres from the dominant axis of the face normal."""
    ax, ay, az = abs(n[0]), abs(n[1]), abs(n[2])
    if az >= ax and az >= ay:
        return (p[0], p[1])
    if ay >= ax:
        return (p[0], p[2])
    return (p[1], p[2])


class MeshSet:
    def __init__(self):
        self.nodes = {}

    # ------------------------------------------------------------ nodes
    def node(self, role, id=None, toggle=None):
        key = (role, id, toggle)
        nd = self.nodes.get(key)
        if nd is None:
            nd = self.nodes[key] = Node(role, id, toggle)
        return nd

    def sorted_nodes(self):
        return sorted(self.nodes.values(), key=lambda n: (n.role, str(n.id or ""), str(n.toggle or "")))

    # ------------------------------------------------------------ faces
    def poly(self, role, pts, normal=None, uv=None, id=None, toggle=None, uvmode="box", two_sided=False):
        """Add a polygon. `normal` orients it (the Newell normal is flipped to face that way); `uv` = per-vertex (u, v)
        in metres matching `pts`; otherwise `uvmode` ('box' or 'box_v' = box projection with u and v swapped, for
        vertical wood grain)."""
        if len(pts) < 3:
            return
        pts = [tuple(p) for p in pts]
        n = G.newell(pts)
        if G.length(n) < 1e-12:
            return
        flip = normal is not None and G.dot(n, normal) < 0
        if flip:
            pts = pts[::-1]
            if uv is not None:
                uv = list(uv)[::-1]
            n = (-n[0], -n[1], -n[2])
        if uv is None:
            nn = G.norm(n)
            uv = [box_uv(p, nn) for p in pts]
            if uvmode == "box_v":
                uv = [(v, u) for (u, v) in uv]
        nd = self.node(role, id, toggle)
        base = len(nd.verts)
        nd.verts.extend(pts)
        nd.faces.append(tuple(range(base, base + len(pts))))
        nd.uvs.append([tuple(q) for q in uv])
        if two_sided:
            self.poly(role, pts[::-1], uv=list(uv)[::-1], id=id, toggle=toggle)

    def box(self, role, x0, y0, z0, x1, y1, z1, skip=(), id=None, toggle=None, uvmode="box"):
        """Axis-aligned box; `skip` lists faces to leave out ('-x', '+x', '-y', '+y', '-z', '+z')."""
        if x1 - x0 < 1e-7 or y1 - y0 < 1e-7 or z1 - z0 < 1e-7:
            return
        p = self.poly
        kw = dict(id=id, toggle=toggle, uvmode=uvmode)
        if "-z" not in skip:
            p(role, [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0)], (0, 0, -1), **kw)
        if "+z" not in skip:
            p(role, [(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], (0, 0, 1), **kw)
        if "-x" not in skip:
            p(role, [(x0, y0, z0), (x0, y1, z0), (x0, y1, z1), (x0, y0, z1)], (-1, 0, 0), **kw)
        if "+x" not in skip:
            p(role, [(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)], (1, 0, 0), **kw)
        if "-y" not in skip:
            p(role, [(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)], (0, -1, 0), **kw)
        if "+y" not in skip:
            p(role, [(x0, y1, z0), (x1, y1, z0), (x1, y1, z1), (x0, y1, z1)], (0, 1, 0), **kw)

    # ------------------------------------------------------------ stats
    def triangles(self, role=None):
        return sum(n.triangles() for n in self.nodes.values() if role is None or n.role == role)

    def bbox(self, role=None):
        lo = [1e18] * 3
        hi = [-1e18] * 3
        for nd in self.nodes.values():
            if role is not None and nd.role != role:
                continue
            for v in nd.verts:
                for i in range(3):
                    lo[i] = min(lo[i], v[i])
                    hi[i] = max(hi[i], v[i])
        return lo, hi

    def stats(self):
        out = {}
        for nd in self.nodes.values():
            s = out.setdefault(nd.role, {"nodes": 0, "triangles": 0})
            s["nodes"] += 1
            s["triangles"] += nd.triangles()
        return out

    # ------------------------------------------------------------ Blender
    def to_blender(self, collection, materials, uv_tiles):
        """Create one object per node in `collection`. materials: role -> bpy material; uv_tiles: role -> (tu, tv)
        metres per texture repeat. Objects keep an identity transform (vertices are in house coordinates)."""
        import bpy

        objs = []
        for nd in self.sorted_nodes():
            if not nd.faces:
                continue
            tu, tv = uv_tiles.get(nd.role, (1.0, 1.0))
            me = bpy.data.meshes.new(nd.name)
            me.from_pydata([tuple(v) for v in nd.verts], [], [list(f) for f in nd.faces])
            uvl = me.uv_layers.new(name="UVMap")
            flat = []
            for f_uv in nd.uvs:
                for (u, v) in f_uv:
                    flat.extend((u / tu, v / tv))
            uvl.data.foreach_set("uv", flat)
            me.polygons.foreach_set("use_smooth", [False] * len(me.polygons))
            mat = materials.get(nd.role)
            if mat is not None:
                me.materials.append(mat)
            me.update()
            ob = bpy.data.objects.new(nd.name, me)
            ob["role"] = nd.role
            if nd.toggle:
                ob["toggle"] = nd.toggle
            if nd.id is not None:
                ob["id"] = str(nd.id)
            collection.objects.link(ob)
            objs.append(ob)
        return objs
