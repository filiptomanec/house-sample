"""Roof covering: standing-seam sheets (default) or concrete-tile courses, ridge/hip caps and valley flashings."""
from __future__ import annotations

import math

from . import geom as G
from .roof import _poly_halfplanes

TOGGLE = "roof"
LIFT = 0.006


def plane_uv(pl, x, y):
    """Roof UV in metres: u along the eave, v along the slope."""
    e = (-pl.iy, pl.ix)
    cos_p = 1.0 / math.sqrt(1.0 + pl.tan ** 2)
    return (e[0] * x + e[1] * y, (pl.ix * x + pl.iy * y) / cos_p)


def _line_clip(halfplanes, origin, direction):
    """Parameter range [lo, hi] of the line origin + s*direction inside a convex polygon (a*x+b*y+c >= 0), or None."""
    lo, hi = -1e9, 1e9
    for (a, b, c) in halfplanes:
        k0 = a * origin[0] + b * origin[1] + c
        k1 = a * direction[0] + b * direction[1]
        if abs(k1) < 1e-12:
            if k0 < -1e-9:
                return None
            continue
        s = -k0 / k1
        if k1 > 0:
            lo = max(lo, s)
        else:
            hi = min(hi, s)
    if hi - lo < 1e-4:
        return None
    return lo, hi


def _seam(ms, A, B, n, e, sw, sh, role="roof_tile", drop=0.0):
    """Trapezoid prism along A->B (3D, in a roof plane with unit normal n and horizontal across-vector e)."""
    d = G.norm(G.sub(B, A))
    hw, tw = sw / 2.0, sw * 0.32

    def P(base, across, up):
        return (base[0] + e[0] * across + n[0] * up, base[1] + e[1] * across + n[1] * up,
                base[2] + e[2] * across + n[2] * up)

    a_bl, a_br, a_tl, a_tr = P(A, -hw, -drop), P(A, hw, -drop), P(A, -tw, sh - drop), P(A, tw, sh - drop)
    b_bl, b_br, b_tl, b_tr = P(B, -hw, -drop), P(B, hw, -drop), P(B, -tw, sh - drop), P(B, tw, sh - drop)
    T, to = TOGGLE, role
    ms.poly(to, [a_bl, b_bl, b_tl, a_tl], G.add(G.mul(e, -1), n), toggle=T)
    ms.poly(to, [a_br, b_br, b_tr, a_tr], G.add(e, n), toggle=T)
    ms.poly(to, [a_tl, b_tl, b_tr, a_tr], n, toggle=T)
    ms.poly(to, [a_bl, a_br, a_tr, a_tl], G.mul(d, -1), toggle=T)
    ms.poly(to, [b_bl, b_br, b_tr, b_tl], d, toggle=T)


def build_covering(cfg, ms, model):
    p = cfg.p
    steel = "steel" in str(cfg.covering) or "seam" in str(cfg.covering)
    for (pl, poly) in model.faces:
        if steel and p["seams"]:
            dz = -p["seam_h"] / pl.normal()[2]         # sheet lies one seam height below the nominal surface
        elif not steel and p["courses"]:
            dz = -(p["course_step"] + 0.004)
        else:
            dz = 0.0
        pts = [(x, y, pl.z(x, y) + dz) for (x, y) in poly]
        uv = [plane_uv(pl, x, y) for (x, y, _) in pts]
        ms.poly("roof_tile", pts, (0, 0, 1), uv=uv, toggle=TOGGLE)
    if steel and p["seams"]:
        build_seams(cfg, ms, model)
    elif not steel and p["courses"]:
        build_courses(cfg, ms, model)


def build_seams(cfg, ms, model):
    """Standing seams along the slope every seam_pitch; pieces of one plane are joined so a seam is never cut where the
    plane was split by another roof."""
    p = cfg.p
    pitch, sw, sh = p["seam_pitch"], p["seam_w"], p["seam_h"]
    by_plane = {}
    for pc in model.pieces:
        by_plane.setdefault(id(pc.plane), (pc.plane, []))[1].append(pc)
    for (pl, pcs) in by_plane.values():
        e = (-pl.iy, pl.ix)
        nin = (pl.ix, pl.iy)
        full = model.own_region(pl.roof, pl)
        ts = [e[0] * x + e[1] * y for (x, y) in full]
        tc = (min(ts) + max(ts)) / 2.0
        n3 = pl.normal()
        e3 = (e[0], e[1], 0.0)
        segs = {}
        for pc in pcs:
            tp = [e[0] * x + e[1] * y for (x, y) in pc.poly]
            hp = _poly_halfplanes(pc.poly)
            k0 = int(math.ceil((min(tp) - tc) / pitch + 1e-9))
            k1 = int(math.floor((max(tp) - tc) / pitch - 1e-9))
            for k in range(k0, k1 + 1):
                t = tc + k * pitch
                origin = (t * e[0], t * e[1])
                rng = _line_clip(hp, origin, nin)
                if rng is not None:
                    segs.setdefault(k, []).append((rng[0], rng[1], origin))
        for k, lst in sorted(segs.items()):
            lst.sort()
            merged = [list(lst[0])]
            for (lo, hi, origin) in lst[1:]:
                if lo <= merged[-1][1] + 1e-4:
                    merged[-1][1] = max(merged[-1][1], hi)
                else:
                    merged.append([lo, hi, origin])
            for (lo, hi, origin) in merged:
                A = (origin[0] + nin[0] * lo, origin[1] + nin[1] * lo)
                B = (origin[0] + nin[0] * hi, origin[1] + nin[1] * hi)
                _seam(ms, (A[0], A[1], pl.z(*A)), (B[0], B[1], pl.z(*B)), n3, e3, sw, sh, drop=sh)


def build_courses(cfg, ms, model):
    """Concrete-tile covering: rows (courses) with a small riser at the lower edge of each course."""
    p = cfg.p
    gauge, step = p["course_gauge"], p["course_step"]
    for pc in model.pieces:
        pl = pc.plane
        cos_p = 1.0 / math.sqrt(1.0 + pl.tan ** 2)
        gp = gauge * cos_p                            # course height in plan
        full = model.own_region(pl.roof, pl)
        us = [pl.ix * x + pl.iy * y for (x, y) in full]
        u_top = max(us)
        us_p = [pl.ix * x + pl.iy * y for (x, y) in pc.poly]
        k0 = int(math.floor((u_top - max(us_p)) / gp))
        k1 = int(math.ceil((u_top - min(us_p)) / gp))
        for k in range(k0, k1 + 1):
            hi_u, lo_u = u_top - k * gp, u_top - (k + 1) * gp
            poly = G.clip_halfplane(pc.poly, pl.ix, pl.iy, -lo_u)
            poly = G.clip_halfplane(poly, -pl.ix, -pl.iy, hi_u) if poly else []
            if not poly:
                continue
            pts = []
            for (x, y) in poly:
                u = pl.ix * x + pl.iy * y
                f = min(1.0, max(0.0, (hi_u - u) / gp))        # 0 at the upper edge .. 1 at the nose
                if k == 0:
                    off = -step * f
                else:
                    off = -step + step * f
                pts.append((x, y, pl.z(x, y) + off + 0.001))
            uv = [plane_uv(pl, x, y) for (x, y, _) in pts]
            ms.poly("roof_tile", pts, (0, 0, 1), uv=uv, toggle=TOGGLE)
            # riser at the nose: between this course's lower edge (0) and the next course's upper edge (-step)
            low = [(x, y) for (x, y) in poly if abs(pl.ix * x + pl.iy * y - lo_u) < 1e-6]
            if len(low) >= 2 and k >= 1:
                a, b = low[0], low[1]
                za = pl.z(*a) + 0.001
                zb = pl.z(*b) + 0.001
                d = pl.down()
                ms.poly("roof_tile", [(a[0], a[1], za), (b[0], b[1], zb), (b[0], b[1], zb - step), (a[0], a[1], za - step)],
                        (d[0], d[1], 0), toggle=TOGGLE)


def _across(edge_t, mid, centroid):
    """Unit vector in the plane, perpendicular to the edge, pointing from the edge towards the piece centroid."""
    v = G.sub(centroid, mid)
    v = G.sub(v, G.mul(edge_t, G.dot(v, edge_t)))
    return G.norm(v)


def build_ridges(cfg, ms, model):
    """Caps on ridges and hips (convex edges) and flashing strips along valleys (concave edges)."""
    p = cfg.p
    w, h = p["ridge_w"], p["ridge_h"]
    for (seg, p1, p2, c1, c2) in model.ridges:
        Ea, Eb = seg
        t = G.norm(G.sub(Eb, Ea))
        mid = G.mul(G.add(Ea, Eb), 0.5)
        n1, n2 = p1.normal(), p2.normal()
        d1, d2 = _across(t, mid, c1), _across(t, mid, c2)
        c = G.dot(n1, n2)
        x = G.mul(G.add(n1, n2), h / (1.0 + c))

        def at(E, d, n, ww=w, hh=h):
            return G.add(G.add(E, G.mul(d, ww)), G.mul(n, hh))

        for (n, d) in ((n1, d1), (n2, d2)):
            ms.poly("ridge_cap", [G.add(Ea, x), G.add(Eb, x), at(Eb, d, n), at(Ea, d, n)], n, toggle=TOGGLE)
            base_a, base_b = G.add(Ea, G.mul(d, w)), G.add(Eb, G.mul(d, w))
            ms.poly("ridge_cap", [at(Ea, d, n), at(Eb, d, n), base_b, base_a], d, toggle=TOGGLE)
        for (E, sgn) in ((Ea, -1), (Eb, 1)):
            cap = [G.add(E, G.mul(d1, w)), at(E, d1, n1), G.add(E, x), at(E, d2, n2), G.add(E, G.mul(d2, w))]
            ms.poly("ridge_cap", cap, G.mul(t, sgn), toggle=TOGGLE)
    vw = p["valley_w"]
    for (seg, p1, p2, c1, c2) in model.valleys:
        Ea, Eb = seg
        t = G.norm(G.sub(Eb, Ea))
        mid = G.mul(G.add(Ea, Eb), 0.5)
        for (pl, cc) in ((p1, c1), (p2, c2)):
            n = pl.normal()
            d = _across(t, mid, cc)
            lift = G.mul(n, 0.012)
            ms.poly("ridge_cap", [G.add(Ea, lift), G.add(Eb, lift), G.add(G.add(Eb, G.mul(d, vw)), lift),
                                  G.add(G.add(Ea, G.mul(d, vw)), lift)], n, toggle=TOGGLE)
