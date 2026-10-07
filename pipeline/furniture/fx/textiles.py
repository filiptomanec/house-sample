"""Textiles: rugs, sheepskin, throws, cushions on a seat, curtains."""
import math
import numpy as np

from . import mesh as M, soft as S


def rug(pc, w=2.4, d=1.7, style=None, mat=None, **kw):
    """Flat woven rug centred at the origin on the floor; style plain / border / stripes."""
    style = style or pc.pick(['border', 'stripes', 'plain'])
    base = mat or pc.pick(['f_sand', 'f_greige', 'f_linen'])
    if pc.outdoor:
        base = 't_fabric'
    pc.box(-w / 2, -d / 2, 0, w / 2, d / 2, 0.014, base, r=0.005)
    acc = pc.pick(['f_fabric_grey', 'f_sage', 'f_blue', 'f_clay']) if not pc.outdoor else 't_sage'
    if style == 'border':
        m = 0.07
        pc.box(-w / 2 + m, -d / 2 + m, 0.0, w / 2 - m, d / 2 - m, 0.0158, acc if pc.rand() < 0.5 else 'f_white' if not pc.outdoor else 't_white', r=0.002)
        pc.box(-w / 2 + m + 0.045, -d / 2 + m + 0.045, 0.0, w / 2 - m - 0.045, d / 2 - m - 0.045, 0.0172, base, r=0.002)
    elif style == 'stripes':
        n = max(3, int(d / 0.28))
        sw = d / n
        for i in range(n):
            if i % 2 == 0:
                pc.box(-w / 2 + 0.02, -d / 2 + i * sw + 0.02, 0.0, w / 2 - 0.02, -d / 2 + (i + 1) * sw - 0.02, 0.0158, acc, r=0.002)


def sheepskin(pc, w=0.55, d=0.7, **kw):
    pc.cushion(w, d, 0.07, 'f_linen', seed=pc.rand(0, 5), wr=0.01, e_plan=0.9, e_vert=0.7)


def throw_folded(pc, w=0.5, d=0.9, mat=None, **kw):
    mat = mat or pc.pick(['f_sage', 'f_sand', 'f_blue', 'f_clay'])
    pc.softbox(-w / 2, -d / 2, 0, w / 2, d / 2, 0.06, mat, r=0.02, wr=0.006, seed=pc.rand(0, 5))


def curtain(pc, width=0.6, height=2.6, mat=None, **kw):
    """One gathered panel hanging in the xz plane at y = 0 (rail at z = height), origin at the floor."""
    mat = mat or pc.pick(['f_linen', 'f_sand', 'f_white'])
    V, F, N = S.gen_curtain(width, height - 0.04, folds=max(3, int(width / 0.12)), amp=0.03, thick=0.01, nz=3 if pc.hi else 1,
                            seed=pc.rand(0, 6))
    pc.mesh(V, F, N, mat, M.T(0, 0, 0.02))


def curtain_set(pc, opening_w=2.0, height=2.6, **kw):
    """Rail and a panel on each side of an opening of width opening_w, at y = 0, origin at the opening centre."""
    mat = pc.pick(['f_linen', 'f_sand', 'f_white'])
    pw = 0.55
    rail_w = opening_w + 2 * pw + 0.2
    pc.tube((-rail_w / 2, 0.0, height), (rail_w / 2, 0.0, height), 0.009, 'f_black_metal', seg=pc.n(8, 5))
    for sx in (-1, 1):
        with pc.at(sx * (opening_w / 2 + pw / 2 + 0.05), 0.0, 0.0):
            curtain(pc, pw, height, mat)
        pc.sphere((sx * rail_w / 2, 0, height), 0.014, 'f_black_metal', 6, 4)
