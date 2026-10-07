"""Fences, kerbs and the asphalt of the street: boxes swept along polylines that follow the terrain (ray cast)."""
from __future__ import annotations

import math

from mathutils import Vector

from . import ground_materials as GM
from .util import log


def _samples(path, step):
    pts = []
    for i in range(len(path) - 1):
        a, b = Vector((path[i][0], path[i][1], 0)), Vector((path[i + 1][0], path[i + 1][1], 0))
        n = max(1, int(math.ceil((b - a).length / step)))
        for k in range(n):
            pts.append(a.lerp(b, k / n))
    pts.append(Vector((path[-1][0], path[-1][1], 0)))
    return pts


def sweep_box(name, path, width, z0, z1, zfunc, material, step=1.0, tile=1.8, cap=True, ground_follow=True):
    """A rectangular bar (width x [z0, z1] above the ground) along a polyline; each cross-section sits on the ground there
    (z0 is relative to the local ground, so a fence steps with the terrain smoothly)."""
    import bmesh
    import bpy
    pts = _samples(path, step)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    rings, dist = [], [0.0]
    for i in range(1, len(pts)):
        dist.append(dist[-1] + (pts[i] - pts[i - 1]).length)
    for i, p in enumerate(pts):
        d = pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]
        d.z = 0
        d.normalize()
        side = Vector((-d.y, d.x, 0)) * (width * 0.5)
        g = zfunc(p.x, p.y)
        a, b = Vector((p.x, p.y, 0)) - side, Vector((p.x, p.y, 0)) + side
        rings.append([bm.verts.new((a.x, a.y, g + z0)), bm.verts.new((b.x, b.y, g + z0)),
                      bm.verts.new((b.x, b.y, g + z1)), bm.verts.new((a.x, a.y, g + z1))])
    faces = []
    for i in range(len(rings) - 1):
        for k in range(4):
            k2 = (k + 1) % 4
            faces.append(bm.faces.new((rings[i][k], rings[i + 1][k], rings[i + 1][k2], rings[i][k2])))
            f = faces[-1]
            for lp in f.loops:
                idx = 0 if lp.vert in rings[i] else 1
                lp[uvl].uv = (dist[i + idx] / tile, (lp.vert.co.z - (zfunc(lp.vert.co.x, lp.vert.co.y))) / tile)
    if cap:
        bm.faces.new(rings[0][::-1])
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(material)
    return bpy.data.objects.new(name, me)


def slat_boards(name, path, height, zfunc, material, board=0.12, gap=0.012, depth=0.025, z0=0.45):
    """Vertical boards along a polyline (one mesh); every board stands on the ground at its own place, so the fence steps with
    the terrain. The boards are slightly different in height."""
    import bmesh
    import bpy
    from .util import rng
    r = rng("boards", name)
    pts = _samples(path, board + gap)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        d = (b - a)
        L = d.length
        if L < 1e-6:
            continue
        d /= L
        side = Vector((-d.y, d.x, 0)) * (depth * 0.5)
        mid = a + d * (board * 0.5)
        g = zfunc(mid.x, mid.y)
        top = g + height - r.uniform(0.0, 0.03)
        lo = g + z0
        p0, p1 = a + d * 0.0, a + d * board
        vs = [bm.verts.new((p0.x - side.x, p0.y - side.y, lo)), bm.verts.new((p1.x - side.x, p1.y - side.y, lo)),
              bm.verts.new((p1.x - side.x, p1.y - side.y, top)), bm.verts.new((p0.x - side.x, p0.y - side.y, top)),
              bm.verts.new((p0.x + side.x, p0.y + side.y, lo)), bm.verts.new((p1.x + side.x, p1.y + side.y, lo)),
              bm.verts.new((p1.x + side.x, p1.y + side.y, top)), bm.verts.new((p0.x + side.x, p0.y + side.y, top))]
        for q in ((0, 1, 2, 3), (5, 4, 7, 6), (1, 5, 6, 2), (4, 0, 3, 7), (3, 2, 6, 7)):
            f = bm.faces.new([vs[j] for j in q])
            for lp in f.loops:
                lp[uvl].uv = ((lp.vert.co.x + lp.vert.co.y) * 0.3 + i * 0.37, (lp.vert.co.z - g) / 1.8)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(material)
    return bpy.data.objects.new(name, me)


def post_boxes(name, pts, size, height, zfunc, material):
    """Square posts standing on the ground at the given xy points (one joined mesh)."""
    import bmesh
    import bpy
    bm = bmesh.new()
    for (x, y) in pts:
        g = zfunc(x, y) - 0.05
        r = bmesh.ops.create_cube(bm, size=1.0)
        for v in r["verts"]:
            v.co = (x + v.co.x * size, y + v.co.y * size, g + (v.co.z + 0.5) * (height + 0.05))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(material)
    return bpy.data.objects.new(name, me)


def darker(m, f):
    """Copy of a material with its tint multiplied by f (the house materials multiply a tint colour into the texture)."""
    m2 = m.copy()
    m2.name = m.name + "_dark"
    for n in m2.node_tree.nodes:
        if n.type == "MIX" and getattr(n, "blend_type", "") == "MULTIPLY" and len(n.inputs) > 7:
            c = n.inputs[7].default_value
            n.inputs[7].default_value = (c[0] * f, c[1] * f, c[2] * f, 1.0)
    return m2


def build(scn, terrain):
    import bpy
    from . import surfaces
    hbcfg = scn.house["cfg"]
    col = bpy.data.collections.new("fences")
    bpy.context.scene.collection.children.link(col)
    zf = lambda x, y: terrain.z(x, y)  # noqa: E731
    site = scn.inputs["site"]
    wood = surfaces.role_material("wood_cladding", hbcfg)
    concrete = surfaces.role_material("slab", hbcfg)
    post_mat = surfaces.role_material("frame", hbcfg)
    fence_wood = darker(wood, 0.72)
    nobj = 0
    for fi, f in enumerate(site["fences"]):
        for pi, part in enumerate(f["parts"]):
            h, th = float(f["height"]), float(f["thickness"])
            if f["kind"] == "plinth_fence":
                col.objects.link(sweep_box("plinth_%d_%d" % (fi, pi), part, th, -0.25, 0.45, zf, concrete, tile=2.0))
                col.objects.link(slat_boards("boards_%d_%d" % (fi, pi), part, h, zf, fence_wood, z0=0.45))
                nobj += 2
            else:
                col.objects.link(slat_boards("fence_%d_%d" % (fi, pi), part, h, zf, fence_wood, board=0.14, gap=0.01, depth=th, z0=0.1))
                pts = [(p.x, p.y) for p in _samples(part, 2.4)]
                col.objects.link(post_boxes("posts_%d_%d" % (fi, pi), pts, 0.09, h + 0.05, zf, wood))
                nobj += 2
    # the street: asphalt, kerbs on both edges of the carriageway
    st = site["zones"]["street"]
    cw = st["carriageway"]
    import bmesh
    bm = bmesh.new()
    vs = [bm.verts.new((x, y, 0.0)) for x, y in cw]
    fc = bm.faces.new(vs)
    bmesh.ops.triangulate(bm, faces=[fc])
    for _ in range(9):
        longe = [e for e in bm.edges if e.calc_length() > 0.9]
        if not longe:
            break
        bmesh.ops.subdivide_edges(bm, edges=longe, cuts=1, use_grid_fill=True)
    for v in bm.verts:
        v.co.z = terrain.z(v.co.x, v.co.y) + 0.004
    bm.normal_update()
    for f in bm.faces:
        if f.normal.z < 0:
            f.normal_flip()
    me = bpy.data.meshes.new("asphalt")
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    me.materials.append(GM.asphalt_material())
    col.objects.link(bpy.data.objects.new("asphalt", me))
    kh = float(st.get("kerbHeight", 0.12))
    kerb_mat = surfaces.role_material("floor_concrete", hbcfg)
    for k, edge in enumerate(((cw[0], cw[1]), (cw[2], cw[3]))):
        col.objects.link(sweep_box("kerb_%d" % k, [edge[0], edge[1]], 0.16, -0.02, kh, zf, kerb_mat, step=1.5, tile=2.0))
    log("fences: %d objects, street with kerbs" % nobj)
