"""Storage: wardrobes (closed, walk-in, hall, utility) and shelves (bookcase, rack, storage, open, bedside, bath, low)."""
import math
from . import builder
from fx import stuff


def _pull(pc, x, y_front, z0, z1):
    pc.box(x - 0.008, y_front - 0.014, z0, x + 0.008, y_front, z1, 'f_oak', r=0.003)


@builder('wardrobe')
def wardrobe(pc, w, d, variant):
    hw, hd = w / 2, d / 2
    v = variant or 'closed'
    H = 2.30 if v != 'utility' else 2.10
    if v == 'walkin':
        return _walkin(pc, w, d, H)
    n = max(1, int(round(w / 0.5)))
    cw = w / n
    open_bay = (v in ('closed', 'hall') and n >= 4 and pc.seed % 3 == 0)
    pc.box(-hw, -hd + 0.03, 0.0, hw, hd, 0.07, 'f_anthracite')                               # plinth
    # carcass; an open bay (the first one) is a recess, so the carcass leaves it out
    pc.box(-hw + (cw if open_bay else 0.0), -hd + 0.03, 0.07, hw, hd, H, 'f_white', r=0.004)
    for i in range(n):
        a, b = -hw + i * cw + 0.002, -hw + (i + 1) * cw - 0.002
        if open_bay and i == 0:
            # an open oak niche: side boards, top and bottom between them, white back, shelves with folded stacks
            pc.box(a, -hd + 0.02, 0.07, a + 0.02, hd - 0.03, H, 'f_oak', r=0.003)
            pc.box(b - 0.02, -hd + 0.02, 0.07, b, hd - 0.03, H, 'f_oak', r=0.003)
            pc.box(a + 0.02, -hd + 0.023, H - 0.03, b - 0.02, hd - 0.03, H - 0.004, 'f_oak', r=0.003)
            pc.box(a + 0.02, -hd + 0.023, 0.07, b - 0.02, hd - 0.03, 0.09, 'f_oak', r=0.003)
            pc.box(a + 0.02, hd - 0.034, 0.09, b - 0.02, hd - 0.004, H - 0.03, 'f_white')
            for k in range(4):
                z = 0.11 + (k + 1) * (H - 0.17) / 5
                pc.box(a + 0.02, -hd + 0.033, z, b - 0.02, hd - 0.034, z + 0.022, 'f_oak', r=0.003)
                stuff.folded_stack(pc, (a + b) / 2, 0.0, z + 0.022, w=cw * 0.7, d=d * 0.6, n=3 + k % 2)
            continue
        pc.box(a, -hd, 0.08, b, -hd + 0.02, H - 0.005, 'f_white' if v != 'hall' else pc.pick(['f_white', 'f_greige']), r=0.004)
        px = b - 0.045 if i % 2 == 0 else a + 0.045
        _pull(pc, px, -hd, 0.9, 1.35)
    if v == 'hall':
        # mirror strip on the middle door
        k = n // 2
        a, b = -hw + k * cw + 0.03, -hw + (k + 1) * cw - 0.03
        pc.box(a, -hd - 0.003, 0.35, b, -hd + 0.003, 2.0, 'f_mirror')
    pc.anchor('top', rect=(-hw, -hd, hw, hd), z=H)
    pc.footprint([(-hw, -hd, hw, hd, H)])


def _walkin(pc, w, d, H):
    """Open wardrobe wall: oak uprights, hanging rails with garments, shelves with folded stacks and boxes."""
    hw, hd = w / 2, d / 2
    n = max(2, int(round(w / 0.9)))
    cw = w / n
    pc.box(-hw, hd - 0.012, 0.0, hw, hd, H, 'f_white', r=0.0)                                # back panel
    for i in range(n + 1):
        x = -hw + i * cw
        pc.box(x - 0.011 + (0.011 if i == 0 else 0) - (0.011 if i == n else 0), -hd + 0.02, 0.07,
               x + 0.011 + (0.011 if i == 0 else 0) - (0.011 if i == n else 0), hd - 0.012, H - 0.022, 'f_oak', r=0.003)
    pc.box(-hw, -hd + 0.02, H - 0.022, hw, hd - 0.012, H, 'f_oak', r=0.003)
    pc.box(-hw, -hd + 0.02, 0.0, hw, hd - 0.012, 0.07, 'f_oak', r=0.003)
    kinds = ['shirt', 'shirt', 'dress', 'jacket', 'trousers']
    for i in range(n):
        a, b = -hw + i * cw + 0.011, -hw + (i + 1) * cw - 0.011
        mode = (i + pc.seed) % 3
        if mode == 0:                                  # double hanging
            for z in (1.85, 1.02):
                pc.tube((a, 0.0, z), (b, 0.0, z), 0.007, 'f_chrome', seg=pc.n(8, 6))
                stuff.garment_row(pc, a, b, 0.0, z, kinds=['shirt', 'shirt', 'trousers'], max_h=0.74)
            pc.box(a, -hd + 0.03, 0.22, b, hd - 0.015, 0.242, 'f_oak', r=0.003)
        elif mode == 1:                                # long hanging
            z = 1.84
            pc.tube((a, 0.0, z), (b, 0.0, z), 0.007, 'f_chrome', seg=pc.n(8, 6))
            stuff.garment_row(pc, a, b, 0.0, z, kinds=['dress', 'dress', 'coat', 'jacket'])
            pc.box(a, -hd + 0.03, 0.12, b, hd - 0.015, 0.142, 'f_oak', r=0.003)
        else:                                          # shelves
            zs = [0.30, 0.62, 0.94, 1.26, 1.58, 1.90]
            for k, z in enumerate(zs):
                pc.box(a, -hd + 0.03, z, b, hd - 0.015, z + 0.022, 'f_oak', r=0.003)
                cx = (a + b) / 2
                if k % 2 == 0:
                    stuff.folded_stack(pc, cx - 0.12, 0.0, z + 0.022, w=0.30, d=0.30, n=3 + k % 3)
                    stuff.folded_stack(pc, cx + 0.14, 0.0, z + 0.022, w=0.26, d=0.30, n=2 + k % 2)
                else:
                    stuff.crate(pc, cx - 0.14, 0.0, z + 0.022, w=0.34, d=0.30, h=0.20, mat=pc.pick(['f_sand', 'f_linen', 'f_greige']))
                    stuff.basket(pc, cx + 0.16, 0.0, z + 0.022, r=0.11, h=0.2)
    pc.footprint([(-hw, -hd, hw, hd, H)])


@builder('shelf')
def shelf(pc, w, d, variant):
    hw, hd = w / 2, d / 2
    v = variant or 'bookcase'
    {'bookcase': _bookcase, 'rack': _rack, 'storage': _storage, 'open': _open, 'bedside': _bedside, 'bath': _bath,
     'low': _low}[v](pc, w, d)


def _frame(pc, w, d, H, nsh, mat='f_oak', t=0.022, back=True, base=0.0, zs=None):
    hw, hd = w / 2, d / 2
    for sx in (-1, 1):
        pc.box(sx * hw - (t if sx > 0 else 0), -hd, base, sx * hw + (0 if sx > 0 else t), hd, H, mat, r=0.003)
    zs = zs or [base + i * (H - base - t) / (nsh - 1) for i in range(nsh)]
    for z in zs:
        pc.box(-hw + t, -hd, z, hw - t, hd - 0.01, z + t, mat, r=0.003)
    if back:
        pc.box(-hw + t, hd - 0.01, base, hw - t, hd, H, 'f_white')
    return zs


def _bookcase(pc, w, d):
    hw, hd = w / 2, d / 2
    H = 1.95 if w >= 0.9 else 1.6
    zs = _frame(pc, w, d, H, 6, base=0.0)
    t = 0.022
    for k, z in enumerate(zs[:-1]):
        zt = z + t
        gap = zs[k + 1] - zt
        mode = (k + pc.seed) % 4
        if mode in (0, 1, 2):
            stuff.books(pc, -hw + t + 0.02, hw - t - 0.02 - (0.3 if mode == 2 else 0), hd - 0.12, zt, hmax=min(0.30, gap - 0.03), depth=min(0.22, d - 0.1))
            if mode == 2 and hw - t > 0.45:
                stuff.basket(pc, hw - t - 0.15, hd - 0.15, zt, r=0.1, h=min(0.2, gap - 0.04))
        else:
            stuff.crate(pc, -hw / 2, 0.0, zt, w=0.3, d=min(0.28, d - 0.06), h=min(0.2, gap - 0.04), mat=pc.pick(['f_sand', 'f_greige']))
            stuff.book_stack(pc, hw / 2, 0.0, zt, n=3)
    pc.footprint([(-hw, -hd, hw, hd, H)])


def _rack(pc, w, d):
    """Garage rack: anthracite uprights, light boards, grey crates and cartons."""
    hw, hd = w / 2, d / 2
    H = 1.95
    for sx in (-1, 1):
        for sy in (-1, 1):
            pc.box(sx * (hw - 0.02) - 0.02, sy * (hd - 0.02) - 0.02, 0, sx * (hw - 0.02) + 0.02, sy * (hd - 0.02) + 0.02, H, 'f_anthracite', r=0.002)
    zs = [0.22, 0.72, 1.22, 1.72]
    for k, z in enumerate(zs):
        pc.box(-hw + 0.01, -hd + 0.01, z, hw - 0.01, hd - 0.01, z + 0.025, 'f_oak', r=0.003)
        gap = (zs[k + 1] if k + 1 < len(zs) else H) - z - 0.025
        x = -hw + 0.12
        while x < hw - 0.25:
            cwid = pc.rand(0.28, 0.42)
            if x + cwid > hw - 0.05:
                break
            kind = (k + int(x * 10) + pc.seed) % 3
            hh = min(pc.rand(0.18, 0.30), gap - 0.05)
            if kind == 0:
                stuff.crate(pc, x + cwid / 2, 0.0, z + 0.025, w=cwid, d=min(0.3, d - 0.08), h=hh, mat=pc.pick(['f_greige', 'f_fabric_grey', 'f_sand']))
            elif kind == 1:
                pc.box(x, -min(0.15, hd - 0.05), z + 0.025, x + cwid, min(0.15, hd - 0.05), z + 0.025 + hh, 'f_oak', r=0.003)
            else:
                stuff.basket(pc, x + cwid / 2, 0.0, z + 0.025, r=min(0.13, cwid / 2), h=hh)
            x += cwid + pc.rand(0.03, 0.12)
    pc.footprint([(-hw, -hd, hw, hd, H)])


def _storage(pc, w, d):
    hw, hd = w / 2, d / 2
    H = 2.0
    zs = _frame(pc, w, d, H, 6, mat='f_white')
    for k, z in enumerate(zs[:-1]):
        zt = z + 0.022
        gap = zs[k + 1] - zt
        x = -hw + 0.10
        while x < hw - 0.22:
            sw = pc.rand(0.18, 0.30)
            if x + sw > hw - 0.06:
                break
            kind = (k + int(x * 10) + pc.seed) % 3
            if kind == 0:
                stuff.basket(pc, x + sw / 2, 0.0, zt, r=min(0.12, sw / 2, hd - 0.04), h=min(0.2, gap - 0.04))
            elif kind == 1:
                stuff.jar(pc, x + 0.06, -0.04, zt, r=0.045, h=min(0.18, gap - 0.04), content=pc.pick(['f_sand', 'f_linen', 'f_sage']))
                stuff.jar(pc, x + 0.17, 0.02, zt, r=0.04, h=min(0.14, gap - 0.04), content=pc.pick(['f_sand', 'f_clay']))
            else:
                stuff.crate(pc, x + sw / 2, 0.0, zt, w=sw - 0.01, d=min(0.28, d - 0.06), h=min(0.2, gap - 0.04), mat=pc.pick(['f_sand', 'f_linen']))
            x += sw + pc.rand(0.04, 0.10)
    pc.footprint([(-hw, -hd, hw, hd, H)])


def _open(pc, w, d):
    hw, hd = w / 2, d / 2
    H = 2.1
    zs = _frame(pc, w, d, H, 7, base=0.05)
    for k, z in enumerate(zs[:-1]):
        zt = z + 0.022
        x = -hw + 0.12
        while x < hw - 0.3:
            sw = pc.rand(0.26, 0.36)
            if x + sw > hw - 0.08:
                break
            if k % 2 == 0:
                stuff.folded_stack(pc, x + sw / 2, 0.0, zt, w=sw, d=min(0.3, d - 0.05), n=3 + (k + int(x * 7)) % 3)
            else:
                stuff.crate(pc, x + sw / 2, 0.0, zt, w=sw + 0.04, d=min(0.3, d - 0.05), h=0.2, mat=pc.pick(['f_sand', 'f_linen', 'f_greige']))
            x += sw + 0.05
    pc.footprint([(-hw, -hd, hw, hd, H)])


def _bath(pc, w, d):
    hw, hd = w / 2, d / 2
    H = 1.5
    zs = _frame(pc, w, d, H, 4, base=0.12)
    for k, z in enumerate(zs[:-1]):
        zt = z + 0.022
        x = -hw + 0.1
        while x < hw - 0.25:
            if (k + int(x * 5)) % 2 == 0:
                for j in range(2):
                    stuff.towel_roll(pc, x + 0.13, -0.05 + j * 0.0, zt + j * 0.0, w=0.3, r=0.05, mat=pc.pick(['f_white', 'f_linen', 'f_sand']))
                x += 0.36
            else:
                stuff.basket(pc, x + 0.12, 0.0, zt, r=0.1, h=0.16)
                x += 0.3
    pc.footprint([(-hw, -hd, hw, hd, H)])


def _bedside(pc, w, d):
    hw, hd = w / 2, d / 2
    H = 0.5
    for sx in (-1, 1):
        for sy in (-1, 1):
            pc.tube((sx * (hw - 0.04), sy * (hd - 0.04), 0), (sx * (hw - 0.04), sy * (hd - 0.04), 0.14), 0.016, 'f_oak', r1=0.013, seg=pc.n(10, 6))
    pc.box(-hw, -hd, 0.13, hw, hd, H, 'f_oak', r=0.012, s=1, keep=True)
    pc.box(-hw + 0.02, -hd - 0.012, 0.31, hw - 0.02, -hd + 0.004, H - 0.02, 'f_white', r=0.004)       # drawer front
    pc.box(-0.05, -hd - 0.018, H - 0.07, 0.05, -hd - 0.012, H - 0.062, 'f_black_metal')
    pc.box(-hw + 0.02, -hd + 0.02, 0.15, hw - 0.02, hd - 0.02, 0.29, 'f_white', r=0.0)              # open niche
    pc.anchor('top', rect=(-hw, -hd, hw, hd), z=H)
    pc.footprint([(-hw, -hd, hw, hd, H)])


def _low(pc, w, d):
    hw, hd = w / 2, d / 2
    H = 0.85
    for sx in (-1, 1):
        for sy in (-1, 1):
            pc.tube((sx * (hw - 0.07), sy * (hd - 0.05), 0), (sx * (hw - 0.07), sy * (hd - 0.05), 0.16), 0.017, 'f_oak', r1=0.013, seg=pc.n(10, 6))
    pc.box(-hw, -hd, 0.15, hw, hd, H, 'f_white', r=0.008, s=1, keep=True)
    pc.box(-hw - 0.004, -hd - 0.004, H - 0.03, hw + 0.004, hd + 0.004, H, 'f_oak', r=0.006)
    n = max(2, int(round(w / 0.45)))
    cw = (w - 0.03) / n
    for i in range(n):
        a = -hw + 0.015 + i * cw
        pc.box(a + 0.003, -hd - 0.014, 0.17, a + cw - 0.003, -hd + 0.004, H - 0.04, 'f_oak' if i % 2 == 0 else 'f_white', r=0.003)
    pc.anchor('top', rect=(-hw, -hd, hw, hd), z=H)
    pc.footprint([(-hw, -hd, hw, hd, H)])
