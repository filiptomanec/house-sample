"""Terrace pieces: sun lounger, hanging daybed, kettle grill with side table. Materials resolve to the t_* set."""
import math
from . import builder


@builder('lounger')
def lounger(pc, w, d, variant):
    hw, hd = w / 2, d / 2
    teak, alu, fab = 't_teak', 't_alu', 't_fabric'
    zf = 0.30
    ang = math.radians(32)
    y_hinge = 0.18
    L_back = hd - y_hinge
    # frame: alu side rails (flat part + inclined back part) on four legs
    for sx in (-1, 1):
        x = sx * (hw - 0.04)
        pc.tube((x, -hd + 0.03, zf), (x, y_hinge, zf), 0.016, alu, seg=pc.n(8, 6))
        pc.tube((x, y_hinge, zf), (x, y_hinge + L_back * math.cos(ang), zf + L_back * math.sin(ang)), 0.016, alu, seg=pc.n(8, 6))
        pc.tube((x, -hd + 0.06, 0), (x, -hd + 0.06, zf), 0.016, alu, seg=pc.n(8, 6))
        pc.tube((x, y_hinge - 0.1, 0), (x, y_hinge - 0.1, zf), 0.016, alu, seg=pc.n(8, 6))
        pc.tube((x, y_hinge + 0.55, 0), (x, y_hinge + 0.55 * math.cos(ang), zf + 0.55 * math.sin(ang) - 0.0), 0.012, alu, seg=pc.n(8, 6))
    # teak slats
    n = 9
    for i in range(n):
        y0 = -hd + 0.03 + i * (y_hinge + hd - 0.03) / n
        pc.box(-hw + 0.03, y0, zf - 0.01, hw - 0.03, y0 + (y_hinge + hd - 0.03) / n - 0.012, zf + 0.016, teak, r=0.004)
    with pc.at(0, y_hinge, zf, rx=ang):
        m = 8
        for i in range(m):
            y0 = 0.012 + i * L_back / m
            pc.box(-hw + 0.03, y0, -0.01, hw - 0.03, y0 + L_back / m - 0.012, 0.016, teak, r=0.004)
    # cushions
    pc.softbox(-hw + 0.045, -hd + 0.03, zf + 0.016, hw - 0.045, y_hinge, zf + 0.086, fab, r=0.025, wr=0.003, puff=0.01, seed=1.0)
    with pc.at(0, y_hinge, zf, rx=ang):
        pc.softbox(-hw + 0.045, 0.0, 0.016, hw - 0.045, L_back - 0.02, 0.086, fab, r=0.025, wr=0.003, puff=0.01, seed=2.0)
        pc.softbox(-hw * 0.7, L_back - 0.30, 0.086, hw * 0.7, L_back - 0.04, 0.17, 't_sage', r=0.04, wr=0.004, puff=0.02, seed=3.0)
    pc.anchor('top', rect=(-hw, -hd, hw, y_hinge), z=zf + 0.09)
    pc.footprint([(-hw, -hd, hw, hd, 0.8)])


@builder('swingbed')
def swingbed(pc, w, d, variant):
    hw, hd = w / 2, d / 2
    teak, rope, fab = 't_teak', 't_rope', 't_fabric'
    zb = 0.46
    top = float(pc.ctx.get('ceiling', 2.75)) - 0.10
    # tray frame
    pc.box(-hw, -hd, zb, hw, -hd + 0.07, zb + 0.14, teak, r=0.01, s=1, keep=True)
    pc.box(-hw, hd - 0.07, zb, hw, hd, zb + 0.14, teak, r=0.01, s=1, keep=True)
    pc.box(-hw, -hd + 0.066, zb, -hw + 0.07, hd - 0.066, zb + 0.136, teak, r=0.01)
    pc.box(hw - 0.07, -hd + 0.066, zb, hw, hd - 0.066, zb + 0.136, teak, r=0.01)
    n = 12
    for i in range(n):
        x0 = -hw + 0.07 + i * (w - 0.14) / n
        pc.box(x0 + 0.004, -hd + 0.07, zb + 0.03, x0 + (w - 0.14) / n - 0.004, hd - 0.07, zb + 0.05, teak, r=0.003)
    pc.softbox(-hw + 0.08, -hd + 0.08, zb + 0.05, hw - 0.08, hd - 0.08, zb + 0.20, fab, r=0.05, wr=0.005, puff=0.02, seed=4.0)
    for i, x in enumerate((-0.55, 0.0, 0.55)):
        with pc.at(x * (hw / 1.0), hd - 0.30, zb + 0.20, rx=math.radians(-25), rz=math.radians(4 * (i - 1))):
            pc.cushion(0.5, 0.4, 0.13, ['t_sage', 't_fabric', 't_sage'][i], seed=i * 1.9)
    with pc.at(0.15, -hd + 0.45, zb + 0.20):
        pc.softbox(-0.5, -0.25, 0, 0.5, 0.25, 0.04, 't_sage', r=0.015, wr=0.004, seed=2.0)
    # four ropes to a beam, joined above the bed
    apex = (0.0, 0.0, top)
    for sx in (-1, 1):
        for sy in (-1, 1):
            pc.tube((sx * (hw - 0.035), sy * (hd - 0.035), zb + 0.12), (sx * 0.05, sy * 0.05, top), 0.011, rope, seg=pc.n(8, 6))
    pc.sphere((0, 0, top), 0.04, rope, 10, 6)
    pc.tube((0, 0, top), (0, 0, top + 0.1), 0.012, 't_alu', seg=6)
    pc.anchor('top', rect=(-hw, -hd, hw, hd), z=zb + 0.2)
    pc.footprint([(-hw, -hd, hw, hd, 0.9)])


@builder('grill')
def grill(pc, w, d, variant):
    hw, hd = w / 2, d / 2
    en, st, alu, teak = 't_enamel', 't_steel', 't_alu', 't_teak'
    r = min(d / 2 - 0.02, 0.29)
    cx = -hw + r + 0.04
    # kettle bowl and lid on a tripod
    for k in range(3):
        a = math.pi / 2 + k * 2 * math.pi / 3
        pc.tube((cx + math.cos(a) * r * 0.5, math.sin(a) * r * 0.5, 0.52), (cx + math.cos(a) * r * 0.9, math.sin(a) * r * 0.9, 0.03), 0.014, st, seg=pc.n(8, 6))
    pc.cyl(cx + math.cos(math.pi / 2 + 2 * math.pi / 3) * r * 0.9, math.sin(math.pi / 2 + 2 * math.pi / 3) * r * 0.9, 0.0, 0.05, 0.035, en, seg=8)
    bowl = [(0, 0.50, 'h'), (r * 0.5, 0.50), (r * 0.9, 0.58), (r, 0.70), (r * 1.0, 0.76), (r * 0.98, 0.78, 'h'), (0, 0.78, 'h')]
    pc.lathe(bowl, en, cx=cx, cy=0.0, seg=pc.n(32, 16))
    lid = [(r * 1.02, 0.78, 'h'), (r * 1.0, 0.80), (r * 0.86, 0.92), (r * 0.55, 1.00), (r * 0.2, 1.04), (0, 1.045)]
    pc.lathe(lid, en, cx=cx, cy=0.0, seg=pc.n(32, 16))
    pc.tube((cx - r * 0.5, -r * 0.2, 1.03), (cx + r * 0.5, -r * 0.2, 1.03), 0.012, 't_alu', seg=pc.n(8, 6))
    pc.tube((cx - r * 0.5, -r * 0.2, 1.03), (cx - r * 0.45, -r * 0.5, 0.97), 0.008, 't_alu', seg=6)
    pc.tube((cx + r * 0.5, -r * 0.2, 1.03), (cx + r * 0.45, -r * 0.5, 0.97), 0.008, 't_alu', seg=6)
    pc.cyl(cx, 0.0, 1.045, 1.075, 0.02, st, seg=10)
    # side table
    x0 = cx + r + 0.08
    x1 = hw - 0.02
    if x1 - x0 > 0.2:
        pc.box(x0, -hd + 0.05, 0.78, x1, hd - 0.05, 0.80, teak, r=0.004)
        for sx in (x0 + 0.03, x1 - 0.03):
            for sy in (-hd + 0.08, hd - 0.08):
                pc.tube((sx, sy, 0.0), (sx, sy, 0.78), 0.013, alu, seg=pc.n(8, 6))
        pc.box(x0 + 0.03, -hd + 0.08, 0.2, x1 - 0.03, hd - 0.08, 0.215, teak, r=0.003)
        pc.anchor('top', rect=(x0, -hd + 0.05, x1, hd - 0.05), z=0.80)
    pc.footprint([(cx - r, -r, cx + r, r, 1.05), (x0, -hd + 0.05, x1, hd - 0.05, 0.8)] if x1 - x0 > 0.2 else [(cx - r, -r, cx + r, r, 1.05)])
