"""Plants for interior and terrace: each function draws at the origin of the current frame, standing on z = 0.

Signature: fn(pc, **params). Materials resolve through pc.m(): f_plant / f_pot indoors, t_plant / t_pot on the terrace.
Leaf counts follow the detail level (pc.hi); the silhouette stays the same in lite.
"""
import math
import numpy as np

from . import mesh as M


def _pot(pc, r=0.12, h=0.24, mat='pot', flare=1.12, soil=True, foot=0.7):
    prof = [(0, 0, 'h'), (r * foot, 0, 'h'), (r * 0.96, h * 0.14), (r * flare, h), (r * flare - 0.012, h, 'h')]
    pc.lathe(prof, pc.m(mat), seg=pc.n(24, 12))
    if soil:
        pc.cyl(0, 0, h * 0.78, h * 0.93, r * flare - 0.014, 'f_black_metal' if not pc.outdoor else 't_enamel', seg=pc.n(18, 10))


def _stem(pc, p0, p1, r, mat, bend=(0, 0, 0)):
    """Curved stem as two tube segments through a bent midpoint."""
    p0, p1 = np.array(p0, float), np.array(p1, float)
    mid = (p0 + p1) / 2 + np.array(bend)
    pc.tube(p0, mid, r, mat, r1=r * 0.85, seg=pc.n(6, 4))
    pc.tube(mid, p1, r * 0.85, mat, r1=r * 0.7, seg=pc.n(6, 4))
    return mid


def _leaf_at(pc, pos, az, pitch, L, W, mat, droop=0.15, fold=0.12, shape=0.8, tip=1.0, curl=0.0, nl=None):
    with pc.at(pos[0], pos[1], pos[2], rz=az, ry=-pitch):
        pc.leaf(L, W, mat, droop=droop, fold=fold, shape=shape, tip=tip, curl=curl, nl=nl)


def monstera(pc, h=0.95, pot_r=0.16, **kw):
    g = pc.m('plant')
    _pot(pc, pot_r, 0.26)
    n = pc.n(11, 7)
    top = 0.24
    for i in range(n):
        az = i * 2.399963 + pc.rand(-0.2, 0.2)
        reach = pc.rand(0.12, 0.34) * h
        z1 = top + pc.rand(0.35, 1.0) * (h - top - 0.1)
        p0 = (0.02 * math.cos(az), 0.02 * math.sin(az), top)
        p1 = (reach * math.cos(az), reach * math.sin(az), z1)
        _stem(pc, p0, p1, 0.007, g, bend=(0.0, 0.0, 0.05))
        s = pc.rand(0.85, 1.15) * (0.55 + 0.45 * z1 / h)
        _leaf_at(pc, p1, az + pc.rand(-0.4, 0.4), pc.rand(-0.1, 0.5), 0.42 * s, 0.40 * s, g, droop=0.22, fold=0.10, shape=0.72, tip=0.5, nl=pc.n(7, 5))


def fig(pc, h=1.45, pot_r=0.19, **kw):
    g = pc.m('plant')
    _pot(pc, pot_r, 0.34, flare=1.05)
    wood = pc.m('wood_dark')
    base = np.array([0, 0, 0.3])
    top = np.array([pc.rand(-0.03, 0.03), pc.rand(-0.03, 0.03), h * 0.78])
    pc.tube(base, top, 0.016, wood, r1=0.009, seg=pc.n(8, 5))
    n = pc.n(15, 9)
    for i in range(n):
        t = i / max(n - 1, 1)
        z = 0.42 * h + t * (h * 0.56)
        az = i * 2.399963
        r0 = 0.015
        p0 = (top[0] * t, top[1] * t, z)
        s = 1.0 - 0.35 * t
        _leaf_at(pc, p0, az, 0.35 + 0.5 * t, 0.30 * s, 0.17 * s, g, droop=0.14, fold=0.14, shape=0.62, nl=pc.n(6, 4))
    _leaf_at(pc, (top[0], top[1], h * 0.82), 0.4, 1.2, 0.2, 0.12, g, droop=0.05, fold=0.12, shape=0.62)


def olive(pc, h=1.7, pot_r=0.22, **kw):
    g = ('f_plant_olive' if not pc.outdoor else 't_plant')
    _pot(pc, pot_r, 0.4, flare=1.0)
    wood = pc.m('wood_dark')
    zt = 0.72
    pc.tube((0, 0, 0.36), (0.0, 0.0, zt), 0.022, wood, r1=0.015, seg=pc.n(8, 5))
    rng = pc.rng
    nb = 6
    per = pc.n(33, 13)
    for k in range(nb):
        a = k * 2 * math.pi / nb + rng.uniform(-0.3, 0.3)
        reach = rng.uniform(0.18, 0.30)
        z1 = rng.uniform(1.0, h * 0.78)
        p0 = np.array([0.0, 0.0, zt - 0.05 + 0.04 * k])
        p1 = np.array([reach * math.cos(a), reach * math.sin(a), z1])
        mid = (p0 + p1) / 2 + np.array([0.02 * math.cos(a), 0.02 * math.sin(a), 0.0])
        pc.tube(p0, mid, 0.011, wood, r1=0.008, seg=pc.n(6, 4))
        pc.tube(mid, p1, 0.008, wood, r1=0.004, seg=pc.n(6, 4))
        for i in range(per):
            t = rng.uniform(0.25, 1.0)
            base = mid + (p1 - mid) * t if t > 0.0 else mid
            off = np.array([rng.uniform(-0.07, 0.07), rng.uniform(-0.07, 0.07), rng.uniform(-0.05, 0.08)])
            sc = 1.7 if pc.lite else 1.0
            _leaf_at(pc, tuple(base + off), rng.uniform(0, 6.28), rng.uniform(-0.5, 0.9), 0.085 * sc, 0.021 * sc, g, droop=0.12, fold=0.3, shape=0.9, nl=3)
    for i in range(pc.n(18, 8)):
        a = rng.uniform(0, 6.28)
        p = (0.12 * math.cos(a), 0.12 * math.sin(a), rng.uniform(1.15, h * 0.85))
        _leaf_at(pc, p, rng.uniform(0, 6.28), rng.uniform(0.2, 1.2), 0.09, 0.022, g, droop=0.1, fold=0.3, shape=0.9, nl=3)


def snake_plant(pc, h=0.62, pot_r=0.11, **kw):
    g = pc.m('plant')
    _pot(pc, pot_r, 0.2, flare=1.1)
    n = pc.n(10, 6)
    for i in range(n):
        az = i * 2.399963 + pc.rand(-0.2, 0.2)
        r = pc.rand(0.0, 0.05)
        L = pc.rand(0.5, 1.0) * h
        lean = pc.rand(0.0, 0.28)
        with pc.at(r * math.cos(az), r * math.sin(az), 0.18, rz=az):
            with pc.at(0, 0, 0, ry=-(math.pi / 2 - lean)):
                pc.leaf(L, 0.055, g, droop=0.1, fold=0.45, nl=pc.n(5, 3), shape=0.7, tip=1.4)


def pothos(pc, drop=0.35, pot_r=0.075, **kw):
    """Small pot with trailing vines (for shelf edges and tops)."""
    g = pc.m('plant')
    _pot(pc, pot_r, 0.12)
    n = pc.n(6, 3)
    for i in range(n):
        az = i * 1.9 + pc.rand(-0.3, 0.3)
        d = pc.rand(0.5, 1.0) * drop
        p0 = (0.03 * math.cos(az), 0.03 * math.sin(az), 0.12)
        mid = (pot_r * 1.5 * math.cos(az), pot_r * 1.5 * math.sin(az), 0.11)
        p1 = (pot_r * 1.6 * math.cos(az), pot_r * 1.6 * math.sin(az), 0.11 - d)
        pc.tube(p0, mid, 0.003, g, seg=4)
        pc.tube(mid, p1, 0.003, g, seg=4)
        for k in range(pc.n(5, 2)):
            t = (k + 0.5) / pc.n(5, 2)
            p = (mid[0] + (p1[0] - mid[0]) * t, mid[1] + (p1[1] - mid[1]) * t, mid[2] + (p1[2] - mid[2]) * t)
            _leaf_at(pc, p, az + pc.rand(-1, 1), 0.2, 0.06, 0.05, g, droop=0.3, fold=0.1, shape=0.5, nl=3)
    for i in range(pc.n(5, 3)):
        az = i * 1.3
        _leaf_at(pc, (0.02 * math.cos(az), 0.02 * math.sin(az), 0.12), az, 0.8, 0.07, 0.055, g, droop=0.2, fold=0.1, shape=0.5, nl=3)


def succulent(pc, pot_r=0.07, **kw):
    g = pc.m('plant')
    _pot(pc, pot_r, 0.1)
    n = pc.n(14, 8)
    for i in range(n):
        ring = i // 7
        az = i * 2.399963
        _leaf_at(pc, (0.006 * math.cos(az), 0.006 * math.sin(az), 0.095), az, 0.35 + 0.5 * (1 - ring), 0.05, 0.022, g, droop=0.04, fold=0.35, nl=3)


def eucalyptus(pc, h=0.55, vase_r=0.06, **kw):
    """Vase with eucalyptus stems."""
    _vase(pc, vase_r, 0.2, 'pot')
    g = ('f_plant_olive' if not pc.outdoor else 't_plant')
    n = pc.n(7, 4)
    for i in range(n):
        az = i * 2.399963
        lean = pc.rand(0.05, 0.35)
        L = pc.rand(0.6, 1.0) * (h - 0.15)
        p0 = (0, 0, 0.19)
        p1 = (L * math.sin(lean) * math.cos(az), L * math.sin(lean) * math.sin(az), 0.19 + L * math.cos(lean))
        pc.tube(p0, p1, 0.003, g, seg=4)
        for k in range(pc.n(7, 3)):
            t = 0.25 + 0.75 * k / pc.n(7, 3)
            p = tuple(p0[j] + (p1[j] - p0[j]) * t for j in range(3))
            pc.sphere(p, (0.026, 0.026, 0.004), g, 6, 4)


def pampas(pc, h=1.1, vase_r=0.09, **kw):
    pc_mat = 't_grass' if pc.outdoor else 'f_sand'
    _vase(pc, vase_r, 0.42, 'pot')
    g = ('f_plant_olive' if not pc.outdoor else 't_plant')
    n = pc.n(14, 7)
    for i in range(n):
        az = i * 2.399963
        lean = pc.rand(0.03, 0.3)
        L = pc.rand(0.7, 1.0) * (h - 0.35)
        p0 = (0, 0, 0.4)
        p1 = (L * math.sin(lean) * math.cos(az), L * math.sin(lean) * math.sin(az), 0.4 + L * math.cos(lean))
        pc.tube(p0, p1, 0.0035, g, seg=4)
        d = np.array(p1) - np.array(p0)
        d = d / np.linalg.norm(d)
        tip = np.array(p1) + d * 0.28
        pc.tube(p1, tip, 0.022, pc_mat, r1=0.002, seg=pc.n(7, 4))


def _vase(pc, r, h, mat='pot'):
    prof = [(0, 0, 'h'), (r * 0.6, 0, 'h'), (r, h * 0.35), (r * 0.9, h * 0.75), (r * 0.5, h * 0.97), (r * 0.55, h, 'h'), (r * 0.45, h, 'h'),
            (r * 0.45, h * 0.8, 'h')]
    pc.lathe(prof, pc.m(mat), seg=pc.n(20, 10))


def buxus(pc, r=0.18, pot_r=0.16, pot_h=0.3, **kw):
    """Clipped box ball in a planter pot."""
    _pot(pc, pot_r, pot_h, 'pot', flare=1.0, soil=False)
    V, F, N = M.gen_sphere(1.0, pc.n(14, 8), pc.n(9, 6))
    rng = np.random.default_rng(pc.seed)
    bump = 1 + 0.07 * np.sin(V[:, 0] * 9 + rng.uniform(0, 6)) * np.sin(V[:, 1] * 8 + rng.uniform(0, 6)) * np.cos(V[:, 2] * 7)
    V2 = V * bump[:, None]
    N2 = M.smooth_normals(V2, F)
    pc.mesh(V2, F, N2, 't_buxus' if pc.outdoor else 'f_plant', M.T(0, 0, pot_h + r * 0.85) @ M.Sc(r, r, r * 0.95))


def lavender(pc, w=0.3, **kw):
    """Bed of lavender sprigs (a planter tray without the box; the planter is drawn by the caller)."""
    n = pc.n(26, 12)
    for i in range(n):
        x = pc.rand(-w / 2, w / 2)
        y = pc.rand(-0.06, 0.06)
        lean = pc.rand(0.0, 0.3)
        h = pc.rand(0.28, 0.42)
        az = pc.rand(0, 6.28)
        p1 = (x + h * math.sin(lean) * math.cos(az), y + h * math.sin(lean) * math.sin(az), h * math.cos(lean))
        pc.tube((x, y, 0.0), p1, 0.0025, 't_plant', seg=3)
        d = np.array(p1) - np.array([x, y, 0.0])
        d = d / np.linalg.norm(d)
        pc.tube(p1, np.array(p1) + d * 0.07, 0.007, 't_lavender', r1=0.003, seg=4)


def grass_tuft(pc, r=0.16, h=0.6, **kw):
    n = pc.n(36, 16)
    for i in range(n):
        az = i * 2.399963 + pc.rand(-0.2, 0.2)
        L = pc.rand(0.6, 1.0) * h
        lean = pc.rand(0.1, 0.55)
        with pc.at(pc.rand(-0.03, 0.03), pc.rand(-0.03, 0.03), 0.0, rz=az):
            with pc.at(0, 0, 0, ry=-(math.pi / 2 - lean)):
                pc.leaf(L, 0.012, 't_grass' if pc.outdoor else 'f_plant_olive', droop=0.25, fold=0.0, nl=pc.n(4, 3), shape=0.9, tip=1.0)


PLANTS = {
    'monstera': (monstera, {'r': 0.45, 'h': 1.0}),
    'fig': (fig, {'r': 0.32, 'h': 1.5}),
    'olive': (olive, {'r': 0.38, 'h': 1.7}),
    'snake_plant': (snake_plant, {'r': 0.16, 'h': 0.7}),
    'pothos': (pothos, {'r': 0.12, 'h': 0.2}),
    'succulent': (succulent, {'r': 0.08, 'h': 0.14}),
    'eucalyptus': (eucalyptus, {'r': 0.12, 'h': 0.6}),
    'pampas': (pampas, {'r': 0.2, 'h': 1.2}),
    'buxus': (buxus, {'r': 0.2, 'h': 0.65}),
    'grass_tuft': (grass_tuft, {'r': 0.2, 'h': 0.6}),
}
