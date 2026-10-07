"""Soup assembly (numpy only): place pieces in the house frame, bucket by zone and material, derive footprints."""
import math
import numpy as np

from . import mesh as M, grain
from .palette import WOOD


def place_matrix(x, y, rot_deg, z=0.0):
    return M.T(x, y, z) @ M.Rz(math.radians(rot_deg))


def bucket(entries):
    """entries: list of (zone, Soup) already in the house frame -> {(zone, material): (pos, nrm, uv|None)}.
    Wood materials get box-projected grain UVs (parts numbered globally so that every board is its own part)."""
    acc = {}
    pid = 0
    for zone, soup in entries:
        for p in soup.parts:
            pid += 1
            acc.setdefault((zone, p['mat']), []).append((p['pos'], p['nrm'], np.full(len(p['pos']), pid)))
    out = {}
    for key, lst in acc.items():
        pos = np.concatenate([a[0] for a in lst])
        nrm = np.concatenate([a[1] for a in lst])
        uv = None
        if key[1] in WOOD:
            uv = grain.uvs(pos, np.concatenate([a[2] for a in lst]))
        out[key] = (pos, nrm, uv)
    return out


def part_boxes(soup, zmin_body=0.08, zmax_body=1.7, floor_reach=0.45, top_min=0.30, gap=0.03):
    """Walk-collider boxes of a soup (house frame): plan boxes of its parts that stand on or low above the floor and rise
    above top_min, grouped where their boxes overlap or come within `gap`. Returns [(x0, y0, x1, y1, top)]."""
    items = []
    for p in soup.parts:
        pos = p['pos'].reshape(-1, 3)
        z0, z1 = pos[:, 2].min(), pos[:, 2].max()
        if z0 > floor_reach or z1 < top_min:
            continue
        body = pos[(pos[:, 2] > zmin_body) & (pos[:, 2] < zmax_body)]
        if len(body) == 0:
            continue
        items.append([body[:, 0].min(), body[:, 1].min(), body[:, 0].max(), body[:, 1].max(), min(z1, zmax_body)])
    # union-find over overlapping boxes
    n = len(items)
    par = list(range(n))

    def find(a):
        while par[a] != a:
            par[a] = par[par[a]]
            a = par[a]
        return a
    for i in range(n):
        for j in range(i + 1, n):
            a, b = items[i], items[j]
            if a[0] - gap < b[2] and b[0] - gap < a[2] and a[1] - gap < b[3] and b[1] - gap < a[3]:
                par[find(j)] = find(i)
    groups = {}
    for i in range(n):
        groups.setdefault(find(i), []).append(items[i])
    out = []
    for g in groups.values():
        out.append((min(q[0] for q in g), min(q[1] for q in g), max(q[2] for q in g), max(q[3] for q in g),
                    max(q[4] for q in g)))
    return out


def rect_to_house(box, x, y, rot_deg):
    """Local box (x0, y0, x1, y1[, h]) -> house-frame axis-aligned box for a piece at (x, y) turned by rot_deg."""
    a = math.radians(rot_deg)
    c, s = math.cos(a), math.sin(a)
    pts = [(box[0], box[1]), (box[2], box[1]), (box[2], box[3]), (box[0], box[3])]
    xs = [x + c * px - s * py for px, py in pts]
    ys = [y + s * px + c * py for px, py in pts]
    return [min(xs), min(ys), max(xs), max(ys)]
