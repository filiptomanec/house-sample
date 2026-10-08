"""Pools (C1/C3 `outdoor[].pool`): the house builder makes the coping and the liner of the basin (GLB roles `pool_coping`,
`pool_liner`, `water`; docs/ARCHITECTURE.md section 3). The render adds what only a photograph needs:

* **Water** as a closed volume (the water polygon from the floor to `waterZ`): Principled transmission, IOR 1.333, a fine
  ripple normal, an absorption volume in the style `water` colour (deep water turns aqua), and shadow rays that pass
  (Light Path) so the sun still lights the floor of the basin; the GLB water plane is hidden.
* **Liner**: small mosaic tiles in the style `pool_liner` colour and a caustic pattern (Voronoi cell edges, two scales) on the
  parts below the water line. Caustic transport itself is off (noise); the pattern is in the albedo.
* The ground is cut under every basin by terrain.py (`groundVoids`), the grass by lawn.py.
* Underwater spots are lamps (lights.py, kind `pool`).
Fallback while the house builder has no pool roles (an older GLB builder): the liner and the coping are built here and the
paving the old builder laid over the basin is cut away.
"""
from __future__ import annotations

from mathutils import Vector

from .util import hex_to_linear, log


def water_material(c3, name="pool_water"):
    import bpy
    m = bpy.data.materials.get(name)
    if m is not None:
        return m
    spec = c3.material_spec("water")
    col = hex_to_linear(spec.get("color", "#7fcfc4"))
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    N, L = nt.nodes, nt.links
    out = next(n for n in N if n.type == "OUTPUT_MATERIAL")
    bs = N.get("Principled BSDF")
    bs.inputs["Base Color"].default_value = (1.0, 1.0, 1.0, 1)
    bs.inputs["Roughness"].default_value = 0.01
    bs.inputs["IOR"].default_value = 1.333
    for key in ("Transmission Weight", "Transmission"):
        if key in bs.inputs:
            bs.inputs[key].default_value = 1.0
            break
    # ripples: two noise octaves in world space, a gentle bump
    tc = N.new("ShaderNodeTexCoord")
    n1 = N.new("ShaderNodeTexNoise")
    n1.inputs["Scale"].default_value = 1.6
    n1.inputs["Detail"].default_value = 4
    n1.inputs["Roughness"].default_value = 0.55
    L.new(tc.outputs["Object"], n1.inputs["Vector"])
    bu = N.new("ShaderNodeBump")
    bu.inputs["Strength"].default_value = 0.12
    bu.inputs["Distance"].default_value = 0.02
    L.new(n1.outputs["Fac"], bu.inputs["Height"])
    L.new(bu.outputs[0], bs.inputs["Normal"])
    tp = N.new("ShaderNodeBsdfTransparent")
    lp = N.new("ShaderNodeLightPath")
    mx = N.new("ShaderNodeMixShader")
    L.new(lp.outputs["Is Shadow Ray"], mx.inputs[0])
    L.new(bs.outputs[0], mx.inputs[1])
    L.new(tp.outputs[0], mx.inputs[2])
    L.new(mx.outputs[0], out.inputs["Surface"])
    va = N.new("ShaderNodeVolumeAbsorption")
    va.inputs["Color"].default_value = (*col, 1)
    va.inputs["Density"].default_value = 0.45
    L.new(va.outputs[0], out.inputs["Volume"])
    return m


def tune_liner(m, c3, water_z):
    """Mosaic tiles and the caustic pattern below the water line (module doc). Works on the GLB material or a new one."""
    m.use_nodes = True
    nt = m.node_tree
    N, L = nt.nodes, nt.links
    bs = N.get("Principled BSDF") or next((n for n in N if n.type == "BSDF_PRINCIPLED"), None)
    if bs is None or m.get("pool_tuned"):
        return
    m["pool_tuned"] = 1
    base = hex_to_linear(c3.color("pool_liner", "#c5d3d1"))
    tc = N.new("ShaderNodeTexCoord")
    geo = N.new("ShaderNodeNewGeometry")
    br = N.new("ShaderNodeTexBrick")
    br.offset = 0.0
    br.inputs["Scale"].default_value = 1.0
    br.inputs["Brick Width"].default_value = 0.025
    br.inputs["Row Height"].default_value = 0.025
    br.inputs["Mortar Size"].default_value = 0.0015
    br.inputs["Color1"].default_value = (*base, 1)
    br.inputs["Color2"].default_value = (*[c * 0.94 for c in base], 1)
    br.inputs["Mortar"].default_value = (*[c * 0.78 for c in base], 1)
    # box-like coordinates: x + z on the walls along x, y + z along y, x / y on the floor
    sep = N.new("ShaderNodeSeparateXYZ")
    L.new(geo.outputs["Position"], sep.inputs[0])
    sn = N.new("ShaderNodeSeparateXYZ")
    L.new(geo.outputs["Normal"], sn.inputs[0])
    cx = N.new("ShaderNodeCombineXYZ")
    ax = N.new("ShaderNodeMath")
    ax.operation = "ABSOLUTE"
    L.new(sn.outputs["X"], ax.inputs[0])
    mxu = N.new("ShaderNodeMix")
    mxu.data_type = "FLOAT"
    L.new(ax.outputs[0], mxu.inputs[0])
    L.new(sep.outputs["X"], mxu.inputs[2])
    L.new(sep.outputs["Y"], mxu.inputs[3])
    az = N.new("ShaderNodeMath")
    az.operation = "ABSOLUTE"
    L.new(sn.outputs["Z"], az.inputs[0])
    mxv = N.new("ShaderNodeMix")
    mxv.data_type = "FLOAT"
    L.new(az.outputs[0], mxv.inputs[0])
    L.new(sep.outputs["Z"], mxv.inputs[2])
    L.new(sep.outputs["Y"], mxv.inputs[3])
    L.new(mxu.outputs[0], cx.inputs["X"])
    L.new(mxv.outputs[0], cx.inputs["Y"])
    L.new(cx.outputs[0], br.inputs["Vector"])
    # caustics: edges of distorted Voronoi cells at two scales
    def web(scale, seed_off):
        nz = N.new("ShaderNodeTexNoise")
        nz.inputs["Scale"].default_value = scale * 0.6
        L.new(geo.outputs["Position"], nz.inputs["Vector"])
        vm = N.new("ShaderNodeVectorMath")
        vm.operation = "MULTIPLY_ADD"
        vm.inputs[1].default_value = (0.18, 0.18, 0.18)
        L.new(nz.outputs["Color"], vm.inputs[0])
        vm2 = N.new("ShaderNodeVectorMath")
        vm2.operation = "ADD"
        vm2.inputs[1].default_value = (seed_off, seed_off * 0.7, 0.0)
        L.new(geo.outputs["Position"], vm2.inputs[0])
        L.new(vm2.outputs[0], vm.inputs[2])
        vo = N.new("ShaderNodeTexVoronoi")
        vo.feature = "DISTANCE_TO_EDGE"
        vo.inputs["Scale"].default_value = scale
        L.new(vm.outputs[0], vo.inputs["Vector"])
        mr = N.new("ShaderNodeMapRange")
        mr.inputs["From Min"].default_value = 0.0
        mr.inputs["From Max"].default_value = 0.07
        mr.inputs["To Min"].default_value = 1.0
        mr.inputs["To Max"].default_value = 0.0
        L.new(vo.outputs["Distance"], mr.inputs["Value"])
        return mr.outputs[0]
    w = N.new("ShaderNodeMath")
    w.operation = "MAXIMUM"
    L.new(web(3.2, 0.0), w.inputs[0])
    L.new(web(5.1, 3.7), w.inputs[1])
    below = N.new("ShaderNodeMath")
    below.operation = "LESS_THAN"
    below.inputs[1].default_value = water_z - 0.03
    L.new(sep.outputs["Z"], below.inputs[0])
    k = N.new("ShaderNodeMath")
    k.operation = "MULTIPLY"
    L.new(w.outputs[0], k.inputs[0])
    L.new(below.outputs[0], k.inputs[1])
    k2 = N.new("ShaderNodeMath")
    k2.operation = "MULTIPLY_ADD"
    k2.inputs[1].default_value = 0.38
    k2.inputs[2].default_value = 1.0
    L.new(k.outputs[0], k2.inputs[0])
    sc = N.new("ShaderNodeVectorMath")
    sc.operation = "SCALE"
    L.new(br.outputs["Color"], sc.inputs[0])
    L.new(k2.outputs[0], sc.inputs["Scale"])
    for l in list(bs.inputs["Base Color"].links):
        L.remove(l)
    L.new(sc.outputs[0], bs.inputs["Base Color"])
    bs.inputs["Roughness"].default_value = 0.18
    del tc


def _box_faces(x0, y0, x1, y1, z0, z1, inward=False):
    v = [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)]
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    if inward:
        f = [tuple(reversed(q)) for q in f]
    return v, f


def _mesh(name, v, f, mat, col):
    import bpy
    me = bpy.data.meshes.new(name)
    me.from_pydata(v, [], f)
    me.materials.append(mat)
    me.update()
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    return ob


def _fallback_basin(scn, p, col):
    """Liner, coping and the cut through the old paving, for a house builder without pool roles."""
    import bpy
    from . import surfaces
    hbcfg = scn.house["cfg"]
    x0, y0, x1, y1 = p["water"]
    ox0, oy0, ox1, oy1 = p["outer"]
    top, floor = float(p["copingTop"]), float(p["floorZ"])
    liner = bpy.data.materials.get("pool_liner") or bpy.data.materials.new("pool_liner")
    v, f = _box_faces(x0, y0, x1, y1, floor, top - 0.001, inward=True)
    _mesh("pool_liner_fallback", v, f[:1] + f[2:], liner, col)      # open top
    try:
        coping = surfaces.role_material("pool_coping", hbcfg)
    except Exception:
        coping = surfaces.role_material("terrace_paving", hbcfg)
    vs, fs = [], []
    for (a, b, c, d) in ((ox0, oy0, ox1, y0 + 0.02), (ox0, y1 - 0.02, ox1, oy1), (ox0, y0, x0 + 0.02, y1), (x1 - 0.02, y0, ox1, y1)):
        v, f = _box_faces(a, b, c, d, top - 0.05, top + 0.006)
        i0 = len(vs)
        vs += v
        fs += [tuple(i0 + j for j in q) for q in f]
    _mesh("pool_coping_fallback", vs, fs, coping, col)
    # cut the old paving over the basin
    cv, cf = _box_faces(ox0 + 0.01, oy0 + 0.01, ox1 - 0.01, oy1 - 0.01, floor - 0.8, top + 0.004)
    cutter = _mesh("pool_cutter", cv, cf, liner, col)
    cutter.hide_render = True
    cutter.hide_viewport = True
    n = 0
    for ob in scn.house["house"].all_objects:
        if ob.type != "MESH":
            continue
        bb = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
        if max(q.x for q in bb) < ox0 or min(q.x for q in bb) > ox1 or max(q.y for q in bb) < oy0 or min(q.y for q in bb) > oy1:
            continue
        if max(q.z for q in bb) < floor or min(q.z for q in bb) > top + 0.01:
            continue
        mod = ob.modifiers.new("pool_cut", "BOOLEAN")
        mod.operation = "DIFFERENCE"
        mod.object = cutter
        n += 1
    return n


def build(scn, terrain):
    import bpy
    c3 = scn.c3
    pools = c3.pools()
    if not pools:
        return
    col = bpy.data.collections.new("pool")
    bpy.context.scene.collection.children.link(col)
    glb_pool = bpy.data.materials.get("pool_liner") is not None
    hidden = 0
    for ob in scn.house["house"].all_objects:
        if ob.type == "MESH" and any(m and m.name == "water" for m in ob.data.materials):
            ob.hide_render = True
            hidden += 1
    wm = water_material(c3)
    cut = 0
    for i, p in enumerate(pools):
        if not glb_pool:
            cut += _fallback_basin(scn, p, col)
        x0, y0, x1, y1 = p["water"]
        e = 0.002
        v, f = _box_faces(x0 + e, y0 + e, x1 - e, y1 - e, float(p["floorZ"]) + e, float(p["waterZ"]))
        w = _mesh("pool_water_%d" % i, v, f, wm, col)
        w.visible_shadow = True
        liner = bpy.data.materials.get("pool_liner")
        if liner:
            tune_liner(liner, c3, float(p["waterZ"]))
    log("pool: %d basin(s), water volume with absorption; GLB water planes hidden: %d; %s"
        % (len(pools), hidden, "liner from the house GLB" if glb_pool else "fallback liner and coping (%d cuts)" % cut))
