"""Poly Haven plant models (CC0, assets/models): import, bake, foliage shading with a per-species tint, library collections."""
from __future__ import annotations

import glob
import os

import numpy as np

from .ground_materials import ASSETS
from .util import hex_to_linear, log

_cache = {}
_KEEP = {}                      # model name -> fraction of the leaves that stays (set by vegetation.py)


def _library():
    import bpy
    lib = bpy.data.collections.get("LIB")
    if lib is None:
        lib = bpy.data.collections.new("LIB")
        bpy.context.scene.collection.children.link(lib)
        lib.hide_render = True
        lib.hide_viewport = True
    return lib


def load_model(name, origin="base", keep=None):
    """Imports assets/models/<name>/*.gltf; transforms are baked, the origin is moved to the base (xy centre of the lowest
    vertices). Returns the list of mesh objects (kept in the hidden LIB collection)."""
    import bpy
    from mathutils import Matrix, Vector
    if name in _cache:
        return _cache[name]
    keep = keep if keep is not None else _KEEP.get(name)
    files = glob.glob(os.path.join(ASSETS, "models", name, "*.gltf"))
    if not files:
        raise SystemExit("missing plant asset %s (see ASSETS.md)" % name)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=files[0])
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == "MESH"]
    lib = _library()
    for o in meshes:
        me = o.data
        if keep is not None and keep < 1.0 and len(me.polygons) > 500000:
            from . import tree_lod
            n_tri = tree_lod.reduce_object(o, keep, name)
            log("%s thinned to %d triangles (keep %.2f of the leaves)" % (name, n_tri, keep))
            me = o.data
        me.transform(o.matrix_world)
        o.matrix_world = Matrix.Identity(4)
        n = len(me.vertices)
        co = np.empty(n * 3, dtype=np.float32)
        me.vertices.foreach_get("co", co)
        co = co.reshape(-1, 3)
        zmin = co[:, 2].min()
        low = co[co[:, 2] < zmin + 0.06]
        c = Vector((float(low[:, 0].mean()), float(low[:, 1].mean()), float(zmin)))
        me.transform(Matrix.Translation(-c))
        for uc in list(o.users_collection):
            uc.objects.unlink(o)
        lib.objects.link(o)
    for o in new:
        if o.type != "MESH":
            bpy.data.objects.remove(o)
    _cache[name] = meshes
    return meshes


def bounds(obj):
    n = len(obj.data.vertices)
    co = np.empty(n * 3, dtype=np.float32)
    obj.data.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    return co.min(axis=0), co.max(axis=0)


def foliage_material(m, tint=None, value=2.1, translucency=0.3, recolor=False, cutout=True, vary=0.0):
    """Leaf cards from a Poly Haven atlas: the alpha comes from the luminance of the atlas (black background), the colour is
    brightened, a share of translucency lets light through. Returns a new material (a tinted copy when `tint` is given)."""
    nt0 = m.node_tree
    bs0 = nt0.nodes.get("Principled BSDF")
    if bs0 is None or not bs0.inputs["Base Color"].links:
        return m
    m = m.copy()
    m.use_backface_culling = False
    nodes, links = m.node_tree.nodes, m.node_tree.links
    bs = nodes.get("Principled BSDF")
    for key in ("Metallic", "Normal", "Alpha"):
        for l in list(bs.inputs[key].links):
            links.remove(l)
    bs.inputs["Metallic"].default_value = 0.0
    bs.inputs["Alpha"].default_value = 1.0
    src = bs.inputs["Base Color"].links[0].from_socket
    bw = nodes.new("ShaderNodeRGBToBW")
    links.new(src, bw.inputs[0])
    mr = nodes.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = 0.012
    mr.inputs["From Max"].default_value = 0.045
    links.new(bw.outputs[0], mr.inputs["Value"])
    hsv = nodes.new("ShaderNodeHueSaturation")
    hsv.inputs["Value"].default_value = value
    hsv.inputs["Saturation"].default_value = 1.1
    links.new(src, hsv.inputs["Color"])
    col = hsv.outputs[0]
    if vary > 0:
        # a little different tone for every instance (Object Info > Random): one material serves all trees
        oi = nodes.new("ShaderNodeObjectInfo")
        hv = nodes.new("ShaderNodeHueSaturation")
        mrh = nodes.new("ShaderNodeMapRange")
        mrh.inputs["To Min"].default_value = 0.5 - vary * 0.12
        mrh.inputs["To Max"].default_value = 0.5 + vary * 0.12
        links.new(oi.outputs["Random"], mrh.inputs["Value"])
        links.new(mrh.outputs[0], hv.inputs["Hue"])
        mrv = nodes.new("ShaderNodeMapRange")
        mrv.inputs["To Min"].default_value = 1.0 - vary
        mrv.inputs["To Max"].default_value = 1.0 + vary * 0.6
        links.new(oi.outputs["Random"], mrv.inputs["Value"])
        links.new(mrv.outputs[0], hv.inputs["Value"])
        links.new(col, hv.inputs["Color"])
        col = hv.outputs[0]
    if recolor and tint is not None:
        # the atlas only supplies light and dark: the colour is the species colour
        mr2 = nodes.new("ShaderNodeMapRange")
        mr2.inputs["From Min"].default_value = 0.0
        mr2.inputs["From Max"].default_value = 0.3
        mr2.inputs["To Min"].default_value = 0.45
        mr2.inputs["To Max"].default_value = 1.35
        links.new(bw.outputs[0], mr2.inputs["Value"])
        mx0 = nodes.new("ShaderNodeMix")
        mx0.data_type = "RGBA"
        mx0.blend_type = "MULTIPLY"
        mx0.inputs[0].default_value = 1.0
        mx0.inputs[6].default_value = (*tint, 1.0)
        links.new(mr2.outputs[0], mx0.inputs[7])
        col = mx0.outputs[2]
        tint = None
    if tint is not None:
        mx = nodes.new("ShaderNodeMix")
        mx.data_type = "RGBA"
        mx.blend_type = "MULTIPLY"
        mx.inputs[0].default_value = 1.0
        mx.inputs[7].default_value = (*tint, 1.0)
        links.new(col, mx.inputs[6])
        col = mx.outputs[2]
    links.new(col, bs.inputs["Base Color"])
    tr = nodes.new("ShaderNodeBsdfTranslucent")
    links.new(col, tr.inputs["Color"])
    mix = nodes.new("ShaderNodeMixShader")
    mix.inputs[0].default_value = translucency
    links.new(bs.outputs[0], mix.inputs[1])
    links.new(tr.outputs[0], mix.inputs[2])
    out = next(n for n in nodes if n.type == "OUTPUT_MATERIAL")
    if not cutout:
        # the leaves of the scanned tree are modelled leaf shapes: no alpha test (much cheaper to render)
        links.new(mix.outputs[0], out.inputs["Surface"])
        return m
    tp = nodes.new("ShaderNodeBsdfTransparent")
    cut = nodes.new("ShaderNodeMixShader")
    links.new(mr.outputs[0], cut.inputs[0])
    links.new(tp.outputs[0], cut.inputs[1])
    links.new(mix.outputs[0], cut.inputs[2])
    links.new(cut.outputs[0], out.inputs["Surface"])
    return m


def leaf_tint(hex_color, reference="#6a8b45"):
    """Linear RGB multiplier that turns the atlas green into the species colour."""
    a, r = hex_to_linear(hex_color), hex_to_linear(reference)
    return tuple(min(2.0, a[i] / max(r[i], 1e-3)) for i in range(3))


def species_collection(model, species, tint, tag, recolor=False, copies=None, cutout=True, vary=0.0):
    """A collection with copies of the model's objects whose materials are tinted foliage (mesh data is shared).
    `copies` = [(yaw_deg, scale, dx, dy)]: several rotated copies around the same trunk make a fuller crown (default one)."""
    import bpy
    import math
    copies = copies or [(0.0, 1.0, 0.0, 0.0)]
    key = ("sc", model, species, tag, tuple(copies))
    if key in _cache:
        return _cache[key]
    col = bpy.data.collections.new("S_%s_%s" % (model, species))
    _library().children.link(col)
    mats = {}
    for src in load_model(model):
        for i, base in enumerate(src.data.materials):
            mats[(src.name, i)] = foliage_material(base, tint, recolor=recolor, cutout=cutout, vary=vary) if base else None
    for yaw, sc, dx, dy in copies:
        for src in load_model(model):
            o = src.copy()
            col.objects.link(o)
            o.location = (dx, dy, 0.0)
            o.scale = (sc, sc, sc)
            o.rotation_euler = (0.0, 0.0, math.radians(yaw))
            for i, slot in enumerate(o.material_slots):
                slot.link = "OBJECT"
                slot.material = mats.get((src.name, i))
    _cache[key] = col
    return col


def instance(collection, location, scale, yaw_deg, name):
    import bpy
    import math
    o = bpy.data.objects.new(name, None)
    o.instance_type = "COLLECTION"
    o.instance_collection = collection
    o.location = location
    o.scale = scale if isinstance(scale, (tuple, list)) else (scale,) * 3
    o.rotation_euler = (0.0, 0.0, math.radians(yaw_deg))
    return o


def model_stats(name):
    """Height and crown of a scanned model from its leaf vertices (material index 1 when there are three materials, else all):
    {height, crown (diameter), centre (x, y), z0, z1 (foliage zone)}."""
    key = ("stats", name)
    if key in _cache:
        return _cache[key]
    objs = load_model(name)
    ob = max(objs, key=lambda o: len(o.data.vertices))
    me = ob.data
    n = len(me.vertices)
    co = np.empty(n * 3, dtype=np.float32)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    sel = co
    if len(me.materials) >= 3 and len(me.loops) == 3 * len(me.polygons):
        mi = np.empty(len(me.polygons), dtype=np.int32)
        me.polygons.foreach_get("material_index", mi)
        vi = np.empty(len(me.loops), dtype=np.int32)
        me.loops.foreach_get("vertex_index", vi)
        leaf_v = np.unique(vi.reshape(-1, 3)[mi == 1].ravel())
        if len(leaf_v):
            sel = co[leaf_v]
    q = lambda a, p: float(np.percentile(a, p))  # noqa: E731
    st = {"height": float(co[:, 2].max()), "crown": q(sel[:, 0], 97) - q(sel[:, 0], 3),
          "crownY": q(sel[:, 1], 97) - q(sel[:, 1], 3), "cx": float(sel[:, 0].mean()), "cy": float(sel[:, 1].mean()),
          "z0": q(sel[:, 2], 4), "z1": q(sel[:, 2], 98)}
    _cache[key] = st
    return st
