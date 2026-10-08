"""Lawn blades: procedural patches of fine, mown grass blades scattered over the terrain with Geometry Nodes.

* Blades (own geometry, no asset): `grassBladesPerPatch` tapered, bent ribbons in a square of `grassPatchM`, each 3 segments;
  heights and widths of a mown lawn of fine grasses (`ground.blade`), a share of dry blades (`ground.dryBlades`). A few
  patch variants are instanced, so the lawn costs a few thousand triangles of memory.
* Distribution: Poisson disc (`grassDensityPerM2` patches per m2 at the most, a minimum distance that keeps the patches from
  clumping), times the face attribute `grass` of the terrain (the plot lawn and the green verge, faded far from the house).
* Mask by point proximity: a blade patch is dropped when its centre lies on, or within `grassEdgeGapM` of, any surface that is
  not lawn (paving, beds, the house, the pool, the pavement and the carriageway): a flat mesh of those polygons (`no_grass`,
  never rendered) is the target of a Geometry Proximity node, so the edge is exact, not the 0.5 m staircase of the grid.
* Height scale `grassScale` (the patch footprint keeps its size, so the cover stays closed). Colours from `style.json`
  `lawnColors` (root, tip) with a random tone per blade and per patch, low-frequency patches and faint mowing stripes along
  the house axes; light shines through the thin blades.
"""
from __future__ import annotations

import math

from . import plants
from .util import hex_to_linear, rng


def blade_patch(name, cfg, seed):
    """One patch mesh: blades as tapered ribbons (UV v = 0 at the root .. 1 at the tip, u across), a per-blade random value
    (`blade` attribute, 0..1) and a dry flag (`dry`, 0 or 1) for the shader."""
    import bpy
    g = cfg["ground"]
    bl = g.get("blade") or {}
    h0, h1 = bl.get("heightM", (0.07, 0.14))
    w0, w1 = bl.get("widthM", (0.0028, 0.0045))
    lean0, lean1 = bl.get("lean", (0.12, 0.5))
    dry_share = float((g.get("dryBlades") or {}).get("share", 0.0))
    size = float(g["grassPatchM"])
    r = rng("lawn-blades", seed)
    verts, faces, uvs, rnd, dry = [], [], [], [], []
    segs = 3
    for _ in range(int(g["grassBladesPerPatch"])):
        x, y = (r.random() - 0.5) * size, (r.random() - 0.5) * size
        h = r.uniform(h0, h1)
        w = r.uniform(w0, w1)
        yaw = r.uniform(0, 2 * math.pi)
        lean_dir = yaw + math.pi / 2 * (1 if r.random() < 0.5 else -1) + r.uniform(-0.4, 0.4)   # bends across its face
        lean = r.uniform(lean0, lean1) * h
        cx, cy = math.cos(yaw), math.sin(yaw)              # across the blade
        lx, ly = math.cos(lean_dir), math.sin(lean_dir)
        rv = r.random()
        dv = 1.0 if r.random() < dry_share else 0.0
        i0 = len(verts)
        for k in range(segs + 1):
            t = k / segs
            bend = lean * t * t                              # the blade bends over towards its tip
            px, py, pz = x + lx * bend, y + ly * bend, h * (t - 0.18 * t * t * (lean / max(h, 1e-6)))
            half = 0.5 * w * (1.0 - t ** 1.6)
            if k == segs:
                verts.append((px, py, pz))
                uvs.append((0.5, 1.0))
            else:
                verts.append((px - cx * half, py - cy * half, pz))
                verts.append((px + cx * half, py + cy * half, pz))
                uvs += [(0.0, t), (1.0, t)]
        for k in range(segs - 1):
            a0 = i0 + 2 * k
            faces.append((a0, a0 + 1, a0 + 3, a0 + 2))
        tip = i0 + 2 * segs
        faces.append((tip - 2, tip - 1, tip))
        rnd += [rv] * (2 * segs + 1)
        dry += [dv] * (2 * segs + 1)
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    uvl = me.uv_layers.new(name="UVMap")
    for poly in me.polygons:
        for li, vi in zip(poly.loop_indices, poly.vertices):
            uvl.data[li].uv = uvs[vi]
    for key, vals in (("blade", rnd), ("dry", dry)):
        at = me.attributes.new(key, "FLOAT", "POINT")
        at.data.foreach_set("value", vals)
    for poly in me.polygons:
        poly.use_smooth = True
    me.update()
    return me


def make_patches(cfg, colors, count=4):
    """`count` patch variants (blade_patch) sharing one blade material; returns a (library) collection."""
    import bpy
    col = bpy.data.collections.new("V_lawn")
    plants._library().children.link(col)
    mat = blade_material(cfg, colors)
    for k in range(count):
        me = blade_patch("lawn_patch_%d" % k, cfg, k)
        me.materials.append(mat)
        col.objects.link(bpy.data.objects.new(me.name, me))
    return col


def blade_material(cfg, colors):
    """Root-to-tip gradient (`lawnColors`), a random tone per blade and per patch, slow patches and mowing stripes (by the
    instance location), dry blades in `ground.dryBlades.color`; translucent and a little glossy like real blades."""
    import bpy
    m = bpy.data.materials.new("lawn_blades")
    m.use_nodes = True
    nodes, links = m.node_tree.nodes, m.node_tree.links
    bs = nodes.get("Principled BSDF")
    out = next(n for n in nodes if n.type == "OUTPUT_MATERIAL")
    bs.inputs["Roughness"].default_value = 0.42
    if "Specular IOR Level" in bs.inputs:
        bs.inputs["Specular IOR Level"].default_value = 0.4
    uv = nodes.new("ShaderNodeUVMap")
    sep = nodes.new("ShaderNodeSeparateXYZ")
    links.new(uv.outputs[0], sep.inputs[0])
    ramp = nodes.new("ShaderNodeValToRGB")
    root, tip = hex_to_linear(colors[0]), hex_to_linear(colors[1])
    ramp.color_ramp.elements[0].color = (*[c * 0.7 for c in root], 1)
    ramp.color_ramp.elements[1].position = 0.85
    ramp.color_ramp.elements[1].color = (*tip, 1)
    links.new(sep.outputs["Y"], ramp.inputs["Fac"])
    # dry blades: the gradient towards the straw colour of the config
    dry_cfg = cfg["ground"].get("dryBlades") or {}
    dry = nodes.new("ShaderNodeAttribute")
    dry.attribute_name = "dry"
    mixd = nodes.new("ShaderNodeMix")
    mixd.data_type = "RGBA"
    links.new(dry.outputs["Fac"], mixd.inputs[0])
    links.new(ramp.outputs["Color"], mixd.inputs[6])
    mixd.inputs[7].default_value = (*hex_to_linear(dry_cfg.get("color", "#8f8a52")), 1)
    col = mixd.outputs[2]
    # tone: per blade (attribute) x per patch (Object Info) x slow patches x mowing stripes
    blade = nodes.new("ShaderNodeAttribute")
    blade.attribute_name = "blade"
    rb = nodes.new("ShaderNodeMapRange")
    rb.inputs["To Min"].default_value = 0.78
    rb.inputs["To Max"].default_value = 1.18
    links.new(blade.outputs["Fac"], rb.inputs["Value"])
    oi = nodes.new("ShaderNodeObjectInfo")
    ra = nodes.new("ShaderNodeMapRange")
    ra.inputs["To Min"].default_value = 0.9
    ra.inputs["To Max"].default_value = 1.08
    links.new(oi.outputs["Random"], ra.inputs["Value"])
    nz = nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 0.22
    nz.inputs["Detail"].default_value = 2
    links.new(oi.outputs["Location"], nz.inputs["Vector"])
    rn = nodes.new("ShaderNodeMapRange")
    rn.inputs["From Min"].default_value = 0.3
    rn.inputs["From Max"].default_value = 0.7
    rn.inputs["To Min"].default_value = 0.9
    rn.inputs["To Max"].default_value = 1.08
    links.new(nz.outputs["Fac"], rn.inputs["Value"])
    sl = nodes.new("ShaderNodeSeparateXYZ")
    links.new(oi.outputs["Location"], sl.inputs[0])
    sc = nodes.new("ShaderNodeMath")
    sc.operation = "MULTIPLY"
    sc.inputs[1].default_value = math.pi / float(cfg["ground"].get("stripeM", 1.25))
    links.new(sl.outputs["X"], sc.inputs[0])
    wv = nodes.new("ShaderNodeMath")
    wv.operation = "SINE"
    links.new(sc.outputs[0], wv.inputs[0])
    st = nodes.new("ShaderNodeMapRange")
    st.inputs["From Min"].default_value = -0.3
    st.inputs["From Max"].default_value = 0.3
    st.inputs["To Min"].default_value = 0.96
    st.inputs["To Max"].default_value = 1.04
    links.new(wv.outputs[0], st.inputs["Value"])
    tone = rb.outputs[0]
    for f in (ra.outputs[0], rn.outputs[0], st.outputs[0]):
        mm = nodes.new("ShaderNodeMath")
        mm.operation = "MULTIPLY"
        links.new(tone, mm.inputs[0])
        links.new(f, mm.inputs[1])
        tone = mm.outputs[0]
    hsv = nodes.new("ShaderNodeHueSaturation")
    links.new(tone, hsv.inputs["Value"])
    links.new(col, hsv.inputs["Color"])
    links.new(hsv.outputs[0], bs.inputs["Base Color"])
    tr = nodes.new("ShaderNodeBsdfTranslucent")
    links.new(hsv.outputs[0], tr.inputs["Color"])
    mix = nodes.new("ShaderNodeMixShader")
    mix.inputs[0].default_value = 0.25
    links.new(bs.outputs[0], mix.inputs[1])
    links.new(tr.outputs[0], mix.inputs[2])
    links.new(mix.outputs[0], out.inputs[0])
    return m


def exclusion_mesh(name, polygons):
    """A flat mesh (z = 0) of the polygons where no grass grows; never rendered (hidden collection). Concave outlines (an L-shaped
    path) are tessellated exactly (mathutils.geometry.tessellate_polygon)."""
    import bpy
    from mathutils import Vector
    from mathutils.geometry import tessellate_polygon
    verts, faces = [], []
    for poly in polygons:
        if len(poly) < 3:
            continue
        ring = [Vector((float(p[0]), float(p[1]), 0.0)) for p in poly]
        i0 = len(verts)
        verts += [tuple(v) for v in ring]
        faces += [(i0 + a, i0 + b, i0 + c) for a, b, c in tessellate_polygon([ring])]
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    plants._library().objects.link(ob)
    return ob


def scatter(obj, collection, density, smin, smax, seed, name, zoff=0.0, attribute="grass", exclude=None, gap=0.03,
            poisson=True, xy=None):
    """Geometry-nodes modifier: instances of the objects of `collection` on the faces of `obj`: at most `density` per m2 times
    the face attribute `attribute`, Poisson disc distributed; points on or within `gap` of the faces of `exclude` are dropped."""
    import bpy
    mod = obj.modifiers.new(name, "NODES")
    ng = bpy.data.node_groups.new(name, "GeometryNodeTree")
    ng.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    ng.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    N, L = ng.nodes, ng.links
    gi, go = N.new("NodeGroupInput"), N.new("NodeGroupOutput")
    na = N.new("GeometryNodeInputNamedAttribute")
    na.data_type = "FLOAT"
    na.inputs["Name"].default_value = attribute
    dist = N.new("GeometryNodeDistributePointsOnFaces")
    L.new(gi.outputs[0], dist.inputs["Mesh"])
    if poisson:
        dist.distribute_method = "POISSON"
        # dart throwing: candidates at 3 x the density, thinned to a minimum distance of 0.5 / sqrt(density); about `density`
        # points per m2 survive, evenly spread (no clumps, no large holes)
        dist.inputs["Distance Min"].default_value = 0.5 / max(density, 1e-3) ** 0.5
        dist.inputs["Density Max"].default_value = density * 3.0
        L.new(na.outputs["Attribute"], dist.inputs["Density Factor"])
    else:
        dist.distribute_method = "RANDOM"
        mul = N.new("ShaderNodeMath")
        mul.operation = "MULTIPLY"
        mul.inputs[1].default_value = density
        L.new(na.outputs["Attribute"], mul.inputs[0])
        L.new(mul.outputs[0], dist.inputs["Density"])
    dist.inputs["Seed"].default_value = seed
    ci = N.new("GeometryNodeCollectionInfo")
    ci.inputs["Collection"].default_value = collection
    ci.inputs["Separate Children"].default_value = True
    ci.inputs["Reset Children"].default_value = True
    inst = N.new("GeometryNodeInstanceOnPoints")
    inst.inputs["Pick Instance"].default_value = True
    if exclude is not None:
        oi = N.new("GeometryNodeObjectInfo")
        oi.transform_space = "RELATIVE"
        oi.inputs["Object"].default_value = exclude
        pos = N.new("GeometryNodeInputPosition")
        flat = N.new("ShaderNodeVectorMath")
        flat.operation = "MULTIPLY"
        flat.inputs[1].default_value = (1.0, 1.0, 0.0)
        L.new(pos.outputs[0], flat.inputs[0])
        prox = N.new("GeometryNodeProximity")
        try:
            prox.target_element = "FACES"
        except (AttributeError, TypeError):
            pass
        L.new(oi.outputs["Geometry"], prox.inputs[0])
        src_in = prox.inputs.get("Source Position") or prox.inputs.get("Sample Position")
        L.new(flat.outputs[0], src_in)
        cmp = N.new("FunctionNodeCompare")
        cmp.data_type = "FLOAT"
        cmp.operation = "GREATER_THAN"
        cmp.inputs[1].default_value = gap
        L.new(prox.outputs["Distance"], cmp.inputs[0])
        L.new(cmp.outputs[0], inst.inputs["Selection"])
    rz = N.new("FunctionNodeRandomValue")
    rz.data_type = "FLOAT_VECTOR"
    rz.inputs["Min"].default_value = (0, 0, 0)
    rz.inputs["Max"].default_value = (0.08, 0.08, 6.283)
    rz.inputs["Seed"].default_value = seed + 1
    rs = N.new("FunctionNodeRandomValue")
    rs.data_type = "FLOAT_VECTOR"
    # the footprint keeps its size (coverage), the height is scaled (`smin`..`smax`: a mown lawn, a low planting)
    rs.inputs["Min"].default_value = (xy[0], xy[0], smin) if xy else (smin, smin, smin)
    rs.inputs["Max"].default_value = (xy[1], xy[1], smax) if xy else (smax, smax, smax)
    rs.inputs["Seed"].default_value = seed + 2
    ri = N.new("FunctionNodeRandomValue")
    ri.data_type = "INT"
    ri.inputs[4].default_value = 0
    ri.inputs[5].default_value = 99
    ri.inputs["Seed"].default_value = seed + 3
    L.new(dist.outputs["Points"], inst.inputs["Points"])
    L.new(ci.outputs[0], inst.inputs["Instance"])
    L.new(rz.outputs[0], inst.inputs["Rotation"])
    L.new(rs.outputs[0], inst.inputs["Scale"])
    L.new(ri.outputs[2], inst.inputs["Instance Index"])
    tr = N.new("GeometryNodeTranslateInstances")
    tr.inputs["Translation"].default_value = (0, 0, zoff)
    L.new(inst.outputs[0], tr.inputs["Instances"])
    j = N.new("GeometryNodeJoinGeometry")
    L.new(gi.outputs[0], j.inputs[0])
    L.new(tr.outputs[0], j.inputs[0])
    L.new(j.outputs[0], go.inputs[0])
    mod.node_group = ng
    return mod
