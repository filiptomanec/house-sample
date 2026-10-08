"""Thinned copy of the scanned tree. The Poly Haven tree has 1.9 million leaf triangles (modelled leaves, about 100 000 separate
pieces); a render does not need them all, and Cycles pays for them in every sample and for every scene update. The leaf pieces
(connected triangle groups) are found once (cached in assets/cache), a seeded fraction `keep` of them stays, each kept piece
is scaled up about its centre so that the leaf area stays the same. Branches and trunk are untouched."""
from __future__ import annotations

import os

import numpy as np

from .ground_materials import ASSETS
from .util import log

CACHE = os.path.join(os.path.dirname(ASSETS), "assets", "cache")


def _components(tri, tag, nv):
    """Component label of every vertex used by the triangles (min vertex index of the connected group). Cached."""
    path = os.path.join(CACHE, "%s_leaf_components.npz" % tag)
    if os.path.exists(path):
        z = np.load(path)
        if z["tri_count"] == len(tri) and len(z["lab"]) == nv:
            return z["lab"].astype(np.int64)
    flat = tri.ravel()
    tri_id = np.repeat(np.arange(len(tri), dtype=np.int64), 3)
    order = np.argsort(flat, kind="stable")
    sv = flat[order]
    starts = np.flatnonzero(np.r_[True, sv[1:] != sv[:-1]])
    verts_u = sv[starts]
    st = tri_id[order]
    lab = np.arange(nv, dtype=np.int64)
    for it in range(200):
        m = lab[tri].min(axis=1)
        vm = np.minimum.reduceat(m[st], starts)
        new = np.minimum(lab[verts_u], vm)
        if np.array_equal(new, lab[verts_u]):
            break
        lab[verts_u] = new
    os.makedirs(CACHE, exist_ok=True)
    np.savez(path, lab=lab.astype(np.int32), tri_count=len(tri))
    log("tree leaf pieces found in %d passes" % it)
    return lab


def reduce_object(obj, keep, tag, leaf_material=1, seed=7):
    """Replaces the mesh of `obj` (triangles, materials, UV layers) by the thinned one. Returns the number of triangles."""
    import bpy
    me = obj.data
    nv, npoly, nl = len(me.vertices), len(me.polygons), len(me.loops)
    if nl != 3 * npoly:
        log("tree: not a triangle mesh, left as it is")
        return npoly
    co = np.empty(nv * 3, dtype=np.float32)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    vi = np.empty(nl, dtype=np.int32)
    me.loops.foreach_get("vertex_index", vi)
    tri = vi.reshape(-1, 3).astype(np.int64)
    mi = np.empty(npoly, dtype=np.int32)
    me.polygons.foreach_get("material_index", mi)
    leaf = mi == leaf_material
    lab = _components(tri[leaf], tag, nv)
    comp = lab[tri[:, 0]]
    comp[~leaf] = -1
    ids = np.unique(comp[leaf])
    rnd = np.random.default_rng(seed).random(len(ids))
    kept_ids = ids[rnd < keep]
    keep_tri = ~leaf | np.isin(comp, kept_ids)
    # scale the kept leaf pieces about their centres
    new_co = co.copy()
    lv = np.unique(tri[leaf & keep_tri].ravel())
    cl = lab[lv]
    uniq, inv = np.unique(cl, return_inverse=True)
    cnt = np.bincount(inv).astype(np.float64)
    cen = np.stack([np.bincount(inv, weights=co[lv, k]) / cnt for k in range(3)], axis=1)
    f = 1.0 / np.sqrt(max(keep, 1e-3))
    new_co[lv] = cen[inv] + (co[lv] - cen[inv]) * f
    # new mesh: used vertices only, loops of the kept triangles, UV layers copied
    t_keep = tri[keep_tri]
    used, remap = np.unique(t_keep.ravel(), return_inverse=True)
    loops_idx = (np.flatnonzero(keep_tri)[:, None] * 3 + np.arange(3)[None, :]).ravel()
    uvs = []
    for layer in me.uv_layers:
        a = np.empty(nl * 2, dtype=np.float32)
        layer.data.foreach_get("uv", a)
        uvs.append((layer.name, a.reshape(-1, 2)[loops_idx]))
    mats = list(me.materials)
    new = bpy.data.meshes.new(me.name + "_thin")
    nt = len(t_keep)
    new.vertices.add(len(used))
    new.vertices.foreach_set("co", new_co[used].ravel())
    new.loops.add(nt * 3)
    new.polygons.add(nt)
    new.loops.foreach_set("vertex_index", remap.astype(np.int32))
    new.polygons.foreach_set("loop_start", np.arange(0, nt * 3, 3, dtype=np.int32))
    new.polygons.foreach_set("material_index", mi[keep_tri].astype(np.int32))
    new.polygons.foreach_set("use_smooth", np.ones(nt, dtype=bool))
    for m in mats:
        new.materials.append(m)
    for name, arr in uvs:
        lay = new.uv_layers.new(name=name)
        lay.data.foreach_set("uv", arr.ravel())
    new.update()
    new.validate()
    obj.data = new
    bpy.data.meshes.remove(me)
    return nt
