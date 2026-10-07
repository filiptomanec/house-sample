"""Small pure-Python geometry helpers (no numpy, no bpy): vectors, convex polygon clipping, rectangle utilities."""
from __future__ import annotations

import math

EPS = 1e-6


# ---------------------------------------------------------------- vectors
def sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def add(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def mul(a, k):
    return (a[0] * k, a[1] * k, a[2] * k)


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def length(a):
    return math.sqrt(dot(a, a))


def norm(a):
    n = length(a)
    return (a[0] / n, a[1] / n, a[2] / n) if n > 1e-12 else (0.0, 0.0, 0.0)


def lerp(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(len(a)))


def newell(pts):
    """Unnormalised normal of a (planar) polygon, counter-clockwise = pointing at the viewer."""
    nx = ny = nz = 0.0
    n = len(pts)
    for i in range(n):
        a, b = pts[i], pts[(i + 1) % n]
        nx += (a[1] - b[1]) * (a[2] + b[2])
        ny += (a[2] - b[2]) * (a[0] + b[0])
        nz += (a[0] - b[0]) * (a[1] + b[1])
    return (nx, ny, nz)


# ---------------------------------------------------------------- 2D polygons
def area2(poly):
    """Signed area of a 2D polygon (positive = counter-clockwise)."""
    s = 0.0
    n = len(poly)
    for i in range(n):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % n]
        s += x0 * y1 - x1 * y0
    return s / 2.0


def centroid2(poly):
    n = len(poly)
    return (sum(p[0] for p in poly) / n, sum(p[1] for p in poly) / n)


def rect_poly(x0, y0, x1, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def clip_halfplane(poly, a, b, c):
    """Part of a convex 2D polygon with a*x + b*y + c >= 0 (Sutherland-Hodgman). Returns [] when empty."""
    out = []
    n = len(poly)
    if n == 0:
        return out
    for i in range(n):
        p, q = poly[i], poly[(i + 1) % n]
        dp = a * p[0] + b * p[1] + c
        dq = a * q[0] + b * q[1] + c
        if dp >= -EPS:
            out.append(p)
        if (dp > EPS and dq < -EPS) or (dp < -EPS and dq > EPS):
            t = dp / (dp - dq)
            out.append((p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t))
    return clean_poly(out)


def clean_poly(poly, tol=1e-7):
    """Drop repeated and collinear vertices; [] when the polygon degenerates (area ~ 0)."""
    pts = []
    for p in poly:
        if not pts or abs(p[0] - pts[-1][0]) > tol or abs(p[1] - pts[-1][1]) > tol:
            pts.append(p)
    while len(pts) > 1 and abs(pts[0][0] - pts[-1][0]) <= tol and abs(pts[0][1] - pts[-1][1]) <= tol:
        pts.pop()
    changed = True
    while changed and len(pts) >= 3:
        changed = False
        for i in range(len(pts)):
            a, b, c = pts[i - 1], pts[i], pts[(i + 1) % len(pts)]
            cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
            if abs(cr) <= 1e-9:
                del pts[i]
                changed = True
                break
    if len(pts) < 3 or abs(area2(pts)) < 1e-9:
        return []
    return pts


def subtract_convex(poly, halfplanes):
    """Convex polygon minus the convex region ∩ {a*x + b*y + c >= 0}; returns a list of convex polygons."""
    pieces = []
    rest = poly
    for (a, b, c) in halfplanes:
        if not rest:
            break
        outside = clip_halfplane(rest, -a, -b, -c)
        if outside:
            pieces.append(outside)
        rest = clip_halfplane(rest, a, b, c)
    return pieces


def rect_halfplanes(x0, y0, x1, y1):
    return [(1, 0, -x0), (-1, 0, x1), (0, 1, -y0), (0, -1, y1)]


def point_in_rect(x, y, r, tol=0.0):
    return r[0] - tol <= x <= r[2] + tol and r[1] - tol <= y <= r[3] + tol


def seg_param(p, a, b):
    """Parameter t of the projection of p on the segment a-b (2D)."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    l2 = dx * dx + dy * dy
    return ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 if l2 > 0 else 0.0


def seg_dist(p, a, b):
    t = max(0.0, min(1.0, seg_param(p, a, b)))
    return math.hypot(p[0] - (a[0] + (b[0] - a[0]) * t), p[1] - (a[1] + (b[1] - a[1]) * t))


def collinear_overlap(a0, a1, b0, b1, tol=1e-6):
    """Overlap of two 2D segments lying on one (infinite) line: returns (p, q) in the direction of a0->a1, or None."""
    dx, dy = a1[0] - a0[0], a1[1] - a0[1]
    l = math.hypot(dx, dy)
    if l < tol:
        return None
    for b in (b0, b1):
        if abs((b[0] - a0[0]) * dy - (b[1] - a0[1]) * dx) / l > tol:
            return None
    t0, t1 = seg_param(b0, a0, a1), seg_param(b1, a0, a1)
    lo, hi = max(0.0, min(t0, t1)), min(1.0, max(t0, t1))
    if (hi - lo) * l < 1e-4:
        return None
    return ((a0[0] + dx * lo, a0[1] + dy * lo), (a0[0] + dx * hi, a0[1] + dy * hi))


def uniq_sorted(vals, tol=1e-6):
    out = []
    for v in sorted(vals):
        if not out or v - out[-1] > tol:
            out.append(v)
    return out


def snap_index(sorted_vals, v, tol=1e-6):
    """Index of v in a sorted list of snapped coordinates (nearest within tol), else -1."""
    lo, hi = 0, len(sorted_vals) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if abs(sorted_vals[mid] - v) <= tol:
            return mid
        if sorted_vals[mid] < v:
            lo = mid + 1
        else:
            hi = mid - 1
    return -1


def merge_cell_rects(cells):
    """Greedy merge of grid cells {(i, j)} into rectangles (i0, j0, i1, j1) with inclusive index ranges."""
    left = set(cells)
    rects = []
    for (i, j) in sorted(left, key=lambda c: (c[1], c[0])):
        if (i, j) not in left:
            continue
        i1 = i
        while (i1 + 1, j) in left:
            i1 += 1
        j1 = j
        while all((k, j1 + 1) in left for k in range(i, i1 + 1)):
            j1 += 1
        for jj in range(j, j1 + 1):
            for ii in range(i, i1 + 1):
                left.discard((ii, jj))
        rects.append((i, j, i1, j1))
    return rects
