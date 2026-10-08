"""Exterior elements: outdoor slabs (paving, ramps, timber decks, pools), posts, gravel border, timber cladding, the louvre
wall and the heat-pump outdoor unit.

Every level comes from the data: slab tops from `derived.outdoor[].grade` (flat or a ramp plane with corner heights), pools
from `derived.outdoor[].pool`, the ground around the house from the site plateau level (`cfg.ground_z`), the louvre blades
from `derived.screens[]` (positions, chord, thickness, rest angle, `z0`/`z1`), the unit from `derived.outdoorUnit`. Only
construction details (edge depth, board width, edging size) are in `params.py`.
"""
from __future__ import annotations

import math

from . import geom as G
from .openings import Frame
from .walls import footprint_polygons, subtract_holes, hole_table, holes_on

PAVED_EDGING_ROLES = ("terrace_paving", "drive_paving", "path")


def _on_footprint(cfg, mid, tol=2e-3):
    """True when a point lies on the boundary of the house footprint."""
    for poly in footprint_polygons(cfg):
        n = len(poly)
        for k in range(n):
            if G.seg_dist(mid, poly[k], poly[(k + 1) % n]) < tol:
                return True
    return False


def _in_poly(poly, x, y):
    """Point in a simple polygon (even-odd rule)."""
    inside = False
    n = len(poly)
    for i in range(n):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % n]
        if (y0 > y) != (y1 > y) and x < x0 + (y - y0) * (x1 - x0) / (y1 - y0):
            inside = not inside
    return inside


def _in_house(cfg, x, y):
    return any(G.point_in_rect(x, y, r) for r in cfg.outline.get("rects", []))


def area_at(cfg, x, y, skip_holes=True):
    """The outdoor area whose slab covers a plan point (pools and their coping first, holes excluded), or None."""
    best = None
    for o in cfg.outdoor:
        if o.get("pool") and G.point_in_rect(x, y, o["pool"]["outer"]):
            return o
        if not G.point_in_rect(x, y, o["rect"]):
            continue
        if skip_holes and any(G.point_in_rect(x, y, h, tol=-1e-6) for h in o.get("holes", [])):
            continue
        best = best or o
    return best


def slab_top_at(cfg, x, y):
    """Top of the outdoor slab under a point (the derived grade plane); the ground level when there is none."""
    o = area_at(cfg, x, y)
    if o is None:
        return cfg.ground_z
    if o.get("pool"):
        return float(o["pool"]["copingTop"])
    return cfg.grade_z(o, x, y)


def _covered(cfg, o, x, y):
    """Something other than open ground lies at a point next to the edge of area `o`: the house, another outdoor area, a
    hole of `o` (a pool), or a paved surface of the site (aprons to the gates, service path)."""
    if _in_house(cfg, x, y):
        return True
    for q in cfg.outdoor:
        if q is o:
            if any(G.point_in_rect(x, y, h) for h in q.get("holes", [])):
                return True
            continue
        if G.point_in_rect(x, y, q["rect"]) or (q.get("pool") and G.point_in_rect(x, y, q["pool"]["outer"])):
            return True
    return any(_in_poly(pv, x, y) for pv in cfg.site_paved)


def free_runs(cfg, o, a, b, n, step=0.05, probe=0.02):
    """Parts of the segment a-b (on the boundary of area `o`, outward normal n) that border open ground: [(t0, t1)] in
    0..1. The segment is sampled every `step` metres and probed `probe` metres outside."""
    L = math.hypot(b[0] - a[0], b[1] - a[1])
    k = max(1, int(math.ceil(L / step)))
    runs, start = [], None
    for i in range(k):
        t = (i + 0.5) / k
        x = a[0] + (b[0] - a[0]) * t + n[0] * probe
        y = a[1] + (b[1] - a[1]) * t + n[1] * probe
        free = not _covered(cfg, o, x, y)
        if free and start is None:
            start = i / k
        if not free and start is not None:
            runs.append((start, i / k))
            start = None
    if start is not None:
        runs.append((start, 1.0))
    return [(t0, t1) for (t0, t1) in runs if (t1 - t0) * L > 1e-3]


def _pieces(o):
    """Plan polygons of an area: its rect minus its holes (convex pieces)."""
    polys = [G.rect_poly(*o["rect"])]
    for h in o.get("holes", []):
        hp = G.rect_halfplanes(*h)
        nxt = []
        for pp in polys:
            nxt.extend(G.subtract_convex(pp, hp))
        polys = nxt
    return polys


def _rect_edges(r):
    """Edges of a rect, counter-clockwise, with outward normals."""
    x0, y0, x1, y1 = r
    return [((x0, y0), (x1, y0), (0, -1)), ((x1, y0), (x1, y1), (1, 0)),
            ((x1, y1), (x0, y1), (0, 1)), ((x0, y1), (x0, y0), (-1, 0))]


def _side(ms, role, a, b, n, za, zb, depth, id=None, uvmode="box"):
    """Vertical face along a-b (outward normal n) from the top heights za/zb down by `depth`."""
    ms.poly(role, [(a[0], a[1], za - depth), (b[0], b[1], zb - depth), (b[0], b[1], zb), (a[0], a[1], za)],
            (n[0], n[1], 0), id=id, uvmode=uvmode)


def _edging(ms, cfg, a, b, n, za, zb):
    """Steel edging strip outside a slab edge: its top follows the slab top, `edging_h` deep, `edging_t` thick."""
    t, h = cfg.p["edging_t"], cfg.p["edging_h"]
    oa = (a[0] + n[0] * t, a[1] + n[1] * t)
    ob = (b[0] + n[0] * t, b[1] + n[1] * t)
    ms.poly("frame", [(oa[0], oa[1], za - h), (ob[0], ob[1], zb - h), (ob[0], ob[1], zb), (oa[0], oa[1], za)], (n[0], n[1], 0))
    ms.poly("frame", [(a[0], a[1], za), (b[0], b[1], zb), (ob[0], ob[1], zb), (oa[0], oa[1], za)], (0, 0, 1))
    d = G.norm((b[0] - a[0], b[1] - a[1], 0.0))
    ms.poly("frame", [(a[0], a[1], za - h), (oa[0], oa[1], za - h), (oa[0], oa[1], za), (a[0], a[1], za)], (-d[0], -d[1], 0))
    ms.poly("frame", [(b[0], b[1], zb - h), (ob[0], ob[1], zb - h), (ob[0], ob[1], zb), (b[0], b[1], zb)], (d[0], d[1], 0))


def _free_edges(cfg, o, rect):
    """[(a, b, n)] sub-segments of the rect edges of area `o` that border open ground."""
    out = []
    for (a, b, n) in _rect_edges(rect):
        for (t0, t1) in free_runs(cfg, o, a, b, n):
            pa = (a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0)
            pb = (a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1)
            out.append((pa, pb, n))
    return out


# ------------------------------------------------------------------ outdoor slabs
def build_outdoor(cfg, ms):
    for o in cfg.outdoor:
        if o.get("pool"):
            build_pool(cfg, ms, o)
        elif o["role"] == "deck":
            build_deck(cfg, ms, o)
        else:
            build_paving(cfg, ms, o)
        build_posts(cfg, ms, o)


def build_paving(cfg, ms, o):
    """A paved slab: planar top from the grade (flat or a ramp), 0.15 m edges and steel edging where it borders ground."""
    role, oid = o["role"], o["id"]
    z = lambda x, y: cfg.grade_z(o, x, y)
    for pp in _pieces(o):
        ms.poly(role, [(x, y, z(x, y)) for (x, y) in pp], (0, 0, 1), id=oid)
    for (a, b, n) in _free_edges(cfg, o, o["rect"]):
        za, zb = z(*a), z(*b)
        _side(ms, role, a, b, n, za, zb, cfg.p["slab_edge"], id=oid)
        if role in PAVED_EDGING_ROLES:
            _edging(ms, cfg, a, b, n, za, zb)


def deck_tile(cfg):
    """Metres per repeat of the deck texture: so many board pitches that one board maps onto one texture board."""
    p = cfg.p
    return p["deck_texture_boards"] * (p["deck_board"] + p["deck_gap"])


def build_deck(cfg, ms, o):
    """Timber deck: boards along x (high detail) or a textured top (lite) at the grade top; timber fascia on free edges."""
    p, oid = cfg.p, o["id"]
    z = lambda x, y: cfg.grade_z(o, x, y)
    x0, y0, x1, y1 = o["rect"]
    pieces = _pieces(o)
    if p["deck_boards"]:
        bw, gap, bt, blen = p["deck_board"], p["deck_gap"], p["deck_t"], p["deck_board_len"]
        pitch = bw + gap
        rows = max(1, int(round((y1 - y0) / pitch)))
        pitch = (y1 - y0) / rows                 # boards spread over the depth: the edge boards are not slivers
        bw = pitch - gap
        nt = p["deck_texture_boards"]
        tile = deck_tile(cfg)
        delta = 0.07                             # texture rows have a dark joint line at their edge: keep the board inside
        for k in range(rows):
            ya, yb = y0 + k * pitch + gap / 2.0, y0 + (k + 1) * pitch - gap / 2.0
            off = ((k * 0.618034) % 1.0) * blen  # staggered end joints, the same for every build
            xs = [x0]
            xj = x0 + off
            while xj < x1 - 0.3:
                if xj > x0 + 0.3:
                    xs.append(xj)
                xj += blen
            xs.append(x1)
            r = k % nt
            for j in range(len(xs) - 1):
                ba = xs[j] + (gap / 2.0 if j > 0 else 0.0)
                bb = xs[j + 1] - (gap / 2.0 if j < len(xs) - 2 else 0.0)
                board = G.rect_poly(ba, ya, bb, yb)
                for pp in pieces:
                    q = _clip_convex(board, pp)
                    if not q:
                        continue
                    qx0, qx1 = min(v[0] for v in q), max(v[0] for v in q)
                    qy0, qy1 = min(v[1] for v in q), max(v[1] for v in q)
                    if qx1 - qx0 < 0.02 or qy1 - qy0 < 0.02:
                        continue

                    def uv(x, y):
                        f = (y - ya) / (yb - ya)
                        return (x, tile * (r + delta + f * (1 - 2 * delta)) / nt)
                    top = [(x, y, z(x, y)) for (x, y) in G.rect_poly(qx0, qy0, qx1, qy1)]
                    ms.poly("deck", top, (0, 0, 1), uv=[uv(x, y) for (x, y, _) in top], id=oid)
                    for (a, b, n) in _rect_edges((qx0, qy0, qx1, qy1)):
                        mid = ((a[0] + b[0]) / 2.0 + n[0] * 0.01, (a[1] + b[1]) / 2.0 + n[1] * 0.01)
                        if not _in_rect(mid, o["rect"]) or any(G.point_in_rect(mid[0], mid[1], h) for h in o["holes"]):
                            continue                  # the outer edge of the deck gets the fascia below
                        _side(ms, "deck", a, b, n, z(*a), z(*b), bt, id=oid)
        # substructure seen through the board gaps (dark)
        for pp in pieces:
            ms.poly("slab", [(x, y, z(x, y) - bt) for (x, y) in pp], (0, 0, 1), id=None)
    else:
        for pp in pieces:
            ms.poly("deck", [(x, y, z(x, y)) for (x, y) in pp], (0, 0, 1), id=oid)
    for (a, b, n) in _free_edges(cfg, o, o["rect"]):
        _side(ms, "deck", a, b, n, z(*a), z(*b), p["slab_edge"], id=oid, uvmode="box")


def _in_rect(p, r):
    return r[0] - 1e-9 <= p[0] <= r[2] + 1e-9 and r[1] - 1e-9 <= p[1] <= r[3] + 1e-9


def _clip_convex(poly, clip):
    """Intersection of two convex polygons (clip must be counter-clockwise)."""
    out = poly
    n = len(clip)
    for i in range(n):
        (ax, ay), (bx, by) = clip[i], clip[(i + 1) % n]
        # inside = left of a->b
        out = G.clip_halfplane(out, -(by - ay), bx - ax, (by - ay) * ax - (bx - ax) * ay)
        if not out:
            return []
    return out


def build_pool(cfg, ms, o):
    """Pool: coping ring with an overhang over the basin wall, basin liner down to the floor, water plane."""
    p, oid = cfg.p, o["id"]
    pl = o["pool"]
    W = pl["water"]
    ct = float(pl["copingTop"])
    tc, ov = p["coping_t"], p["coping_overhang"]
    B = (W[0] - ov, W[1] - ov, W[2] + ov, W[3] + ov)
    zf, zw = float(pl["floorZ"]), float(pl["waterZ"])
    zl = ct - tc                                   # underside of the coping lip = top of the basin wall
    # coping: top ring, inner lip face, lip underside
    for q in G.subtract_convex(G.rect_poly(*pl["outer"]), G.rect_halfplanes(*W)):
        ms.poly("pool_coping", [(x, y, ct) for (x, y) in q], (0, 0, 1), id=oid)
    for (a, b, n) in _rect_edges(W):
        _side(ms, "pool_coping", a, b, (-n[0], -n[1]), ct, ct, tc, id=oid)
    for q in G.subtract_convex(G.rect_poly(*B), G.rect_halfplanes(*W)):
        ms.poly("pool_coping", [(x, y, zl) for (x, y) in q], (0, 0, -1), id=oid)
    # an outer edge of the coping that borders open ground (a pool not set into a deck) gets a side
    for (a, b, n) in _free_edges(cfg, o, pl["outer"]):
        _side(ms, "pool_coping", a, b, n, ct, ct, p["slab_edge"], id=oid)
    # basin: walls facing the water and the floor
    for (a, b, n) in _rect_edges(B):
        ms.poly("pool_liner", [(a[0], a[1], zf), (b[0], b[1], zf), (b[0], b[1], zl), (a[0], a[1], zl)], (-n[0], -n[1], 0), id=oid)
    ms.poly("pool_liner", [(x, y, zf) for (x, y) in G.rect_poly(*B)], (0, 0, 1), id=oid)
    # water surface (the web swaps in its own material)
    ms.poly("water", [(x, y, zw) for (x, y) in G.rect_poly(*B)], (0, 0, 1), id=oid)


def build_posts(cfg, ms, o):
    """Square posts (`postSize`) from the slab top to the soffit."""
    ps = o.get("postSize")
    if not o.get("posts") or not ps:
        return
    ps = float(ps)
    for (px, py) in o["posts"]:
        zt = cfg.grade_z(o, px, py)
        ms.box("post", px - ps / 2.0, py - ps / 2.0, zt, px + ps / 2.0, py + ps / 2.0, cfg.soffit_z,
               skip=("-z", "+z"), id=o["id"])


# ------------------------------------------------------------------ gravel border
def build_gravel(cfg, ms):
    p = cfg.p
    gw = p["gravel_w"]
    zt, zb = cfg.ground_z + p["gravel_up"], cfg.ground_z - p["gravel_depth"]
    house = [tuple(r) for r in cfg.outline.get("rects", [])]
    if not house:
        return
    grown = [(r[0] - gw, r[1] - gw, r[2] + gw, r[3] + gw) for r in house]
    covered = house + [tuple(o["rect"]) for o in cfg.outdoor] + \
        [tuple(o["pool"]["outer"]) for o in cfg.pools]
    gx0, gy0 = min(r[0] for r in grown), min(r[1] for r in grown)
    gx1, gy1 = max(r[2] for r in grown), max(r[3] for r in grown)
    xs_in = [v for r in grown + covered for v in (r[0], r[2])]
    ys_in = [v for r in grown + covered for v in (r[1], r[3])]
    for pv in cfg.site_paved:
        xs_in += [q[0] for q in pv if gx0 < q[0] < gx1]
        ys_in += [q[1] for q in pv if gy0 < q[1] < gy1]
    xs, ys = G.uniq_sorted(xs_in), G.uniq_sorted(ys_in)

    def inside(rects, x, y):
        return any(r[0] < x < r[2] and r[1] < y < r[3] for r in rects)

    def blocked(x, y):
        return inside(covered, x, y) or any(_in_poly(pv, x, y) for pv in cfg.site_paved)

    cells = set()
    for i in range(len(xs) - 1):
        for j in range(len(ys) - 1):
            cx, cy = (xs[i] + xs[i + 1]) / 2.0, (ys[j] + ys[j + 1]) / 2.0
            if inside(grown, cx, cy) and not blocked(cx, cy):
                cells.add((i, j))
    for (i0, j0, i1, j1) in G.merge_cell_rects(cells):
        x0, x1, y0, y1 = xs[i0], xs[i1 + 1], ys[j0], ys[j1 + 1]
        ms.poly("gravel", [(x0, y0, zt), (x1, y0, zt), (x1, y1, zt), (x0, y1, zt)], (0, 0, 1))

    # sides against open ground (not against the house or a slab)
    def free(i, j):
        if (i, j) in cells:
            return False
        if i < 0 or j < 0 or i >= len(xs) - 1 or j >= len(ys) - 1:
            return True
        cx, cy = (xs[i] + xs[i + 1]) / 2.0, (ys[j] + ys[j + 1]) / 2.0
        return not blocked(cx, cy) and not _in_house(cfg, cx, cy)

    for (i, j) in sorted(cells):
        x0, x1, y0, y1 = xs[i], xs[i + 1], ys[j], ys[j + 1]
        if free(i - 1, j):
            ms.poly("gravel", [(x0, y0, zb), (x0, y1, zb), (x0, y1, zt), (x0, y0, zt)], (-1, 0, 0))
        if free(i + 1, j):
            ms.poly("gravel", [(x1, y0, zb), (x1, y1, zb), (x1, y1, zt), (x1, y0, zt)], (1, 0, 0))
        if free(i, j - 1):
            ms.poly("gravel", [(x0, y0, zb), (x1, y0, zb), (x1, y0, zt), (x0, y0, zt)], (0, -1, 0))
        if free(i, j + 1):
            ms.poly("gravel", [(x0, y1, zb), (x1, y1, zb), (x1, y1, zt), (x0, y1, zt)], (0, 1, 0))


# ------------------------------------------------------------------ wood cladding
def build_cladding(cfg, ms):
    """Vertical boards in front of the facade where `accents` say so; interrupted by openings (kept above their heads)."""
    p = cfg.p
    tab = hole_table(cfg)
    for a in cfg.accents:
        w = cfg.wall_by_id.get(a.get("wallId"))
        if w is None or not cfg.wall_outward(w):
            continue
        c = a["cx"] if a["orient"] == "h" else a["cy"]
        s0, s1 = c - a["w"] / 2.0, c + a["w"] / 2.0
        ns = cfg.wall_outward(w)
        face = w["at"] + ns * w["t"] / 2.0
        top = cfg.soffit_z - 0.012                 # just under the flat soffit of the overhang
        F = Frame(cfg, {"wallId": w["id"]})
        holes = holes_on(tab, w["orient"], round(face, 6))
        rects = subtract_holes(s0, s1, 0.0, top, holes)
        ct, board, pitch = p["clad_t"], p["clad_board"], p["clad_pitch"]
        for (ra, rb, za, zb) in rects:
            width = rb - ra
            if width < 0.02 or zb - za < 0.02:
                continue
            skip = ["+d"]
            if za <= 1e-6:
                skip.append("-z")
            if zb >= top - 1e-6:
                skip.append("+z")
            if p["clad_boards"]:
                n = max(1, int(width / pitch + 0.5))
                pw = width / n
                gap = min(p["clad_edge_gap"] * 2 + (pitch - board), pw * 0.4)
                for k in range(n):
                    sa = ra + k * pw + gap / 2.0
                    sb_ = ra + (k + 1) * pw - gap / 2.0
                    F.box(ms, "wood_cladding", sa, sb_, -ct, 0.0, za, zb, skip=tuple(skip), id=a["id"])
            else:
                F.quad(ms, "wood_cladding", ra, rb, -ct, -ct, za, zb, (-F.ed[0], -F.ed[1], 0), id=a["id"])


# ------------------------------------------------------------------ louvre wall (turning blades between rails)
def blade_corners(screen, centre, deg, chord, thick):
    """Plan corners of one blade turned by `deg` from the wall plane (counter-clockwise from the screen axis, the
    convention of the web), counter-clockwise."""
    base = math.pi / 2.0 if screen["orient"] == "v" else 0.0
    phi = base + math.radians(deg)
    u = (math.cos(phi), math.sin(phi))
    v = (-u[1], u[0])
    hc, ht = chord / 2.0, thick / 2.0
    cx, cy = centre
    return [(cx - u[0] * hc - v[0] * ht, cy - u[1] * hc - v[1] * ht), (cx + u[0] * hc - v[0] * ht, cy + u[1] * hc - v[1] * ht),
            (cx + u[0] * hc + v[0] * ht, cy + u[1] * hc + v[1] * ht), (cx - u[0] * hc + v[0] * ht, cy - u[1] * hc + v[1] * ht)]


def build_screens(cfg, ms):
    p = cfg.p
    for sc in cfg.screens:
        if sc.get("type") != "slats":
            continue
        c, a0, a1 = sc["at"], sc["from"], sc["to"]
        bl = sc.get("blades") or {}
        mid = (c, (a0 + a1) / 2.0) if sc["orient"] == "v" else ((a0 + a1) / 2.0, c)
        z0 = float(sc["z0"]) if sc.get("z0") is not None else slab_top_at(cfg, *mid)
        z1 = float(sc["z1"]) if sc.get("z1") is not None else cfg.soffit_z
        chord = float(bl.get("chord", cfg.slat_d))
        thick = float(bl.get("thickness", cfg.slat_w))
        positions = bl.get("positions")
        if not positions:
            n = max(1, int((a1 - a0) / cfg.slat_pitch + 1e-6))
            positions = [a0 + (k + 0.5) * (a1 - a0) / n for k in range(n)]
        deg = float(sc.get("restDeg", (cfg.house.get("shading") or {}).get("slats", {}).get("restDeg", 90)))
        rh, rd = p["rail_h"], max(p["rail_d"], chord + 0.02)

        def rail(za, zb, skip):
            if sc["orient"] == "v":
                ms.box("screen_rail", c - rd / 2.0, a0, za, c + rd / 2.0, a1, zb, skip=skip, id=sc["id"])
            else:
                ms.box("screen_rail", a0, c - rd / 2.0, za, a1, c + rd / 2.0, zb, skip=skip, id=sc["id"])

        rail(z0, z0 + rh, ("-z",))
        rail(z1 - rh, z1, ("+z",))
        bz0, bz1 = z0 + rh + 0.004, z1 - rh - 0.004
        base = math.pi / 2.0 if sc["orient"] == "v" else 0.0
        phi = base + math.radians(deg)
        ud = (math.cos(phi), math.sin(phi))                     # along the blade (its chord)
        for i, s in enumerate(positions):
            centre = (c, s) if sc["orient"] == "v" else (s, c)
            q = blade_corners(sc, centre, deg, chord, thick)
            # grain along the blade height: v = z; u across the blade, shifted per blade so neighbouring blades show
            # different parts of the timber texture (a fixed, seedless sequence)
            off = (i * 0.618034 % 1.0) * 1.7

            def u_of(x, y):
                dx, dy = x - centre[0], y - centre[1]
                return off + dx * ud[0] + dy * ud[1] + 0.5 * (-dx * ud[1] + dy * ud[0])
            for k in range(4):
                (xa, ya), (xb, yb) = q[k], q[(k + 1) % 4]
                pts = [(xa, ya, bz0), (xb, yb, bz0), (xb, yb, bz1), (xa, ya, bz1)]
                ms.poly("screen_slats", pts, (yb - ya, -(xb - xa), 0), id=sc["id"],
                        uv=[(u_of(x, y), z) for (x, y, z) in pts])


# ------------------------------------------------------------------ heat-pump outdoor unit
def build_outdoor_unit(cfg, ms):
    """The unit (role `equipment`) on a small pad, its fan towards the open side, inside a slatted timber screen."""
    u = cfg.outdoor_unit
    if not u:
        return
    p = cfg.p
    fp = [tuple(q) for q in u["footprint"]]
    x0, x1 = min(q[0] for q in fp), max(q[0] for q in fp)
    y0, y1 = min(q[1] for q in fp), max(q[1] for q in fp)
    zg = float(u.get("z", cfg.ground_z))
    h = float(u["size"][2])
    zp = zg + p["unit_pad"]
    ms.box("equipment", x0 - 0.05, y0 - 0.05, zg - 0.05, x1 + 0.05, y1 + 0.05, zp, skip=("-z",))
    ms.box("equipment", x0, y0, zp, x1, y1, zp + h, skip=("-z",))
    # front = the long side facing away from the house (largest distance to the outline)
    sides = _rect_edges((x0, y0, x1, y1))

    def dist_to_house(pt):
        best = 1e9
        for poly in footprint_polygons(cfg):
            for k in range(len(poly)):
                best = min(best, G.seg_dist(pt, poly[k], poly[(k + 1) % len(poly)]))
        return best

    def probe(e):
        a, b, n = e
        return ((a[0] + b[0]) / 2.0 + n[0] * 0.5, (a[1] + b[1]) / 2.0 + n[1] * 0.5)

    front = max(sides, key=lambda e: (math.hypot(e[1][0] - e[0][0], e[1][1] - e[0][1]) > 0.6, dist_to_house(probe(e))))
    back = [e for e in sides if e[2] == (-front[2][0], -front[2][1])][0]
    # fan: a recessed ring on the front face
    a, b, n = front
    cx, cy = (a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0
    along = G.norm((b[0] - a[0], b[1] - a[1], 0.0))
    L = math.hypot(b[0] - a[0], b[1] - a[1])
    r = min(L, h) * 0.36
    zc = zp + h * 0.5
    seg = 16 if cfg.lod == "high" else 10
    inset = 0.02
    for k in range(seg):
        t0, t1 = 2 * math.pi * k / seg, 2 * math.pi * (k + 1) / seg
        P = lambda t, d: (cx + along[0] * r * math.cos(t) - n[0] * d, cy + along[1] * r * math.cos(t) - n[1] * d,
                          zc + r * math.sin(t))
        tm = (t0 + t1) / 2.0
        # ring wall from the face into the recess, facing the axis
        ms.poly("equipment", [P(t0, -0.001), P(t1, -0.001), P(t1, inset), P(t0, inset)],
                (-along[0] * math.cos(tm), -along[1] * math.cos(tm), -math.sin(tm)))
    ms.poly("equipment", [(cx + along[0] * r * math.cos(2 * math.pi * k / seg) - n[0] * inset,
                           cy + along[1] * r * math.cos(2 * math.pi * k / seg) - n[1] * inset,
                           zc + r * math.sin(2 * math.pi * k / seg)) for k in range(seg)], (n[0], n[1], 0))
    # slatted screen on every side except the back (towards the wall)
    if not p["unit_slats"]:
        return
    g = p["unit_screen_gap"]
    sx0, sy0, sx1, sy1 = x0 - g, y0 - g, x1 + g, y1 + g
    zt = zp + h + p["unit_screen_up"]
    sw, sp, st = p["unit_slat_w"], p["unit_slat_pitch"], p["unit_slat_t"]
    bn = back[2]
    for (ea, eb, en) in _rect_edges((sx0, sy0, sx1, sy1)):
        if en == bn:
            continue
        L = math.hypot(eb[0] - ea[0], eb[1] - ea[1])
        cnt = max(2, int(L / sp))
        d = ((eb[0] - ea[0]) / L, (eb[1] - ea[1]) / L)
        for k in range(cnt):
            s = (k + 0.5) * L / cnt
            px, py = ea[0] + d[0] * s, ea[1] + d[1] * s
            hx = abs(d[0]) * sw / 2.0 + abs(en[0]) * st / 2.0
            hy = abs(d[1]) * sw / 2.0 + abs(en[1]) * st / 2.0
            ms.box("wood_cladding", px - hx, py - hy, zg - 0.02, px + hx, py + hy, zt, skip=("-z",), id="unit")
        # two battens behind the slats (towards the unit)
        off = st / 2.0 + 0.015
        cut = off + 0.02                       # battens of neighbouring sides must not overlap at the corners
        ax0, ax1 = sorted((ea[0] - en[0] * off + d[0] * cut, eb[0] - en[0] * off - d[0] * cut))
        ay0, ay1 = sorted((ea[1] - en[1] * off + d[1] * cut, eb[1] - en[1] * off - d[1] * cut))
        ex, ey = abs(en[0]) * 0.015, abs(en[1]) * 0.015
        for zb in (zg + 0.15, zt - 0.12):
            ms.box("wood_cladding", ax0 - ex, ay0 - ey, zb, ax1 + ex, ay1 + ey, zb + 0.06, id="unit")
