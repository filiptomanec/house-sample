"""Chairs and benches: oak dining chair, bar stool, task chair, outdoor chair, hall and garden bench."""
import math
from . import builder


@builder('chair')
def chair(pc, w, d, variant):
    v = variant or 'dining'
    hw, hd = w / 2, d / 2
    if v == 'stool':
        return _stool(pc, w, d)
    if v == 'task':
        return _task(pc, w, d)
    if v == 'outdoor':
        return _outdoor(pc, w, d)
    wood = pc.m('f_oak')
    zs = 0.45
    sx, fy, ry = hw - 0.045, hd - 0.04, hd - 0.05
    for sgn in (-1, 1):
        pc.tube((sgn * sx, -fy, 0), (sgn * sx, -fy, zs - 0.006), 0.017, wood, r1=0.0125, seg=pc.n(10, 6))          # front legs
        pc.tube((sgn * sx, ry + 0.02, 0), (sgn * sx, ry - 0.005, 0.44), 0.016, wood, r1=0.0135, seg=pc.n(10, 6))   # rear legs
        pc.tube((sgn * sx, ry - 0.005, 0.44), (sgn * sx, ry - 0.045, 0.84), 0.0135, wood, r1=0.012, seg=pc.n(10, 6))
        pc.box(sgn * sx - 0.011, -fy, 0.33, sgn * sx + 0.011, ry, 0.36, wood, r=0.004)                       # side stretcher
    pc.box(-hw + 0.02, -hd + 0.01, zs - 0.02, hw - 0.02, hd - 0.04, zs + 0.0, wood, r=0.008, keep=True)
    pad = pc.pick(['f_linen', 'f_sand', 'f_rattan', 'f_sage']) if v == 'dining' else 'f_linen'
    pc.softbox(-hw + 0.03, -hd + 0.02, zs, hw - 0.03, hd - 0.05, zs + 0.035, pad, r=0.014, wr=0.0, puff=0.006)
    # backrest: two curved-looking slats between the rear legs
    for z0, z1, tilt in ((0.62, 0.74, -9), (0.76, 0.85, -11)):
        with pc.at(0, ry - 0.03 - (z0 - 0.46) * 0.12, z0, rx=math.radians(tilt)):
            pc.box(-sx - 0.006, -0.009, 0, sx + 0.006, 0.009, z1 - z0, wood, r=0.005, keep=False)
    pc.footprint([(-hw, -hd, hw, hd, 0.85)])


def _stool(pc, w, d):
    wood = pc.m('f_oak')
    r = min(w, d) / 2 - 0.02
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        c, s = math.cos(a), math.sin(a)
        pc.tube((c * (r - 0.04) * 1.15, s * (r - 0.04) * 1.15, 0), (c * (r - 0.09), s * (r - 0.09), 0.62), 0.017, wood, r1=0.014, seg=pc.n(10, 6))
    pc.cyl(0, 0, 0.60, 0.635, r, wood, r=0.006)
    pc.softbox(-r + 0.02, -r + 0.02, 0.635, r - 0.02, r - 0.02, 0.675, pc.pick(['f_linen', 'f_sand', 'f_greige']), r=0.016, puff=0.006)
    for k in range(8):
        a0, a1 = k * math.pi / 4, (k + 1) * math.pi / 4
        rr = (r - 0.04) * 0.92
        pc.tube((math.cos(a0) * rr, math.sin(a0) * rr, 0.24), (math.cos(a1) * rr, math.sin(a1) * rr, 0.24), 0.01, wood, seg=6)
    pc.footprint([(-r, -r, r, r, 0.68)])


def _task(pc, w, d):
    dark = pc.m('f_anthracite')
    r = min(w, d) / 2 - 0.01
    for k in range(5):
        a = k * 2 * math.pi / 5 + math.pi / 2
        pc.tube((0, 0, 0.09), (math.cos(a) * r, math.sin(a) * r, 0.07), 0.015, dark, r1=0.012, seg=6)
        pc.cyl(math.cos(a) * r, math.sin(a) * r, 0.0, 0.05, 0.022, 'f_rubber', seg=8)
    pc.tube((0, 0, 0.08), (0, 0, 0.42), 0.026, dark, seg=8)
    fab = pc.pick(['f_fabric_grey', 'f_greige', 'f_sage'])
    pc.softbox(-0.215, -0.21, 0.42, 0.215, 0.20, 0.50, fab, r=0.03, puff=0.01)
    with pc.at(0, 0.20, 0.50, rx=math.radians(-8)):
        pc.softbox(-0.2, -0.03, 0.0, 0.2, 0.03, 0.42, fab, r=0.025, puff=0.006)
        pc.tube((0, 0.0, -0.02), (0, 0.0, 0.1), 0.012, dark, seg=6)
    pc.footprint([(-w / 2, -d / 2, w / 2, d / 2, 0.9)])


def _outdoor(pc, w, d):
    alu, fab = pc.m('t_alu'), pc.m('t_fabric')
    hw, hd = w / 2 - 0.02, d / 2 - 0.02
    zs = 0.43
    for sx in (-1, 1):
        for sy in (-1, 1):
            pc.tube((sx * hw, sy * hd, 0), (sx * hw, sy * hd, zs), 0.014, alu, seg=pc.n(8, 6))
        pc.tube((sx * hw, hd, zs), (sx * hw, hd - 0.03, 0.82), 0.012, alu, seg=pc.n(8, 6))
        pc.tube((sx * hw, -hd, zs), (sx * hw, hd, zs), 0.013, alu, seg=pc.n(8, 6))
    pc.tube((-hw, -hd, zs), (hw, -hd, zs), 0.013, alu, seg=pc.n(8, 6))
    pc.tube((-hw, hd, zs), (hw, hd, zs), 0.013, alu, seg=pc.n(8, 6))
    pc.tube((-hw, hd - 0.03, 0.82), (hw, hd - 0.03, 0.82), 0.012, alu, seg=pc.n(8, 6))
    pc.softbox(-hw + 0.01, -hd + 0.01, zs, hw - 0.01, hd - 0.01, zs + 0.06, fab, r=0.02, puff=0.008)
    with pc.at(0, hd - 0.02, zs + 0.05, rx=math.radians(-10)):
        pc.softbox(-hw + 0.01, -0.025, 0.0, hw - 0.01, 0.025, 0.34, fab, r=0.02, puff=0.006)
    pc.footprint([(-w / 2, -d / 2, w / 2, d / 2, 0.85)])


@builder('bench')
def bench(pc, w, d, variant):
    hw, hd = w / 2, d / 2
    if variant == 'outdoor':
        teak, alu = pc.m('t_teak'), pc.m('t_alu')
        n = 5
        sl = (d - 0.02 * (n - 1)) / n
        for i in range(n):
            y0 = -hd + i * (sl + 0.02)
            pc.box(-hw, y0, 0.41, hw, y0 + sl, 0.45, teak, r=0.004)
        for sx in (-1, 1):
            pc.box(sx * (hw - 0.12) - 0.02, -hd + 0.03, 0.0, sx * (hw - 0.12) + 0.02, hd - 0.03, 0.41, alu, r=0.004)
        pc.footprint([(-hw, -hd, hw, hd, 0.46)])
        return
    wood = pc.m('f_oak')
    pc.box(-hw, -hd, 0.40, hw, hd, 0.44, wood, r=0.01)                             # seat board
    for sx in (-1, 1):                                                              # slab sides
        pc.box(sx * (hw - 0.10) - 0.02, -hd + 0.02, 0.0, sx * (hw - 0.10) + 0.02, hd - 0.02, 0.40, wood, r=0.006)
    pc.box(-hw + 0.12, -hd + 0.04, 0.13, hw - 0.12, hd - 0.04, 0.15, wood, r=0.006)  # low shelf
    cw = min(1.0, w - 0.4)
    pc.softbox(-cw / 2, -hd + 0.02, 0.44, cw / 2, hd - 0.02, 0.485, pc.pick(['f_linen', 'f_sand', 'f_sage']), r=0.014, puff=0.008, wr=0.002)
    pc.anchor('top', rect=(-hw, -hd, hw, hd), z=0.485)
    pc.anchor('under', rect=(-hw + 0.12, -hd + 0.04, hw - 0.12, hd - 0.04), z=0.15)
    pc.footprint([(-hw, -hd, hw, hd, 0.49)])
