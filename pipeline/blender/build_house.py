"""Procedural house model in Blender, driven by generated/derived.json + model/house.json (+ model/style.json).

    BLENDER -b --factory-startup --python pipeline/blender/build_house.py -- \
        --derived generated/derived.json --house model/house.json --style model/style.json \
        --out public/models [--lod high|lite] [--for-render [--blinds] [--pv] [--vegetation]] [--usdz] [--blend file.blend]

`build_scene(cfg)` builds the geometry into a collection and returns it, so other tools (the renderer) can call it and add
their own details (blinds, PV, vegetation, terrain) into the returned collections.
"""
from __future__ import annotations

import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

from hb import config as C            # noqa: E402
from hb import mesh as M              # noqa: E402
from hb import walls as W             # noqa: E402
from hb import openings as O          # noqa: E402
from hb import exterior as X          # noqa: E402
from hb import roof as R              # noqa: E402
from hb import roof_eaves as RE       # noqa: E402
from hb import selfcheck as SC        # noqa: E402


def build_geometry(cfg):
    """Pure-Python part: all polygons of the house in a MeshSet. Returns (MeshSet, info dict)."""
    ms = M.MeshSet()
    st = W.build_grid(cfg)
    W.build_walls(cfg, ms, st)
    cells = W.build_floors_and_ceilings(cfg, ms, st)
    W.build_plinth(cfg, ms)
    glazed = O.build_openings(cfg, ms)
    X.build_outdoor(cfg, ms)
    X.build_gravel(cfg, ms)
    X.build_cladding(cfg, ms)
    X.build_screens(cfg, ms)
    model = R.RoofModel(cfg)
    RE.build_roof(cfg, ms, model)
    warnings = R.check_against_derived(cfg, model) + W.check_floor_areas(cfg, st, cells)
    errs, _ = SC.check(ms)
    if errs:
        raise RuntimeError("geometry self-check failed:\n  " + "\n  ".join(errs[:30]))
    info = {"structure": st, "roof": model, "rooms": sorted(cells), "glazed": glazed, "warnings": warnings}
    return ms, info


def _collection(bpy, name, parent=None):
    col = bpy.data.collections.new(name)
    (parent or bpy.context.scene.collection).children.link(col)
    return col


def build_scene(cfg, clear=True, mode=None):
    """Build the house into Blender. Returns {'house': collection, 'blinds'|'pv'|'vegetation'|'terrain': empty
    collections for render-only details (when cfg.for_render), 'objects': [...], 'stats': {...}, 'geometry': MeshSet}."""
    import bpy
    from hb import materials as MAT

    if clear:
        for ob in list(bpy.data.objects):
            bpy.data.objects.remove(ob)
        for coll in list(bpy.data.collections):
            bpy.data.collections.remove(coll)
        for blk in (bpy.data.meshes, bpy.data.materials, bpy.data.images):
            for item in list(blk):
                blk.remove(item)
    t0 = time.time()
    ms, info = build_geometry(cfg)
    roles = {n.role for n in ms.nodes.values()}
    mats, tiles = MAT.make_materials(cfg, roles, mode or ("render" if cfg.for_render else "export"))
    house = _collection(bpy, "house")
    objs = ms.to_blender(house, mats, tiles)
    out = {"house": house, "objects": objs, "geometry": ms, "info": info,
           "stats": {"triangles": ms.triangles(), "nodes": len(objs), "roles": ms.stats(),
                     "seconds": round(time.time() - t0, 2)}}
    if cfg.for_render:
        # hooks for the render-only details; other modules fill these collections
        for name in ("blinds", "pv", "vegetation", "terrain"):
            out[name] = _collection(bpy, name)
    return out


def parse_args(argv):
    a = {"lod": "high", "for_render": False, "usdz": False}
    it = iter(argv)
    for tok in it:
        if tok in ("--derived", "--house", "--style", "--out", "--lod", "--blend", "--glb", "--assets", "--tex", "--tex-px"):
            a[tok[2:]] = next(it)
        elif tok == "--for-render":
            a["for_render"] = True
        elif tok in ("--blinds", "--pv", "--vegetation"):
            # render-only details: other modules fill the matching collections; the flags imply --for-render
            a.setdefault("details", []).append(tok[2:])
            a["for_render"] = True
        elif tok == "--usdz":
            a["usdz"] = True
        else:
            raise SystemExit("unknown argument: %s" % tok)
    for req in ("derived", "house", "out"):
        if req not in a:
            raise SystemExit("missing --%s" % req)
    if a["lod"] not in ("high", "lite"):
        raise SystemExit("--lod must be high or lite")
    return a


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    a = parse_args(argv)
    os.makedirs(a["out"], exist_ok=True)
    cfg = C.Config.load(a["derived"], a["house"], a.get("style"), lod=a["lod"], for_render=a["for_render"],
                        out_dir=a["out"], assets_dir=a.get("assets"), tex_dir=a.get("tex"),
                        overrides={"texture_px": int(a["tex-px"])} if "tex-px" in a else None)
    res = build_scene(cfg, mode="usd" if a["usdz"] else None)
    res["details"] = a.get("details", [])
    print("[house] %s: %d nodes, %d triangles, %.1fs" % (a["lod"], res["stats"]["nodes"], res["stats"]["triangles"],
                                                          res["stats"]["seconds"]))
    for w in res["info"]["warnings"]:
        print("[house] WARNING: %s" % w)
    from hb import export as EX
    if a["usdz"]:
        EX.export_usdz(cfg, res, os.path.join(a["out"], "house.usdz"))
    elif not a["for_render"] or a.get("glb"):
        # the render variant (glass shader, 2k textures) is not meant for the web: it only exports with an explicit --glb
        glb = a.get("glb") or os.path.join(a["out"], "house-lite.glb" if a["lod"] == "lite" else "house.glb")
        EX.export_glb(cfg, res, glb)
    if a.get("blend"):
        import bpy
        bpy.ops.wm.save_as_mainfile(filepath=a["blend"])


if __name__ == "__main__":
    main()
