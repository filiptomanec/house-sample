"""Tables, desks and the TV unit."""
import math
from . import builder


def _leg(pc, x, y, h, wood, r0=0.03, r1=0.02, splay=0.0):
    pc.tube((x + splay, y + splay, 0), (x, y, h), r0 * 0.8 if splay else r0, wood, r1=r1, seg=pc.n(12, 6))


@builder('table')
def table(pc, w, d, variant):
    v = variant or 'dining'
    hw, hd = w / 2, d / 2
    if v.startswith('outdoor'):
        teak, alu = pc.m('t_teak'), pc.m('t_alu')
        h = 0.38 if v == 'outdoor_low' else 0.75
        n = max(3, int(d / 0.1))
        sl = (d - 0.012 * (n - 1)) / n
        for i in range(n):
            y0 = -hd + i * (sl + 0.012)
            pc.box(-hw, y0, h - 0.03, hw, y0 + sl, h, teak, r=0.004)
        pc.box(-hw + 0.05, -hd + 0.05, h - 0.06, hw - 0.05, hd - 0.05, h - 0.03, alu, r=0.004)
        for sx in (-1, 1):
            for sy in (-1, 1):
                pc.box(sx * (hw - 0.07) - 0.02, sy * (hd - 0.07) - 0.02, 0, sx * (hw - 0.07) + 0.02, sy * (hd - 0.07) + 0.02, h - 0.06, alu, r=0.003)
        pc.anchor('top', rect=(-hw, -hd, hw, hd), z=h)
        pc.footprint([(-hw, -hd, hw, hd, h)])
        return
    wood = pc.m('f_oak')
    if v == 'coffee':
        h = 0.38
        pc.box(-hw, -hd, h - 0.035, hw, hd, h, wood, r=0.015, s=1, keep=True)
        for sx in (-1, 1):
            for sy in (-1, 1):
                x, y = sx * (hw - 0.07), sy * (hd - 0.07)
                pc.tube((x + sx * 0.012, y + sy * 0.012, 0), (x, y, h - 0.03), 0.021, wood, r1=0.016, seg=pc.n(10, 6))
        pc.box(-hw + 0.08, -hd + 0.08, 0.12, hw - 0.08, hd - 0.08, 0.135, wood, r=0.006)       # low shelf
        pc.anchor('top', rect=(-hw, -hd, hw, hd), z=h)
        pc.footprint([(-hw, -hd, hw, hd, h)])
        return
    h = 0.75
    pc.box(-hw, -hd, h - 0.04, hw, hd, h, wood, r=0.012, s=1, keep=True)
    pc.box(-hw + 0.10, -hd + 0.10, h - 0.085, hw - 0.10, hd - 0.10, h - 0.04, wood, r=0.006)    # apron under the top
    if w >= 2.2 or pc.rand() < 0.4:
        # trestle: two slab ends joined by a stretcher
        for sx in (-1, 1):
            x = sx * (hw - 0.30)
            pc.box(x - 0.025, -hd + 0.12, 0, x + 0.025, hd - 0.12, h - 0.045, wood, r=0.008)
        pc.box(-hw + 0.30, -0.02, 0.18, hw - 0.30, 0.02, 0.24, wood, r=0.006)
    else:
        for sx in (-1, 1):
            for sy in (-1, 1):
                _leg(pc, sx * (hw - 0.09), sy * (hd - 0.09), h - 0.045, wood, 0.026, 0.017, splay=sx * 0.0)
    pc.anchor('top', rect=(-hw, -hd, hw, hd), z=h)
    pc.footprint([(-hw, -hd, hw, hd, h)])


@builder('desk')
def desk(pc, w, d, variant):
    hw, hd = w / 2, d / 2
    wood, white = pc.m('f_oak'), pc.m('f_white')
    h = 0.68 if variant == 'kids' else 0.74
    pc.box(-hw, -hd, h - 0.03, hw, hd, h, wood, r=0.01, s=1, keep=True)
    # drawer unit on the right, open slab leg on the left
    dw = min(0.42, w * 0.32)
    pc.box(hw - dw, -hd + 0.03, 0.04, hw - 0.015, hd - 0.02, h - 0.03, white, r=0.008)
    pc.box(hw - dw + 0.01, -hd + 0.04, 0.0, hw - 0.025, hd - 0.06, 0.045, 'f_anthracite')
    n = 3
    for i in range(n):
        z0 = 0.07 + i * (h - 0.13) / n
        z1 = z0 + (h - 0.13) / n - 0.012
        pc.box(hw - dw + 0.006, -hd + 0.015, z0, hw - 0.021, -hd + 0.033, z1, white if variant == 'kids' else wood, r=0.004)
        pc.box(hw - dw / 2 - 0.05, -hd + 0.008, z1 - 0.03, hw - dw / 2 + 0.05, -hd + 0.016, z1 - 0.022, 'f_black_metal')
    pc.box(-hw + 0.04, -hd + 0.06, 0, -hw + 0.065, hd - 0.06, h - 0.03, wood, r=0.005)
    pc.box(-hw + 0.04, hd - 0.05, 0.42, hw - dw, hd - 0.04, h - 0.04, white, r=0.003)          # modesty panel
    pc.anchor('top', rect=(-hw, -hd, hw, hd), z=h)
    pc.footprint([(-hw, -hd, hw, hd, h)])


@builder('tv')
def tv(pc, w, d, variant):
    hw, hd = w / 2, d / 2
    wood, white = pc.m('f_oak'), pc.m('f_white')
    lh = 0.10
    for sx in (-1, 1):
        for sy in (-1, 1):
            pc.tube((sx * (hw - 0.08), sy * (hd - 0.07), 0), (sx * (hw - 0.08), sy * (hd - 0.07), lh + 0.01), 0.018, wood, r1=0.014, seg=pc.n(10, 6))
    top = 0.46
    pc.box(-hw, -hd, lh, hw, hd, top, white, r=0.012, s=1, keep=True)
    pc.box(-hw - 0.005, -hd - 0.005, top - 0.025, hw + 0.005, hd + 0.005, top + 0.004, wood, r=0.006)  # oak top rail
    # four fronts with slim grooves
    n = 4
    cw = (w - 0.05) / n
    for i in range(n):
        x0 = -hw + 0.025 + i * cw
        pc.box(x0 + 0.004, -hd - 0.006, lh + 0.02, x0 + cw - 0.004, -hd + 0.004, top - 0.03, wood if i % 2 == 0 else white, r=0.004)
    tw = min(w - 0.45, 1.45)
    th = tw * 0.5625
    z0 = top + 0.07
    pc.box(-0.12, -0.06, top, 0.12, 0.06, top + 0.012, 'f_black_metal', r=0.003)                # stand foot
    pc.box(-0.015, -0.01, top + 0.01, 0.015, 0.02, z0 + 0.03, 'f_black_metal')
    pc.box(-tw / 2, -0.012, z0, tw / 2, 0.015, z0 + th, 'f_screen', r=0.004)
    pc.anchor('top', rect=(-hw, -hd, hw, hd), z=top, tv_halfwidth=tw / 2)
    side = (w - tw) / 2
    if side > 0.22:
        pc.anchor('free_l', rect=(-hw + 0.03, -hd + 0.04, -tw / 2 - 0.03, hd - 0.04), z=top + 0.004)
        pc.anchor('free_r', rect=(tw / 2 + 0.03, -hd + 0.04, hw - 0.03, hd - 0.04), z=top + 0.004)
    pc.footprint([(-hw, -hd, hw, hd, z0 + th)])
