"""Material changes that only the renders need (the web GLB keeps its simple materials): cheap clear glass, woven fabrics,
translucent lamp shades, a car-paint clear coat."""
from __future__ import annotations

FABRICS = ("f_linen", "f_sand", "f_fabric_grey", "f_sage", "f_clay", "f_blue", "f_ochre", "f_greige", "t_fabric", "t_sage",
           "t_rope", "f_rattan")
SHADES = ("f_paper",)
PAINT = ("f_car_paint_a", "f_car_paint_b")


def _principled(m):
    return m.node_tree.nodes.get("Principled BSDF") if m and m.use_nodes else None


def _inp(bs, *names):
    for n in names:
        if n in bs.inputs:
            return bs.inputs[n]
    return None


def clear_glass(m, tint=(0.88, 0.93, 0.95), reflect=1.0):
    """Glass without refraction: Fresnel mix of a tinted transparent shader and a sharp glossy one. Rooms and the lamps are
    seen through it, shadow rays pass (sun patches on the floor) and the noise stays low."""
    m.use_nodes = True
    nt = m.node_tree
    nodes, links = nt.nodes, nt.links
    for n in list(nodes):
        nodes.remove(n)
    out = nodes.new("ShaderNodeOutputMaterial")
    tr = nodes.new("ShaderNodeBsdfTransparent")
    tr.inputs["Color"].default_value = (*tint, 1.0)
    gl = nodes.new("ShaderNodeBsdfGlossy")
    gl.inputs["Roughness"].default_value = 0.02
    gl.inputs["Color"].default_value = (reflect, reflect, reflect, 1.0)
    fr = nodes.new("ShaderNodeFresnel")
    # Cycles inverts the IOR of the Fresnel node on a back face (a ray leaving the glass): past 41 degrees that is total
    # internal reflection, a black or mirror pane. The glass here is a sheet, so both sides get the same Fresnel:
    # IOR = 1.52 on the front, 1 / 1.52 on the back (inverted again by the node).
    ge = nodes.new("ShaderNodeNewGeometry")
    ior = nodes.new("ShaderNodeMath")
    ior.operation = "MULTIPLY_ADD"
    ior.inputs[1].default_value = 1.0 / 1.52 - 1.52
    ior.inputs[2].default_value = 1.52
    links.new(ge.outputs["Backfacing"], ior.inputs[0])
    links.new(ior.outputs[0], fr.inputs["IOR"])
    mx = nodes.new("ShaderNodeMixShader")
    links.new(fr.outputs[0], mx.inputs[0])
    links.new(tr.outputs[0], mx.inputs[1])
    links.new(gl.outputs[0], mx.inputs[2])
    links.new(mx.outputs[0], out.inputs[0])


def weave_bump(m, scale=380.0, strength=0.12):
    """Fine woven look for textiles: a noise bump in object space (no UVs needed), a little sheen."""
    bs = _principled(m)
    if not bs or bs.inputs["Normal"].links:
        return
    nt = m.node_tree
    tc = nt.nodes.new("ShaderNodeTexCoord")
    n1 = nt.nodes.new("ShaderNodeTexNoise")
    n1.inputs["Scale"].default_value = scale
    n1.inputs["Detail"].default_value = 2.0
    nt.links.new(tc.outputs["Object"], n1.inputs["Vector"])
    bu = nt.nodes.new("ShaderNodeBump")
    bu.inputs["Strength"].default_value = strength
    bu.inputs["Distance"].default_value = 0.002
    nt.links.new(n1.outputs["Fac"], bu.inputs["Height"])
    nt.links.new(bu.outputs["Normal"], bs.inputs["Normal"])
    sh = _inp(bs, "Sheen Weight")
    if sh is not None:
        sh.default_value = 0.35
        rough = _inp(bs, "Sheen Roughness")
        if rough is not None:
            rough.default_value = 0.5


def lamp_shade(m, glow=0.0):
    """Paper shade: half translucent so that the lamp inside lights it from within; `glow` is a small emission."""
    bs = _principled(m)
    if not bs:
        return
    nt = m.node_tree
    out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
    base = bs.inputs["Base Color"].default_value
    tl = nt.nodes.new("ShaderNodeBsdfTranslucent")
    tl.inputs["Color"].default_value = base
    mx = nt.nodes.new("ShaderNodeMixShader")
    mx.inputs[0].default_value = 0.55
    nt.links.new(bs.outputs[0], mx.inputs[1])
    nt.links.new(tl.outputs[0], mx.inputs[2])
    nt.links.new(mx.outputs[0], out.inputs[0])


def car_paint(m):
    bs = _principled(m)
    if not bs:
        return
    for names, val in ((("Coat Weight",), 1.0), (("Coat Roughness",), 0.03)):
        s = _inp(bs, *names)
        if s is not None:
            s.default_value = val


def tune_furniture(objects):
    """Applies the render tweaks to the imported furniture materials (looked up by their palette names)."""
    seen = set()
    for ob in objects:
        if ob.type != "MESH":
            continue
        for m in ob.data.materials:
            if not m or m.name in seen:
                continue
            seen.add(m.name)
            base = m.name.split(".")[0]
            if base in FABRICS:
                weave_bump(m)
            elif base in SHADES:
                lamp_shade(m)
            elif base in PAINT:
                car_paint(m)
        # lamp shades must not shadow their own lamp
        if any(m and m.name.split(".")[0] in SHADES for m in ob.data.materials):
            ob.visible_shadow = False
    return seen
