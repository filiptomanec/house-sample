"""Procedural, seamless floor textures (drawn from scratch, nothing fetched): light oak planks, grey 60 x 60 tiles, light stone-grey tiles.

Every texture tiles seamlessly (periodic FFT noise, joints laid out on the tile period) and is drawn at real scale:
TILE[kind] is the size of one texture repeat in metres (u, v); u runs along the planks. numpy only; PNG files are written
with zlib so no image library is needed.
"""
from __future__ import annotations

import os
import struct
import zlib

import numpy as np

TILE = {
    "oak": (3.6, 3.6),      # 18 rows of 20 cm planks, 2 planks of 180 cm per row, staggered joints
    "tile": (1.2, 1.2),     # 2 x 2 tiles of 60 x 60 cm, 3 mm grout
    "stone": (1.2, 1.2),    # 2 x 2 tiles of 60 x 60 cm, 2 mm grout
}


def noise(shape, sig_u, sig_v, rng):
    """Periodic gaussian-filtered noise, zero mean, unit std; sig_* = correlation length in pixels along u (x) / v (y)."""
    h, w = shape
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.fftfreq(w)[None, :]
    f = np.exp(-2 * (np.pi ** 2) * ((fx * sig_u) ** 2 + (fy * sig_v) ** 2))
    n = np.real(np.fft.ifft2(np.fft.fft2(rng.standard_normal(shape)) * f))
    return (n - n.mean()) / (n.std() + 1e-9)


def srgb(h):
    return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], float) / 255


def groove(d, half):
    t = np.clip(d / half, 0, 1)
    return t * t * (3 - 2 * t)


def normal_from_height(hgt, strength):
    dx = (np.roll(hgt, -1, 1) - np.roll(hgt, 1, 1)) * 0.5 * strength
    dy = (np.roll(hgt, -1, 0) - np.roll(hgt, 1, 0)) * 0.5 * strength
    n = np.dstack([-dx, dy, np.ones_like(hgt)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return n * 0.5 + 0.5


def periodic_gap(a, b, period):
    d = np.abs(np.asarray(a)[:, None] - np.asarray(b)[None, :]) % period
    return float(np.minimum(d, period - d).min())


def spread_tones(count, pairs, rng, min_step=0.2, iters=4000):
    """Board tones in -1..1, evenly spread and shuffled so touching boards differ by at least min_step where possible."""
    t = rng.permutation(np.linspace(-1, 1, count))
    a, b = np.array([p[0] for p in pairs]), np.array([p[1] for p in pairs])
    bad = lambda t: int(np.sum(np.abs(t[a] - t[b]) < min_step))
    cur = bad(t)
    for _ in range(iters):
        if cur == 0:
            break
        i, j = rng.integers(0, count, 2)
        t[i], t[j] = t[j], t[i]
        new = bad(t)
        if new <= cur:
            cur = new
        else:
            t[i], t[j] = t[j], t[i]
    return t


def planks(n, tile, rows, cut, gap, base, amp, grain_amp, seed, gap_col, hue=0.02, ramp=0.02, patch=0.015, stagger=0.3):
    """Rows of boards along u on one texture repeat of `tile` = (u, v) metres, drawn at n x n px.
    cut(rng) gives the lengths of the boards of one row; every board gets its own tone, warm/cool shift, piece of the
    grain and grain strength. Returns colour (h, w, 3) in 0..1 and a height map."""
    rng = np.random.default_rng(seed)
    (tu, tv), h, w = tile, n, n
    pu, pv, pitch = w / tu, h / tv, tv / rows
    U = (np.arange(w) + 0.5) / pu
    V = (np.arange(h) + 0.5) / pv
    joints = []
    for r in range(rows):
        for _ in range(500):
            L = np.asarray(cut(rng), float)
            j = np.sort((rng.random() * tu + np.concatenate([[0], np.cumsum(L)[:-1]])) % tu)
            if (r == 0 or periodic_gap(j, joints[-1], tu) >= stagger) and \
                    (r < rows - 1 or periodic_gap(j, joints[0], tu) >= stagger):
                break
        joints.append(j)
    first = np.cumsum([0] + [len(j) for j in joints])
    count = int(first[-1])
    ids, along, du = np.empty((rows, w), int), np.empty((rows, w)), np.empty((rows, w))
    for r, j in enumerate(joints):
        k = (np.searchsorted(j, U, "right") - 1) % len(j)
        length = (np.roll(j, -1) - j) % tu
        length[length == 0] = tu
        ids[r] = first[r] + k
        along[r] = ((U - j[k]) % tu) / length[k]
        d = np.abs(U[:, None] - j[None, :]) % tu
        du[r] = np.minimum(d, tu - d).min(1)
    pairs = {(int(a), int(b)) for r in range(rows) for a, b in zip(ids[r], np.roll(ids[r], 1)) if a != b}
    pairs |= {(int(a), int(b)) for r in range(rows) for a, b in zip(ids[r], ids[(r + 1) % rows])}
    tone = 1 + amp * spread_tones(count, sorted(pairs), rng)
    warm = 1 + hue * rng.uniform(-1, 1, count)
    slope = ramp * rng.uniform(-1, 1, count)
    strength = rng.uniform(0.75, 1.25, count)
    phase = rng.uniform(0, 2 * np.pi, count)
    shift = rng.integers(0, n, (count, 2))
    row = (np.floor(V / pitch).astype(int) % rows)[:, None]
    col_i = np.arange(w)[None, :]
    bid = ids[row, col_i]
    t_along = along[row, col_i]
    dv = np.abs(V / pitch - np.round(V / pitch))[:, None] * pitch
    dmin = np.minimum(np.broadcast_to(dv, (h, w)), du[row, col_i])
    yy, xx = np.meshgrid(np.arange(h), np.arange(w), indexing="ij")
    sy, sx = (yy + shift[bid, 0]) % h, (xx + shift[bid, 1]) % w
    own = lambda f: f[sy, sx]
    g = own(noise((h, w), 0.25 * pu, 0.0025 * pv, rng) * 0.7 + noise((h, w), 0.05 * pu, 0.0014 * pv, rng) * 0.3)
    wave = own(noise((h, w), 0.32 * pu, 0.08 * pv, rng))
    vb = (sy + 0.5) / pv
    cyc = lambda per_m: round(per_m * tv) / tv
    figure = np.sin(2 * np.pi * cyc(20) * vb + wave * 3.5 + phase[bid])
    fine = np.sin(2 * np.pi * cyc(80) * vb + wave * 1.5 + 0.5 * phase[bid])
    pores = own(noise((h, w), 0.009 * pu, 0.001 * pv, rng))
    patchy = noise((h, w), 0.45 * pu, 0.3 * pv, rng)
    lum = tone[bid] * (1 + slope[bid] * (2 * t_along - 1)) * (1 + patch * patchy) * \
        (1 + grain_amp * strength[bid] * (0.45 * g + 0.30 * figure + 0.12 * fine + 0.13 * pores))
    col = base[None, None, :] * lum[..., None]
    col[..., 0] *= warm[bid]
    col[..., 2] /= warm[bid]
    edge = groove(dmin * pu, gap * pu)
    col = col * edge[..., None] + gap_col[None, None, :] * (1 - edge[..., None])
    hgt = edge * 1.0 + 0.04 * g * edge
    return np.clip(col, 0, 1), hgt


def tiles(n, count, grout_px, base, var, grout_col, seed, stone=False):
    rng = np.random.default_rng(seed)
    h = w = n
    y = (np.arange(h)[:, None] + 0.5) / h * count
    x = (np.arange(w)[None, :] + 0.5) / w * count
    tid = (np.floor(y).astype(int) % count) * count + (np.floor(x).astype(int) % count)
    tone = 1 + var * rng.standard_normal(count * count)
    d = np.minimum(np.abs(x - np.round(x)) * w / count, np.abs(y - np.round(y)) * h / count)
    shift = rng.integers(0, n, (count * count, 2))

    def per_tile(a):
        out = np.empty_like(a)
        for t in range(count * count):
            m = tid == t
            out[m] = np.roll(a, tuple(shift[t]), (0, 1))[m]
        return out

    mott = per_tile(noise((h, w), 55, 55, rng) * 0.6 + noise((h, w), 12, 12, rng) * 0.4)
    fine = noise((h, w), 1.2, 1.2, rng)
    lum = tone[tid] * (1 + 0.035 * mott + 0.018 * fine)
    if stone:
        vein = per_tile(np.exp(-np.abs(noise((h, w), 40, 18, rng)) * 9))
        lum = lum * (1 - 0.05 * vein) * (1 + 0.012 * noise((h, w), 3, 3, rng))
    col = base[None, None, :] * lum[..., None]
    edge = groove(d, grout_px)
    bevel = 0.97 + 0.03 * groove(d, grout_px * 2.5)
    col = col * (edge * bevel)[..., None] + grout_col[None, None, :] * (1 - edge[..., None])
    return np.clip(col, 0, 1), edge * 1.0


def half(a):
    return (a[0::2, 0::2] + a[1::2, 0::2] + a[0::2, 1::2] + a[1::2, 1::2]) / 4


def render(kind, n=1024):
    """(diffuse, normal) arrays 0..1 for a kind at n x n px."""
    k = n / 1024.0
    if kind == "oak":
        col, hgt = planks(2 * n, TILE[kind], 18, lambda rng: (1.8, 1.8), 0.0035, srgb("#DCBE95"), 0.07, 0.08, 11,
                          srgb("#A08A6C"), hue=0.015, ramp=0.02, patch=0.015)
        col, hgt = half(col), half(hgt)
        nor = normal_from_height(hgt, 1.2)
    elif kind == "tile":
        col, hgt = tiles(n, 2, 2.6 * k, srgb("#A7A7A3"), 0.02, srgb("#8E8D89"), 31)
        nor = normal_from_height(hgt, 1.0)
    elif kind == "stone":
        col, hgt = tiles(n, 2, 1.8 * k, srgb("#CFCBC3"), 0.018, srgb("#B7B3AB"), 47, stone=True)
        nor = normal_from_height(hgt, 1.0)
    else:
        raise ValueError(kind)
    return col, nor


def s2l(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def l2s(c):
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(np.clip(c, 0, None), 1 / 2.4) - 0.055)


def hex_lin(h):
    return s2l(np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], dtype=np.float64) / 255.0)


def normalize_rgb(rgb, target_hex, contrast, sat):
    """Recolour sRGB pixels (..., 3) in 0..1 so that their mean (linear light) equals the target colour; the local
    variation is scaled by `contrast`, its colourfulness by `sat`. Returns sRGB in 0..1."""
    shape = rgb.shape
    lin = s2l(rgb.reshape(-1, 3).astype(np.float64))
    tgt = hex_lin(target_hex)
    out = lin * (tgt / np.maximum(lin.mean(axis=0), 1e-4))
    dev = (out - tgt) * contrast
    lum = dev @ np.array([0.2126, 0.7152, 0.0722])
    dev = lum[:, None] + (dev - lum[:, None]) * sat
    return np.clip(l2s(np.clip(tgt + dev, 0, 1)), 0, 1).reshape(shape)


def write_png(path, arr):
    """8-bit RGB PNG from a float array (h, w, 3) in 0..1 (stdlib zlib)."""
    a = (np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8)
    h, w, _ = a.shape
    raw = b"".join(b"\x00" + a[y].tobytes() for y in range(h))

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(raw, 6)))
        f.write(chunk(b"IEND", b""))
    return path


def textures(kind, out_dir, size=1024, neutral=None):
    """Writes proc_<kind>_diff_<size>.png and proc_<kind>_nor_gl_<size>.png into out_dir; returns their paths.
    neutral = (target hex, contrast, saturation) recolours the colour map to a neutral mean (the material colour is
    then applied as a tint, so a style colour change needs no new texture)."""
    os.makedirs(out_dir, exist_ok=True)
    tag = "" if not neutral else "_n%s_%d_%d" % (neutral[0][1:], int(neutral[1] * 100), int(neutral[2] * 100))
    diff = os.path.join(out_dir, "proc_%s_diff_%d%s.png" % (kind, size, tag))
    nor = os.path.join(out_dir, "proc_%s_nor_gl_%d.png" % (kind, size))
    if os.path.exists(diff) and os.path.exists(nor):
        return diff, nor
    c, nm = render(kind, size)
    if neutral:
        c = normalize_rgb(c, *neutral)
    write_png(diff, c)
    write_png(nor, nm)
    return diff, nor


def seam_maps(out_dir, n, seam_frac, rough, metal, crest_rough=None):
    """Standing-seam stripe for the roof sheet, one seam per texture repeat (u = across the seams, the seam centred on
    u = 0): an OpenGL normal map of the folded seam and a glTF metallic-roughness map (G = roughness, B = metallic, R = 1).
    At a distance, where the modelled seams are thinner than a pixel, the mipmaps keep an even seam rhythm. Returns paths."""
    os.makedirs(out_dir, exist_ok=True)
    crest = rough * 0.7 if crest_rough is None else crest_rough
    tag = "%d_%d" % (n, int(round(seam_frac * 1000)))
    nor_p = os.path.join(out_dir, "proc_seam_nor_gl_%s.png" % tag)
    mr_p = os.path.join(out_dir, "proc_seam_mr_%s_%d_%d_%d.png" % (tag, int(rough * 100), int(metal * 100), int(crest * 100)))
    if os.path.exists(nor_p) and os.path.exists(mr_p):
        return nor_p, mr_p
    u = (np.arange(n) + 0.5) / n
    d = np.minimum(u, 1 - u)                                     # distance to the seam line (in repeats)
    half = seam_frac / 2.0
    # height: a rounded fold over the seam width plus a faint stiffening rib halfway between seams
    hgt = np.clip(1 - (d / half) ** 2, 0, 1) ** 0.5 + 0.04 * np.exp(-((d - 0.5) / 0.01) ** 2)
    hgt2 = np.tile(hgt[None, :], (n, 1))
    nor = normal_from_height(hgt2 * (n * seam_frac * 0.6), 1.0)
    mr = np.empty((n, n, 3))
    mr[..., 0] = 1.0
    r_line = rough + (crest - rough) * np.clip(1 - (d / half) ** 2, 0, 1)
    mr[..., 1] = np.tile(r_line[None, :], (n, 1))
    mr[..., 2] = metal
    write_png(nor_p, nor)
    write_png(mr_p, mr)
    return nor_p, mr_p
