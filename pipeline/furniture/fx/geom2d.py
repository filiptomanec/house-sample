"""Plan geometry helpers (stdlib only): rectangles, rectilinear regions as unions of rectangles, door zones."""
import math

EPS = 1e-9


def rect_area(r):
    return max(0.0, r[2] - r[0]) * max(0.0, r[3] - r[1])


def rect_inter(a, b):
    x0, y0, x1, y1 = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
    return [x0, y0, x1, y1] if x1 > x0 + EPS and y1 > y0 + EPS else None


def inter_area(a, b):
    q = rect_inter(a, b)
    return rect_area(q) if q else 0.0


def grow(r, d):
    return [r[0] - d, r[1] - d, r[2] + d, r[3] + d]


def contains(r, x, y):
    return r[0] - EPS <= x <= r[2] + EPS and r[1] - EPS <= y <= r[3] + EPS


def polygon_area(pts):
    return 0.5 * sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))


def point_in_polygon(x, y, pts):
    inside = False
    n = len(pts)
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def polygon_to_rects(pts):
    """Decompose a rectilinear polygon into rectangles by coordinate compression (non-axis edges are approximated by
    testing cell centres)."""
    xs = sorted(set(round(p[0], 6) for p in pts))
    ys = sorted(set(round(p[1], 6) for p in pts))
    cells = []
    for j in range(len(ys) - 1):
        run = None
        for i in range(len(xs) - 1):
            cx, cy = (xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2
            if point_in_polygon(cx, cy, pts):
                if run is None:
                    run = [xs[i], ys[j], xs[i + 1], ys[j + 1]]
                else:
                    run[2] = xs[i + 1]
            elif run is not None:
                cells.append(run)
                run = None
        if run is not None:
            cells.append(run)
    return cells


class Region:
    """A union of axis-aligned rectangles (a room's clean floor)."""

    def __init__(self, rects):
        self.rects = [list(map(float, r)) for r in rects]
        xs = [r[0] for r in self.rects] + [r[2] for r in self.rects]
        ys = [r[1] for r in self.rects] + [r[3] for r in self.rects]
        self.bbox = [min(xs), min(ys), max(xs), max(ys)] if self.rects else [0, 0, 0, 0]
        self.xs = sorted(set(round(v, 6) for v in xs))
        self.ys = sorted(set(round(v, 6) for v in ys))

    def contains(self, x, y):
        return any(contains(r, x, y) for r in self.rects)

    def area(self):
        # exact for rectilinear unions: sum over compressed cells
        a = 0.0
        for i in range(len(self.xs) - 1):
            for j in range(len(self.ys) - 1):
                if self.contains((self.xs[i] + self.xs[i + 1]) / 2, (self.ys[j] + self.ys[j + 1]) / 2):
                    a += (self.xs[i + 1] - self.xs[i]) * (self.ys[j + 1] - self.ys[j])
        return a

    def covered_area(self, box):
        """Area of `box` inside the region."""
        xs = sorted(set([box[0], box[2]] + [v for v in self.xs if box[0] < v < box[2]]))
        ys = sorted(set([box[1], box[3]] + [v for v in self.ys if box[1] < v < box[3]]))
        a = 0.0
        for i in range(len(xs) - 1):
            for j in range(len(ys) - 1):
                if self.contains((xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2):
                    a += (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j])
        return a

    def corners(self):
        """Convex interior corners: (x, y, sx, sy) with (sx, sy) pointing into the region along both axes."""
        out = []
        for x in self.xs:
            for y in self.ys:
                q = [self.contains(x + sx * 1e-3, y + sy * 1e-3) for sx in (-1, 1) for sy in (-1, 1)]
                if sum(q) == 1:
                    sx = -1 if q[0] or q[1] else 1
                    sy = -1 if q[0] or q[2] else 1
                    out.append((x, y, sx, sy))
        return out


def door_zone_rects(op, wall_t, clear=0.55):
    """Rectangles that must stay free in front of a door or entry: the wall gap extended `clear` metres into both
    rooms. op uses orient/axis/from/to."""
    a, b = op['from'], op['to']
    ax = op['axis']
    h = wall_t / 2 + clear
    if op['orient'] == 'h':
        return [[a, ax - h, b, ax + h]]
    return [[ax - h, a, ax + h, b]]


def swing_polygon(op, wall_t, steps=7):
    """Quarter disc swept by the door leaf (polygon points), or None when the opening has no swing."""
    if not op.get('swing') or not op.get('hinge'):
        return None
    sd = 1 if op['swing'] == '+' else -1
    hd = 1 if op['hinge'] == '+' else -1
    L = min(op['w'], 0.9) if op['kind'] == 'entry' else op['w']
    along = op['c'] + hd * op['w'] / 2
    face = sd * wall_t / 2
    if op['orient'] == 'h':
        hx, hy = along, op['axis'] + face
        closed = (hx - hd * L, hy)
        leaf = (hx, hy + sd * L)
    else:
        hx, hy = op['axis'] + face, along
        closed = (hx, hy - hd * L)
        leaf = (hx + sd * L, hy)
    a0 = math.atan2(closed[1] - hy, closed[0] - hx)
    a1 = math.atan2(leaf[1] - hy, leaf[0] - hx)
    da = (a1 - a0 + math.pi) % (2 * math.pi) - math.pi
    pts = [(hx, hy)]
    for k in range(steps + 1):
        a = a0 + da * k / steps
        pts.append((hx + L * math.cos(a), hy + L * math.sin(a)))
    return pts


def rect_hits_polygon(r, pts):
    """Does rectangle r overlap the convex-ish polygon pts (sampling vertices, edges and the rectangle corners)?"""
    for p in pts:
        if contains(r, p[0], p[1]):
            return True
    cs = [(r[0], r[1]), (r[2], r[1]), (r[2], r[3]), (r[0], r[3]), ((r[0] + r[2]) / 2, (r[1] + r[3]) / 2)]
    if any(point_in_polygon(c[0], c[1], pts) for c in cs):
        return True
    n = len(pts)
    for i in range(n):
        for t in (0.25, 0.5, 0.75):
            x = pts[i][0] + (pts[(i + 1) % n][0] - pts[i][0]) * t
            y = pts[i][1] + (pts[(i + 1) % n][1] - pts[i][1]) * t
            if contains(r, x, y):
                return True
    return False


def cut_box(a, z):
    """Box a minus rectangle z: disjoint pieces (west, east, south and north parts), slivers under 1 cm dropped."""
    c = [[a[0], a[1], min(a[2], z[0]), a[3]], [max(a[0], z[2]), a[1], a[2], a[3]],
         [max(a[0], z[0]), a[1], min(a[2], z[2]), min(a[3], z[1])],
         [max(a[0], z[0]), max(a[1], z[3]), min(a[2], z[2]), a[3]]]
    return [b for b in c if b[2] - b[0] >= 0.01 and b[3] - b[1] >= 0.01]
