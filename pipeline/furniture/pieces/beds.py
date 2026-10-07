"""Beds: oak platform frame on slim legs, upholstered headboard, linen bedding, pillows, folded throw."""
import math
from . import builder

ACCENTS = ['f_sage', 'f_sand', 'f_blue', 'f_clay']


@builder('bed')
def bed(pc, w, d, variant):
    """Head at +y. Footprint is the frame (w x d); the mattress sits inside it."""
    rng = pc.rng
    hw, hd = w / 2, d / 2
    wood = pc.m('f_oak')
    # legs and frame
    lh, fz0, fz1 = 0.11, 0.11, 0.29
    for sx in (-1, 1):
        for sy in (-1, 1):
            pc.tube((sx * (hw - 0.07), sy * (hd - 0.07), 0), (sx * (hw - 0.065), sy * (hd - 0.065), lh + 0.01), 0.022, wood,
                    r1=0.017, seg=pc.n(10, 6))
    pc.box(-hw, -hd, fz0, hw, hd - 0.02, fz1, wood, r=0.012, s=1)
    # upholstered headboard: a wide panel standing on the frame, slightly wider than the bed
    head_mat = pc.pick(['f_fabric_grey', 'f_greige'])
    pc.box(-hw - 0.02, hd - 0.085, 0.16, hw + 0.02, hd, 1.04, head_mat, r=0.03, s=1, keep=True)
    # a thin oak rail along the top of the headboard
    pc.box(-hw - 0.02, hd - 0.095, 1.00, hw + 0.02, hd - 0.075, 1.045, wood, r=0.008)
    # mattress
    mt_w, mt_d = w - 0.05, d - 0.15
    z_m0, z_m1 = fz1 - 0.02, fz1 + 0.20
    ym0, ym1 = -hd + 0.025, hd - 0.10
    pc.softbox(-mt_w / 2, ym0, z_m0, mt_w / 2, ym1, z_m1, 'f_linen', r=0.045, wr=0.0, s=1)
    # sheet strip at the foot (mattress side under the duvet) is hidden; the duvet covers 2/3 of the length
    duvet_len = mt_d * 0.70
    yd1 = ym0 + duvet_len
    ztop = z_m1 + 0.075
    pc.softbox(-mt_w / 2 - 0.02, ym0 - 0.01, z_m0 + 0.05, mt_w / 2 + 0.02, yd1, ztop, 'f_linen', r=0.05, wr=0.007,
               puff=0.012, seed=rng.uniform(0, 6), sub=None)
    # turned-back cuff of the duvet
    pc.softbox(-mt_w / 2 - 0.018, yd1 - 0.20, ztop - 0.045, mt_w / 2 + 0.018, yd1 + 0.012, ztop + 0.012, 'f_linen', r=0.02,
               wr=0.003, seed=1.0)
    # folded throw across the foot
    acc = pc.pick(ACCENTS)
    th_y = ym0 + 0.40
    pc.softbox(-mt_w / 2 - 0.03, th_y - 0.20, ztop - 0.005, mt_w / 2 + 0.03, th_y + 0.20, ztop + 0.04, acc, r=0.018, wr=0.004,
               seed=rng.uniform(0, 6))
    # drop of the throw over the side edges
    for sx in (-1, 1):
        pc.softbox(sx * (mt_w / 2 + 0.02), th_y - 0.20, ztop - 0.19, sx * (mt_w / 2 + 0.047), th_y + 0.20, ztop + 0.02, acc,
                   r=0.012, wr=0.0)
    # pillows against the headboard
    n_pil = 1 if w < 1.2 else 2
    pw = 0.62 if w >= 1.5 else 0.5
    cols = ['f_linen', 'f_linen', pc.pick(['f_sand', 'f_greige'])]
    for i in range(n_pil):
        x = 0.0 if n_pil == 1 else (-1 if i == 0 else 1) * (mt_w / 4)
        with pc.at(x, hd - 0.10 - 0.20, z_m1 + 0.075, rx=math.radians(-72)):
            pc.cushion(min(pw, mt_w / n_pil - 0.04), 0.42, 0.15, cols[i % 3], seed=i * 2.1 + rng.uniform(0, 3))
    if w >= 1.5:
        for i, x in enumerate((-0.28, 0.33)):
            with pc.at(x * (mt_w / 1.6), hd - 0.10 - 0.33, z_m1 + 0.11, rx=math.radians(-35), rz=math.radians(rng.uniform(-8, 8))):
                pc.cushion(0.40, 0.40, 0.12, pc.pick(['f_sage', 'f_blue', 'f_clay', 'f_sand']), seed=5.0 + i)
    pc.anchor('bed', rect=(-mt_w / 2, ym0, mt_w / 2, ym1), z=ztop)
    pc.footprint([(-hw, -hd, hw, hd, 1.05)])
