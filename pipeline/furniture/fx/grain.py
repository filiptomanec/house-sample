"""Procedural light-oak grain: one small seamless texture shared by the wood materials, plus box-projected UVs.

The texture is nearly neutral (only the late-wood lines are a little browner); every wood material keeps its palette
colour as the glTF baseColorFactor (`tint`), scaled so that the average of tint x texture equals the palette colour.
One repeat is TILE metres (u along the grain, v across it). UVs are projected per part (one primitive of a piece): each
triangle goes onto the plane of the part's frame axis its normal is closest to, with u along the longest remaining
axis, so the grain runs along every board, leg and batten. Every part starts at its own place in the texture (seeded by
its position), so neighbouring boards differ and every build gives the same file.
"""
import os
import shutil
import subprocess
import numpy as np

TILE = (1.2, 0.6)
MAGICK = shutil.which('magick') or '/opt/homebrew/bin/magick'


def noise(shape, sig_u, sig_v, rng):
    """Periodic gaussian-filtered noise, zero mean, unit std (correlation lengths in pixels along u and v)."""
    h, w = shape
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.fftfreq(w)[None, :]
    f = np.exp(-2 * (np.pi ** 2) * ((fx * sig_u) ** 2 + (fy * sig_v) ** 2))
    n = np.real(np.fft.ifft2(np.fft.fft2(rng.standard_normal(shape)) * f))
    return (n - n.mean()) / (n.std() + 1e-9)


def half(a):
    return (a[0::2, 0::2] + a[1::2, 0::2] + a[0::2, 1::2] + a[1::2, 1::2]) / 4


def texture(n=512, seed=5):
    """sRGB colour (n, n, 3) in 0..1: columns run along u (the grain), rows across (v)."""
    rng = np.random.default_rng(seed)
    N = 2 * n
    tu, tv = TILE
    pu, pv = N / tu, N / tv
    v = (np.arange(N) + 0.5) / pv
    k = 7                                                    # glued staves, 6-11 cm wide
    w = rng.uniform(0.75, 1.3, k)
    w *= tv / w.sum()
    edges = np.concatenate([[0], np.cumsum(w)[:-1]])
    sid = np.clip(np.searchsorted(edges, v, 'right') - 1, 0, k - 1)
    order = rng.permutation(np.linspace(-1, 1, k))
    for _ in range(200):
        if np.all(np.abs(order - np.roll(order, 1)) >= 0.3):
            break
        order = rng.permutation(order)
    tone = 1 + 0.035 * order
    warm = 1 + 0.012 * rng.uniform(-1, 1, k)
    spacing = rng.uniform(0.0045, 0.0075, k)
    wander = rng.choice([0.003, 0.006, 0.012, 0.022, 0.032], k)
    phase = rng.uniform(0, 2 * np.pi, k)
    S = sid[:, None]
    t = (v - edges[sid])[:, None]
    meander = noise((N, N), 0.20 * pu, 0.035 * pv, rng)
    jitter = noise((N, N), 0.6 * pu, 0.004 * pv, rng)
    phi = 2 * np.pi * (t + wander[S] * meander) / spacing[S] + 1.3 * jitter + phase[S]
    line = ((1 + np.cos(phi)) / 2) ** 4
    ring = np.floor((phi + np.pi) / (2 * np.pi))
    line *= 0.45 + 0.95 * np.modf(np.abs(np.sin(ring * 12.9898 + S * 78.233)) * 43758.5453)[0]
    fade = np.clip(0.65 + 0.35 * noise((N, N), 0.07 * pu, 0.012 * pv, rng), 0, 1)
    streak = 0.6 * noise((N, N), 0.22 * pu, 0.0018 * pv, rng) + 0.4 * noise((N, N), 0.035 * pu, 0.0010 * pv, rng)
    patch = noise((N, N), 0.40 * pu, 0.15 * pv, rng)
    lum = tone[S] * (1 + 0.016 * patch) * (1 + 0.040 * streak) * (1 - 0.17 * fade * line)
    base = np.array([1.0, 0.975, 0.94])
    deep = np.array([0.0, 0.03, 0.08])
    col = 0.86 * lum[..., None] * base * (1 - deep * (fade * line)[..., None])
    col[..., 0] *= warm[S]
    col[..., 2] /= warm[S]
    return np.clip(half(col), 0, 1)


def to_linear(c):
    c = np.asarray(c, float)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def tint(palette_linear, tex):
    """glTF baseColorFactor (linear): average of factor x texture (linear) = palette colour."""
    m = to_linear(tex).reshape(-1, 3).mean(0)
    f = np.asarray(palette_linear[:3], float) / m
    return tuple(float(x) for x in np.clip(f, 0, 1))


def save(arr, path, quality=84):
    """Writes the array as JPEG/WebP/PNG (by extension) with ImageMagick."""
    a = (np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8)
    ppm = path + '.ppm'
    with open(ppm, 'wb') as f:
        f.write(b'P6\n%d %d\n255\n' % (a.shape[1], a.shape[0]))
        f.write(a.tobytes())
    subprocess.run([MAGICK, ppm, '-strip', '-quality', str(quality), path], check=True)
    os.remove(ppm)
    return path


def make(path, n):
    """Writes the texture at n x n px (the same pattern, box-filtered down from 512); returns (path, array)."""
    tex = texture(512)
    while tex.shape[0] > n:
        tex = half(tex)
    save(tex, path)
    return path, tex


def frame(V):
    """Rows: the part's axes, longest first (world axes ordered by extent, or principal axes of a clearly elongated
    part turned more than 8 degrees off every world axis)."""
    ext = V.max(0) - V.min(0)
    W = np.eye(3)[np.argsort(-ext, kind='stable')]
    if len(V) >= 4:
        w, E = np.linalg.eigh(np.cov((V - V.mean(0)).T))
        e0 = E[:, 2]
        if w[2] > 4 * max(w[1], 1e-12) and np.abs(e0).max() < np.cos(np.radians(8)):
            return E[:, ::-1].T
    return W


def uvs(pos, pid):
    """Box-projected UVs (nt, 3, 2) for triangle corners pos (nt, 3, 3); pid (nt,) labels the parts."""
    nt = len(pos)
    uv = np.zeros((nt, 3, 2))
    if not nt:
        return uv
    fn = np.cross(pos[:, 1] - pos[:, 0], pos[:, 2] - pos[:, 0])
    order = np.argsort(pid, kind='stable')
    cuts = np.flatnonzero(np.diff(pid[order])) + 1
    for sel in np.split(order, cuts):
        P = pos[sel].reshape(-1, 3)
        F = frame(np.unique(P.round(5), axis=0))
        L = (P @ F.T).reshape(-1, 3, 3)
        L -= L.reshape(-1, 3).min(0)
        k = np.abs(fn[sel] @ F.T).argmax(1)
        a = np.where(k == 0, 1, 0)
        b = np.where(k == 2, 1, 2)
        u = np.take_along_axis(L, np.repeat(a[:, None, None], 3, 1), 2)[..., 0]
        v = np.take_along_axis(L, np.repeat(b[:, None, None], 3, 1), 2)[..., 0]
        c = np.round(P.mean(0) * 1000).astype(np.int64)
        rng = np.random.default_rng(int((c[0] * 73856093) ^ (c[1] * 19349663) ^ (c[2] * 83492791)) & 0xFFFFFFFF)
        uv[sel, :, 0] = u / TILE[0] + rng.random()
        uv[sel, :, 1] = v / TILE[1] + rng.random()
    return uv
