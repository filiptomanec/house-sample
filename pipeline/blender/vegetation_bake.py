"""Bakes a light web tree from the CC0 tree asset (Poly Haven tree_small_02, see ASSETS.md) for the instanced vegetation
of the 3D viewer:

    public/models/tree.glb       desktop: <= 6 000 triangles, 512 px WebP leaf atlas, Draco
    public/models/tree-lite.glb  phones:  about 2 000 triangles, 256 px atlas

    BLENDER -b --factory-startup --python pipeline/blender/vegetation_bake.py -- \
        --asset assets/models/tree_small_02/tree_small_02_1k.gltf --out public/models [--style model/style.json] \
        [--tex pipeline/out/tex] [--lods high,lite]

How: the trunk and the branches are decimated to a few hundred triangles; the 1.9 million leaf triangles are replaced by
leaf cards. The crown is cut into voxels; every voxel with leaves gets one card at the centre of its leaves, turned
towards their mean normal and the outside of the crown. The card texture is a 2 x 2 atlas of leaf clusters rendered
from the asset itself (orthographic, unlit albedo, transparent background; the transparent texels carry the mean leaf
colour so the mipmaps do not darken the edges). Card normals point out of the crown, so the crown shades like one soft
volume. Everything is seeded: the same asset gives the same files.

The tree is normalised: trunk base at the origin, height 1 and crown diameter 1 in both plan directions (each axis scaled by
the crown's own extent, the leaf cards stay square; house frame, z up, exported Y-up like every model), so the web scales one
instance per site tree by (crown, height, crown) and tints it per species. Node names
`tree_bark` and `tree_foliage` with extras {role: "bark" | "foliage"}, materials of the same names. The leaf atlas is neutral
(the luminance of the leaves, mean 0.8) and the colour is the material's baseColorFactor: `generated.foliage_tree` /
`generated.bark` of `--style` (model/style.json) when given, like the house textures (neutral texture x role colour). The
scene extras carry `crownBase` (lowest leaf, as a fraction of the height), `crownCentre` (the crown centre in plan relative to
the trunk, normalised), `sourceHeight` and `sourceCrown` (the asset's metres, the crown as the mean of its two plan extents)
and `source`. Nothing here describes the house.
"""
from __future__ import annotations

import math
import os
import sys

import bpy
import numpy as np

LODS = {
    # name: file, bark triangles (trunk, branches), leaf cards, atlas px
    "high": dict(file="tree.glb", trunk=900, branches=700, cards=2000, atlas=512),
    "lite": dict(file="tree-lite.glb", trunk=320, branches=180, cards=650, atlas=256),
}
CELLS = 2                 # atlas of CELLS x CELLS leaf clusters
SEED = 20261008


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    a = {}
    for i in range(0, len(argv) - 1, 2):
        a[argv[i].lstrip("-")] = argv[i + 1]
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.abspath(os.path.join(here, "..", ".."))
    a.setdefault("asset", os.path.join(root, "assets", "models", "tree_small_02", "tree_small_02_1k.gltf"))
    a.setdefault("out", os.path.join(root, "public", "models"))
    a.setdefault("tex", os.path.join(root, "pipeline", "out", "tex"))
    a.setdefault("lods", "high,lite")
    return a


def style_colours(path):
    """(foliage, bark) linear RGB from `generated` of model/style.json, or (None, None)."""
    if not path or not os.path.exists(path):
        return None, None
    import json
    with open(path, "r", encoding="utf-8") as f:
        gen = (json.load(f).get("generated") or {})

    def lin(key):
        h = (gen.get(key) or {}).get("color")
        if not h:
            return None
        c = [int(h[i:i + 2], 16) / 255.0 for i in (1, 3, 5)]
        return [v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c]
    return lin("foliage_tree"), lin("bark")


def log(*m):
    print("[tree]", *m, flush=True)


def reset():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob)
    for blk in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.cameras, bpy.data.lights):
        for it in list(blk):
            blk.remove(it)


# ------------------------------------------------------------------------------------------------- asset
def load_asset(path):
    bpy.ops.import_scene.gltf(filepath=path)
    obs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if len(obs) != 1:
        raise SystemExit("expected one mesh in %s, found %d" % (path, len(obs)))
    ob = obs[0]
    ob.data.transform(ob.matrix_world)          # bake the importer's Y-up -> Z-up conversion
    ob.matrix_world.identity()
    me = ob.data
    nv, npoly, nl = len(me.vertices), len(me.polygons), len(me.loops)
    co = np.empty(nv * 3)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    ls = np.empty(npoly, dtype=np.int64)
    lt = np.empty(npoly, dtype=np.int64)
    mi = np.empty(npoly, dtype=np.int64)
    me.polygons.foreach_get("loop_start", ls)
    me.polygons.foreach_get("loop_total", lt)
    me.polygons.foreach_get("material_index", mi)
    lv = np.empty(nl, dtype=np.int64)
    me.loops.foreach_get("vertex_index", lv)
    uvs = []
    for layer in me.uv_layers:
        u = np.empty(nl * 2)
        layer.data.foreach_get("uv", u)
        uvs.append(u.reshape(-1, 2))
    names = [s.material.name if s.material else "" for s in ob.material_slots]
    images = {}
    for s in ob.material_slots:
        for nd in (s.material.node_tree.nodes if s.material and s.material.node_tree else []):
            if nd.type == "TEX_IMAGE" and nd.image:
                images.setdefault(s.material.name, []).append(nd.image)
    return dict(ob=ob, co=co, ls=ls, lt=lt, mi=mi, lv=lv, uvs=uvs, names=names, images=images)


def part(asset, key):
    """Polygon indices of the material whose name contains `key`."""
    idx = [i for i, n in enumerate(asset["names"]) if key in n]
    return np.nonzero(np.isin(asset["mi"], idx))[0]


def submesh(asset, polys, name, uv_layer=0):
    """New mesh object from a subset of polygons (vertices re-indexed, one UV layer)."""
    ls, lt, lv, co = asset["ls"], asset["lt"], asset["lv"], asset["co"]
    loops = np.concatenate([np.arange(ls[p], ls[p] + lt[p]) for p in polys]) if len(polys) else np.zeros(0, np.int64)
    vids = lv[loops]
    uniq, inv = np.unique(vids, return_inverse=True)
    faces, k = [], 0
    for p in polys:
        n = int(lt[p])
        faces.append(inv[k:k + n].tolist())
        k += n
    me = bpy.data.meshes.new(name)
    me.from_pydata(co[uniq].tolist(), [], faces)
    if asset["uvs"]:
        layer = me.uv_layers.new(name="UVMap")
        layer.data.foreach_set("uv", asset["uvs"][min(uv_layer, len(asset["uvs"]) - 1)][loops].reshape(-1))
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def decimated(ob, target):
    """Copy of a mesh object decimated (collapse) to about `target` triangles."""
    tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    mod = ob.modifiers.new("dec", "DECIMATE")
    mod.decimate_type = "COLLAPSE"
    mod.ratio = min(1.0, target / max(1, tris))
    mod.use_collapse_triangulate = True
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    ob.modifiers.remove(mod)
    out = bpy.data.objects.new(ob.name + "_dec", me)
    bpy.context.scene.collection.objects.link(out)
    return out


def mean_colour(images):
    """Mean sRGB colour of the first colour texture of a material (its albedo), as linear RGB."""
    for img in images:
        if img.colorspace_settings.name != "sRGB" or "nor" in img.name or "arm" in img.name:
            continue
        px = np.empty(len(img.pixels), dtype=np.float32)
        img.pixels.foreach_get(px)
        srgb = px.reshape(-1, 4)[:, :3]
        lin = np.where(srgb <= 0.04045, srgb / 12.92, ((srgb + 0.055) / 1.055) ** 2.4)     # pixels are sRGB encoded
        return [float(c) for c in lin.mean(axis=0)]
    return [0.18, 0.15, 0.12]


# ------------------------------------------------------------------------------------------------- leaf clusters
def leaf_stats(asset, polys):
    """Centroids, areas and normals of the leaf polygons (triangles or quads; the first three corners give the normal)."""
    ls, lt, lv, co = asset["ls"], asset["lt"], asset["lv"], asset["co"]
    a = co[lv[ls[polys]]]
    b = co[lv[ls[polys] + 1]]
    c = co[lv[ls[polys] + 2]]
    n = np.cross(b - a, c - a)
    area = np.linalg.norm(n, axis=1) / 2
    nn = n / np.maximum(2 * area[:, None], 1e-12)
    cen = (a + b + c) / 3
    return cen, area, nn


def voxel_cards(cen, area, nrm, target):
    """Voxel size giving about `target` occupied voxels, and per voxel: centre (area weighted), leaf area, mean normal."""
    lo, hi = cen.min(axis=0), cen.max(axis=0)
    s_lo, s_hi = 0.02, float(np.max(hi - lo))
    for _ in range(30):
        s = (s_lo + s_hi) / 2
        keys = np.floor((cen - lo) / s).astype(np.int64)
        n = len(np.unique(keys, axis=0))
        if n > target:
            s_lo = s
        else:
            s_hi = s
    s = s_hi
    keys = np.floor((cen - lo) / s).astype(np.int64)
    uniq, inv = np.unique(keys, axis=0, return_inverse=True)
    inv = inv.reshape(-1)
    k = len(uniq)
    w = np.bincount(inv, weights=area, minlength=k)
    c = np.stack([np.bincount(inv, weights=area * cen[:, i], minlength=k) for i in range(3)], axis=1) / w[:, None]
    nm = np.stack([np.bincount(inv, weights=area * nrm[:, i], minlength=k) for i in range(3)], axis=1)
    nm /= np.maximum(np.linalg.norm(nm, axis=1, keepdims=True), 1e-9)
    return s, c, w, nm


def render_clusters(asset, leaf_polys, cen, centres, normals, size, px, tex_dir, leaf_imgs):
    """Renders CELLS*CELLS leaf clusters (unlit albedo, transparent) and assembles the atlas. Returns the RGBA array
    (h, w, 4) in Blender image order (bottom row first)."""
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 48
    scene.cycles.seed = 7
    scene.cycles.use_denoising = False
    scene.render.film_transparent = True
    scene.render.filter_size = 1.0
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0
    cell = px // CELLS
    scene.render.resolution_x = scene.render.resolution_y = cell
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    w = bpy.data.worlds.new("black")
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.0
    scene.world = w
    # unlit leaf material: emission = albedo texture, cut out by the alpha texture
    mat = bpy.data.materials.new("leaf_bake")
    mat.use_nodes = True
    nt = mat.node_tree
    for nd in list(nt.nodes):
        nt.nodes.remove(nd)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    mix = nt.nodes.new("ShaderNodeMixShader")
    diff = nt.nodes.new("ShaderNodeTexImage")
    diff.image = leaf_imgs["diff"]
    alpha = nt.nodes.new("ShaderNodeTexImage")
    alpha.image = leaf_imgs["alpha"]
    alpha.image.colorspace_settings.name = "Non-Color"
    nt.links.new(diff.outputs["Color"], em.inputs["Color"])
    nt.links.new(alpha.outputs["Color"], mix.inputs["Fac"])
    nt.links.new(tr.outputs["BSDF"], mix.inputs[1])
    nt.links.new(em.outputs["Emission"], mix.inputs[2])
    nt.links.new(mix.outputs["Shader"], out.inputs["Surface"])
    atlas = np.zeros((px, px, 4), dtype=np.float64)
    cam_d = bpy.data.cameras.new("bake_cam")
    cam_d.type = "ORTHO"
    cam_d.ortho_scale = size
    cam = bpy.data.objects.new("bake_cam", cam_d)
    scene.collection.objects.link(cam)
    scene.camera = cam
    from mathutils import Vector
    for k, (c, n) in enumerate(zip(centres, normals)):
        # leaves within a ball: the cluster has a ragged round outline with transparent corners (a card never reads
        # as a square)
        sel = leaf_polys[np.linalg.norm(cen - c, axis=1) < size * 0.42]
        ob = submesh(asset, sel, "cluster_%d" % k, uv_layer=0)
        ob.data.materials.append(mat)
        cam.location = Vector(c) + Vector(n) * (size * 2.0)
        cam.rotation_euler = (-Vector(n)).to_track_quat("-Z", "Z" if abs(n[2]) < 0.9 else "Y").to_euler()
        cam_d.clip_start, cam_d.clip_end = 0.01, size * 4
        path = os.path.join(tex_dir, "tree_cluster_%d_%d.png" % (px, k))
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(path)
        a = np.empty(len(img.pixels), dtype=np.float32)
        img.pixels.foreach_get(a)
        a = a.reshape(cell, cell, 4)
        bpy.data.images.remove(img)
        bpy.data.objects.remove(ob)
        r0, c0 = (k // CELLS) * cell, (k % CELLS) * cell
        atlas[r0:r0 + cell, c0:c0 + cell] = a
    bpy.data.objects.remove(cam)
    return atlas


def finish_atlas(atlas):
    """Transparent texels get the mean leaf colour (so the mipmaps keep the leaf colour at the card edges)."""
    a = atlas[..., 3]
    solid = a > 0.5
    mean = (atlas[..., :3][solid]).mean(axis=0) if solid.any() else np.array([0.3, 0.4, 0.2])
    out = atlas.copy()
    out[..., :3][~solid] = mean
    return out


def neutral_atlas(atlas, mean=0.8):
    """Luminance of the leaves (linear), scaled so the opaque texels average `mean`, back in sRGB; alpha kept. The colour of
    the species multiplies it (baseColorFactor or the web's instance colour)."""
    rgb = np.clip(atlas[..., :3], 0, 1)
    lin = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    lum = lin @ np.array([0.2126, 0.7152, 0.0722])
    solid = atlas[..., 3] > 0.5
    k = mean / max(float(lum[solid].mean()) if solid.any() else mean, 1e-6)
    lum = np.clip(lum * k, 0, 1)
    enc = np.where(lum <= 0.0031308, lum * 12.92, 1.055 * np.power(lum, 1 / 2.4) - 0.055)
    out = atlas.copy()
    out[..., 0] = out[..., 1] = out[..., 2] = enc
    return out


def save_png(arr, path):
    h, w, _ = arr.shape
    img = bpy.data.images.new(os.path.basename(path), w, h, alpha=True)
    img.pixels.foreach_set(np.clip(arr, 0, 1).astype(np.float32).reshape(-1))
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)
    return path


# ------------------------------------------------------------------------------------------------- cards
def card_geometry(centres, weights, normals, size, crown_c, rng):
    """One quad per voxel: centred on its leaves, facing a mix of their mean normal and the outside of the crown,
    turned randomly in its plane, sized by the voxel and its leaf density; UVs on a random atlas cell. Returns
    (corners (n, 4, 3) in metres, facing directions (n, 3), uvs (n * 4, 2))."""
    corners, dirs, uvs = [], [], []
    wmax = float(np.quantile(weights, 0.9))
    inset = 0.5 / 256.0
    for c, w, n in zip(centres, weights, normals):
        out = c - crown_c
        out = out / max(np.linalg.norm(out), 1e-9)
        d = 0.45 * n + 0.55 * out + rng.normal(0, 0.25, 3)
        d /= max(np.linalg.norm(d), 1e-9)
        ref = np.array([0.0, 0.0, 1.0]) if abs(d[2]) < 0.9 else np.array([1.0, 0.0, 0.0])
        u = np.cross(d, ref)
        u /= np.linalg.norm(u)
        v = np.cross(d, u)
        th = rng.uniform(0, 2 * math.pi)
        u, v = u * math.cos(th) + v * math.sin(th), -u * math.sin(th) + v * math.cos(th)
        s = size * (1.35 + 0.5 * min(1.0, math.sqrt(w / max(wmax, 1e-9)))) / 2
        corners.append([c - u * s - v * s, c + u * s - v * s, c + u * s + v * s, c - u * s + v * s])
        dirs.append(d)
        cell = int(rng.integers(CELLS * CELLS))
        u0, v0 = (cell % CELLS) / CELLS, (cell // CELLS) / CELLS
        cw = 1.0 / CELLS
        uvs += [(u0 + inset, v0 + inset), (u0 + cw - inset, v0 + inset), (u0 + cw - inset, v0 + cw - inset),
                (u0 + inset, v0 + cw - inset)]
    return np.array(corners), np.array(dirs), np.array(uvs)


def cards_mesh(corners, dirs, uvs, crown_c, scale, name):
    """Mesh of the leaf cards: the card centres scaled by `scale` (x, y, z), the cards themselves scaled uniformly (by the
    geometric mean), so they stay square and keep their facing. Custom normals point out of the (scaled) crown, so the crown
    shades like one soft volume; the web's instance scale turns them back with the normal matrix."""
    sc = np.asarray(scale, dtype=np.float64)
    iso = float(np.prod(sc)) ** (1.0 / 3.0)
    centres = corners.mean(axis=1, keepdims=True)
    q = centres * sc + (corners - centres) * iso
    cc = np.asarray(crown_c) * sc
    verts, faces, nrms = [], [], []
    for i in range(len(q)):
        k = len(verts)
        verts += [tuple(p) for p in q[i]]
        faces.append((k, k + 1, k + 2, k + 3))
        for p in q[i]:
            o = p - cc
            o = o / max(np.linalg.norm(o), 1e-9)
            m = 0.75 * o + 0.25 * dirs[i]
            nrms.append(tuple(m / max(np.linalg.norm(m), 1e-9)))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    layer = me.uv_layers.new(name="UVMap")
    layer.data.foreach_set("uv", uvs.reshape(-1))
    me.normals_split_custom_set_from_vertices(nrms)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def materials(atlas_path, foliage_rgb, bark_rgb):
    bark = bpy.data.materials.new("bark")
    bark.use_nodes = True
    bark.use_backface_culling = True                      # closed trunk: single sided
    b = bark.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*bark_rgb, 1.0)
    b.inputs["Roughness"].default_value = 0.9
    leaves = bpy.data.materials.new("foliage")
    leaves.use_nodes = True
    leaves.use_backface_culling = False                   # double sided
    nt = leaves.node_tree
    p = nt.nodes["Principled BSDF"]
    p.inputs["Roughness"].default_value = 0.75
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(atlas_path, check_existing=True)
    tex.image.alpha_mode = "STRAIGHT"
    tex.interpolation = "Linear"
    mix = nt.nodes.new("ShaderNodeMix")                   # neutral atlas x species colour (glTF baseColorFactor)
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.inputs[0].default_value = 1.0
    mix.inputs[7].default_value = (*foliage_rgb, 1.0)
    clip = nt.nodes.new("ShaderNodeMath")                 # alpha clip: the glTF exporter writes alphaMode MASK
    clip.operation = "GREATER_THAN"
    clip.inputs[1].default_value = 0.5
    nt.links.new(tex.outputs["Color"], mix.inputs[6])
    nt.links.new(mix.outputs[2], p.inputs["Base Color"])
    nt.links.new(tex.outputs["Alpha"], clip.inputs[0])
    nt.links.new(clip.outputs["Value"], p.inputs["Alpha"])
    try:
        leaves.surface_render_method = "DITHERED"
    except Exception:
        pass
    return bark, leaves


def export(objs, path, quality):
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True, export_apply=False, export_yup=True,
        export_extras=True, export_cameras=False, export_lights=False, export_animations=False,
        export_image_format="WEBP", export_image_quality=quality,
        export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
        export_draco_position_quantization=14, export_draco_normal_quantization=10,
        export_draco_texcoord_quantization=12,
    )


def main():
    a = args()
    os.makedirs(a["out"], exist_ok=True)
    os.makedirs(a["tex"], exist_ok=True)
    if not os.path.exists(a["asset"]):
        raise SystemExit("missing CC0 tree asset %s (see ASSETS.md)" % a["asset"])
    for lod in a["lods"].split(","):
        spec = LODS[lod]
        reset()
        asset = load_asset(a["asset"])
        leaf_polys = part(asset, "leaves")
        trunk_polys, branch_polys = part(asset, "trunk"), part(asset, "branches")
        # origin at the base of the trunk
        trunk_v = asset["co"][np.unique(asset["lv"][np.concatenate([np.arange(asset["ls"][p], asset["ls"][p] + asset["lt"][p])
                                                                    for p in trunk_polys])])]
        zmin = float(trunk_v[:, 2].min())
        base = trunk_v[trunk_v[:, 2] < zmin + 0.15][:, :2].mean(axis=0)
        asset["co"] = asset["co"] - np.array([base[0], base[1], zmin])
        asset["ob"].hide_render = True
        cen, area, nrm = leaf_stats(asset, leaf_polys)
        keep = area > 1e-10
        leaf_polys, cen, area, nrm = leaf_polys[keep], cen[keep], area[keep], nrm[keep]
        crown_c = (cen * area[:, None]).sum(axis=0) / area.sum()
        size, centres, weights, normals = voxel_cards(cen, area, nrm, spec["cards"])
        log(lod, "voxel %.3f m, %d cards" % (size, len(centres)))
        # atlas (cached per size: the asset and the seed define it)
        atlas_path = os.path.join(a["tex"], "tree_leaf_atlas_%d.png" % spec["atlas"])
        if not os.path.exists(atlas_path):
            order = np.argsort(-weights)
            picks = []
            for i in order:                                # dense clusters, spread over the crown
                if all(np.linalg.norm(centres[i] - centres[j]) > size * 4 for j in picks):
                    picks.append(int(i))
                if len(picks) == CELLS * CELLS:
                    break
            leaf_imgs = {"diff": None, "alpha": None}
            folder = os.path.join(os.path.dirname(a["asset"]), "textures")
            for f in sorted(os.listdir(folder)):
                if "leaves_diff" in f:
                    leaf_imgs["diff"] = bpy.data.images.load(os.path.join(folder, f))
                if "leaves_alpha" in f:
                    leaf_imgs["alpha"] = bpy.data.images.load(os.path.join(folder, f))
            cluster = size * 2.2
            raw = render_clusters(asset, leaf_polys, cen, centres[picks],
                                  [(normals[i] + (centres[i] - crown_c) / max(np.linalg.norm(centres[i] - crown_c), 1e-9))
                                   / 2 for i in picks], cluster, spec["atlas"], a["tex"], leaf_imgs)
            save_png(finish_atlas(raw), atlas_path)
        # normalisation: the asset's own crown (leaf extents) and height, the same for every level of detail
        leaf_v = asset["co"][np.unique(asset["lv"][np.concatenate([np.arange(asset["ls"][p], asset["ls"][p] + asset["lt"][p])
                                                                   for p in leaf_polys])])]
        src_h = float(max(leaf_v[:, 2].max(), trunk_v[:, 2].max() - zmin))
        # crown diameter 1 in both plan directions (the site data, the plan and the sun analysis use round crowns)
        ext = np.array([np.ptp(leaf_v[:, 0]), np.ptp(leaf_v[:, 1])])
        src_c = float(ext.mean())
        scale = (1.0 / float(ext[0]), 1.0 / float(ext[1]), 1.0 / src_h)
        rng = np.random.default_rng(SEED)
        corners, dirs, uvs = card_geometry(centres, weights, normals, size, crown_c, rng)
        leaves = cards_mesh(corners, dirs, uvs, crown_c, scale, "tree_foliage")
        trunk = submesh(asset, trunk_polys, "trunk_src", uv_layer=0)
        branches = submesh(asset, branch_polys, "branch_src", uv_layer=0)
        t_dec = decimated(trunk, spec["trunk"])
        b_dec = decimated(branches, spec["branches"])
        # join trunk and branches into one bark node
        bpy.ops.object.select_all(action="DESELECT")
        t_dec.select_set(True)
        b_dec.select_set(True)
        bpy.context.view_layer.objects.active = t_dec
        bpy.ops.object.join()
        bark_ob = t_dec
        bark_ob.name = bark_ob.data.name = "tree_bark"
        from mathutils import Matrix
        bark_ob.data.transform(Matrix.Diagonal((scale[0], scale[1], scale[2], 1.0)))
        for o in (trunk, branches, asset["ob"]):
            bpy.data.objects.remove(o)
        foliage_rgb, bark_style = style_colours(a.get("style"))
        bark_rgb = bark_style or mean_colour(sum((v for k, v in asset["images"].items() if "trunk" in k), []))
        if foliage_rgb is None:
            foliage_rgb = [0.076, 0.147, 0.042]            # a mid leaf green when no style is given
        # neutral atlas (luminance only): the species colour comes from the material factor or the web's instance colour
        neutral_path = os.path.join(a["tex"], "tree_leaf_atlas_%d_neutral.png" % spec["atlas"])
        if not os.path.exists(neutral_path):
            img = bpy.data.images.load(atlas_path)
            px = np.empty(len(img.pixels), dtype=np.float32)
            img.pixels.foreach_get(px)
            arr = px.reshape(img.size[1], img.size[0], 4).astype(np.float64)
            bpy.data.images.remove(img)
            save_png(neutral_atlas(arr), neutral_path)
        m_bark, m_leaves = materials(neutral_path, foliage_rgb, bark_rgb)
        for ob, m, role in ((bark_ob, m_bark, "bark"), (leaves, m_leaves, "foliage")):
            ob.data.materials.clear()
            ob.data.materials.append(m)
            ob["role"] = role
            for poly in ob.data.polygons:
                poly.use_smooth = role == "foliage"
        scn = bpy.context.scene
        scn["crownBase"] = round(float(cen[:, 2].min()) / src_h, 4)
        # the crown centre in plan relative to the trunk base (normalised, house frame x east / y north): a loader may shift
        # an instance by -crownCentre x crown to centre the crown on the site position instead of the trunk
        scn["crownCentre"] = [round((float(leaf_v[:, 0].min()) + float(leaf_v[:, 0].max())) / 2 * scale[0], 4),
                              round((float(leaf_v[:, 1].min()) + float(leaf_v[:, 1].max())) / 2 * scale[1], 4)]
        scn["sourceHeight"] = round(src_h, 3)
        scn["sourceCrown"] = round(src_c, 3)
        scn["source"] = "tree_small_02 (Poly Haven, CC0)"
        path = os.path.join(a["out"], spec["file"])
        export([bark_ob, leaves], path, 85 if lod == "high" else 75)
        allv = np.array([v.co[:] for o in (bark_ob, leaves) for v in o.data.vertices])
        tris = sum(len(p.vertices) - 2 for o in (bark_ob, leaves) for p in o.data.polygons)
        log("%s: %d triangles, %.0f kB, normalised extent x %.3f y %.3f z %.3f, crown centre (%.3f, %.3f) (source %.2f m high, "
            "crown %.2f x %.2f m)" % (path, tris, os.path.getsize(path) / 1024.0, np.ptp(allv[:, 0]), np.ptp(allv[:, 1]),
                                     allv[:, 2].max(), (leaf_v[:, 0].min() + leaf_v[:, 0].max()) / 2 * scale[0],
                                     (leaf_v[:, 1].min() + leaf_v[:, 1].max()) / 2 * scale[1], src_h, ext[0], ext[1]))

main()
