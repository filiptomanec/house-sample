"""Draped surfaces of the site (paths, aprons, mulch and gravel beds): the polygon is triangulated, subdivided and laid on the
terrain mesh a few millimetres above it. Surfaces the house model already contains (`inGlb`) are skipped."""
from __future__ import annotations

from . import ground_materials as GM
from .util import log

LIFT = {"terrace_paving": 0.006, "drive_paving": 0.006, "path": 0.006, "gravel": 0.012, "mulch": 0.018}


def role_material(role, hbcfg):
    import bpy
    m = bpy.data.materials.get(role)
    if m is not None:
        return m
    if role == "mulch":
        return GM.mulch()
    from hb import materials as HM        # pipeline/blender is on sys.path (assemble.build_house)
    specs = HM.resolve_specs(hbcfg.style)
    return HM.make_material(bpy, hbcfg, role, specs[role], "render")


def build(scn, terrain):
    import bmesh
    import bpy
    from hb import materials as HM
    hbcfg = scn.house["cfg"]
    tiles = HM.uv_tiles(HM.resolve_specs(hbcfg.style))
    col = bpy.data.collections.new("surfaces")
    bpy.context.scene.collection.children.link(col)
    n = 0
    for i, s in enumerate(scn.inputs["site"]["surfaces"]):
        if s.get("inGlb") or len(s["polygon"]) < 3:
            continue
        role = s["role"]
        tx, ty = tiles.get(role, (1.5, 1.5))
        bm = bmesh.new()
        vs = [bm.verts.new((x, y, 0.0)) for x, y in s["polygon"]]
        f = bm.faces.new(vs)
        bmesh.ops.triangulate(bm, faces=[f])
        for _ in range(8):
            long_e = [e for e in bm.edges if e.calc_length() > 0.45]
            if not long_e:
                break
            bmesh.ops.subdivide_edges(bm, edges=long_e, cuts=1, use_grid_fill=True)
        lift = LIFT.get(role, 0.008)
        for v in bm.verts:
            v.co.z = terrain.z(v.co.x, v.co.y) + lift
        bm.normal_update()
        for fc in bm.faces:
            if fc.normal.z < 0:
                fc.normal_flip()
        uv = bm.loops.layers.uv.new("UVMap")
        for fc in bm.faces:
            for lp in fc.loops:
                lp[uv].uv = (lp.vert.co.x / tx, lp.vert.co.y / ty)
        me = bpy.data.meshes.new("surface_%d_%s" % (i, role))
        bm.to_mesh(me)
        bm.free()
        for p in me.polygons:
            p.use_smooth = False
        me.materials.append(role_material(role, hbcfg))
        ob = bpy.data.objects.new(me.name, me)
        col.objects.link(ob)
        n += 1
    log("surfaces: %d draped meshes" % n)
