"""Texture preparation: CC0 images from assets/textures resized to the level of detail and recoloured; procedural floors."""
from __future__ import annotations

import os

import numpy as np

from . import floor_textures as FT


def _bpy():
    import bpy
    return bpy


def asset_path(cfg, folder, kind):
    return os.path.join(cfg.assets_dir, "textures", folder, "%s_%s_2k.jpg" % (folder, kind))


def _normalize(px, target_hex, contrast, sat):
    """Recolour an RGBA float image buffer (see floor_textures.normalize_rgb); alpha is kept."""
    a = px.reshape(-1, 4).astype(np.float64)
    a[:, :3] = FT.normalize_rgb(a[:, :3], target_hex, contrast, sat)
    return a.reshape(-1).astype(np.float32)


def prepare(cfg, folder, kind, size, norm=None):
    """Resized copy (size x size JPEG) of a Poly Haven texture. norm = (target hex, contrast, saturation) recolours
    the colour map to a target mean colour (see _normalize)."""
    bpy = _bpy()
    os.makedirs(cfg.tex_dir, exist_ok=True)
    tag = "" if not norm else "_n%s_%d_%d" % (norm[0][1:], int(norm[1] * 100), int(norm[2] * 100))
    dst = os.path.join(cfg.tex_dir, "%s_%s_%d%s.jpg" % (folder, kind, size, tag))
    if os.path.exists(dst):
        return dst
    src = asset_path(cfg, folder, kind)
    if not os.path.exists(src):
        raise FileNotFoundError("missing texture asset: %s (see ASSETS.md)" % src)
    img = bpy.data.images.load(src)
    img.scale(size, size)
    if norm:
        px = np.empty(len(img.pixels), dtype=np.float32)
        img.pixels.foreach_get(px)
        img.pixels.foreach_set(_normalize(px, *norm))
    img.filepath_raw = dst
    img.file_format = "JPEG"
    img.save()
    bpy.data.images.remove(img)
    return dst


def procedural(cfg, kind, size, neutral=None):
    return FT.textures(kind, cfg.tex_dir, size, neutral)


def bake_tint(path, tint_hex, out_path):
    """Multiply an image by a tint colour (linear light, like glTF's baseColorFactor) and save it; for exporters that
    drop the factor (USDZ)."""
    bpy = _bpy()
    if os.path.exists(out_path):
        return out_path
    img = bpy.data.images.load(path)
    px = np.empty(len(img.pixels), dtype=np.float32)
    img.pixels.foreach_get(px)
    a = px.reshape(-1, 4).astype(np.float64)
    tint = FT.hex_lin(tint_hex)
    a[:, :3] = np.clip(FT.l2s(FT.s2l(a[:, :3]) * tint), 0, 1)
    img.pixels.foreach_set(a.reshape(-1).astype(np.float32))
    img.filepath_raw = out_path
    img.file_format = "JPEG" if out_path.lower().endswith(".jpg") else "PNG"
    img.save()
    bpy.data.images.remove(img)
    return out_path
