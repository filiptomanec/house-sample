"""Soft and organic generators: subdivided rounded boxes (cushions, duvets), pillows, leaves, curtains, rugs."""
import math
import numpy as np

from . import mesh as M


def _axis(h, r, s, sub):
    k = np.arange(s + 1) / s
    c = h - r
    inner = np.linspace(-c, c, sub + 2)[1:-1] if sub > 0 else np.array([])
    return np.concatenate([-h + r * k, inner, c + r * k])


def gen_rbox_sub(hx, hy, hz, r, s=1, sub=(4, 4, 1), bottom=False):
    """Rounded box whose flat faces are subdivided (sub = interior cells minus one per axis), so that the surface
    can be displaced. Welded, smooth analytic normals. The flat bottom is left open unless bottom=True.
    Returns (V, F, N)."""
    r = min(r, 0.49 * min(hx, hy, hz))
    h = np.array([hx, hy, hz])
    c = h - r
    axes = [_axis(h[a], r, s, sub[a]) for a in range(3)]
    n = [len(a) for a in axes]
    ids = -np.ones(n, np.int64)
    pts = []
    k = 0
    for i in range(n[0]):
        for j in range(n[1]):
            for l in range(n[2]):
                if i in (0, n[0] - 1) or j in (0, n[1] - 1) or l in (0, n[2] - 1):
                    ids[i, j, l] = k
                    pts.append((i, j, l))
                    k += 1
    pts = np.array(pts)
    Q = np.stack([axes[0][pts[:, 0]], axes[1][pts[:, 1]], axes[2][pts[:, 2]]], axis=1)
    P = np.clip(Q, -c, c)
    v = Q - P
    N = v / np.maximum(np.linalg.norm(v, axis=1, keepdims=True), 1e-12)
    V = P + r * N
    quads = []
    for i in range(n[0] - 1):
        for j in range(n[1] - 1):
            for l in (0, n[2] - 1):
                flat_bottom = l == 0 and i >= s + 0 and i < n[0] - 1 - s and j >= s and j < n[1] - 1 - s
                if flat_bottom and not bottom:
                    continue
                quads.append((ids[i, j, l], ids[i + 1, j, l], ids[i + 1, j + 1, l], ids[i, j + 1, l]))
    for i in range(n[0] - 1):
        for l in range(n[2] - 1):
            for j in (0, n[1] - 1):
                quads.append((ids[i, j, l], ids[i + 1, j, l], ids[i + 1, j, l + 1], ids[i, j, l + 1]))
    for j in range(n[1] - 1):
        for l in range(n[2] - 1):
            for i in (0, n[0] - 1):
                quads.append((ids[i, j, l], ids[i, j + 1, l], ids[i, j + 1, l + 1], ids[i, j, l + 1]))
    F = M.quads_to_tris(quads)
    return V, M.orient_outward(V, F, N), N


def displace(V, F, delta):
    """Move vertices by delta (n, 3) and recompute smooth normals."""
    V2 = V + delta
    return V2, F, M.smooth_normals(V2, F)


def wrinkle(V, seed=0.0, amp=0.006, freq=9.0):
    """Soft deterministic ripple in z for a set of points."""
    x, y = V[:, 0], V[:, 1]
    w = np.sin(freq * x + 1.7 * seed) * np.sin(0.8 * freq * y + 2.3 * seed) \
        + 0.6 * np.sin(1.9 * freq * (x + 0.4 * y) + seed)
    return amp * w


def gen_cushion(lx, ly, h, nu=20, nv=10, e_plan=0.38, e_vert=0.62, wr=0.004, seed=0.0, pinch=0.04):
    """Puffy two-sided cushion (superellipsoid), lying in the xy plane, z from -h/2 to h/2."""
    lat = np.linspace(-math.pi / 2 + 1e-3, math.pi / 2 - 1e-3, nv)
    lon = np.linspace(0, 2 * math.pi, nu, endpoint=False)
    LA, LO = np.meshgrid(lat, lon, indexing='ij')

    def sg(w, e):
        return np.sign(w) * np.abs(w) ** e
    cl = sg(np.cos(LA), e_vert)
    x = lx / 2 * cl * sg(np.cos(LO), e_plan)
    y = ly / 2 * cl * sg(np.sin(LO), e_plan)
    z = h / 2 * sg(np.sin(LA), e_vert)
    # corners pull in a little (sewn corners)
    corner = (np.abs(x) / (lx / 2) * np.abs(y) / (ly / 2)) ** 2
    x = x * (1 - pinch * corner)
    y = y * (1 - pinch * corner)
    if wr:
        z = z + wr * np.sin(11 * x + seed) * np.sin(9 * y + 2 * seed) * np.sign(z) * np.abs(np.sin(LA)) ** 2
    P = np.stack([x, y, z], axis=2)
    return M.gen_grid(P, closed_u=False, closed_v=True, center=(0, 0, 0))


def gen_leaf(L, W, droop=0.15, fold=0.12, curl=0.0, nl=6, nw=3, shape=0.8, tip=1.0):
    """Leaf lying along +x from the origin, widening in y, with a midrib fold (z) and a droop towards the tip.
    shape < 1 puts the widest point further out; tip > 1 sharpens the tip. Open double-sided sheet."""
    t = np.linspace(0, 1, nl)
    s = np.linspace(-1, 1, nw)
    TT, SS = np.meshgrid(t, s, indexing='ij')
    width = W * np.sin(np.pi * TT ** shape) ** (0.8 * tip)
    x = L * TT
    y = SS * width / 2
    z = fold * np.abs(SS) * width - droop * L * TT ** 2 + curl * SS * width * TT
    P = np.stack([x, y, z], axis=2)
    V, F, N = M.gen_grid(P)
    # the borders have a zero-width tip and base: collapsed triangles are harmless but removed
    a, b, c = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    area = np.linalg.norm(np.cross(b - a, c - a), axis=1)
    return V, F[area > 1e-10], N


def gen_curtain(width, height, folds=5, amp=0.035, thick=0.008, nz=3, sway=0.01, seed=0.0):
    """Hanging curtain panel in the xz plane at y=0 (folds toward +-y), top at z=height, floor at z=0."""
    nx = folds * 6 + 1
    x = np.linspace(-width / 2, width / 2, nx)
    z = np.linspace(0, height, nz + 1)
    X, Z = np.meshgrid(x, z, indexing='ij')
    y = amp * np.sin(2 * math.pi * folds * (X + width / 2) / width + seed) * (0.75 + 0.25 * Z / height)
    y = y + sway * np.sin(2.1 * Z + seed)
    P = np.stack([X, y, Z], axis=2)
    return M.gen_sheet(P, thick)
