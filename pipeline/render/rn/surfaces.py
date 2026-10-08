"""Draped surfaces of the site and of the street: the polygon is triangulated, subdivided and laid on the terrain mesh a few
millimetres above it. Surfaces the house model already contains (`inGlb`) are skipped. The pavement of the street (C3
`zones.street.pavement`) is built by street.py with the same `drape`. Beds and draped
paths get a graphite steel lawn edging (`config.json` `ground.edging`)."""
from __future__ import annotations

from mathutils import Vector

from . import ground_materials as GM
from .util import hex_to_linear, log

LIFT = {"terrace_paving": 0.006, "drive_paving": 0.009, "path": 0.009, "gravel": 0.012, "mulch": 0.016}
EDGED = ("mulch", "gravel")                      # beds always get an edging
EDGED_KINDS = ("service_path", "bins")           # draped paved areas inside the plot


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


def pavement_material(c3):
    import bpy
    m = bpy.data.materials.get("street_pavement")
    if m is not None:
        return m
    return GM.tinted_texture("street_pavement", "concrete_pavers_02", 1.6, c3.color("pavement", "#b8b6ab"), nstr=0.8,
                             anti_tile=False) or role_material("path", None)


def drape(name, polygon, terrain, lift, material, tiles=(1.5, 1.5), max_edge=0.45):
    """A draped mesh object (not linked); `lift` is metres above the terrain or a function lift(x, y)."""
    import bmesh
    import bpy
    tx, ty = tiles
    bm = bmesh.new()
    vs = [bm.verts.new((float(x), float(y), 0.0)) for x, y in polygon]
    f = bm.faces.new(vs)
    bmesh.ops.triangulate(bm, faces=[f])
    for _ in range(10):
        long_e = [e for e in bm.edges if e.calc_length() > max_edge]
        if not long_e:
            break
        bmesh.ops.subdivide_edges(bm, edges=long_e, cuts=1, use_grid_fill=True)
    for v in bm.verts:
        v.co.z = terrain.z(v.co.x, v.co.y) + (lift(v.co.x, v.co.y) if callable(lift) else lift)
    bm.normal_update()
    for fc in bm.faces:
        if fc.normal.z < 0:
            fc.normal_flip()
    uv = bm.loops.layers.uv.new("UVMap")
    for fc in bm.faces:
        for lp in fc.loops:
            lp[uv].uv = (lp.vert.co.x / tx, lp.vert.co.y / ty)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = False
    me.materials.append(material)
    return bpy.data.objects.new(me.name, me)


def edging(name, polygon, terrain, spec, material, step=0.5):
    """A thin steel strip along a closed polygon outline: `width` thick, `reveal` above the ground, `depth` into it."""
    import bmesh
    import bpy
    pts = []
    n = len(polygon)
    for i in range(n):
        a, b = Vector((*polygon[i], 0)), Vector((*polygon[(i + 1) % n], 0))
        k = max(1, int((b - a).length / step))
        for j in range(k):
            pts.append(a.lerp(b, j / k))
    pts.append(pts[0].copy())
    bm = bmesh.new()
    w = float(spec["width"]) / 2
    rings = []
    for i, p in enumerate(pts):
        d = pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]
        d.z = 0
        if d.length < 1e-9:
            d = Vector((1, 0, 0))
        d.normalize()
        s = Vector((-d.y, d.x, 0)) * w
        g = terrain.z(p.x, p.y)
        z0, z1 = g - float(spec["depth"]), g + float(spec["reveal"])
        rings.append([bm.verts.new((p.x - s.x, p.y - s.y, z0)), bm.verts.new((p.x + s.x, p.y + s.y, z0)),
                      bm.verts.new((p.x + s.x, p.y + s.y, z1)), bm.verts.new((p.x - s.x, p.y - s.y, z1))])
    for i in range(len(rings) - 1):
        for k in range(4):
            k2 = (k + 1) % 4
            bm.faces.new((rings[i][k], rings[i + 1][k], rings[i + 1][k2], rings[i][k2]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(material)
    return bpy.data.objects.new(name, me)


def steel_material(c3, name="steel_graphite", role="fence_post"):
    import bpy
    m = bpy.data.materials.get(name)
    if m is not None:
        return m
    spec = c3.material_spec(role)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bs = m.node_tree.nodes.get("Principled BSDF")
    bs.inputs["Base Color"].default_value = (*hex_to_linear(spec.get("color", "#2b2e31")), 1)
    bs.inputs["Metallic"].default_value = float(spec.get("metallic", 0.3))
    bs.inputs["Roughness"].default_value = float(spec.get("roughness", 0.45))
    return m


def build(scn, terrain):
    import bpy
    from hb import materials as HM
    hbcfg = scn.house["cfg"]
    c3 = scn.c3
    tiles = HM.uv_tiles(HM.resolve_specs(hbcfg.style))
    col = bpy.data.collections.new("surfaces")
    bpy.context.scene.collection.children.link(col)
    n = 0
    beds = []
    for i, s in enumerate(scn.inputs["site"]["surfaces"]):
        if s.get("inGlb") or len(s["polygon"]) < 3:
            continue
        role = s["role"]
        ob = drape("surface_%d_%s" % (i, role), s["polygon"], terrain, LIFT.get(role, 0.008), role_material(role, hbcfg),
                   tiles.get(role, (1.5, 1.5)))
        ob["surface_kind"] = s.get("kind", role)
        col.objects.link(ob)
        if role in ("mulch",):
            beds.append(ob)
        n += 1
    # lawn edging around beds and the draped paths of the plot
    edge_mat = steel_material(c3)
    ne = 0
    for i, s in enumerate(scn.inputs["site"]["surfaces"]):
        if s.get("inGlb"):
            continue
        if s["role"] in EDGED or s.get("kind") in EDGED_KINDS:
            col.objects.link(edging("edging_%d" % i, s["polygon"], terrain, scn.cfg["ground"]["edging"], edge_mat))
            ne += 1
    scn.bed_objects = beds
    log("surfaces: %d draped meshes, %d edgings" % (n, ne))
