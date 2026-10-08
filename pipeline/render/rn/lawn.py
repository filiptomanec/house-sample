"""Lawn blades: patches of Poly Haven bermuda blades scattered over the terrain faces with Geometry Nodes. The density comes
from the face attribute `grass` of the terrain mesh (0 under paving, fading with the distance from the house)."""
from __future__ import annotations

from . import plants
from .util import rng


def make_patches(cfg, count=4):
    """`count` patches of `grassBladesPerPatch` blades in a square of `grassPatchM`; returns a (library) collection."""
    import bpy
    from mathutils import Matrix
    g = cfg["ground"]
    blades = [o for o in plants.load_model("grass_bermuda_01") if any(k in o.name for k in ("medium", "small", "flattened"))]
    col = bpy.data.collections.new("V_lawn")
    plants._library().children.link(col)
    tmp = bpy.data.collections.new("tmp_patch")
    bpy.context.scene.collection.children.link(tmp)
    size = g["grassPatchM"]
    for k in range(count):
        r = rng("lawn-patch", k)
        parts = []
        for _ in range(g["grassBladesPerPatch"]):
            src = r.choice(blades)
            o = src.copy()
            o.data = src.data.copy()
            tmp.objects.link(o)
            o.matrix_world = (Matrix.Translation(((r.random() - 0.5) * size, (r.random() - 0.5) * size, 0))
                              @ Matrix.Rotation(r.random() * 6.283, 4, "Z") @ Matrix.Scale(0.8 + r.random() * 0.6, 4))
            parts.append(o)
        with bpy.context.temp_override(active_object=parts[0], object=parts[0], selected_objects=parts,
                                       selected_editable_objects=parts):
            bpy.ops.object.join()
        o = parts[0]
        o.name = "lawn_patch_%d" % k
        o.data.transform(o.matrix_world)
        o.matrix_world = Matrix.Identity(4)
        tmp.objects.unlink(o)
        col.objects.link(o)
        # lusher green than the raw asset: a gentle multiply on every patch material (shared material, done once below)
    bpy.data.collections.remove(tmp)
    for o in col.objects:
        for m in o.data.materials:
            if m and not m.get("lawn_tuned"):
                _tune_blade_material(m)
                m["lawn_tuned"] = 1
    return col


def _tune_blade_material(m):
    """Replace the dark atlas colour of the blades by a green gradient (dark root, light tip) with a random tone per instance;
    the atlas normal map and roughness stay. Light shines through thin blades (translucency)."""
    nodes, links = m.node_tree.nodes, m.node_tree.links
    bs = nodes.get("Principled BSDF")
    if not bs:
        return
    for l in list(bs.inputs["Base Color"].links):
        links.remove(l)
    for key in ("Metallic", "Roughness"):
        for l in list(bs.inputs[key].links):
            links.remove(l)
    bs.inputs["Metallic"].default_value = 0.0
    bs.inputs["Roughness"].default_value = 0.55
    if "Specular IOR Level" in bs.inputs:
        bs.inputs["Specular IOR Level"].default_value = 0.3
    tc = nodes.new("ShaderNodeTexCoord")
    sep = nodes.new("ShaderNodeSeparateXYZ")
    links.new(tc.outputs["Object"], sep.inputs[0])
    mr = nodes.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = 0.0
    mr.inputs["From Max"].default_value = 0.09
    links.new(sep.outputs["Z"], mr.inputs["Value"])
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (*_lin("#2a4617"), 1)
    ramp.color_ramp.elements[1].color = (*_lin("#7fa23e"), 1)
    links.new(mr.outputs[0], ramp.inputs["Fac"])
    oi = nodes.new("ShaderNodeObjectInfo")
    hsv = nodes.new("ShaderNodeHueSaturation")
    hsv.inputs["Value"].default_value = 1.0
    ra = nodes.new("ShaderNodeMapRange")
    ra.inputs["To Min"].default_value = 0.72
    ra.inputs["To Max"].default_value = 1.25
    links.new(oi.outputs["Random"], ra.inputs["Value"])
    links.new(ra.outputs[0], hsv.inputs["Value"])
    links.new(ramp.outputs["Color"], hsv.inputs["Color"])
    links.new(hsv.outputs[0], bs.inputs["Base Color"])
    out = next(n for n in nodes if n.type == "OUTPUT_MATERIAL")
    tr = nodes.new("ShaderNodeBsdfTranslucent")
    links.new(hsv.outputs[0], tr.inputs["Color"])
    mix = nodes.new("ShaderNodeMixShader")
    mix.inputs[0].default_value = 0.25
    links.new(bs.outputs[0], mix.inputs[1])
    links.new(tr.outputs[0], mix.inputs[2])
    links.new(mix.outputs[0], out.inputs[0])


def _lin(h):
    from .util import hex_to_linear
    return hex_to_linear(h)


def scatter(obj, collection, density, smin, smax, seed, name, zoff=0.0, attribute="grass"):
    """Geometry-nodes modifier: instances of the objects of `collection` on the faces of `obj`, density per m2 times the face
    attribute `attribute` (0 = none)."""
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
    dist.distribute_method = "RANDOM"
    dist.inputs["Seed"].default_value = seed
    L.new(gi.outputs[0], dist.inputs["Mesh"])
    # density (per m2, a field in random mode) = attribute x density
    mul = N.new("ShaderNodeMath")
    mul.operation = "MULTIPLY"
    mul.inputs[1].default_value = density
    L.new(na.outputs["Attribute"], mul.inputs[0])
    L.new(mul.outputs[0], dist.inputs["Density"])
    ci = N.new("GeometryNodeCollectionInfo")
    ci.inputs["Collection"].default_value = collection
    ci.inputs["Separate Children"].default_value = True
    ci.inputs["Reset Children"].default_value = True
    inst = N.new("GeometryNodeInstanceOnPoints")
    inst.inputs["Pick Instance"].default_value = True
    rz = N.new("FunctionNodeRandomValue")
    rz.data_type = "FLOAT_VECTOR"
    rz.inputs["Min"].default_value = (0, 0, 0)
    rz.inputs["Max"].default_value = (0.08, 0.08, 6.283)
    rz.inputs["Seed"].default_value = seed + 1
    rs = N.new("FunctionNodeRandomValue")
    rs.data_type = "FLOAT"
    rs.inputs[2].default_value = smin
    rs.inputs[3].default_value = smax
    rs.inputs["Seed"].default_value = seed + 2
    ri = N.new("FunctionNodeRandomValue")
    ri.data_type = "INT"
    ri.inputs[4].default_value = 0
    ri.inputs[5].default_value = 99
    ri.inputs["Seed"].default_value = seed + 3
    L.new(dist.outputs["Points"], inst.inputs["Points"])
    L.new(ci.outputs[0], inst.inputs["Instance"])
    L.new(rz.outputs[0], inst.inputs["Rotation"])
    L.new(rs.outputs[1], inst.inputs["Scale"])
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
