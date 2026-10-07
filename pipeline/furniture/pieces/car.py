"""Cars: two procedural models (estate, hatch) in neutral colours, lofted from cross-sections.

Built in a normalised frame (length 4.7 m along +x, nose at +x; width 1.9 m) and scaled uniformly to the piece size.
Wheel arches come from raising the loft bottom around the axles, so the wheels stay visible from the side.
"""
import math
import numpy as np
from fx import mesh as M
from . import builder

L0, W0 = 4.7, 1.9
AXLES = (1.45, -1.33)
WHEEL_R = 0.345

MODELS = {
    'estate': dict(
        paint='f_car_paint_a',
        body=[(-2.20, 0.86, 0.42, 0.96), (-1.95, 0.93, 0.30, 1.02), (-1.0, 0.945, 0.25, 1.00), (0.0, 0.945, 0.25, 0.99),
              (0.9, 0.935, 0.25, 0.97), (1.55, 0.92, 0.27, 0.90), (2.05, 0.885, 0.30, 0.78), (2.20, 0.85, 0.34, 0.70)],
        cabin=[(0.98, 0.80, 0.97, 1.00), (0.92, 0.795, 0.97, 1.10), (0.42, 0.75, 0.97, 1.44), (0.10, 0.74, 0.97, 1.47),
               (-1.95, 0.73, 0.97, 1.47), (-2.18, 0.71, 0.97, 1.14), (-2.24, 0.70, 0.97, 0.99)],
        rear_pillar=((-2.0, 0.715, 1.44), (-2.19, 0.70, 1.02)), rails=True, roof_end=-1.97),
    'hatch': dict(
        paint='f_car_paint_b',
        body=[(-2.20, 0.84, 0.42, 0.90), (-1.95, 0.92, 0.30, 0.97), (-1.0, 0.945, 0.25, 0.99), (0.0, 0.945, 0.25, 0.99),
              (0.9, 0.935, 0.25, 0.97), (1.55, 0.92, 0.27, 0.90), (2.05, 0.885, 0.30, 0.78), (2.20, 0.85, 0.34, 0.70)],
        cabin=[(0.98, 0.80, 0.97, 1.00), (0.92, 0.795, 0.97, 1.10), (0.42, 0.75, 0.97, 1.43), (0.0, 0.74, 0.97, 1.455),
               (-1.15, 0.73, 0.97, 1.42), (-1.75, 0.71, 0.97, 1.18), (-2.05, 0.69, 0.97, 1.03), (-2.12, 0.68, 0.97, 0.99)],
        rear_pillar=((-1.2, 0.72, 1.42), (-2.05, 0.69, 1.03)), rails=False, roof_end=-1.15),
}


def _interp(pts, x):
    xs = [p[0] for p in pts]
    if x <= xs[0]:
        return pts[0][1:]
    if x >= xs[-1]:
        return pts[-1][1:]
    for i in range(len(xs) - 1):
        if xs[i] <= x <= xs[i + 1]:
            t = (x - xs[i]) / (xs[i + 1] - xs[i])
            t = t * t * (3 - 2 * t)
            a, b = pts[i][1:], pts[i + 1][1:]
            return tuple(a[k] + (b[k] - a[k]) * t for k in range(len(a)))
    return pts[-1][1:]


def _section(hw, zb, zt, m, crown=0.025, taper=0.0, sq=None, rt=0.17, rb=0.06):
    """Closed section (y, z): flat bottom, fixed-radius corners (rb below, rt at the shoulder), straight sides and a slightly
    crowned top, with a fixed number of points per part (so the surface does not ripple when the bottom is raised at a wheel
    arch). Runs from the bottom centre over the +y side to the top centre and down the -y side; m is 24 or 16."""
    h = zt - zb
    rt = max(0.01, min(rt, h * 0.45, hw * 0.9))
    rb = max(0.005, min(rb, h * 0.3))
    nb, ns, nt = (3, 2, 5) if m >= 24 else (2, 1, 3)
    pts = [(0.0, zb), (hw - rb, zb)]
    for k in range(1, nb + 1):
        t = k / nb * math.pi / 2
        pts.append((hw - rb + rb * math.sin(t), zb + rb - rb * math.cos(t)))
    for k in range(1, ns + 1):
        pts.append((hw, zb + rb + (h - rb - rt) * k / (ns + 1)))
    for k in range(0, nt):
        t = k / (nt - 1) * math.pi / 2
        pts.append((hw - rt + rt * math.cos(t), zt - rt + rt * math.sin(t)))
    pts.append((0.0, zt))
    P = np.array(pts)
    y, z = P[:, 0], P[:, 1]
    zc = (zb + zt) / 2
    zrel = np.clip((z - zb) / max(h, 1e-6), 0, 1)
    z = z + crown * (1 - (y / hw) ** 2) * np.clip((z - zc) / max(h / 2, 1e-6), 0, 1)
    y = y * (1 - taper * zrel)
    right = np.stack([y, z], axis=1)
    left = np.stack([-y[-2:0:-1], z[-2:0:-1]], axis=1)
    return np.concatenate([right, left], axis=0)


def _arch(x):
    """Raised bottom (m) at x from the wheel arches."""
    k = 0.0
    for xa in AXLES:
        dx = (x - xa) / 0.43
        if abs(dx) < 1:
            k = max(k, math.sqrt(1 - dx * dx))
    return k * (0.74 - 0.25)


def _loft_grid(stations, m, hi, arches=True, cap=0.16, taper=0.0, crown=0.025, nx=40, rt=0.17, rb=0.06):
    """Station grid P (rows along x, m points around). Rounded end caps are appended."""
    stations = sorted(stations, key=lambda q: q[0])
    xmin, xmax = stations[0][0], stations[-1][0]
    xs = list(np.linspace(xmin, xmax, nx))
    if arches:
        for xa in AXLES:
            xs += [xa + d for d in np.linspace(-0.43, 0.43, 9 if hi else 5)]
    xs = sorted(set(round(x, 4) for x in xs if xmin <= x <= xmax))
    rows = []
    for x in xs:
        hw, zb, zt = _interp(stations, x)
        if arches and zb < 0.5:
            zb = max(zb, 0.25 + _arch(x))
        rows.append((x, hw, zb, zt, 1.0))
    caps_t = [0.45, 0.8, 0.96] if hi else [0.6, 0.95]
    front, back = rows[-1], rows[0]
    ext_f = [(front[0] + cap * math.sin(t * math.pi / 2), front[1], front[2], front[3], math.cos(t * math.pi / 2)) for t in caps_t]
    ext_b = [(back[0] - cap * math.sin(t * math.pi / 2), back[1], back[2], back[3], math.cos(t * math.pi / 2)) for t in caps_t]
    P = []
    for (x, hw, zb, zt, sc) in ext_b[::-1] + rows + ext_f:
        zc = (zb + zt) / 2
        hh = (zt - zb) / 2 * sc
        sec = _section(hw * sc, zc - hh, zc + hh, m, crown * sc, taper, None, rt, rb)
        P.append(np.stack([np.full(len(sec), x), sec[:, 0], sec[:, 1]], axis=1))
    return np.array(P)


def _add_grid(pc, P, mat, closed_v=True):
    V, F, N = M.gen_grid(P, closed_u=False, closed_v=closed_v, center=P.reshape(-1, 3).mean(0))
    pc.mesh(V, F, N, mat)


def _band(pc, stations, m, x0, x1, ks, mat, off=0.006):
    """A strip of the cabin loft (x in [x0, x1], columns ks) pushed slightly outwards: pillars in body colour."""
    stations = sorted(stations, key=lambda q: q[0])
    P = []
    for x in np.linspace(x0, x1, 6):
        hw, zb, zt = _interp(stations, x)
        sec = _section(hw, zb, zt, m, 0.012, 0.14, None, rt=0.10, rb=0.03)
        P.append(np.stack([np.full(len(sec), x), sec[:, 0], sec[:, 1]], axis=1))
    P = np.array(P)
    sub = P[:, ks[0]:ks[1] + 1].copy()
    cen = P.mean(axis=1, keepdims=True)
    d = sub - cen
    d[:, :, 0] = 0
    d = d / np.maximum(np.linalg.norm(d, axis=2, keepdims=True), 1e-9)
    _add_grid(pc, sub + d * off, mat, closed_v=False)


def _wheel(pc, x, y, side):
    """Wheel at (x, y) with its axis along y; side = +1 for the +y side (outer face towards +y)."""
    with pc.at(x, y, WHEEL_R, rx=math.pi / 2):
        tire = [(0.22, -0.108, 'h'), (0.30, -0.112), (0.345, -0.05), (0.345, 0.05), (0.30, 0.112),
                (0.22, 0.108, 'h'), (0.2, 0.1, 'h'), (0.2, -0.1, 'h')]
        pc.lathe(tire, 'f_rubber', seg=pc.n(26, 14), close=True)
        zo = -0.1 * side                                  # after Rx(90 deg) local +z points to -y
        pc.lathe([(0.0, zo, 'h'), (0.21, zo, 'h'), (0.215, zo * 0.9, 'h'), (0.0, zo * 0.9, 'h')], 'f_steel', seg=pc.n(26, 14))
        pc.cyl(0, 0, zo * 0.95, zo * 1.25, 0.05, 'f_car_trim', seg=pc.n(16, 10))
        if pc.hi:
            for k in range(5):
                with pc.at(0, 0, zo * 1.06, rz=k * 2 * math.pi / 5):
                    pc.box(0.04, -0.018, -0.012, 0.205, 0.018, 0.012, 'f_car_trim', r=0.0)


@builder('car')
def car(pc, w, d, variant):
    spec = MODELS.get(variant or 'hatch', MODELS['hatch'])
    s = min(w / L0, d / W0)
    paint = spec['paint']
    with pc.at(0, 0, 0, s=s):
        m = pc.n(24, 16)
        _add_grid(pc, _loft_grid(spec['body'], m, pc.hi, True, nx=pc.n(22, 14)), paint)
        cab = _loft_grid(spec['cabin'], m, pc.hi, False, cap=0.05, taper=0.14, crown=0.012, nx=pc.n(18, 10), rt=0.10, rb=0.03)
        _add_grid(pc, cab, 'f_car_glass')
        # painted roof cap: the top arc of the cabin loft between the windscreen and the rear glass
        roof_x1, roof_x0 = 0.50, spec['roof_end']
        rows = [i for i in range(len(cab)) if roof_x0 <= cab[i, 0, 0] <= roof_x1]
        k0, k1 = int(0.38 * m), int(0.62 * m) + 1
        if len(rows) > 1:
            cap = cab[rows[0]:rows[-1] + 1, k0:k1].copy()
            cap[:, :, 2] += 0.006
            _add_grid(pc, cap, paint, closed_v=False)
        mm = m
        for (xa, xb, ka, kb) in ((0.42, 0.98, 0.30, 0.40), (-0.36, -0.22, 0.14, 0.40)):
            k0, k1 = int(ka * mm), int(kb * mm)
            _band(pc, spec['cabin'], mm, xa, xb, (k0, k1), paint)
            _band(pc, spec['cabin'], mm, xa, xb, (mm - k1, mm - k0), paint)
        if spec['rails']:
            for sy in (-1, 1):
                pc.tube((0.35, sy * 0.60, 1.50), (-1.95, sy * 0.60, 1.50), 0.016, 'f_car_trim', seg=pc.n(8, 6))
        # lights, grille, bumpers, plates
        for sy in (-1, 1):
            pc.box(2.06, sy * 0.62 - 0.17, 0.64, 2.17, sy * 0.62 + 0.17, 0.73, 'f_car_light', r=0.025, s=1)
            pc.box(-2.27, sy * 0.66 - 0.16, 0.78, -2.15, sy * 0.66 + 0.16, 0.88, 'f_car_tail', r=0.025, s=1)
            # door mirrors
            pc.box(0.82, sy * 0.93 - 0.05 + sy * 0.02, 1.0, 0.98, sy * 0.93 + 0.05 + sy * 0.10, 1.10, paint, r=0.02, s=1)
        pc.box(2.05, -0.38, 0.42, 2.26, 0.38, 0.60, 'f_car_trim', r=0.02, s=1)                    # grille
        pc.box(2.12, -0.30, 0.30, 2.3, 0.30, 0.40, 'f_car_trim', r=0.01, s=1)                      # lower intake
        pc.box(2.27, -0.26, 0.42, 2.285, 0.26, 0.5, 'f_white', r=0.0)                              # plates
        pc.box(-2.335, -0.26, 0.52, -2.32, 0.26, 0.60, 'f_white', r=0.0)
        pc.box(-2.0, -0.74, 0.22, 2.0, 0.74, 0.34, 'f_car_trim', r=0.0)                            # underbody
        if pc.hi:
            for sy in (-1, 1):                                                                     # door shut lines
                for xl in (0.55, -0.30, -1.15):
                    pc.box(xl - 0.003, sy * 0.949 - 0.004 + (0.004 if sy > 0 else 0), 0.40, xl + 0.003,
                           sy * 0.949 + (0.004 if sy > 0 else 0), 0.95, 'f_car_trim', r=0.0)
        for xa in AXLES:
            for sy in (-1, 1):
                _wheel(pc, xa, sy * 0.80, sy)
    pc.anchor('car', rect=(-w / 2, -d / 2, w / 2, d / 2), z=1.5)
    pc.footprint([(-w / 2, -d / 2, w / 2, d / 2, 1.5 * s)])
