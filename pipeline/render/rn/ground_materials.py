"""Materials of the ground and of the vegetation: lawn, verge, meadow, field, asphalt, mulch (Poly Haven textures, procedural
colour variation). Adapted from the earlier renderer: noise ramps for the lawn, Voronoi fields for the far land."""
from __future__ import annotations

import glob
import os

from .util import hex_to_linear, repo_path

ASSETS = repo_path("assets")


def _nodes(m):
    m.use_nodes = True
    return m.node_tree.nodes, m.node_tree.links


def _clear(m):
    nodes, links = _nodes(m)
    for n in list(nodes):
        if n.type != "OUTPUT_MATERIAL":
            nodes.remove(n)
    return nodes, links, next(n for n in nodes if n.type == "OUTPUT_MATERIAL")


def _img(path, noncolor=False):
    import bpy
    im = bpy.data.images.load(path, check_existing=True)
    if noncolor:
        im.colorspace_settings.name = "Non-Color"
    return im


def pbr_world(name, folder, size=2.0, tint=(1, 1, 1), rough_mul=1.0, nstr=1.0, sat=1.0, val=1.0, anti_tile=True):
    """Poly Haven material mapped by world position (box projection), size = metres per repeat. With `anti_tile` a second sample
    with another scale and angle is blended in by a slow noise, which hides the repetition on large flat areas."""
    import bpy
    m = bpy.data.materials.new(name)
    nodes, links, out = _clear(m)
    bs = nodes.new("ShaderNodeBsdfPrincipled")
    links.new(bs.outputs[0], out.inputs[0])
    d = os.path.join(ASSETS, "textures", folder)
    geo = nodes.new("ShaderNodeNewGeometry")

    def sampler(scale, rot, kind, noncolor):
        f = glob.glob(os.path.join(d, "*_%s_2k.jpg" % kind))
        if not f:
            return None
        mp = nodes.new("ShaderNodeMapping")
        mp.inputs["Scale"].default_value = (1 / scale,) * 3
        mp.inputs["Rotation"].default_value = (0, 0, rot)
        links.new(geo.outputs["Position"], mp.inputs[0])
        t = nodes.new("ShaderNodeTexImage")
        t.image = _img(f[0], noncolor)
        t.projection = "BOX"
        t.projection_blend = 0.25
        links.new(mp.outputs[0], t.inputs[0])
        return t

    def blended(kind, noncolor):
        a = sampler(size, 0.0, kind, noncolor)
        if a is None or not anti_tile:
            return a.outputs[0] if a else None
        b = sampler(size * 0.63, 0.9, kind, noncolor)
        nz = nodes.new("ShaderNodeTexNoise")
        nz.inputs["Scale"].default_value = 0.08
        links.new(geo.outputs["Position"], nz.inputs["Vector"])
        mx = nodes.new("ShaderNodeMix")
        mx.data_type = "RGBA"
        links.new(nz.outputs["Fac"], mx.inputs[0])
        links.new(a.outputs[0], mx.inputs[6])
        links.new(b.outputs[0], mx.inputs[7])
        return mx.outputs[2]

    col = blended("diff", False)
    if col is not None:
        hsv = nodes.new("ShaderNodeHueSaturation")
        hsv.inputs["Saturation"].default_value = sat
        hsv.inputs["Value"].default_value = val
        links.new(col, hsv.inputs["Color"])
        mix = nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs[0].default_value = 1.0
        mix.inputs[7].default_value = (*tint, 1.0)
        links.new(hsv.outputs[0], mix.inputs[6])
        links.new(mix.outputs[2], bs.inputs["Base Color"])
    r = blended("rough", True)
    if r is not None:
        mt = nodes.new("ShaderNodeMath")
        mt.operation = "MULTIPLY"
        mt.inputs[1].default_value = rough_mul
        links.new(r, mt.inputs[0])
        links.new(mt.outputs[0], bs.inputs["Roughness"])
    n = blended("nor_gl", True)
    if n is not None:
        nm = nodes.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = nstr
        links.new(n, nm.inputs["Color"])
        links.new(nm.outputs[0], bs.inputs["Normal"])
    return m


def lawn(name, c0, c1, scale=1.0):
    """Base colour of the lawn under the blades: two noise octaves through a colour ramp, small bump."""
    import bpy
    m = bpy.data.materials.new(name)
    nodes, links, out = _clear(m)
    bs = nodes.new("ShaderNodeBsdfPrincipled")
    links.new(bs.outputs[0], out.inputs[0])
    geo = nodes.new("ShaderNodeNewGeometry")
    n1 = nodes.new("ShaderNodeTexNoise")
    n1.inputs["Scale"].default_value = 0.35 / scale
    n1.inputs["Detail"].default_value = 4
    n2 = nodes.new("ShaderNodeTexNoise")
    n2.inputs["Scale"].default_value = 6 / scale
    n2.inputs["Detail"].default_value = 8
    links.new(geo.outputs["Position"], n1.inputs["Vector"])
    links.new(geo.outputs["Position"], n2.inputs["Vector"])
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.35
    ramp.color_ramp.elements[0].color = (*hex_to_linear(c0), 1)
    ramp.color_ramp.elements[1].position = 0.7
    ramp.color_ramp.elements[1].color = (*hex_to_linear(c1), 1)
    ma = nodes.new("ShaderNodeMath")
    ma.operation = "MULTIPLY_ADD"
    ma.inputs[1].default_value = 0.6
    ma.inputs[2].default_value = 0.2
    links.new(n1.outputs["Fac"], ma.inputs[0])
    m2 = nodes.new("ShaderNodeMath")
    m2.operation = "MULTIPLY"
    m2.inputs[1].default_value = 0.35
    links.new(n2.outputs["Fac"], m2.inputs[0])
    add = nodes.new("ShaderNodeMath")
    links.new(ma.outputs[0], add.inputs[0])
    links.new(m2.outputs[0], add.inputs[1])
    links.new(add.outputs[0], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], bs.inputs["Base Color"])
    bs.inputs["Roughness"].default_value = 0.85
    bu = nodes.new("ShaderNodeBump")
    bu.inputs["Strength"].default_value = 0.3
    links.new(n2.outputs["Fac"], bu.inputs["Height"])
    links.new(bu.outputs[0], bs.inputs["Normal"])
    return m


def farmland(cfg, inputs, c3=None):
    """The land beyond the plot: meadow near the house, patchwork of fields (Voronoi: ripening grain, stubble, maize and
    grass greens; the stubble colour is the style `field`) farther out."""
    import bpy
    m = bpy.data.materials.new("farmland")
    nodes, links, out = _clear(m)
    bs = nodes.new("ShaderNodeBsdfPrincipled")
    links.new(bs.outputs[0], out.inputs[0])
    geo = nodes.new("ShaderNodeNewGeometry")
    wn = nodes.new("ShaderNodeTexNoise")
    wn.inputs["Scale"].default_value = 0.01
    wn.inputs["Detail"].default_value = 2
    links.new(geo.outputs["Position"], wn.inputs["Vector"])
    sc_ = nodes.new("ShaderNodeVectorMath")
    sc_.operation = "SCALE"
    sc_.inputs["Scale"].default_value = 25
    links.new(wn.outputs["Color"], sc_.inputs[0])
    vec = nodes.new("ShaderNodeVectorMath")
    vec.operation = "ADD"
    links.new(geo.outputs["Position"], vec.inputs[0])
    links.new(sc_.outputs[0], vec.inputs[1])
    stretch = nodes.new("ShaderNodeVectorMath")             # fields are long strips, not round patches
    stretch.operation = "MULTIPLY"
    stretch.inputs[1].default_value = (0.45, 1.0, 1.0)
    links.new(vec.outputs[0], stretch.inputs[0])
    vo = nodes.new("ShaderNodeTexVoronoi")
    vo.inputs["Scale"].default_value = 0.014
    links.new(stretch.outputs[0], vo.inputs["Vector"])
    ramp = nodes.new("ShaderNodeValToRGB")
    cr = ramp.color_ramp
    cr.interpolation = "CONSTANT"
    fieldc = c3.color("field", "#9c9566") if c3 else "#9c9566"
    # strips of crops: greens of maize and grass, the style stubble colour, ripening grain, ploughed soil (darkened a little: a
    # field seen from afar under the sun is never pastel)
    cols = ["#466e29", "#62803a", fieldc, "#53792f", "#9a9264", "#3f6127", "#6e5f49", "#7f7f4a"]
    cr.elements[0].color = (*hex_to_linear(cols[0]), 1)
    cr.elements[1].position = 1.0
    cr.elements[1].color = (*hex_to_linear(cols[-1]), 1)
    for i, c in enumerate(cols[1:-1]):
        e = cr.elements.new((i + 1) / (len(cols) - 1))
        e.color = (*hex_to_linear(c), 1)
    sep = nodes.new("ShaderNodeSeparateColor")
    links.new(vo.outputs["Color"], sep.inputs[0])
    links.new(sep.outputs[0], ramp.inputs["Fac"])
    n2 = nodes.new("ShaderNodeTexNoise")
    n2.inputs["Scale"].default_value = 0.8
    n2.inputs["Detail"].default_value = 6
    links.new(geo.outputs["Position"], n2.inputs["Vector"])
    mix = nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "OVERLAY"
    mix.inputs[0].default_value = 0.25
    links.new(ramp.outputs["Color"], mix.inputs[6])
    links.new(n2.outputs["Color"], mix.inputs[7])
    n3 = nodes.new("ShaderNodeTexNoise")
    n3.inputs["Scale"].default_value = 0.07
    n3.inputs["Detail"].default_value = 5
    links.new(geo.outputs["Position"], n3.inputs["Vector"])
    mix2 = nodes.new("ShaderNodeMix")
    mix2.data_type = "RGBA"
    mix2.blend_type = "OVERLAY"
    mix2.inputs[0].default_value = 0.35
    links.new(mix.outputs[2], mix2.inputs[6])
    links.new(n3.outputs["Color"], mix2.inputs[7])
    meadow = nodes.new("ShaderNodeValToRGB")
    meadow.color_ramp.elements[0].color = (*hex_to_linear("#38541f"), 1)
    meadow.color_ramp.elements[1].color = (*hex_to_linear("#587232"), 1)
    n4 = nodes.new("ShaderNodeTexNoise")
    n4.inputs["Scale"].default_value = 0.25
    n4.inputs["Detail"].default_value = 6
    links.new(geo.outputs["Position"], n4.inputs["Vector"])
    links.new(n4.outputs["Fac"], meadow.inputs["Fac"])
    c = inputs["house"]["center"]
    flat = nodes.new("ShaderNodeVectorMath")
    flat.operation = "MULTIPLY"
    flat.inputs[1].default_value = (1, 1, 0)
    links.new(geo.outputs["Position"], flat.inputs[0])
    dist = nodes.new("ShaderNodeVectorMath")
    dist.operation = "DISTANCE"
    dist.inputs[1].default_value = (c[0], c[1], 0)
    links.new(flat.outputs[0], dist.inputs[0])
    wob = nodes.new("ShaderNodeMath")
    wob.operation = "MULTIPLY_ADD"
    wob.inputs[1].default_value = 40
    links.new(n3.outputs["Fac"], wob.inputs[0])
    links.new(dist.outputs["Value"], wob.inputs[2])
    mr = nodes.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = 70
    mr.inputs["From Max"].default_value = 130
    links.new(wob.outputs[0], mr.inputs["Value"])
    mix3 = nodes.new("ShaderNodeMix")
    mix3.data_type = "RGBA"
    links.new(mr.outputs[0], mix3.inputs[0])
    links.new(meadow.outputs["Color"], mix3.inputs[6])
    links.new(mix2.outputs[2], mix3.inputs[7])
    links.new(mix3.outputs[2], bs.inputs["Base Color"])
    bs.inputs["Roughness"].default_value = 0.95
    return m


def field(cfg, inputs, c3=None):
    """Cultivated field beside the plot: ripening crop in the style `field` colour with rows (a wave texture) and a patchy tone."""
    import bpy
    m = bpy.data.materials.new("field")
    nodes, links, out = _clear(m)
    bs = nodes.new("ShaderNodeBsdfPrincipled")
    links.new(bs.outputs[0], out.inputs[0])
    geo = nodes.new("ShaderNodeNewGeometry")
    nz = nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 0.12
    nz.inputs["Detail"].default_value = 5
    links.new(geo.outputs["Position"], nz.inputs["Vector"])
    ramp = nodes.new("ShaderNodeValToRGB")
    fc = hex_to_linear(c3.color("field", "#9c9566") if c3 else "#9c9566")
    ramp.color_ramp.elements[0].position = 0.3
    ramp.color_ramp.elements[0].color = (*[c * 0.78 for c in fc], 1)
    ramp.color_ramp.elements[1].position = 0.7
    ramp.color_ramp.elements[1].color = (*[min(1.0, c * 1.08) for c in fc], 1)
    links.new(nz.outputs["Fac"], ramp.inputs["Fac"])
    wv = nodes.new("ShaderNodeTexWave")
    wv.wave_type = "BANDS"
    wv.bands_direction = "X"
    wv.inputs["Scale"].default_value = 1.4
    wv.inputs["Distortion"].default_value = 0.4
    wv.inputs["Detail"].default_value = 0
    links.new(geo.outputs["Position"], wv.inputs["Vector"])
    mix = nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.inputs[0].default_value = 0.22
    links.new(ramp.outputs["Color"], mix.inputs[6])
    links.new(wv.outputs["Color"], mix.inputs[7])
    links.new(mix.outputs[2], bs.inputs["Base Color"])
    bs.inputs["Roughness"].default_value = 0.95
    bu = nodes.new("ShaderNodeBump")
    bu.inputs["Strength"].default_value = 0.25
    links.new(wv.outputs["Fac"], bu.inputs["Height"])
    links.new(bu.outputs[0], bs.inputs["Normal"])
    return m


_asphalt = []


def asphalt_material(hex_color="#5c6064"):
    if not _asphalt:
        _asphalt.append(tinted_texture("asphalt", "asphalt_02", 3.0, hex_color, nstr=0.6)
                        or pbr_world("asphalt", "asphalt_02", 3.0, val=0.55))
    return _asphalt[0]


_means = {}


def texture_level(folder):
    """Mean of the brightest channel of a texture's diffuse map, linear (what a desaturated sample of it averages to)."""
    import bpy
    if folder in _means:
        return _means[folder]
    f = glob.glob(os.path.join(ASSETS, "textures", folder, "*_diff_2k.jpg"))
    if not f:
        _means[folder] = None
        return None
    im = bpy.data.images.load(f[0], check_existing=True)
    sm = im.copy()
    sm.scale(16, 16)
    px = list(sm.pixels[:])
    bpy.data.images.remove(sm)
    vals = [max(px[i], px[i + 1], px[i + 2]) for i in range(0, len(px), 4)]
    lin = [v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in vals]
    _means[folder] = sum(lin) / len(lin)
    return _means[folder]


def tinted_texture(name, folder, size, hex_color, gain=1.0, nstr=0.6, rough_mul=1.0, anti_tile=True):
    """A Poly Haven texture used for its detail only: desaturated and tinted so that it averages to the style colour."""
    level = texture_level(folder)
    if not level:
        return None
    target = hex_to_linear(hex_color)
    tint = tuple(min(4.0, gain * target[i] / level) for i in range(3))
    return pbr_world(name, folder, size, tint=tint, rough_mul=rough_mul, nstr=nstr, sat=0.0, val=1.0, anti_tile=anti_tile)


def grass_texture(name, hex_color, size=2.2, darken=1.0):
    """Mown grass seen from a distance (the neighbour gardens, the meadow): the Poly Haven grass texture for its detail,
    coloured by the style colour; no blades."""
    m = tinted_texture(name, "leafy_grass", size, hex_color, darken, nstr=0.5)
    return m or lawn(name, hex_color, hex_color)


def lawn_base(name, colors, size=1.1, gain=0.42):
    """The ground under the blades: the Poly Haven grass texture for its detail, darkened to the root colour of the blades
    (`lawnColors`), so a gap between blade patches reads as the dense bottom of the sward, not as flat paint."""
    root, tip = hex_to_linear(colors[0]), hex_to_linear(colors[1])
    mid = "#%02x%02x%02x" % tuple(int(round(255 * ((0.5 * (a + b)) ** (1 / 2.2)))) for a, b in zip(root, tip))
    return tinted_texture(name, "grass_ground", size, mid, gain, nstr=0.7) or lawn(name, colors[0], colors[1])


def ground_materials(cfg, inputs, c3=None):
    lc = c3.lawn_colors() if c3 else ["#2d4a1a", "#46692a"]
    neighbour = c3.color("neighbour", "#6c8752") if c3 else "#6c8752"
    verge = c3.color("verge", neighbour) if c3 else neighbour
    return {
        "lawn": lawn_base("lawn_base", lc),
        "verge": lawn_base("verge_base", lc),
        "street": lawn("street_base", "#3b3e40", "#4a4d50"),
        "neighbour": grass_texture("neighbour_lawn", neighbour, 2.4, 0.82),
        "field": field(cfg, inputs, c3),
        "meadow": grass_texture("meadow", verge, 3.0, 0.72),
    }


def mulch():
    return pbr_world("mulch", "farm_soil", 1.5, tint=hex_to_linear("#8A6A4E"), nstr=0.8, sat=0.9, val=0.95)
