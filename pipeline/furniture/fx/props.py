"""Small props: vases, bowls, trays, lamps, laptop, frames, bath and kids things. Origin on the surface they stand on."""
import math
import numpy as np

from . import mesh as M, stuff, plants


def vase(pc, h=0.26, r=0.07, mat=None, shape=None, **kw):
    mat = mat or pc.m('pot')
    shape = shape or pc.pick(['bulb', 'cylinder', 'bottle'])
    if shape == 'bulb':
        prof = [(0, 0, 'h'), (r * 0.5, 0, 'h'), (r, h * 0.38), (r * 0.8, h * 0.7), (r * 0.36, h * 0.92), (r * 0.4, h, 'h'), (r * 0.3, h, 'h'), (r * 0.3, h * 0.85, 'h')]
    elif shape == 'cylinder':
        prof = [(0, 0, 'h'), (r * 0.8, 0, 'h'), (r * 0.82, h * 0.5), (r * 0.78, h, 'h'), (r * 0.68, h, 'h'), (r * 0.68, h * 0.8, 'h')]
    else:
        prof = [(0, 0, 'h'), (r * 0.7, 0, 'h'), (r * 0.8, h * 0.4), (r * 0.5, h * 0.65), (r * 0.25, h * 0.8), (r * 0.25, h, 'h'), (r * 0.17, h, 'h'), (r * 0.17, h * 0.9, 'h')]
    pc.lathe(prof, mat, seg=pc.n(18, 10))


def bowl(pc, r=0.14, h=0.07, mat=None, fruit=None, **kw):
    mat = mat or pc.pick(['f_pot', 'f_oak', 'f_clay']) if not pc.outdoor else 't_pot'
    prof = [(0, 0, 'h'), (r * 0.45, 0, 'h'), (r * 0.8, h * 0.4), (r, h), (r - 0.008, h, 'h'), (r * 0.78 - 0.008, h * 0.45), (0, h * 0.14)]
    pc.lathe(prof, mat, seg=pc.n(22, 12))
    if fruit:
        cols = {'lemon': 'f_ochre', 'apple': 'f_sage', 'pear': 'f_plant_olive'}
        for i in range(pc.n(5, 3)):
            a = i * 2.2
            rr = r * 0.4 * (0.4 if i == 0 else 1.0)
            pc.sphere((rr * math.cos(a), rr * math.sin(a), h * 0.45 + 0.03 + 0.012 * i), 0.034, cols.get(fruit, 'f_ochre'), 9, 6)


def tray(pc, w=0.42, d=0.28, with_items=True, **kw):
    oak = pc.m('wood')
    pc.box(-w / 2, -d / 2, 0, w / 2, d / 2, 0.012, oak, r=0.004)
    for sx in (-1, 1):
        pc.box(sx * w / 2 - (0.012 if sx > 0 else 0), -d / 2, 0.012, sx * w / 2 + (0 if sx > 0 else 0.012), d / 2, 0.03, oak, r=0.003)
    if with_items:
        candles(pc, 2, x=-w * 0.25, z=0.012)
        with pc.at(w * 0.2, 0.0, 0.012):
            vase(pc, 0.13, 0.04, shape='cylinder')


def candles(pc, n=3, x=0.0, z=0.0, **kw):
    for i in range(n):
        r = pc.rand(0.022, 0.034)
        h = pc.rand(0.06, 0.16)
        pc.cyl(x + i * 0.07 - 0.035 * (n - 1), pc.rand(-0.01, 0.01), z, z + h, r, 't_candle' if pc.outdoor else 'f_white', seg=pc.n(12, 8))


def lamp_table(pc, h=0.44, r=0.1, **kw):
    base = pc.pick(['f_pot', 'f_oak', 'f_greige'])
    prof = [(0, 0, 'h'), (r * 0.8, 0, 'h'), (r * 0.9, h * 0.1), (r, h * 0.28), (r * 0.8, h * 0.45), (r * 0.18, h * 0.58), (r * 0.15, h * 0.62, 'h'), (0, h * 0.62, 'h')]
    pc.lathe(prof, base, seg=pc.n(20, 10))
    pc.tube((0, 0, h * 0.6), (0, 0, h * 0.78), 0.007, 'f_black_metal', seg=6)
    pc.lathe([(r * 1.55, h * 0.58), (r * 1.1, h * 0.98)], 'f_paper', seg=pc.n(24, 12))


def lamp_desk(pc, **kw):
    bk = 'f_black_metal'
    pc.cyl(0, 0, 0, 0.012, 0.075, bk, seg=pc.n(20, 10))
    pc.tube((0, 0, 0.012), (0.02, 0, 0.34), 0.006, bk, seg=6)
    pc.tube((0.02, 0, 0.34), (0.2, 0, 0.44), 0.006, bk, seg=6)
    with pc.at(0.2, 0, 0.44, ry=math.radians(35)):
        pc.lathe([(0.0, 0.03), (0.035, 0.03), (0.06, -0.06), (0.056, -0.06), (0.0, 0.0)], bk, seg=pc.n(18, 10))


def floor_lamp(pc, h=1.5, r=0.2, **kw):
    wood = pc.m('wood')
    for k in range(3):
        a = math.pi / 2 + k * 2 * math.pi / 3
        pc.tube((0, 0, h * 0.62), (0.2 * math.cos(a), 0.2 * math.sin(a), 0.0), 0.011, wood, r1=0.009, seg=pc.n(8, 6))
    pc.tube((0, 0, h * 0.55), (0, 0, h * 0.86), 0.01, wood, seg=pc.n(8, 6))
    pc.lathe([(r * 1.0, h * 0.84), (r * 0.8, h * 1.1)], 'f_paper', seg=pc.n(24, 12))


def pendant(pc, ceiling=2.75, drop=0.85, r=0.26, kind='dome', **kw):
    """Hung from the ceiling above the origin; the lamp body at ceiling - drop."""
    z = ceiling - drop
    pc.cyl(0, 0, ceiling - 0.03, ceiling, 0.05, 'f_white', seg=pc.n(14, 8))
    pc.tube((0, 0, ceiling - 0.03), (0, 0, z + r * 0.9), 0.003, 'f_black_metal', seg=4)
    if kind == 'globe':
        pc.sphere((0, 0, z), (r * 0.8, r * 0.8, r * 0.8), 'f_paper', pc.n(20, 10), pc.n(14, 8))
    else:
        prof = [(0.02, z + r * 0.9, 'h')] + [(r * (0.12 + 0.88 * math.sin(t * math.pi / 2) ** 1.4), z + r * 0.9 * (1 - t) ** 1.25) for t in
                 (0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1.0)] + [(r - 0.008, z, 'h')]
        pc.lathe(prof, 'f_paper', seg=pc.n(32, 16))
        pc.sphere((0, 0, z + 0.02), 0.035, 'f_car_light', 8, 5)


def laptop(pc, rot=0.0, **kw):
    with pc.at(0, 0, 0, rz=rot):
        pc.box(-0.17, -0.11, 0, 0.17, 0.11, 0.012, 'f_steel', r=0.004)
        pc.box(-0.15, -0.09, 0.012, 0.15, 0.04, 0.0125, 'f_anthracite')
        with pc.at(0, 0.11, 0.012, rx=math.radians(-100)):
            pc.box(-0.17, -0.012, 0, 0.17, 0.0, 0.222, 'f_steel', r=0.004)
            pc.box(-0.16, -0.0125, 0.01, 0.16, -0.012, 0.212, 'f_screen')


def frame(pc, w=0.5, h=0.7, art=None, mat=None, **kw):
    """Framed print on a wall: the wall plane is y = 0 and the room lies at -y; origin at the bottom centre."""
    mat = mat or pc.pick(['f_oak', 'f_black_metal', 'f_white'])
    t = 0.025
    pc.box(-w / 2, -t, 0, w / 2, 0.0, h, mat, r=0.004)
    yf = -t - 0.001                                           # front of the white mat
    pc.box(-w / 2 + 0.018, yf, 0.018, w / 2 - 0.018, -t, h - 0.018, 'f_white')
    kind = art or pc.pick(['arch', 'circles', 'lines', 'hills'])
    cols = ['f_sage', 'f_clay', 'f_blue', 'f_ochre', 'f_sand']
    pw, ph = w - 0.1, h - 0.1
    z0 = 0.05
    e = 0.0015
    if kind == 'arch':
        with pc.at(0, yf, h * 0.45, rx=math.pi / 2):
            pc.cyl(0, 0, 0.0, e, min(pw, ph) * 0.3, pc.pick(cols), seg=pc.n(24, 12))
        pc.box(-pw * 0.38, yf - e, h * 0.2, pw * 0.38, yf - 0.0001, h * 0.45, pc.pick(cols))
    elif kind == 'circles':
        for i, (x, z, r) in enumerate(((-0.2, 0.62, 0.45), (0.1, 0.4, 0.3), (0.2, 0.7, 0.2))):
            with pc.at(x * pw, yf - 0.0006 * i, h * z, rx=math.pi / 2):
                pc.cyl(0, 0, 0.0, e, pw * r * 0.3, cols[i % len(cols)], seg=pc.n(24, 12))
    elif kind == 'lines':
        for i in range(4):
            zz = z0 + 0.05 + i * ph * 0.2
            pc.box(-pw * 0.4, yf - e, zz, pw * 0.4 - i * 0.04, yf - 0.0001, zz + 0.012, pc.pick(['f_sage', 'f_blue', 'f_sand']))
    else:
        for i, c in enumerate(('f_sand', 'f_sage', 'f_blue')):
            zz = z0 + ph * 0.18 * i
            pc.box(-pw * 0.42, yf - e - 0.0003 * i, zz, pw * 0.42, yf - 0.0001, zz + ph * 0.18, c)


def towel_stack(pc, n=3, w=0.3, d=0.22, **kw):
    z = 0.0
    for i in range(n):
        t = pc.rand(0.04, 0.055)
        pc.box(-w / 2 + pc.rand(-0.008, 0.008), -d / 2, z, w / 2, d / 2, z + t, pc.pick(['f_white', 'f_linen', 'f_sand', 'f_sage']), r=0.014)
        z += t


def towel_hung(pc, w=0.5, h=0.9, mat=None, **kw):
    """Towel on a hook; wall plane y = 0, the room at -y; origin at the hook height."""
    mat = mat or pc.pick(['f_white', 'f_linen', 'f_sand', 'f_sage'])
    pc.box(-0.01, -0.045, -0.01, 0.01, 0.0, 0.01, 'f_black_metal')
    pc.box(-w / 2, -0.063, -h, w / 2, -0.047, 0.0, mat, r=0.004)


def soap_set(pc, **kw):
    pc.cyl(-0.06, 0, 0, 0.16, 0.032, 'f_white', seg=pc.n(14, 8))
    pc.tube((-0.06, 0, 0.16), (-0.06, 0, 0.19), 0.007, 'f_chrome', seg=6)
    pc.tube((-0.06, 0, 0.19), (-0.035, 0, 0.19), 0.006, 'f_chrome', seg=6)
    pc.cyl(0.06, 0, 0, 0.1, 0.03, 'f_ceramic', seg=pc.n(14, 8))
    for i in range(2):
        pc.tube((0.06 + 0.01 * i, 0.0, 0.07), (0.06 + 0.02 * i, 0.0, 0.17), 0.005, ['f_sage', 'f_clay'][i], seg=5)


def cosmetics(pc, **kw):
    for i, (x, r, h, c) in enumerate(((-0.07, 0.025, 0.12, 'f_white'), (0.0, 0.03, 0.09, 'f_sage'), (0.065, 0.02, 0.15, 'f_clay'))):
        pc.cyl(x, 0.0, 0, h, r, c, seg=pc.n(12, 8), r=0.004)


def teddy(pc, s=1.0, **kw):
    f = pc.pick(['f_sand', 'f_greige', 'f_linen'])
    pc.sphere((0, 0, 0.09 * s), (0.075 * s, 0.065 * s, 0.085 * s), f, 12, 8)
    pc.sphere((0, 0, 0.21 * s), (0.06 * s, 0.055 * s, 0.055 * s), f, 12, 8)
    for sx in (-1, 1):
        pc.sphere((sx * 0.045 * s, 0.0, 0.26 * s), (0.02 * s, 0.015 * s, 0.02 * s), f, 8, 5)
        pc.sphere((sx * 0.095 * s, -0.01 * s, 0.11 * s), (0.025 * s, 0.025 * s, 0.05 * s), f, 8, 5)
        pc.sphere((sx * 0.045 * s, -0.04 * s, 0.025 * s), (0.032 * s, 0.045 * s, 0.028 * s), f, 8, 5)
    pc.sphere((0, -0.05 * s, 0.205 * s), (0.02 * s, 0.015 * s, 0.015 * s), 'f_clay', 8, 5)


def blocks(pc, **kw):
    cols = ['f_sage', 'f_clay', 'f_blue', 'f_oak', 'f_sand', 'f_white']
    pos = [(0, 0, 0), (0.06, 0.0, 0), (0.03, 0.0, 0.05), (-0.07, 0.07, 0), (0.12, 0.08, 0)]
    for i, (x, y, z) in enumerate(pos[:pc.n(5, 3)]):
        with pc.at(x, y, z, rz=pc.rand(-0.3, 0.3)):
            pc.box(-0.025, -0.025, 0, 0.025, 0.025, 0.05, cols[i % len(cols)], r=0.003)


def toy_car(pc, **kw):
    c = pc.pick(['f_clay', 'f_blue', 'f_sage'])
    pc.box(-0.07, -0.032, 0.02, 0.07, 0.032, 0.05, c, r=0.008)
    pc.box(-0.03, -0.028, 0.05, 0.035, 0.028, 0.075, c, r=0.008)
    for sx in (-0.045, 0.045):
        for sy in (-1, 1):
            with pc.at(sx, sy * 0.034, 0.018, rx=math.pi / 2):
                pc.cyl(0, 0, -0.006, 0.006, 0.018, 'f_anthracite', seg=pc.n(10, 6))


def laundry_basket(pc, r=0.2, h=0.5, **kw):
    pc.cyl(0, 0, 0, h, r, 'f_rattan', seg=pc.n(20, 10), r=0.01, rad1=r * 1.08)
    pc.cyl(0, 0, h - 0.02, h + 0.005, r * 1.09, 'f_oak', seg=pc.n(20, 10))
    pc.softbox(-r * 0.8, -r * 0.8, h - 0.08, r * 0.8, r * 0.8, h + 0.06, pc.pick(['f_linen', 'f_sand']), r=0.04, puff=0.02, wr=0.01)


def cutting_board(pc, **kw):
    pc.box(-0.16, -0.1, 0, 0.16, 0.1, 0.02, pc.m('wood'), r=0.006)
    pc.cyl(0.04, 0.0, 0.02, 0.05, 0.05, 'f_sand', seg=pc.n(14, 8), r=0.01, rad1=0.052)
    pc.box(-0.13, -0.03, 0.02, -0.04, 0.03, 0.026, 'f_steel')


def jug(pc, h=0.24, r=0.05, **kw):
    pc.cyl(0, 0, 0, h, r, pc.m('glass'), seg=pc.n(16, 8))
    pc.cyl(0, 0, 0.004, h * 0.55, r * 0.92, 'f_blue' if not pc.outdoor else 't_glass', seg=pc.n(14, 8))


def lantern(pc, h=0.32, r=0.09, **kw):
    alu, gl = 't_alu', 't_glass'
    pc.cyl(0, 0, 0, 0.015, r + 0.01, alu, seg=pc.n(16, 8))
    pc.cyl(0, 0, 0.015, h - 0.03, r, gl, seg=pc.n(16, 8))
    pc.cyl(0, 0, h - 0.03, h - 0.012, r + 0.012, alu, seg=pc.n(16, 8))
    pc.cyl(0, 0, h - 0.012, h, r * 0.35, alu, seg=pc.n(10, 6))
    pc.cyl(0, 0, 0.015, 0.015 + 0.1, 0.035, 't_candle', seg=pc.n(12, 8))
    pc.sphere((0, 0, 0.14), (0.012, 0.012, 0.02), 'f_car_light', 6, 4)


def planter_box(pc, w=0.8, d=0.26, h=0.3, plant='buxus', **kw):
    pot = pc.m('pot')
    pc.box(-w / 2, -d / 2, 0, w / 2, d / 2, h, pot, r=0.01)
    pc.box(-w / 2 + 0.02, -d / 2 + 0.02, h - 0.004, w / 2 - 0.02, d / 2 - 0.02, h + 0.0005, 't_enamel')
    if plant == 'buxus':
        n = max(2, int(w / 0.3))
        for i in range(n):
            with pc.at(-w / 2 + (i + 0.5) * w / n, 0, h - 0.03):
                r = min(0.12, w / n / 2.2)
                V, F, N = M.gen_sphere(1.0, pc.n(12, 8), pc.n(8, 5))
                rng = np.random.default_rng(pc.seed + i)
                bump = 1 + 0.07 * np.sin(V[:, 0] * 9 + rng.uniform(0, 6)) * np.sin(V[:, 1] * 8) * np.cos(V[:, 2] * 7)
                V2 = V * bump[:, None]
                pc.mesh(V2, F, M.smooth_normals(V2, F), 't_buxus', M.T(0, 0, r * 0.9) @ M.Sc(r, r, r))
    elif plant == 'lavender':
        with pc.at(0, 0, h - 0.01):
            plants.lavender(pc, w=w - 0.1)
    else:
        with pc.at(0, 0, h - 0.01):
            plants.grass_tuft(pc, h=0.55)


def wheelbarrow(pc, **kw):
    """Garden wheelbarrow, nose along +x."""
    bk = 'f_anthracite'
    pc.prism_xz([(-0.35, 0.40), (0.35, 0.44), (0.28, 0.2), (-0.28, 0.2)], -0.2, 0.2, 'f_sage')
    for sy in (-1, 1):
        pc.tube((0.35, sy * 0.2, 0.36), (0.45, sy * 0.1, 0.24), 0.012, bk, seg=6)
        pc.tube((-0.3, sy * 0.2, 0.3), (-0.75, sy * 0.24, 0.52), 0.014, bk, seg=6)
        pc.tube((-0.2, sy * 0.2, 0.2), (-0.35, sy * 0.24, 0.0), 0.012, bk, seg=6)
        pc.tube((-0.2, sy * 0.2, 0.2), (0.1, sy * 0.1, 0.18), 0.012, bk, seg=6)
    with pc.at(0.45, 0, 0.18, rx=math.pi / 2):
        pc.cyl(0, 0, -0.03, 0.03, 0.18, 'f_rubber', seg=pc.n(20, 10))
        pc.cyl(0, 0, -0.035, 0.035, 0.1, 'f_steel', seg=pc.n(14, 8))


def stepladder(pc, h=1.5, **kw):
    """Folded A-frame ladder leaning against a wall; wall plane y = 0, room at -y."""
    al = 'f_steel'
    for sy in (-1, 1):
        pc.tube((sy * 0.2, -0.28, 0.0), (sy * 0.2, -0.02, h), 0.014, al, seg=pc.n(8, 6))
    for k in range(5):
        z = 0.25 + k * (h - 0.35) / 4
        y = -0.28 + (0.26) * z / h
        pc.box(-0.2, y - 0.04, z - 0.01, 0.2, y + 0.04, z + 0.01, al)


def shoes(pc, **kw):
    c = pc.pick(['f_white', 'f_greige', 'f_sand', 'f_leather'])
    for i, sx in enumerate((-0.07, 0.07)):
        with pc.at(sx, 0, 0, rz=math.radians(4 * (i * 2 - 1))):
            pc.box(-0.04, -0.14, 0.0, 0.04, 0.12, 0.03, 'f_white', r=0.012)
            pc.box(-0.038, -0.13, 0.03, 0.038, 0.09, 0.075, c, r=0.016)


def wall_shelf(pc, w=0.9, **kw):
    """Floating oak shelf; wall plane y = 0, room at -y; origin at the shelf underside centre."""
    pc.box(-w / 2, -0.2, 0, w / 2, 0.0, 0.03, pc.m('wood'), r=0.005)
    stuff.books(pc, -w / 2 + 0.04, -w / 2 + 0.04 + w * 0.4, -0.1, 0.03, hmax=0.22, depth=0.14)
    with pc.at(w * 0.22, -0.1, 0.03):
        vase(pc, 0.2, 0.05, shape='bottle')
    with pc.at(w * 0.38, -0.09, 0.03):
        plants.succulent(pc)


def tool_rack(pc, w=1.0, **kw):
    """Garden tools hung on a rail; wall plane y = 0, room at -y; origin at the rail centre on the floor."""
    pc.box(-w / 2, -0.03, 1.45, w / 2, 0.0, 1.5, 'f_oak', r=0.004)
    for i, x in enumerate((-0.3, -0.05, 0.2, 0.42)):
        if abs(x) > w / 2 - 0.05:
            continue
        pc.tube((x, -0.03, 1.46), (x, -0.06, 1.46), 0.006, 'f_anthracite', seg=5)
        L = 1.2 - 0.1 * i
        pc.tube((x, -0.07, 1.4), (x, -0.07, 1.4 - L), 0.012, 'f_oak', seg=6)
        pc.box(x - 0.1, -0.08, 1.4 - L - 0.2, x + 0.1, -0.056, 1.4 - L, 'f_steel', r=0.006)
