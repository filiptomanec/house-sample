"""Sofas and armchairs: upholstered bodies on slim oak legs, loose seat and back cushions."""
import math
from . import builder

FABRICS = ['f_greige', 'f_fabric_grey', 'f_linen']


def _legs(pc, pts, h, wood, r0=0.026, r1=0.018):
    for (x, y) in pts:
        pc.tube((x, y, 0), (x, y, h + 0.01), r0, wood, r1=r1, seg=pc.n(10, 6))


def _seats(pc, x0, x1, y0, y1, z0, z1, n, mat, seed):
    """n loose seat cushions side by side between x0 and x1."""
    gap = 0.012
    cw = (x1 - x0 - gap * (n - 1)) / n
    for i in range(n):
        a = x0 + i * (cw + gap)
        pc.softbox(a, y0, z0, a + cw, y1, z1, mat, r=0.04, wr=0.004, puff=0.018, seed=seed + i * 1.7)


def _backs(pc, x0, x1, y_front, z0, z1, n, mat, seed, depth=0.2, tilt=14):
    gap = 0.012
    cw = (x1 - x0 - gap * (n - 1)) / n
    for i in range(n):
        a = x0 + i * (cw + gap)
        with pc.at((a + a + cw) / 2, y_front + depth / 2, z0, rx=math.radians(tilt)):
            pc.softbox(-cw / 2, -depth / 2, 0, cw / 2, depth / 2, z1 - z0, mat, r=0.05, wr=0.004, puff=0.015, seed=seed + i)


@builder('sofa')
def sofa(pc, w, d, variant):
    hw, hd = w / 2, d / 2
    wood = pc.m('f_oak')
    fab = pc.pick(FABRICS)
    lh = 0.135
    _legs(pc, [(sx * (hw - 0.09), sy * (hd - 0.09)) for sx in (-1, 1) for sy in (-1, 1)], lh, wood)
    arm = 0.15
    pc.box(-hw + 0.004, -hd + 0.004, lh, hw - 0.004, hd - 0.004, lh + 0.19, fab, r=0.035, s=1, keep=True)   # base
    for sx in (-1, 1):                                                                         # arms
        pc.box(sx * hw - (arm if sx > 0 else 0), -hd, lh, sx * hw + (0 if sx > 0 else arm), hd - 0.003, lh + 0.50, fab, r=0.05, s=1, keep=True)
    pc.box(-hw + 0.003, hd - 0.17, lh, hw - 0.003, hd, lh + 0.62, fab, r=0.05, s=1, keep=True)  # back rail
    z_seat = lh + 0.19
    n = 3 if w > 1.9 else 2
    _seats(pc, -hw + arm, hw - arm, -hd + 0.0, hd - 0.17, z_seat, z_seat + 0.15, n, fab, 1.0 + pc.rand(0, 3))
    _backs(pc, -hw + arm, hw - arm, hd - 0.17 - 0.2, z_seat + 0.14, z_seat + 0.58, n, fab, 4.0 + pc.rand(0, 3), depth=0.2, tilt=-12)
    pc.anchor('seat', rect=(-hw + arm, -hd, hw - arm, hd - 0.17), z=z_seat + 0.15, n=n)
    pc.footprint([(-hw, -hd, hw, hd, 0.85)])


@builder('sofa_l')
def sofa_l(pc, w, d, variant):
    """Corner sofa: main run along the back (+y), chaise on the +x side reaching to the front."""
    hw, hd = w / 2, d / 2
    wood = pc.m('f_oak')
    fab = pc.pick(FABRICS)
    lh = 0.135
    md = 0.97                                    # depth of the main run
    ch = 0.95                                    # width of the chaise
    legs = [(-hw + 0.09, hd - 0.09), (-hw + 0.09, hd - md + 0.09), (hw - 0.09, hd - 0.09), (hw - 0.09, -hd + 0.09),
            (hw - ch + 0.09, -hd + 0.09), (hw - ch + 0.09, hd - md + 0.09), (0.0, hd - 0.09)]
    _legs(pc, legs, lh, wood)
    arm = 0.15
    zs = lh + 0.19
    pc.box(-hw + 0.004, hd - md, lh, hw - 0.004, hd - 0.004, zs, fab, r=0.035, s=1, keep=True)    # base, main run
    pc.box(hw - ch, -hd + 0.004, lh, hw - 0.004, hd - md + 0.01, zs, fab, r=0.035, s=1, keep=True)  # base, chaise
    pc.box(-hw, hd - md - 0.004, lh, -hw + arm, hd - 0.003, lh + 0.50, fab, r=0.05, s=1, keep=True)    # arm, left (4 mm proud)
    pc.box(-hw + 0.007, hd - 0.17, lh, hw, hd, lh + 0.62, fab, r=0.05, s=1, keep=True)        # back rail
    x1 = hw - ch
    _seats(pc, -hw + arm, x1, hd - md, hd - 0.17, zs, zs + 0.15, 2, fab, 2.0 + pc.rand(0, 3))
    pc.softbox(x1 + 0.012, -hd, zs, hw, hd - 0.17, zs + 0.15, fab, r=0.04, wr=0.004, puff=0.018, seed=7.0)   # chaise cushion
    _backs(pc, -hw + arm, hw, hd - 0.17 - 0.2, zs + 0.14, zs + 0.58, 3, fab, 5.0, depth=0.2, tilt=-12)
    pc.anchor('seat', rect=(-hw + arm, hd - md, x1, hd - 0.17), z=zs + 0.15, n=2)
    pc.footprint([(-hw, hd - md, hw, hd, 0.85), (hw - ch, -hd, hw, hd - md, 0.5)])


@builder('armchair')
def armchair(pc, w, d, variant):
    hw, hd = w / 2, d / 2
    wood = pc.m('f_oak')
    fab = pc.pick(['f_linen', 'f_sand', 'f_sage', 'f_fabric_grey'])
    lh = 0.17
    # splayed oak legs
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = sx * (hw - 0.12), sy * (hd - 0.12)
            pc.tube((x + sx * 0.04, y + sy * 0.04, 0), (x, y, lh + 0.02), 0.022, wood, r1=0.017, seg=pc.n(10, 6))
    pc.box(-hw + 0.04, -hd + 0.04, lh, hw - 0.04, hd - 0.04, lh + 0.17, fab, r=0.05, s=1, keep=True)
    # back and arms as one rounded shell
    for sx in (-1, 1):
        pc.box(sx * (hw - 0.037) - (0.143 if sx > 0 else 0), -hd + 0.10, lh + 0.1, sx * (hw - 0.037) + (0 if sx > 0 else 0.143),
               hd - 0.02, lh + 0.44, fab, r=0.06, s=1, keep=True)
    with pc.at(0, hd - 0.13, lh + 0.14, rx=math.radians(-14)):
        pc.box(-hw + 0.045, -0.10, 0, hw - 0.045, 0.10, 0.50, fab, r=0.07, s=1, keep=True)
    pc.softbox(-hw + 0.18, -hd + 0.06, lh + 0.17, hw - 0.18, hd - 0.2, lh + 0.30, fab, r=0.04, wr=0.003, puff=0.015, seed=pc.rand(0, 5))
    pc.anchor('seat', rect=(-hw + 0.18, -hd + 0.06, hw - 0.18, hd - 0.2), z=lh + 0.30, n=1)
    pc.footprint([(-hw, -hd, hw, hd, 0.8)])
