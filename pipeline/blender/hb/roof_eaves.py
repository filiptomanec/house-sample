"""Roof edge details: fascia, gutter, downpipes, soffits (sloped and flat), snow guards and light pipes."""
from __future__ import annotations

import math

from . import geom as G
from .roof_cover import _seam
from .exterior import slab_top_at, area_at

TOGGLE = "roof"


def footprint_rects(cfg):
    rs = [tuple(r) for r in cfg.outline.get("rects", [])]
    if rs:
        return rs
    b = cfg.bbox
    return [(b["x0"], b["y0"], b["x1"], b["y1"])] if b else []


# ------------------------------------------------------------------ sweeps along the roof outline
def loop_geometry(loop):
    """Outward edge normals and miter vectors (scaled so the offset distance holds on both edges) of a CCW loop."""
    n = len(loop)
    en = []
    for i in range(n):
        a, b = loop[i], loop[(i + 1) % n]
        dx, dy = b[0] - a[0], b[1] - a[1]
        l = math.hypot(dx, dy) or 1.0
        en.append((dy / l, -dx / l))
    mv = []
    for i in range(n):
        n1, n2 = en[i - 1], en[i]
        den = max(0.25, 1.0 + n1[0] * n2[0] + n1[1] * n2[1])
        mv.append(((n1[0] + n2[0]) / den, (n1[1] + n2[1]) / den))
    return en, mv


def sweep(ms, role, loop, profile, closed, skip=(), two_sided=False, toggle=TOGGLE, id=None):
    """Extrude a profile [(out, dz)] along a closed loop with mitred corners. For a closed profile in counter-clockwise
    order (out to the right, up) the outward normals are known, so faces come out right; open profiles are two-sided."""
    en, mv = loop_geometry(loop)
    n, m = len(loop), len(profile)
    nseg = m if closed else m - 1

    def S(i, k):
        v, mm = loop[i], mv[i]
        o, dz = profile[k]
        return (v[0] + mm[0] * o, v[1] + mm[1] * o, v[2] + dz)

    for i in range(n):
        j = (i + 1) % n
        for k in range(nseg):
            if k in skip:
                continue
            k2 = (k + 1) % m
            (o1, z1), (o2, z2) = profile[k], profile[k2]
            pts = [S(i, k), S(j, k), S(j, k2), S(i, k2)]
            nout, nz = (z2 - z1), -(o2 - o1)
            normal = None if two_sided else (en[i][0] * nout, en[i][1] * nout, nz)
            ms.poly(role, pts, normal, toggle=toggle, two_sided=two_sided, id=id)


def eave_soffit(cfg, model, v):
    """Soffit height at a point of the eave line (v = (x, y, z of the covering there))."""
    z, pl = model.height(v[0], v[1], tol=1e-4)
    return min(cfg.soffit_z, v[2] - cfg.p["eave_depth"]) if pl is None else model.underside_on(pl, v[0], v[1])


def build_eaves(cfg, ms, model):
    p = cfg.p
    ft, up = p["fascia_t"], p["fascia_up"]
    r = p["gutter_r"]
    for loop in model.loops:
        # fascia board (closed profile, back face against the roof edge left out), from the covering down to the soffit
        depth = max(p["eave_depth"], max(v[2] - eave_soffit(cfg, model, v) for v in loop))
        sweep(ms, "fascia", loop, [(0.0, up), (0.0, -depth), (ft, -depth), (ft, up)], True, skip=(0,))
        # gutter: lower half of a circle hung on the fascia
        seg = max(2, p["gutter_arc"])
        cx, cz = ft + r, -p["gutter_drop"]
        arc = [(cx + r * math.cos(math.pi + math.pi * k / seg), cz + r * math.sin(math.pi + math.pi * k / seg))
               for k in range(seg + 1)]
        sweep(ms, "gutter", loop, arc, False, two_sided=True)


def build_steps(cfg, ms, model):
    """Where the eave of a higher roof stands above a lower roof the surfaces do not meet: close the gap with a board
    (fascia) from the lower surface up to the higher eave."""
    up = cfg.p["fascia_up"]
    for (p, q, phi, plo, lc) in model.steps:
        dx, dy = q[0] - p[0], q[1] - p[1]
        l = math.hypot(dx, dy) or 1.0
        n = (dy / l, -dx / l)
        if n[0] * (lc[0] - p[0]) + n[1] * (lc[1] - p[1]) < 0:
            n = (-n[0], -n[1])                              # facing the lower roof
        pts = [(p[0], p[1], plo.z(*p)), (q[0], q[1], plo.z(*q)), (q[0], q[1], phi.z(*q) + up), (p[0], p[1], phi.z(*p) + up)]
        ms.poly("fascia", pts, (n[0], n[1], 0), toggle=TOGGLE)


def pipe(ms, role, path, rad, sides, toggle=TOGGLE):
    """Round pipe along a polyline that lies in one vertical plane, with mitred joints (open ends)."""
    pts = [tuple(q) for q in path]
    segs = [G.norm(G.sub(pts[i + 1], pts[i])) for i in range(len(pts) - 1)]
    horiz = None
    for d in segs:
        if abs(d[0]) + abs(d[1]) > 1e-6:
            horiz = (d[0], d[1], 0.0)
            break
    e1 = G.norm(G.cross(horiz, (0, 0, 1))) if horiz else (1.0, 0.0, 0.0)   # common to every segment of the plane

    def ring(i, d):
        """Ring of segment direction d at point i, on the mitre plane of the joint."""
        e2 = G.norm(G.cross(d, e1))
        if 0 < i < len(pts) - 1:
            m = G.norm(G.add(segs[i - 1], segs[i]))
        else:
            m = d
        out = []
        for k in range(sides):
            a = 2 * math.pi * k / sides
            q = G.add(pts[i], G.add(G.mul(e1, rad * math.cos(a)), G.mul(e2, rad * math.sin(a))))
            t = -G.dot(G.sub(q, pts[i]), m) / G.dot(d, m)
            out.append(G.add(q, G.mul(d, t)))
        return out, e2

    for j, d in enumerate(segs):
        ra, e2 = ring(j, d)
        rb, _ = ring(j + 1, d)
        for k in range(sides):
            k2 = (k + 1) % sides
            am = 2 * math.pi * (k + 0.5) / sides
            nrm = G.add(G.mul(e1, math.cos(am)), G.mul(e2, math.sin(am)))
            ms.poly(role, [ra[k], ra[k2], rb[k2], rb[k]], nrm, toggle=toggle)


def downpipe_target(cfg, x, y, rad):
    """Where the pipe runs down the facade: at a wall corner when the outlet sits on the eave mitre of that corner (within
    overhang * sqrt 2), else on the nearest wall face; `downpipe_wall_gap` off the wall."""
    off = cfg.p["downpipe_wall_gap"] + rad
    ov = max([r["overhang"] for r in cfg.roofs] or [0.0])
    best = None
    for poly in footprint_polygons_ccw(cfg):
        n = len(poly)
        for k in range(n):
            v = poly[k]
            dv = math.hypot(v[0] - x, v[1] - y)
            if dv <= ov * math.sqrt(2.0) + 0.1:
                n1 = _edge_normal(poly[k - 1], v)
                n2 = _edge_normal(v, poly[(k + 1) % n])
                cand = (dv - 1e3, (v[0] + (n1[0] + n2[0]) * off, v[1] + (n1[1] + n2[1]) * off))
                best = cand if best is None or cand[0] < best[0] else best
        for k in range(n):
            a, b = poly[k], poly[(k + 1) % n]
            t = max(0.0, min(1.0, G.seg_param((x, y), a, b)))
            q = (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
            d = math.hypot(q[0] - x, q[1] - y)
            nn = _edge_normal(a, b)
            cand = (d, (q[0] + nn[0] * off, q[1] + nn[1] * off))
            best = cand if best is None or cand[0] < best[0] else best
    return best[1] if best else (x, y)


def _edge_normal(a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    l = math.hypot(dx, dy) or 1.0
    return (dy / l, -dx / l)                      # outward for a counter-clockwise polygon


def footprint_polygons_ccw(cfg):
    from .walls import footprint_polygons
    out = []
    for poly in footprint_polygons(cfg):
        out.append(poly if G.area2(poly) > 0 else poly[::-1])
    return out


def build_downpipes(cfg, ms, model):
    """Downpipes from the gutter outlets: a swan neck back under the soffit to the wall (`swan_deg` below the horizontal),
    then down the facade into the ground or the slab. A pipe inside a post is hidden."""
    p = cfg.p
    ft, r = p["fascia_t"], p["gutter_r"]
    posts = [(px, py, float(o.get("postSize") or 0.0)) for o in cfg.outdoor for (px, py) in o.get("posts", [])]
    tan = math.tan(math.radians(p["swan_deg"]))
    cos = math.cos(math.radians(p["swan_deg"]))
    for dp in cfg.downpipes:
        x, y = dp["x"], dp["y"]
        rad = dp.get("diameter", 0.1) / 2.0
        if any(abs(x - px) <= ps / 2.0 + 1e-6 and abs(y - py) <= ps / 2.0 + 1e-6 for (px, py, ps) in posts):
            continue                                  # hidden inside a post
        ze, _ = model.height(x, y, tol=1e-4)
        if ze is None:
            continue
        # the outlet sits under the gutter: offset along the mitre of the nearest loop vertex
        pos, eave = (x, y), (x, y, ze)
        for loop in model.loops:
            en, mv = loop_geometry(loop)
            for i, v in enumerate(loop):
                if math.hypot(v[0] - x, v[1] - y) < 0.05:
                    pos = (v[0] + mv[i][0] * (ft + r), v[1] + mv[i][1] * (ft + r))
                    eave = v
        z_top = ze - p["gutter_drop"] - r * 0.5        # a little into the gutter
        tgt = downpipe_target(cfg, x, y, rad)
        zs = slab_top_at(cfg, *tgt)
        z_bot = zs - 0.02 if area_at(cfg, *tgt) is not None else cfg.ground_z - 0.05
        L = math.hypot(tgt[0] - pos[0], tgt[1] - pos[1])
        if L < 0.02:
            path = [(pos[0], pos[1], z_top), (pos[0], pos[1], z_bot)]
        else:
            # leave the gutter vertically until the pipe clears the fascia, then slope back to the wall
            zfb = eave_soffit(cfg, model, eave)
            z1 = min(z_top - 0.05, zfb - 0.01 - rad / cos + r * tan)
            z2 = z1 - L * tan
            path = [(pos[0], pos[1], z_top), (pos[0], pos[1], z1), (tgt[0], tgt[1], z2), (tgt[0], tgt[1], z_bot)]
        pipe(ms, "gutter", path, rad, p["downpipe_sides"])


# ------------------------------------------------------------------ soffits
def _subtract_rects(polys, rects):
    for r in rects:
        hp = G.rect_halfplanes(*r)
        out = []
        for pp in polys:
            out.extend(G.subtract_convex(pp, hp))
        polys = out
    return polys


def build_soffit(cfg, ms, model):
    """Underside of the overhangs (white), outside the footprint and the covered outdoor areas."""
    covered = [tuple(o["rect"]) for o in cfg.outdoor if o.get("covered")]
    cut = footprint_rects(cfg) + covered
    for pc in model.pieces:
        pl = pc.plane
        polys = _subtract_rects([pc.poly], cut)
        out = []
        # the soffit is flat where the covering is high enough above it and follows the slope near a shallow eave: split
        # the piece on the line where the two meet (u = uc) so every polygon stays planar
        uc = (cfg.soffit_z + cfg.p["eave_depth"] - pl.wt) / pl.tan if pl.tan > 1e-9 else -1e9
        for pp in polys:
            lo = G.clip_halfplane(pp, -pl.ix, -pl.iy, -(pl.k - uc))    # u <= uc (sloped part)
            hi = G.clip_halfplane(pp, pl.ix, pl.iy, pl.k - uc)         # u >= uc (flat part)
            out.extend([q for q in (lo, hi) if q])
        for q in out:
            if abs(G.area2(q)) < 1e-5:
                continue
            pts = [(x, y, model.underside_on(pl, x, y)) for (x, y) in q]
            ms.poly("soffit", pts, (0, 0, -1), toggle=TOGGLE)


def build_covered(cfg, ms, model):
    """Flat white soffit over covered outdoor areas, with a beam face along their open sides if the roof is deeper."""
    zc = cfg.soffit_z
    fp = footprint_rects(cfg)
    for o in cfg.outdoor:
        if not o.get("covered"):
            continue
        x0, y0, x1, y1 = o["rect"]
        for pp in _subtract_rects([G.rect_poly(x0, y0, x1, y1)], fp):
            ms.poly("soffit", [(x, y, zc) for (x, y) in pp], (0, 0, -1), toggle=TOGGLE)
        sides = [((x0, y0), (x1, y0), (0, -1)), ((x1, y0), (x1, y1), (1, 0)),
                 ((x1, y1), (x0, y1), (0, 1)), ((x0, y1), (x0, y0), (-1, 0))]
        for (a, b, nrm) in sides:
            mid = ((a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0)
            if any(G.seg_dist(mid, (r[0], r[1]), (r[2], r[1])) < 2e-3 or G.seg_dist(mid, (r[0], r[3]), (r[2], r[3])) < 2e-3
                   or G.seg_dist(mid, (r[0], r[1]), (r[0], r[3])) < 2e-3 or G.seg_dist(mid, (r[2], r[1]), (r[2], r[3])) < 2e-3
                   for r in fp):
                continue
            L = math.hypot(b[0] - a[0], b[1] - a[1])
            n = max(1, int(L / 0.5))
            ts = [k / float(n) for k in range(n + 1)]
            pts = [(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t) for t in ts]
            tops = []
            for (x, y) in pts:
                z, pl = model.height(x, y, tol=1e-4)
                tops.append(zc if pl is None else model.underside_on(pl, x, y))
            for k in range(n):
                if (tops[k] + tops[k + 1]) / 2.0 - zc < 0.01:
                    continue
                ms.poly("soffit", [(pts[k][0], pts[k][1], zc), (pts[k + 1][0], pts[k + 1][1], zc),
                                   (pts[k + 1][0], pts[k + 1][1], tops[k + 1]), (pts[k][0], pts[k][1], tops[k])],
                        (nrm[0], nrm[1], 0), toggle=TOGGLE)


# ------------------------------------------------------------------ snow guards, light pipes
def build_snow_guards(cfg, ms, model):
    p = cfg.p
    kinds = set(cfg.snow_guard_kinds)
    for o in cfg.openings:
        if o.get("kind") not in kinds:
            continue
        w = cfg.wall_by_id.get(o.get("wallId"))
        ns = cfg.wall_outward(w) if w else 0
        if not ns:
            continue
        face = w["at"] + ns * w["t"] / 2.0
        s_mid = (o["from"] + o["to"]) / 2.0

        def at(s, dist):
            return (s, face + ns * dist) if w["orient"] == "h" else (face + ns * dist, s)

        # distance from the facade to the roof edge, along the opening's axis
        lo, hi = 0.0, 40.0
        if model.height(*at(s_mid, 0.02), tol=1e-6)[0] is None:
            continue
        while hi - lo > 1e-3:
            mid = (lo + hi) / 2.0
            if model.height(*at(s_mid, mid), tol=1e-6)[0] is None:
                hi = mid
            else:
                lo = mid
        dist = lo - p["snow_guard_up"]
        if dist < 0.1:
            continue
        s0, s1 = o["from"] - 0.3, o["to"] + 0.3
        n = max(1, int((s1 - s0) / 0.6))
        pts = []
        for k in range(n + 1):
            s = s0 + (s1 - s0) * k / n
            x, y = at(s, dist)
            z, pl = model.height(x, y, tol=1e-6)
            if pl is None:
                pts = []
                break
            pts.append(((x, y, z), pl))
        if not pts:
            continue
        e = (0.0, 1.0, 0.0) if w["orient"] == "h" else (1.0, 0.0, 0.0)     # horizontal, across the bar
        for k in range(n):
            (A, plA), (B, plB) = pts[k], pts[k + 1]
            _seam(ms, A, B, plA.normal(), e, 0.035, 0.05, role="gutter")


def build_lightpipes(cfg, ms, model):
    p = cfg.p
    h = cfg.lightpipe_dome
    n = p["dome_segments"]
    for k, pt in enumerate(cfg.lightpipes):
        x, y = pt["x"], pt["y"]
        rc = pt.get("diameter", cfg.lightpipe_d) / 2.0 + 0.04
        z, pl = model.height(x, y)
        if pl is None:
            continue
        zt = z + rc * pl.tan + 0.07                      # collar top above the highest point of the circle
        zb = z - rc * pl.tan - 0.03
        for i in range(n):
            a0, a1 = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n
            am = (a0 + a1) / 2.0
            P = lambda a, zz: (x + rc * math.cos(a), y + rc * math.sin(a), zz)
            ms.poly("ridge_cap", [P(a0, zb), P(a1, zb), P(a1, zt), P(a0, zt)], (math.cos(am), math.sin(am), 0),
                    toggle=TOGGLE)
        # white dome: spherical cap of height h on the collar
        Rs = (rc * rc + h * h) / (2.0 * h)
        rings = 3
        rs = [rc * (1.0 - j / float(rings)) for j in range(rings + 1)]
        zs = [zt + (math.sqrt(max(0.0, Rs * Rs - r * r)) - (Rs - h)) for r in rs]
        for j in range(rings):
            for i in range(n):
                a0, a1 = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n
                q = [(x + rs[j] * math.cos(a0), y + rs[j] * math.sin(a0), zs[j]),
                     (x + rs[j] * math.cos(a1), y + rs[j] * math.sin(a1), zs[j]),
                     (x + rs[j + 1] * math.cos(a1), y + rs[j + 1] * math.sin(a1), zs[j + 1]),
                     (x + rs[j + 1] * math.cos(a0), y + rs[j + 1] * math.sin(a0), zs[j + 1])]
                if j == rings - 1:
                    q = q[:3]
                am = (a0 + a1) / 2.0
                nz = 0.4 + 0.6 * (j + 1) / rings
                ms.poly("soffit", q, (math.cos(am) * (1 - nz), math.sin(am) * (1 - nz), nz), toggle=TOGGLE)


def build_roof(cfg, ms, model):
    from . import roof_cover as RC
    RC.build_covering(cfg, ms, model)
    RC.build_ridges(cfg, ms, model)
    build_eaves(cfg, ms, model)
    build_steps(cfg, ms, model)
    build_downpipes(cfg, ms, model)
    build_soffit(cfg, ms, model)
    build_covered(cfg, ms, model)
    build_snow_guards(cfg, ms, model)
    build_lightpipes(cfg, ms, model)
