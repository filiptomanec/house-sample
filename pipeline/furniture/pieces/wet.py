"""Bathroom and utility pieces: wall-hung toilet, vanity with vessel basins and mirror, shower, bath, washer.

The layout passes `pc.ctx['wall']` = {side: bool} (local sides back/front/left/right that touch a wall) so that the
shower puts glass on its open sides and fittings on a wall side.
"""
import math
from . import builder


def _tap(pc, x, y, z, reach=0.14, h=0.16):
    ch = pc.m('f_chrome')
    pc.tube((x, y, z), (x, y, z + h), 0.012, ch, seg=pc.n(10, 6))
    pc.tube((x, y, z + h), (x, y - reach, z + h + 0.015), 0.009, ch, seg=pc.n(8, 6))
    pc.tube((x, y, z + h * 0.55), (x + 0.045, y, z + h * 0.55), 0.007, ch, seg=6)


def _bowl(pc, x, y, z, rx, ry, h):
    """Oval vessel basin: outer wall, rim and hollow inside (one lathe, scaled to an oval)."""
    prof = [(0, z, 'h'), (0.55, z, 'h'), (0.80, z + h * 0.30), (1.0, z + h * 0.85), (0.97, z + h), (0.90, z + h, 'h'),
            (0.86, z + h * 0.80), (0.6, z + h * 0.28), (0.0, z + h * 0.22)]
    from fx import mesh as M
    V, F, N = M.gen_lathe(prof, pc.n(28, 14))
    pc._add('f_ceramic', V, F, N, M.T(x, y, 0) @ M.Sc(rx, ry, 1.0))


@builder('wc')
def wc(pc, w, d, variant):
    hw, hd = w / 2, d / 2
    ce = 'f_ceramic'
    # concealed cistern wall with an oak ledge and the flush plate
    pc.box(-0.27, hd - 0.13, 0.0, 0.27, hd, 1.12, 'f_white', r=0.004)
    pc.box(-0.27, hd - 0.14, 1.12, 0.27, hd, 1.15, 'f_oak', r=0.004)
    pc.anchor('top', rect=(-0.27, hd - 0.14, 0.27, hd), z=1.15)
    pc.box(-0.09, hd - 0.136, 0.82, 0.09, hd - 0.13, 0.98, 'f_white', r=0.003)
    pc.box(-0.07, hd - 0.140, 0.89, -0.01, hd - 0.136, 0.93, 'f_chrome', r=0.002)
    pc.box(0.01, hd - 0.140, 0.89, 0.07, hd - 0.136, 0.93, 'f_chrome', r=0.002)
    # bowl on the wall (floats at 0.22 m), seat and lid
    L = d - 0.13
    pc.box(-0.17, -hd + 0.02, 0.22, 0.17, -hd + 0.02 + L - 0.02, 0.40, ce, r=0.085, s=1, keep=True)
    pc.box(-0.185, -hd + 0.03, 0.385, 0.185, -hd + 0.03 + L - 0.07, 0.425, ce, r=0.02, s=1, keep=True)
    pc.box(-0.18, -hd + 0.03, 0.425, 0.18, -hd + 0.03 + L - 0.08, 0.448, 'f_white', r=0.01, s=1, keep=True)
    pc.box(-0.17, -hd + 0.05, 0.448, 0.17, -hd + 0.03 + L - 0.1, 0.462, 'f_white', r=0.008, s=1)
    pc.box(-0.05, hd - 0.17, 0.43, 0.05, hd - 0.13, 0.5, 'f_white', r=0.006)
    pc.footprint([(-hw, -hd, hw, hd, 0.5)])


@builder('sink')
def sink(pc, w, d, variant):
    hw, hd = w / 2, d / 2
    double = w > 0.9
    H = 0.85
    pc.box(-hw, -hd + 0.03, 0.30, hw, hd, H - 0.03, 'f_oak', r=0.01, s=1, keep=True)
    pc.box(-hw - 0.004, -hd, H - 0.03, hw + 0.004, hd, H, 'f_white', r=0.008, s=1, keep=True)
    n = 2 if double else 1
    cw = w / n
    for i in range(n):
        a = -hw + i * cw
        pc.box(a + 0.012, -hd + 0.018, 0.335, a + cw - 0.012, -hd + 0.032, H - 0.045, 'f_white' if i % 2 else 'f_oak', r=0.003)
        pc.box(a + cw / 2 - 0.06, -hd + 0.012, H - 0.075, a + cw / 2 + 0.06, -hd + 0.019, H - 0.067, 'f_black_metal')
    for i in range(n):
        cx = -hw + (i + 0.5) * cw
        _bowl(pc, cx, -0.02, H, min(0.20 if double else 0.22, cw / 2 - 0.05), 0.18, 0.12)
        _tap(pc, cx, hd - 0.07, H)
    # mirror: round for a single basin, wide pill for the double
    zc = 1.42
    if double:
        mw = w - 0.2
        pc.box(-mw / 2, hd - 0.026, zc - 0.45, mw / 2, hd - 0.006, zc + 0.45, 'f_oak', r=0.012, s=1, keep=True)
        pc.box(-mw / 2 + 0.015, hd - 0.030, zc - 0.435, mw / 2 - 0.015, hd - 0.024, zc + 0.435, 'f_mirror', r=0.0)
    else:
        R = min(0.34, w / 2 + 0.05)
        with pc.at(0, hd - 0.006, zc, rx=math.pi / 2):          # axis along -y: z grows into the room
            pc.cyl(0, 0, 0.0, 0.02, R, 'f_oak', seg=pc.n(36, 18))
            pc.cyl(0, 0, 0.02, 0.024, R - 0.015, 'f_mirror', seg=pc.n(36, 18))
    pc.anchor('top', rect=(-hw, -hd, hw, hd), z=H)
    if double:
        pc.anchor('free', rect=(-0.1, -0.1, 0.1, hd - 0.1), z=H)
    pc.footprint([(-hw, -hd, hw, hd, H)])


@builder('shower')
def shower(pc, w, d, variant):
    hw, hd = w / 2, d / 2
    wall = pc.ctx.get('wall', {'back': True, 'right': True})
    pc.box(-hw, -hd, 0.0, hw, hd, 0.045, 'f_ceramic', r=0.01, s=1, keep=True)           # tray
    pc.cyl(0.12, 0.0, 0.045, 0.047, 0.04, 'f_chrome', seg=pc.n(20, 10))
    glass = 'f_glass'
    frame = 'f_black_metal'
    H = 2.0
    sides = {'front': (-hw, -hd, hw, -hd), 'back': (-hw, hd, hw, hd), 'left': (-hw, -hd, -hw, hd), 'right': (hw, -hd, hw, hd)}
    open_sides = [s for s in ('front', 'left', 'right', 'back') if not wall.get(s, False)]
    if not open_sides:
        open_sides = ['front']
    done = set()                                    # corners already taken by the glass of an earlier side
    for k, s in enumerate(open_sides):
        x0, y0, x1, y1 = sides[s]
        e = 0.0007 * k
        horiz = abs(y1 - y0) < 1e-9

        def span(t_glass, t_frame):
            """(lo, hi) offsets along the side: past the corner when it is free, stopping short of an earlier panel."""
            lo = t_frame if (x0, y0) in done else -t_glass
            hi = t_frame if (x1, y1) in done else -t_glass
            return lo, hi

        g0, g1 = span(0.004, 0.0065)
        f0, f1 = span(0.012, 0.0125)
        if horiz:
            pc.box(x0 + g0, y0 - 0.004 - e, 0.06, x1 - g1, y0 + 0.004 + e, H - 0.02, glass, r=0.0)
            pc.box(x0 + f0, y0 - 0.012, H - 0.02 - e, x1 - f1, y0 + 0.012, H - e, frame, r=0.0)
            pc.box(x0 + f0, y0 - 0.012, 0.045 + e, x1 - f1, y0 + 0.012, 0.06 + e, frame, r=0.0)
        else:
            pc.box(x0 - 0.004 - e, y0 + g0, 0.06, x0 + 0.004 + e, y1 - g1, H - 0.02, glass, r=0.0)
            pc.box(x0 - 0.012, y0 + f0, H - 0.02 - e, x0 + 0.012, y1 - f1, H - e, frame, r=0.0)
            pc.box(x0 - 0.012, y0 + f0, 0.045 + e, x0 + 0.012, y1 - f1, 0.06 + e, frame, r=0.0)
        done |= {(x0, y0), (x1, y1)}
    # door handle on the front glass when it is open
    if 'front' in open_sides:
        pc.box(hw * 0.5 - 0.01, -hd - 0.03, 0.9, hw * 0.5 + 0.01, -hd - 0.008, 1.3, frame, r=0.004)
    # fittings on the first wall side
    ws = next((s for s in ('back', 'right', 'left', 'front') if wall.get(s, False)), 'back')
    ang = {'back': 0.0, 'left': math.pi / 2, 'right': -math.pi / 2, 'front': math.pi}[ws]
    with pc.at(0, 0, 0, rz=ang):
        yb = hd if ws in ('back', 'front') else hw
        pc.tube((0.0, yb - 0.02, 2.05), (0.0, yb - 0.30, 2.07), 0.01, 'f_chrome', seg=pc.n(8, 6))
        pc.cyl(0.0, yb - 0.30, 2.045, 2.07, 0.12, 'f_chrome', seg=pc.n(24, 12))
        pc.box(-0.07, yb - 0.04, 1.0, 0.07, yb - 0.01, 1.2, 'f_chrome', r=0.006)
        pc.tube((0.0, yb - 0.04, 1.2), (0.0, yb - 0.04, 1.65), 0.008, 'f_chrome', seg=6)
    pc.footprint([(-hw, -hd, hw, hd, 2.0)])


@builder('bath')
def bath(pc, w, d, variant):
    hw, hd = w / 2, d / 2
    H = 0.56
    t = 0.07
    ce = 'f_ceramic'
    pc.box(-hw + 0.004, -hd + 0.004, 0.0, hw - 0.004, hd - 0.004, 0.14, ce, r=0.05, s=1, keep=True)
    pc.box(-hw, -hd, 0.02, hw, -hd + t, H, ce, r=0.03, s=1, keep=True)                 # long walls
    pc.box(-hw, hd - t, 0.02, hw, hd, H, ce, r=0.03, s=1, keep=True)
    pc.box(-hw, -hd + t - 0.004, 0.02, -hw + t, hd - t + 0.004, H - 0.004, ce, r=0.03)   # ends (inside the long walls)
    pc.box(hw - t, -hd + t - 0.004, 0.02, hw, hd - t + 0.004, H - 0.004, ce, r=0.03)
    pc.box(-hw + t, -hd + t, 0.14, hw - t, hd - t, 0.16, 'f_white', r=0.0)             # inner floor
    pc.cyl(hw - 0.2, 0.0, 0.16, 0.162, 0.03, 'f_chrome', seg=pc.n(16, 10))
    # deck-mounted spout on the back rim at the left end
    ch = 'f_chrome'
    pc.tube((-hw + 0.25, hd - 0.035, H), (-hw + 0.25, hd - 0.035, H + 0.20), 0.013, ch, seg=pc.n(10, 6))
    pc.tube((-hw + 0.25, hd - 0.035, H + 0.20), (-hw + 0.25, hd - 0.20, H + 0.22), 0.011, ch, seg=pc.n(8, 6))
    pc.tube((-hw + 0.25, hd - 0.20, H + 0.22), (-hw + 0.25, hd - 0.20, H + 0.19), 0.011, ch, seg=pc.n(8, 6))
    pc.anchor('top', rect=(-hw, -hd, hw, hd), z=H)
    pc.footprint([(-hw, -hd, hw, hd, H)])


@builder('washer')
def washer(pc, w, d, variant):
    hw, hd = w / 2, d / 2
    H = 0.85
    pc.box(-hw, -hd + 0.0, 0.02, hw, hd, H, 'f_appliance', r=0.012, s=1, keep=True)
    pc.box(-hw + 0.03, -hd + 0.01, 0.0, hw - 0.03, hd - 0.03, 0.03, 'f_anthracite')
    pc.box(-hw + 0.01, -hd - 0.004, H - 0.12, hw - 0.01, -hd + 0.004, H - 0.01, 'f_white', r=0.004)       # panel
    pc.box(-hw + 0.06, -hd - 0.008, H - 0.085, -hw + 0.19, -hd - 0.002, H - 0.045, 'f_screen', r=0.002)
    pc.cyl(hw - 0.09, -hd - 0.004, H - 0.095, H - 0.092, 0.003, 'f_screen')
    with pc.at(0, -hd, 0.43, rx=math.pi / 2):
        pc.cyl(0, 0, 0.0, 0.012, 0.215, 'f_steel', seg=pc.n(28, 14))
        pc.cyl(0, 0, 0.004, 0.016, 0.18, 'f_anthracite', seg=pc.n(28, 14))
        pc.cyl(0, 0, 0.016, 0.026, 0.18, 'f_glass', seg=pc.n(28, 14))
    pc.anchor('top', rect=(-hw, -hd, hw, hd), z=H)
    pc.footprint([(-hw, -hd, hw, hd, H)])
