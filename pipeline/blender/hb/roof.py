"""Roof model: hip roofs on rectangles, merged into one surface (max over roofs), as convex planar pieces.

Every roof is a hip roof on the outer-face rectangle `rect`: the plane through `wallTop` at each rectangle edge rises
inwards with the pitch; the roof edge (eave) lies `overhang` outside. Several roofs may overlap (cross hip, covered
entrance): the visible surface is the highest one, valleys appear where they intersect. The model knows
- planes (z = wallTop + tan(pitch) * u, u = distance from the wall line towards the inside),
- pieces: the visible convex polygons of every plane,
- height(x, y) of the covering and the underside,
- edges: ridges/hips (convex), valleys (concave) and the outer boundary loops (eaves).
"""
from __future__ import annotations

import math

from . import geom as G

EPS = 1e-6


class Plane:
    def __init__(self, roof, name, ix, iy, k, tan, wt, ov):
        self.roof, self.name = roof, name
        self.ix, self.iy, self.k = ix, iy, k      # u = ix*x + iy*y + k
        self.tan, self.wt, self.ov = tan, wt, ov

    def u(self, x, y):
        return self.ix * x + self.iy * y + self.k

    def z(self, x, y):
        return self.wt + self.tan * self.u(x, y)

    def normal(self):
        """Unit upward normal of the covering plane."""
        n = (-self.tan * self.ix, -self.tan * self.iy, 1.0)
        return G.norm(n)

    def down(self):
        """Horizontal unit vector pointing down the slope (outwards)."""
        return (-self.ix, -self.iy)


class Piece:
    def __init__(self, plane, poly):
        self.plane = plane
        self.poly = poly          # 2D convex polygon (counter-clockwise)

    def pts3(self, dz=0.0):
        return [(x, y, self.plane.z(x, y) + dz) for (x, y) in self.poly]


class RoofModel:
    def __init__(self, cfg):
        self.cfg = cfg
        self.roofs = cfg.roofs
        self.rects = []
        self.planes = []          # per roof: list of Plane
        for ri, r in enumerate(self.roofs):
            x0, y0, x1, y1 = r["rect"]
            ov = r["overhang"]
            tn = math.tan(math.radians(r["pitch"]))
            wt = r["wallTop"]
            self.rects.append((x0 - ov, y0 - ov, x1 + ov, y1 + ov))
            self.planes.append([
                Plane(ri, "S", 0, 1, -y0, tn, wt, ov),
                Plane(ri, "N", 0, -1, y1, tn, wt, ov),
                Plane(ri, "W", 1, 0, -x0, tn, wt, ov),
                Plane(ri, "E", -1, 0, x1, tn, wt, ov),
            ])
        self.pieces = []
        self._make_pieces()
        self.faces = self._merge_faces()
        self.ridges, self.valleys, self.boundary, self.steps = [], [], [], []
        self._classify_edges()
        self.ridges = _merge_segments(self.ridges)
        self.valleys = _merge_segments(self.valleys)
        self.loops = self._loops()

    # ------------------------------------------------------------------ surface
    def own_region(self, ri, pl):
        """Part of the roof's eave rectangle where plane `pl` is the lowest one (the hip roof's own face)."""
        poly = G.rect_poly(*self.rects[ri])
        for q in self.planes[ri]:
            if q is pl:
                continue
            # keep u_q - u_pl >= 0
            poly = G.clip_halfplane(poly, q.ix - pl.ix, q.iy - pl.iy, q.k - pl.k)
            if not poly:
                break
        return poly

    def _higher_region(self, bi, pl, bi_wins_ties):
        """Convex region where roof bi is higher than plane pl."""
        poly = G.rect_poly(*self.rects[bi])
        for q in self.planes[bi]:
            # z_q - z_pl > 0, as a half-plane (ties handled by a tiny shift)
            a = q.tan * q.ix - pl.tan * pl.ix
            b = q.tan * q.iy - pl.tan * pl.iy
            c = (q.wt + q.tan * q.k) - (pl.wt + pl.tan * pl.k)
            c += 1e-7 if bi_wins_ties else -1e-7
            if abs(a) < 1e-12 and abs(b) < 1e-12:
                if c < 0:
                    return []
                continue
            poly = G.clip_halfplane(poly, a, b, c)
            if not poly:
                return []
        return poly

    def _make_pieces(self):
        for ri, planes in enumerate(self.planes):
            for pl in planes:
                parts = [self.own_region(ri, pl)]
                parts = [p for p in parts if p]
                for bi in range(len(self.roofs)):
                    if bi == ri:
                        continue
                    reg = self._higher_region(bi, pl, bi < ri)
                    if not reg:
                        continue
                    hp = _poly_halfplanes(reg)
                    nxt = []
                    for pc in parts:
                        nxt.extend(G.subtract_convex(pc, hp))
                    parts = nxt
                for pc in parts:
                    if abs(G.area2(pc)) > 1e-5:
                        self.pieces.append(Piece(pl, pc))

    def height(self, x, y, tol=1e-6):
        """(z, plane) of the covering at a point, or (None, None) outside every roof."""
        best, bp = None, None
        for ri, planes in enumerate(self.planes):
            r = self.rects[ri]
            if not (r[0] - tol <= x <= r[2] + tol and r[1] - tol <= y <= r[3] + tol):
                continue
            pl = min(planes, key=lambda q: q.z(x, y))
            z = pl.z(x, y)
            if best is None or z > best + 1e-9:
                best, bp = z, pl
        return best, bp

    def underside(self, x, y, plane=None):
        """Underside height at a point: the covering minus the structure depth (tapering to eave_depth at the eave)."""
        z, pl = self.height(x, y)
        if pl is None:
            return None
        return self.underside_on(pl, x, y)

    def underside_on(self, pl, x, y):
        t0 = self.cfg.slab
        t1 = self.cfg.p["eave_depth"]
        u = pl.u(x, y)
        d = max(0.0, -u)
        frac = min(1.0, d / pl.ov) if pl.ov > 1e-9 else 0.0
        return pl.z(x, y) - t0 + (t0 - t1) * frac

    def _merge_faces(self):
        """Pieces of one plane joined into (possibly concave) polygons: [(plane, polygon)]."""
        by_plane = {}
        for pc in self.pieces:
            by_plane.setdefault(id(pc.plane), (pc.plane, []))[1].append(pc.poly)
        out = []
        for (pl, polys) in by_plane.values():
            for loop in merge_polygons(polys):
                out.append((pl, loop))
        return out

    # ------------------------------------------------------------------ edges
    def _edges_of(self, pc):
        n = len(pc.poly)
        return [(pc.poly[i], pc.poly[(i + 1) % n]) for i in range(n)]

    def _classify_edges(self):
        pcs = self.pieces
        shared = []                                    # (piece i, edge idx, t0, t1, piece j)
        cover = {}                                     # (i, edge idx) -> list of (t0, t1)
        for i, pi in enumerate(pcs):
            for ei, (a0, a1) in enumerate(self._edges_of(pi)):
                for j, pj in enumerate(pcs):
                    if i == j:
                        continue
                    for (b0, b1) in self._edges_of(pj):
                        ov = G.collinear_overlap(a0, a1, b0, b1)
                        if ov is None:
                            continue
                        t0, t1 = G.seg_param(ov[0], a0, a1), G.seg_param(ov[1], a0, a1)
                        cover.setdefault((i, ei), []).append((t0, t1))
                        if i < j and pi.plane is not pj.plane:
                            shared.append((ov, pi, pj))
        for (ov, pi, pj) in shared:
            p, q = ov
            mid = ((p[0] + q[0]) / 2.0, (p[1] + q[1]) / 2.0)
            if abs(pi.plane.z(*mid) - pj.plane.z(*mid)) > 1e-4:
                # the surfaces do not meet here: one roof's eave stands above the other roof ("step")
                hi, lo = (pi, pj) if pi.plane.z(*mid) > pj.plane.z(*mid) else (pj, pi)
                self.steps.append((p, q, hi.plane, lo.plane, G.centroid2(lo.poly)))
                continue
            m = G.centroid2(pj.poly)
            zi, zj = pi.plane.z(*m), pj.plane.z(*m)
            seg = ((p[0], p[1], pi.plane.z(*p)), (q[0], q[1], pi.plane.z(*q)))
            ci = G.centroid2(pi.poly)
            ci = (ci[0], ci[1], pi.plane.z(*ci))
            cj = (m[0], m[1], zj)
            rec = (seg, pi.plane, pj.plane, ci, cj)
            if zj < zi - 1e-7:
                self.ridges.append(rec)
            else:
                self.valleys.append(rec)
        for i, pi in enumerate(pcs):
            for ei, (a0, a1) in enumerate(self._edges_of(pi)):
                iv = sorted(cover.get((i, ei), []))
                cur = 0.0
                free = []
                for (t0, t1) in iv:
                    if t0 > cur + 1e-6:
                        free.append((cur, t0))
                    cur = max(cur, t1)
                if cur < 1.0 - 1e-6:
                    free.append((cur, 1.0))
                for (t0, t1) in free:
                    if (t1 - t0) * math.hypot(a1[0] - a0[0], a1[1] - a0[1]) < 1e-4:
                        continue
                    p = (a0[0] + (a1[0] - a0[0]) * t0, a0[1] + (a1[1] - a0[1]) * t0)
                    q = (a0[0] + (a1[0] - a0[0]) * t1, a0[1] + (a1[1] - a0[1]) * t1)
                    self.boundary.append(((p[0], p[1], pi.plane.z(*p)), (q[0], q[1], pi.plane.z(*q)), pi.plane))

    def _loops(self):
        """Closed outer loops of the roof outline (list of lists of (x, y, z), counter-clockwise, merged collinear)."""
        key = lambda p: (round(p[0], 4), round(p[1], 4))
        adj = {}
        for (p, q, pl) in self.boundary:
            adj.setdefault(key(p), []).append((q, p))
            adj.setdefault(key(q), []).append((p, q))
        used = set()
        loops = []
        for (p, q, pl) in self.boundary:
            if (key(p), key(q)) in used or (key(q), key(p)) in used:
                continue
            loop = [p]
            cur, prev = q, p
            used.add((key(p), key(q)))
            guard = 0
            while key(cur) != key(loop[0]) and guard < 1000:
                guard += 1
                loop.append(cur)
                nxt = None
                for (r, _) in adj.get(key(cur), []):
                    if key(r) == key(prev):
                        continue
                    if (key(cur), key(r)) in used or (key(r), key(cur)) in used:
                        continue
                    nxt = r
                    break
                if nxt is None:
                    break
                used.add((key(cur), key(nxt)))
                prev, cur = cur, nxt
            loops.append(loop)
        out = []
        for lp in loops:
            lp = _merge_collinear(lp)
            if len(lp) < 3:
                continue
            if G.area2([(v[0], v[1]) for v in lp]) < 0:
                lp = lp[::-1]
            out.append(lp)
        return out


def _poly_halfplanes(poly):
    """Half-planes (a, b, c) with a*x + b*y + c >= 0 describing a convex counter-clockwise polygon."""
    hp = []
    n = len(poly)
    for i in range(n):
        (x0, y0), (x1, y1) = poly[i], poly[(i + 1) % n]
        a, b = -(y1 - y0), (x1 - x0)
        l = math.hypot(a, b)
        if l < 1e-12:
            continue
        a, b = a / l, b / l
        hp.append((a, b, -(a * x0 + b * y0)))
    return hp


def _merge_collinear(loop):
    pts = list(loop)
    changed = True
    while changed and len(pts) > 3:
        changed = False
        for i in range(len(pts)):
            a, b, c = pts[i - 1], pts[i], pts[(i + 1) % len(pts)]
            cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
            if abs(cr) < 1e-7:
                del pts[i]
                changed = True
                break
    return pts


def check_against_derived(cfg, model, tol=2e-3):
    """Compare the roof faces built here with derived.roofPlanes (the kernel's own decomposition): plan area per plane
    (roof id + side). Returns a list of messages, empty when they agree (or when derived has no roofPlanes)."""
    planes = cfg.derived.get("roofPlanes")
    if not planes:
        return []
    want = {}
    for f in planes:
        key = (f.get("roofId"), f.get("side"))
        want[key] = want.get(key, 0.0) + float(f.get("planArea", 0.0))
    got = {}
    for (pl, poly) in model.faces:
        key = (cfg.roofs[pl.roof]["id"], pl.name)
        got[key] = got.get(key, 0.0) + abs(G.area2(poly))
    out = []
    for key in sorted(set(want) | set(got), key=str):
        a, b = want.get(key, 0.0), got.get(key, 0.0)
        if abs(a - b) > tol * max(1.0, a):
            out.append("roof face %s.%s: plan area %.3f here, %.3f in derived.roofPlanes" % (key[0], key[1], b, a))
    return out


def _key(p, nd=5):
    return (round(p[0], nd), round(p[1], nd))


def merge_polygons(polys):
    """Union of convex polygons that tile a region exactly (shared edges may be split differently): interior edges cancel,
    the remaining boundary edges are chained into loops. Returns counter-clockwise loops."""
    verts = [p for poly in polys for p in poly]
    directed = []
    for poly in polys:
        n = len(poly)
        for i in range(n):
            a, b = poly[i], poly[(i + 1) % n]
            on = []
            for v in verts:
                if _key(v) in (_key(a), _key(b)):
                    continue
                if G.seg_dist(v, a, b) < 1e-6:
                    on.append((G.seg_param(v, a, b), v))
            chain = [a] + [v for (_, v) in sorted(on)] + [b]
            for k in range(len(chain) - 1):
                directed.append((chain[k], chain[k + 1]))
    have = {}
    for (a, b) in directed:
        have[(_key(a), _key(b))] = (a, b)
    rest = {}
    for (ka, kb), (a, b) in have.items():
        if (kb, ka) in have:
            continue
        rest.setdefault(ka, []).append((a, b))
    loops = []
    used = set()
    for ka in sorted(rest):
        for (a, b) in rest[ka]:
            if (_key(a), _key(b)) in used:
                continue
            loop = [a]
            cur = (a, b)
            guard = 0
            while guard < 10000:
                guard += 1
                used.add((_key(cur[0]), _key(cur[1])))
                nxt = None
                for cand in rest.get(_key(cur[1]), []):
                    if (_key(cand[0]), _key(cand[1])) not in used:
                        nxt = cand
                        break
                if nxt is None:
                    break
                loop.append(nxt[0])
                cur = nxt
                if _key(cur[1]) == _key(loop[0]):
                    used.add((_key(cur[0]), _key(cur[1])))
                    break
            loops.append(loop)
    out = []
    for lp in loops:
        lp = _merge_collinear([(p[0], p[1], 0.0) for p in lp])
        poly = [(p[0], p[1]) for p in lp]
        if len(poly) >= 3 and G.area2(poly) > 1e-6:
            out.append(poly)
    return out


def _merge_segments(recs):
    """Join collinear touching ridge/valley records of the same pair of planes."""
    recs = list(recs)
    merged = True
    while merged:
        merged = False
        for i in range(len(recs)):
            for j in range(i + 1, len(recs)):
                (a0, a1), p1, p2, c1, c2 = recs[i]
                (b0, b1), q1, q2, d1, d2 = recs[j]
                if {id(p1), id(p2)} != {id(q1), id(q2)}:
                    continue
                for (x0, x1, y0, y1) in ((a0, a1, b0, b1), (a1, a0, b0, b1), (a0, a1, b1, b0), (a1, a0, b1, b0)):
                    # x0-x1 followed by y0-y1 when x1 == y0
                    if G.length(G.sub(x1, y0)) < 1e-6:
                        d = G.norm(G.sub(x1, x0))
                        e = G.norm(G.sub(y1, y0))
                        if G.dot(d, e) > 1 - 1e-9:
                            recs[i] = ((x0, y1), p1, p2, c1, c2)
                            del recs[j]
                            merged = True
                            break
                if merged:
                    break
            if merged:
                break
    return recs
