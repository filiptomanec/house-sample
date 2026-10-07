"""Free-floor candidates for decor (stdlib only): corners, wall spots, spots beside pieces, with occupancy checks."""
import math

from . import geom2d as G


class Occupancy:
    """Rectangles and discs that are taken in one zone; `free_disc` / `free_rect` test candidates against them."""

    def __init__(self, region, zones, margin=0.04):
        self.region = region          # Region or None (outdoor zone: rect list)
        self.rects = []               # taken boxes
        self.zones = zones            # door zone dicts (rect / poly)
        self.margin = margin

    def add_rect(self, r):
        self.rects.append(list(r))

    def add_disc(self, x, y, rad):
        self.rects.append([x - rad, y - rad, x + rad, y + rad])

    def _inside(self, x, y):
        return self.region.contains(x, y) if self.region is not None else True

    def free_rect(self, r, check_zones=True, inflate=0.0):
        pts = [(r[0], r[1]), (r[2], r[1]), (r[2], r[3]), (r[0], r[3]), ((r[0] + r[2]) / 2, (r[1] + r[3]) / 2),
               ((r[0] + r[2]) / 2, r[1]), ((r[0] + r[2]) / 2, r[3]), (r[0], (r[1] + r[3]) / 2), (r[2], (r[1] + r[3]) / 2)]
        if not all(self._inside(x, y) for x, y in pts):
            return False
        q = G.grow(r, inflate + self.margin)
        if any(G.inter_area(q, t) > 1e-5 for t in self.rects):
            return False
        if check_zones:
            for z in self.zones:
                if 'poly' in z:
                    if G.rect_hits_polygon(r, z['poly']):
                        return False
                elif G.inter_area(r, z['rect']) > 1e-5:
                    return False
        return True

    def free_disc(self, x, y, rad, check_zones=True):
        r = [x - rad, y - rad, x + rad, y + rad]
        if not self.free_rect(r, check_zones):
            return False
        for k in range(8):
            a = k * math.pi / 4
            if not self._inside(x + rad * math.cos(a), y + rad * math.sin(a)):
                return False
        return True


def corner_candidates(region, rad, gap=0.04):
    out = []
    for (x, y, sx, sy) in region.corners():
        out.append({'x': x + sx * (rad + gap), 'y': y + sy * (rad + gap), 'kind': 'corner'})
    return out


def wall_candidates(region, rad, step=0.25, gap=0.04):
    """Spots along the walls: (x, y, inward normal)."""
    out = []
    seen = set()
    for q in region.rects:
        sides = (((q[0], q[1], q[2], q[1]), (0, 1)), ((q[0], q[3], q[2], q[3]), (0, -1)),
                 ((q[0], q[1], q[0], q[3]), (1, 0)), ((q[2], q[1], q[2], q[3]), (-1, 0)))
        for (x0, y0, x1, y1), (nx, ny) in sides:
            L = math.hypot(x1 - x0, y1 - y0)
            n = max(1, int(L / step))
            for k in range(n + 1):
                t = k / n
                x, y = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
                # a real wall: just outside the region along the opposite normal
                if region.contains(x - nx * 0.05, y - ny * 0.05):
                    continue
                c = (round(x + nx * (rad + gap), 3), round(y + ny * (rad + gap), 3))
                if c in seen:
                    continue
                seen.add(c)
                out.append({'x': c[0], 'y': c[1], 'kind': 'wall', 'nx': nx, 'ny': ny})
    return out


def beside_candidates(piece, rad, gap=0.06):
    """Spots at the left and right of a piece (local x), near its back, and in front of it."""
    a = math.radians(piece['rot'])
    u = (math.cos(a), math.sin(a))
    v = (-math.sin(a), math.cos(a))
    out = []
    for sx in (-1, 1):
        for dy in (0.5, 0.0):
            lx = sx * (piece['w'] / 2 + rad + gap)
            ly = piece['d'] / 2 - rad - 0.02 - dy * (piece['d'] - 2 * rad)
            out.append({'x': piece['x'] + u[0] * lx + v[0] * ly, 'y': piece['y'] + u[1] * lx + v[1] * ly, 'kind': 'beside', 'side': sx})
    return out


def wall_plane_offset(region, x, y, dx, dy, max_d=0.2):
    """Distance from (x, y) along (dx, dy) to the room boundary (the wall face), or None."""
    d = 0.0
    while d <= max_d:
        if not region.contains(x + dx * d, y + dy * d):
            return d
        d += 0.005
    return None
