"""Scene assembly: the house from pipeline/blender (build_scene, high detail, render variant) and the furniture GLB."""
from __future__ import annotations

import os
import sys

from . import materials as MAT
from .util import log, repo_path


def _abs(p):
    return p if os.path.isabs(p) else repo_path(p)


def build_house(inputs):
    """Builds the house into the Blender file (clearing it first). Returns the build_scene result dict."""
    bdir = repo_path("pipeline", "blender")
    if bdir not in sys.path:
        sys.path.insert(0, bdir)
    import build_house as BH
    from hb import config as HC
    i = inputs["inputs"]
    cfg = HC.Config.load(_abs(i["derived"]), _abs(i["house"]), _abs(i["style"]), lod="high", for_render=True)
    res = BH.build_scene(cfg)
    res["cfg"] = cfg
    for w in res["info"]["warnings"]:
        log("house warning:", w)
    log("house: %d nodes, %d triangles" % (res["stats"]["nodes"], res["stats"]["triangles"]))
    # the glass role: clear glass without refraction (the builder's render variant uses a refractive Glass BSDF)
    import bpy
    g = bpy.data.materials.get("glass")
    if g:
        MAT.clear_glass(g)
    return res


def import_furniture(inputs):
    """Imports the furniture GLB (house frame baked in, Y-up) and tunes its materials. Returns the new objects."""
    import bpy
    path = _abs(inputs["inputs"]["glb"]["furniture"])
    if not os.path.exists(path):
        log("furniture GLB missing:", path)
        return []
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    col = bpy.data.collections.new("furniture")
    bpy.context.scene.collection.children.link(col)
    for o in new:
        for uc in list(o.users_collection):
            uc.objects.unlink(o)
        col.objects.link(o)
    MAT.tune_furniture(new)
    log("furniture: %d objects" % len([o for o in new if o.type == "MESH"]))
    return new
