"""Materials: one Principled material per role, named after the role (no .001 suffixes).

DEFAULTS is the built-in palette (graphite, ivory, mint; no orange, no serif). `model/style.json` may override colours,
roughness, metalness and opacity per role under "materials" (keys: color, roughness, metalness, opacity).
Textured roles: the texture is neutral (mean colour NEUTRAL, local variation scaled by contrast/sat) and the role colour
multiplies it (glTF baseColorFactor), so the web can recolour a role (looks) without new textures. Tile sizes are metres
per repeat, applied to the UVs when the meshes are created.
"""
from __future__ import annotations

import os

from . import textures as TX
from . import floor_textures as FT

# role -> spec. tex: ("ph", folder) = Poly Haven image in assets/textures, ("proc", kind) = procedural floor
DEFAULTS = {
    "plaster": dict(color="#EEEBE3", rough=0.92, tex=("ph", "painted_plaster_wall"), tile=(1.5, 1.5), normal=0.35,
                    contrast=0.45, sat=0.3),
    "plaster_in": dict(color="#F3F1EC", rough=0.95),
    "wood_cladding": dict(color="#D0B892", rough=0.62, tex=("ph", "japanese_cedar_planks"), tile=(1.8, 1.8), normal=0.8,
                          contrast=0.9, sat=0.25),
    "frame": dict(color="#202325", rough=0.42, metal=0.5),
    "glass": dict(color="#C9DDE4", rough=0.04, metal=0.0, alpha=0.2),
    "sill": dict(color="#B7BABD", rough=0.32, metal=0.9),
    "soffit": dict(color="#F5F4F0", rough=0.82),
    "fascia": dict(color="#2A2D30", rough=0.4, metal=0.6),
    "gutter": dict(color="#2F3236", rough=0.4, metal=0.7),
    "roof_tile": dict(color="#3E4348", rough=0.45, metal=0.7),
    "ridge_cap": dict(color="#33373B", rough=0.4, metal=0.7),
    "ceiling": dict(color="#F7F6F2", rough=0.95),
    "door_leaf": dict(color="#F6F4EE", rough=0.55, metal=0.0),
    "slab": dict(color="#8C8D8A", rough=0.92, tex=("ph", "concrete_floor_02"), tile=(1.5, 1.5), normal=0.8,
                 contrast=0.7, sat=0.2),
    "floor_oak": dict(color="#DCBE95", rough=0.58, tex=("proc", "oak"), normal=0.6),
    "floor_tile": dict(color="#A7A7A3", rough=0.45, tex=("proc", "tile"), normal=0.8),
    "floor_stone": dict(color="#CFCBC3", rough=0.4, tex=("proc", "stone"), normal=0.8),
    "floor_concrete": dict(color="#B9B8B3", rough=0.85, tex=("ph", "concrete_floor_02"), tile=(2.0, 2.0), normal=0.8,
                           contrast=0.7, sat=0.2),
    "terrace_paving": dict(color="#D2D0CA", rough=0.8, tex=("ph", "concrete_pavers_02"), tile=(5.0, 5.0), normal=0.9,
                           contrast=0.55, sat=0.2),
    "drive_paving": dict(color="#9B9A96", rough=0.85, tex=("ph", "concrete_pavers_02"), tile=(3.0, 3.0), normal=0.9,
                         contrast=0.55, sat=0.2),
    "path": dict(color="#C5C3BD", rough=0.85, tex=("ph", "concrete_pavers_02"), tile=(3.0, 3.0), normal=0.9,
                 contrast=0.55, sat=0.2),
    "gravel": dict(color="#CDC8BC", rough=0.95, tex=("ph", "gravel_floor_02"), tile=(1.2, 1.2), normal=1.0,
                   contrast=0.8, sat=0.4),
    "post": dict(color="#F1F0EC", rough=0.7),
    "screen_slats": dict(color="#D8C6A4", rough=0.6, tex=("ph", "japanese_cedar_planks"), tile=(1.8, 1.8), normal=0.8,
                         contrast=0.9, sat=0.25),
}


NEUTRAL = "#E4E4E4"       # mean colour of the neutral textures; the role colour multiplies it


def srgb_to_linear(h):
    out = []
    for i in (1, 3, 5):
        c = int(h[i:i + 2], 16) / 255.0
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out)


def resolve_specs(style):
    """Defaults merged with model/style.json ('materials': {role: {color, roughness, metallic, alpha}}). A role that the
    style describes is taken as complete: metallic and alpha default to 0 and 1 when it does not list them."""
    specs = {k: dict(v) for k, v in DEFAULTS.items()}
    mats = (style or {}).get("materials")
    if isinstance(mats, dict):
        for role, o in mats.items():
            if role not in specs or not isinstance(o, dict):
                continue
            s = specs[role]
            col = o.get("color", o.get("baseColor"))
            if col:
                s["color"] = col
            if "roughness" in o:
                s["rough"] = o["roughness"]
            s["metal"] = o.get("metallic", o.get("metalness", 0.0))
            s["alpha"] = o.get("alpha", o.get("opacity", 1.0))
    return specs


def uv_tiles(specs):
    out = {}
    for role, s in specs.items():
        if s.get("tex") and s["tex"][0] == "proc":
            out[role] = FT.TILE[s["tex"][1]]
        else:
            out[role] = tuple(s.get("tile", (1.0, 1.0)))
    return out


def _image(bpy, path, noncolor=False):
    img = bpy.data.images.load(path, check_existing=True)
    img.colorspace_settings.name = "Non-Color" if noncolor else "sRGB"
    return img


def make_material(bpy, cfg, role, spec, mode="export"):
    lod = cfg.p
    m = bpy.data.materials.new(role)
    m.use_nodes = True
    m.use_backface_culling = True            # single-sided (glTF doubleSided = false); every face is wound outwards
    nt = m.node_tree
    nodes, links = nt.nodes, nt.links
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = float(spec.get("rough", 0.6))
    bsdf.inputs["Metallic"].default_value = float(spec.get("metal", 0.0))
    base = srgb_to_linear(spec["color"])
    bsdf.inputs["Base Color"].default_value = (base[0], base[1], base[2], 1.0)
    alpha = float(spec.get("alpha", 1.0))
    if alpha < 1.0:
        if mode == "render":
            out = nodes.get("Material Output")
            g = nodes.new("ShaderNodeBsdfGlass")
            g.inputs["Color"].default_value = (base[0], base[1], base[2], 1.0)
            g.inputs["Roughness"].default_value = 0.0
            g.inputs["IOR"].default_value = 1.45
            links.new(g.outputs["BSDF"], out.inputs["Surface"])
            nodes.remove(bsdf)
            return m
        bsdf.inputs["Alpha"].default_value = alpha
        try:
            m.surface_render_method = "BLENDED"
        except Exception:
            pass
        if mode == "usd":
            # the USD exporter drops a constant alpha: carry it in a tiny texture instead (UsdPreviewSurface opacity map)
            path = os.path.join(cfg.tex_dir, "usd_%s_opacity_%d.png" % (role, int(alpha * 100)))
            if not os.path.exists(path):
                os.makedirs(cfg.tex_dir, exist_ok=True)
                img = bpy.data.images.new("opacity_tmp", 4, 4, alpha=True)
                img.pixels.foreach_set([1.0, 1.0, 1.0, alpha] * 16)
                img.filepath_raw = path
                img.file_format = "PNG"
                img.save()
                bpy.data.images.remove(img)
            tex = nodes.new("ShaderNodeTexImage")
            tex.image = bpy.data.images.load(path, check_existing=True)
            tex.image.alpha_mode = "STRAIGHT"
            tex.interpolation = "Closest"
            links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
    tex = spec.get("tex")
    if tex:
        size = lod["texture_px"]
        if tex[0] == "ph":
            diff = TX.prepare(cfg, tex[1], "diff", size, (NEUTRAL, spec.get("contrast", 0.6), spec.get("sat", 0.3)))
            nor = TX.prepare(cfg, tex[1], "nor_gl", size) if lod["normal_maps"] else None
        else:
            diff, nor = TX.procedural(cfg, tex[1], min(size, 1024), (NEUTRAL, spec.get("contrast", 0.9), spec.get("sat", 0.7)))
            if not lod["normal_maps"]:
                nor = None
        tint = spec["color"]
        white = tint.lower() in ("#ffffff", "#fff")
        if mode == "usd" and not white:
            stem = os.path.basename(diff).rsplit(".", 1)[0]
            diff = TX.bake_tint(diff, tint, os.path.join(cfg.tex_dir, "usd_%s_%s_%s.jpg" % (role, stem, tint[1:])))
            white = True
        timg = nodes.new("ShaderNodeTexImage")
        timg.image = _image(bpy, diff)
        timg.interpolation = "Linear"
        if white:
            links.new(timg.outputs["Color"], bsdf.inputs["Base Color"])
        else:
            mix = nodes.new("ShaderNodeMix")
            mix.data_type = "RGBA"
            mix.blend_type = "MULTIPLY"
            mix.inputs[0].default_value = 1.0
            t = srgb_to_linear(tint)
            mix.inputs[7].default_value = (t[0], t[1], t[2], 1.0)
            links.new(timg.outputs["Color"], mix.inputs[6])
            links.new(mix.outputs[2], bsdf.inputs["Base Color"])
        if nor:
            nimg = nodes.new("ShaderNodeTexImage")
            nimg.image = _image(bpy, nor, noncolor=True)
            nm = nodes.new("ShaderNodeNormalMap")
            nm.inputs["Strength"].default_value = float(spec.get("normal", 0.8))
            links.new(nimg.outputs["Color"], nm.inputs["Color"])
            links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    return m


def make_materials(cfg, roles, mode="export"):
    """{role: bpy material} for the roles in use, plus the UV tile table."""
    import bpy
    specs = resolve_specs(cfg.style)
    mats = {}
    for role in sorted(roles):
        if role not in specs:
            raise KeyError("no material defined for role %r" % role)
        mats[role] = make_material(bpy, cfg, role, specs[role], mode)
    return mats, uv_tiles(specs)
