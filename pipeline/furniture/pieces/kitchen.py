"""Kitchen: run along a wall, island with a seating overhang, tall fridge. White and oak fronts, stone worktop."""
import math
from . import builder


def _fronts(pc, x0, x1, y_front, z0, z1, mats, n, drawers=False, handle=True):
    """Row of n flat fronts on the plane y = y_front (facing -y), 3 mm gaps, optional drawers (split in three)."""
    cw = (x1 - x0) / n
    for i in range(n):
        a, b = x0 + i * cw + 0.0015, x0 + (i + 1) * cw - 0.0015
        mat = mats[i % len(mats)]
        if drawers and i % 2 == 1:
            rows = 3
            hh = (z1 - z0) / rows
            for j in range(rows):
                pc.box(a, y_front - 0.02, z0 + j * hh + 0.0015, b, y_front, z0 + (j + 1) * hh - 0.0015, mat, r=0.003)
                if handle:
                    pc.box(a + 0.04, y_front - 0.024, z0 + (j + 1) * hh - 0.035, b - 0.04, y_front - 0.02, z0 + (j + 1) * hh - 0.028, 'f_anthracite')
        else:
            pc.box(a, y_front - 0.02, z0 + 0.0015, b, y_front, z1 - 0.0015, mat, r=0.003)
            if handle:
                pc.box(a + 0.015 if i % 2 == 0 else b - 0.021, y_front - 0.026, z1 - 0.20, a + 0.021 if i % 2 == 0 else b - 0.015, y_front - 0.02, z1 - 0.06, 'f_anthracite')


SINK_W, SINK_D, SINK_DEPTH = 0.50, 0.40, 0.18        # undermount bowl: cut-out size and depth


def _worktop_with_cutout(pc, x0, y0, x1, y1, z0, z1, hole):
    """Stone worktop around a rectangular cut-out: four slabs meeting at the hole (no shared visible planes)."""
    hx0, hy0, hx1, hy1 = hole
    pc.box(x0, y0, z0, hx0, y1, z1, 'f_stone')
    pc.box(hx1, y0, z0, x1, y1, z1, 'f_stone')
    pc.box(hx0, y0, z0, hx1, hy0, z1, 'f_stone')
    pc.box(hx0, hy1, z0, hx1, y1, z1, 'f_stone')


def _undermount_bowl(pc, hole, z_under):
    """Steel bowl hung under the worktop, its walls 2 mm outside the cut-out (the stone edge overhangs them), a dark
    drain in the floor."""
    t = 0.0015
    x0, y0, x1, y1 = hole[0] - 0.002, hole[1] - 0.002, hole[2] + 0.002, hole[3] + 0.002
    zt = z_under - 0.001
    zb = zt - SINK_DEPTH
    pc.box(x0 - t, y0 - t, zb - t, x1 + t, y0, zt, 'f_steel')            # front wall (full width)
    pc.box(x0 - t, y1, zb - t, x1 + t, y1 + t, zt, 'f_steel')            # back wall
    pc.box(x0 - t, y0, zb - t, x0, y1, zt, 'f_steel')                    # side walls between them
    pc.box(x1, y0, zb - t, x1 + t, y1, zt, 'f_steel')
    pc.box(x0, y0, zb - t, x1, y1, zb, 'f_steel')                        # floor
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    pc.cyl(cx, cy, zb, zb + 0.003, 0.045, 'f_black_metal', seg=pc.n(20, 10))
    pc.cyl(cx, cy, zb + 0.003, zb + 0.004, 0.03, 'f_steel', seg=pc.n(16, 8))


def _tap(pc, x, y, z):
    ch = pc.m('f_chrome')
    pc.tube((x, y, z), (x, y, z + 0.20), 0.011, ch, seg=pc.n(10, 6))
    pc.tube((x, y, z + 0.20), (x, y - 0.12, z + 0.24), 0.009, ch, seg=pc.n(8, 6))
    pc.tube((x, y - 0.12, z + 0.24), (x, y - 0.12, z + 0.21), 0.009, ch, seg=pc.n(8, 6))


@builder('kitchen_line')
def kitchen_line(pc, w, d, variant):
    hw, hd = w / 2, d / 2
    oak_front = pc.seed % 2 == 0
    low = ['f_oak'] if oak_front else ['f_white']
    hi_cols = ['f_white'] if oak_front else ['f_oak']
    zt = 0.90
    pc.box(-hw, -hd + 0.04, 0.0, hw, hd - 0.0, 0.09, 'f_anthracite')                              # plinth
    sx = -hw + w * 0.28                                                                          # sink (left third)
    sink = (sx - SINK_W / 2, -0.02 - SINK_D / 2, sx + SINK_W / 2, -0.02 + SINK_D / 2)
    if pc.hi:
        # undermount basin: the worktop and the carcass leave room for the bowl
        zb = zt - 0.03 - SINK_DEPTH - 0.006
        pc.box(-hw, -hd + 0.02, 0.09, sink[0] - 0.05, hd, zt - 0.03, 'f_white', r=0.004)          # carcass left
        pc.box(sink[2] + 0.05, -hd + 0.02, 0.09, hw, hd, zt - 0.03, 'f_white', r=0.004)           # carcass right
        pc.box(sink[0] - 0.05 + 0.003, -hd + 0.02, 0.09, sink[2] + 0.05 - 0.003, hd, zb, 'f_white')  # under the bowl
        _worktop_with_cutout(pc, -hw, -hd, hw, hd, zt - 0.03, zt, sink)
        _undermount_bowl(pc, sink, zt - 0.03)
    else:
        pc.box(-hw, -hd + 0.02, 0.09, hw, hd, zt - 0.03, 'f_white', r=0.004)                      # carcass
        pc.box(-hw, -hd, zt - 0.03, hw, hd, zt, 'f_stone', r=0.006)                                # worktop
        pc.box(sink[0], sink[1], zt - 0.002, sink[2], sink[3], zt + 0.002, 'f_steel', r=0.0)      # flat sink (phones)
    n = max(2, int(round(w / 0.6)))
    _fronts(pc, -hw, hw, -hd + 0.02, 0.09, zt - 0.03, low, n, drawers=True)
    pc.box(-hw, hd - 0.012, zt, hw, hd, zt + 0.10, 'f_stone', r=0.003)                              # upstand
    _tap(pc, sx, hd - 0.10, zt)
    hx = hw - w * 0.27
    pc.box(hx - 0.30, -0.24, zt, hx + 0.30, 0.24, zt + 0.006, 'f_screen', r=0.002)
    for (ox, oy, rr) in ((-0.14, -0.10, 0.07), (0.14, -0.10, 0.06), (-0.14, 0.12, 0.06), (0.14, 0.12, 0.08)):
        pc.cyl(hx + ox, oy, zt + 0.006, zt + 0.0075, rr, 'f_anthracite', seg=pc.n(20, 10))
    # slim hood over the hob
    pc.box(hx - 0.30, hd - 0.42, 1.55, hx + 0.30, hd - 0.04, 1.62, 'f_steel', r=0.004)
    pc.box(hx - 0.10, hd - 0.20, 1.62, hx + 0.10, hd - 0.04, float(pc.ctx.get('ceiling', 2.75)), 'f_steel', r=0.004)
    # wall units on the left: floating oak shelves; on the right of the hob nothing (window or light pipe)
    sh_w = min(1.1, w * 0.36)
    for z in (1.40, 1.78):
        pc.box(-hw, hd - 0.26, z, -hw + sh_w, hd - 0.01, z + 0.035, 'f_oak', r=0.006)
    if hx - 0.38 - (-hw + sh_w + 0.05) > 0.5:
        pc.box(-hw + sh_w + 0.05, hd - 0.36, 1.40, hx - 0.38, hd - 0.01, 2.20, hi_cols[0], r=0.006)
    pc.anchor('top', rect=(-hw, -hd, hw, hd), z=zt)
    fa, fb = sx + 0.36, hx - 0.36
    if fb - fa < 0.3:
        fa, fb = hx + 0.36, hw - 0.05
    pc.anchor('free', rect=(fa, -hd + 0.08, fb, hd - 0.1), z=zt)
    pc.anchor('shelves', rects=[(-hw, hd - 0.26, -hw + sh_w, hd - 0.01)], zs=[1.435, 1.815])
    pc.anchor('hob', x=hx, z=zt + 0.006)
    pc.footprint([(-hw, -hd, hw, hd, 0.92)])


@builder('island')
def island(pc, w, d, variant):
    """Cook side (doors) at +y, seating side with a 0.34 m overhang at -y."""
    hw, hd = w / 2, d / 2
    body_d = min(0.64, d - 0.3)
    yb = hd - body_d
    oak_front = pc.seed % 2 == 0
    zt = 0.90
    pc.box(-hw + 0.03, yb, 0.0, hw - 0.03, hd - 0.04, 0.09, 'f_anthracite')
    pc.box(-hw + 0.03, yb, 0.09, hw - 0.03, hd - 0.02, zt - 0.045, 'f_white', r=0.004)
    n = max(2, int(round((w - 0.06) / 0.6)))
    # fronts on the cook side face +y: build facing -y, then mirror by rotation
    with pc.at(0, 0, 0, rz=math.pi):
        _fronts(pc, -(hw - 0.03), (hw - 0.03), -(hd - 0.02), 0.09, zt - 0.045, ['f_oak'] if oak_front else ['f_white'], n, drawers=True)
    # oak end panels reaching to the front of the overhang
    for sx in (-1, 1):
        pc.box(sx * hw - (0.03 if sx > 0 else 0), -hd + 0.04, 0.0, sx * hw + (0 if sx > 0 else 0.03), hd - 0.02, zt - 0.045, 'f_oak', r=0.005)
    # seating-side panel: vertical oak battens
    nb = int((w - 0.06) / 0.06)
    for i in range(nb):
        x = -hw + 0.03 + (i + 0.5) * (w - 0.06) / nb
        pc.box(x - 0.022, yb - 0.02, 0.09, x + 0.022, yb, zt - 0.045, 'f_oak')
    pc.box(-hw, -hd, zt - 0.045, hw, hd, zt, 'f_stone', r=0.01, s=1, keep=True)
    # the sink is in the run along the wall; the island top stays free for preparing and sitting
    pc.anchor('top', rect=(-hw, -hd, hw, hd), z=zt)
    pc.anchor('free', rect=(-hw + 0.15, -hd + 0.08, hw - 0.15, hd - 0.1), z=zt)
    pc.footprint([(-hw, -hd, hw, hd, 0.94)])


@builder('fridge')
def fridge(pc, w, d, variant):
    hw, hd = w / 2, d / 2
    h = 1.85
    pc.box(-hw + 0.02, -hd + 0.03, 0.03, hw - 0.02, hd, h, 'f_appliance', r=0.012, s=1, keep=True)
    pc.box(-hw + 0.04, -hd + 0.015, 0.0, hw - 0.04, hd - 0.05, 0.03, 'f_anthracite')
    # door split: freezer drawer below, fridge above
    zs = 0.62
    pc.box(-hw + 0.02, -hd + 0.018, zs - 0.003, hw - 0.02, -hd + 0.032, zs + 0.003, 'f_black_metal')
    pc.box(hw - 0.08, -hd + 0.0, zs + 0.15, hw - 0.062, -hd + 0.032, zs + 1.05, 'f_steel', r=0.004)
    pc.box(hw - 0.08, -hd + 0.0, 0.10, hw - 0.062, -hd + 0.032, zs - 0.08, 'f_steel', r=0.004)
    pc.footprint([(-hw, -hd, hw, hd, h)])
