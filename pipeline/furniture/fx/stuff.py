"""Small things that fill shelves and surfaces: books, garments, folded stacks, boxes, jars, baskets, towels.

All helpers draw into a Piece at the current frame; positions are in that frame (x, y on the surface, z = surface
height). Colours are muted (STYLE.md): linen, sand, greige, sage, blue-grey, clay, white, oak.
"""
import math

BOOK_COLS = ['f_linen', 'f_greige', 'f_white', 'f_blue', 'f_sand', 'f_fabric_grey', 'f_oak', 'f_sage', 'f_clay', 'f_linen',
             'f_white', 'f_sand']
CLOTH_COLS = ['f_white', 'f_linen', 'f_sand', 'f_sage', 'f_blue', 'f_greige', 'f_fabric_grey', 'f_clay', 'f_white']


def books(pc, x0, x1, y, z, hmax=0.27, depth=0.17, gap_end=0.0, cols=None, lean_end=True, seed=None):
    """A row of books standing on z from x0 to x1, front at y (spine plane), varying heights; the last ones may lean."""
    rng = pc.rng
    cols = cols or BOOK_COLS
    x = x0
    n = 0
    while x < x1 - 0.03:
        t = rng.uniform(0.016, 0.042)
        h = rng.uniform(hmax * 0.68, hmax)
        dp = rng.uniform(depth * 0.8, depth)
        if x + t > x1 - gap_end:
            break
        pc.box(x, y - dp / 2, z, x + t, y + dp / 2, z + h, pc.pick(cols))
        x += t + rng.uniform(0.0, 0.004)
        n += 1
    if lean_end and n > 2 and x < x1 - 0.1:
        with pc.at(x + 0.04, y, z, ry=math.radians(-16)):
            pc.box(0, -depth * 0.45, 0, 0.03, depth * 0.45, hmax * 0.9, pc.pick(cols))
    return n


def book_stack(pc, x, y, z, n=3, w=0.21, d=0.15, cols=None, rot=0.0):
    rng = pc.rng
    cols = cols or BOOK_COLS
    with pc.at(x, y, z, rz=rot):
        zz = 0.0
        for i in range(n):
            t = rng.uniform(0.018, 0.034)
            ww = w * rng.uniform(0.88, 1.0)
            dd = d * rng.uniform(0.9, 1.0)
            ox, oy = rng.uniform(-0.01, 0.01), rng.uniform(-0.01, 0.01)
            with pc.at(ox, oy, zz, rz=math.radians(rng.uniform(-6, 6))):
                pc.box(-ww / 2, -dd / 2, 0, ww / 2, dd / 2, t, pc.pick(cols))
            zz += t
    return zz


def garment(pc, x, y, z_top, kind, mat, fold=0.0):
    """One garment hanging from a rail at z_top (rail along x): a flat body with shoulders, its face across the rail (seen edge-on from the front)."""
    h = {'shirt': 0.66, 'dress': 1.05, 'jacket': 0.78, 'trousers': 0.72, 'coat': 1.12}[kind] * float(pc.rng.uniform(0.92, 1.06))
    w = {'shirt': 0.44, 'dress': 0.40, 'jacket': 0.46, 'trousers': 0.34, 'coat': 0.46}[kind] * float(pc.rng.uniform(0.88, 1.0))
    th = 0.03 if kind != 'coat' else 0.045
    z1 = z_top - 0.05 - float(pc.rng.uniform(0.0, 0.008))
    # hanger hook and arms
    pc.tube((x, y, z_top), (x, y, z_top - 0.05), 0.0035, 'f_anthracite', seg=4)
    th = th * float(pc.rng.uniform(0.9, 1.1))
    with pc.at(x, y + float(pc.rng.uniform(-0.006, 0.006)), z1 - h, rz=math.pi / 2 + math.radians(fold)):   # faces across the rail
        pc.box(-w / 2, -th / 2, 0, w / 2, th / 2, h, mat)
        if kind in ('shirt', 'jacket', 'coat') and pc.hi:
            pc.box(-w / 2 - 0.045, -th / 2 * 0.8, h * 0.62, -w / 2 + 0.005, th / 2 * 0.8, h - 0.01, mat)
            pc.box(w / 2 - 0.005, -th / 2 * 0.8, h * 0.62, w / 2 + 0.045, th / 2 * 0.8, h - 0.01, mat)


def garment_row(pc, x0, x1, y, z_rail, kinds=None, cols=None, max_h=None):
    """Garments hanging along a rail from x0 to x1 (rail itself is drawn by the caller)."""
    rng = pc.rng
    cols = cols or CLOTH_COLS
    kinds = kinds or ['shirt', 'shirt', 'dress', 'jacket', 'trousers']
    x = x0 + 0.05
    while x < x1 - 0.12:
        k = pc.pick(kinds)
        if max_h is not None and {'shirt': 0.66, 'dress': 1.05, 'jacket': 0.78, 'trousers': 0.72, 'coat': 1.12}[k] > max_h:
            k = 'shirt'
        gap = rng.uniform(0.045, 0.07)
        if x + gap > x1 - 0.08:
            break
        garment(pc, x + gap * 0.5, y, z_rail, k, pc.pick(cols), fold=rng.uniform(-4, 4))
        x += gap
    return x


def folded_stack(pc, x, y, z, w=0.32, d=0.28, n=4, cols=None):
    rng = pc.rng
    cols = cols or CLOTH_COLS
    zz = z
    for i in range(n):
        t = rng.uniform(0.035, 0.05)
        with pc.at(x + rng.uniform(-0.01, 0.01), y + rng.uniform(-0.008, 0.008), zz, rz=math.radians(rng.uniform(-3, 3))):
            pc.box(-w / 2, -d / 2, 0, w / 2, d / 2, t, pc.pick(cols), r=0.014, keep=True)
        zz += t
    return zz - z


def crate(pc, x, y, z, w=0.38, d=0.28, h=0.22, mat='f_greige', lid=False):
    """Plastic or fabric storage box with a rim."""
    d = d * float(pc.rng.uniform(0.93, 1.0))
    h = h * float(pc.rng.uniform(0.94, 1.0))
    pc.box(x - w / 2, y - d / 2, z, x + w / 2, y + d / 2, z + h - 0.004, mat, r=0.012)
    pc.box(x - w / 2 - 0.004, y - d / 2 - 0.004, z + h - 0.025, x + w / 2 + 0.004, y + d / 2 + 0.004, z + h, mat, r=0.006)
    pc.box(x - w / 4, y - d / 2 - 0.006, z + h - 0.10, x + w / 4, y - d / 2 + 0.002, z + h - 0.075, 'f_white', r=0.0)


def basket(pc, x, y, z, r=0.14, h=0.22, mat='f_rattan', content=None):
    pc.cyl(x, y, z, z + h, r, mat, seg=pc.n(18, 10), r=0.01, rad1=r * 1.08)
    pc.cyl(x, y, z + h - 0.012, z + h + 0.002, r * 1.09, 'f_oak', seg=pc.n(18, 10))
    if content:
        pc.softbox(x - r * 0.8, y - r * 0.8, z + h - 0.05, x + r * 0.8, y + r * 0.8, z + h + 0.05, content, r=0.03, puff=0.01, wr=0.004)


def jar(pc, x, y, z, r=0.04, h=0.12, lid='f_oak', content='f_sand'):
    pc.cyl(x, y, z, z + h, r, 'f_glass' if not pc.outdoor else 't_glass', seg=pc.n(14, 8))
    pc.cyl(x, y, z + 0.004, z + h * 0.78, r * 0.92, content, seg=pc.n(12, 6))
    pc.cyl(x, y, z + h, z + h + 0.02, r * 1.02, lid, seg=pc.n(14, 8))


def towel_roll(pc, x, y, z, w=0.26, r=0.045, mat='f_white'):
    pc.tube((x - w / 2, y, z + r), (x + w / 2, y, z + r), r, mat, seg=pc.n(12, 8))


def pot(pc, x, y, z, r=0.07, h=0.12, mat='f_pot', soil=True, flare=1.12):
    prof = [(0, z, 'h'), (r * 0.8, z, 'h'), (r, z + h * 0.18), (r * flare, z + h), (r * flare - 0.012, z + h, 'h')]
    pc.lathe(prof, mat, cx=x, cy=y, seg=pc.n(20, 10))
    if soil:
        pc.cyl(x, y, z + h * 0.8, z + h * 0.95, r * flare - 0.014, 'f_black_metal' if not pc.outdoor else 't_enamel', seg=pc.n(16, 8))


def bottle(pc, x, y, z, r=0.032, h=0.22, mat='f_glass'):
    prof = [(0, z, 'h'), (r, z, 'h'), (r, z + h * 0.62), (r * 0.42, z + h * 0.82), (r * 0.36, z + h), (0, z + h, 'h')]
    pc.lathe(prof, mat, cx=x, cy=y, seg=pc.n(14, 8))
