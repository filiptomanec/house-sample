"""Exterior elements: wood cladding, terrace screens, outdoor slabs, gravel border, posts."""
from __future__ import annotations

from . import geom as G
from .openings import Frame
from .walls import footprint_polygons, subtract_holes, hole_table, holes_on


def _on_footprint(cfg, mid, tol=2e-3):
    """True when a point lies on the boundary of the house footprint."""
    for poly in footprint_polygons(cfg):
        n = len(poly)
        for k in range(n):
            if G.seg_dist(mid, poly[k], poly[(k + 1) % n]) < tol:
                return True
    return False


def outdoor_top(cfg, kind):
    return cfg.p["outdoor_top"].get(kind, -0.07)


def outdoor_role(kind):
    return {"drive": "drive_paving", "path": "path"}.get(kind, "terrace_paving")


def slab_top_at(cfg, x, y):
    """Top of the outdoor slab under a point (0 when none)."""
    for o in cfg.outdoor:
        x0, y0, x1, y1 = o["rect"]
        if x0 - 1e-6 <= x <= x1 + 1e-6 and y0 - 1e-6 <= y <= y1 + 1e-6:
            return outdoor_top(cfg, o["type"])
    return cfg.p["ground_z"]


# ------------------------------------------------------------------ outdoor slabs, posts
def build_outdoor(cfg, ms):
    zb = cfg.p["outdoor_bottom"]
    for o in cfg.outdoor:
        x0, y0, x1, y1 = o["rect"]
        zt = outdoor_top(cfg, o["type"])
        role = outdoor_role(o["type"])
        skip = []
        sides = {"-x": ((x0, y0), (x0, y1)), "+x": ((x1, y0), (x1, y1)),
                 "-y": ((x0, y0), (x1, y0)), "+y": ((x0, y1), (x1, y1))}
        for name, (a, b) in sides.items():
            mid = ((a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0)
            if _on_footprint(cfg, mid):
                skip.append(name)
        ms.box(role, x0, y0, zb, x1, y1, zt, skip=tuple(skip + ["-z"]), id=o["id"])
        # posts
        ps = cfg.p["post"]
        for (px, py) in o.get("posts", []):
            ms.box("post", px - ps / 2.0, py - ps / 2.0, zt, px + ps / 2.0, py + ps / 2.0, cfg.clear_height,
                   skip=("-z", "+z"), id=o["id"])


# ------------------------------------------------------------------ gravel border
def build_gravel(cfg, ms):
    p = cfg.p
    gw, zt, zb = p["gravel_w"], p["gravel_top"], p["gravel_bottom"]
    house = [tuple(r) for r in cfg.outline.get("rects", [])]
    if not house:
        return
    grown = [(r[0] - gw, r[1] - gw, r[2] + gw, r[3] + gw) for r in house]
    covered = house + [tuple(o["rect"]) for o in cfg.outdoor]
    xs = G.uniq_sorted([v for r in grown + covered for v in (r[0], r[2])])
    ys = G.uniq_sorted([v for r in grown + covered for v in (r[1], r[3])])

    def inside(rects, x, y):
        return any(r[0] < x < r[2] and r[1] < y < r[3] for r in rects)

    cells = set()
    for i in range(len(xs) - 1):
        for j in range(len(ys) - 1):
            cx, cy = (xs[i] + xs[i + 1]) / 2.0, (ys[j] + ys[j + 1]) / 2.0
            if inside(grown, cx, cy) and not inside(covered, cx, cy):
                cells.add((i, j))
    for (i0, j0, i1, j1) in G.merge_cell_rects(cells):
        x0, x1, y0, y1 = xs[i0], xs[i1 + 1], ys[j0], ys[j1 + 1]
        ms.poly("gravel", [(x0, y0, zt), (x1, y0, zt), (x1, y1, zt), (x0, y1, zt)], (0, 0, 1))
    # sides against open ground (not against the house or an outdoor slab)
    def free(i, j):
        if (i, j) in cells:
            return False
        if i < 0 or j < 0 or i >= len(xs) - 1 or j >= len(ys) - 1:
            return True
        cx, cy = (xs[i] + xs[i + 1]) / 2.0, (ys[j] + ys[j + 1]) / 2.0
        return not inside(covered, cx, cy)

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
        mid = ((s0 + s1) / 2.0, face) if a["orient"] == "h" else (face, (s0 + s1) / 2.0)
        top = cfg.roof_top_at(*(mid)) - cfg.slab - 0.012
        # local frame of the wall: reuse Frame via a record that only carries the wall id
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
                # dark backing strip is not needed: the facade plaster shows through the gaps
            else:
                F.quad(ms, "wood_cladding", ra, rb, -ct, -ct, za, zb, (-F.ed[0], -F.ed[1], 0), id=a["id"])


# ------------------------------------------------------------------ screens (vertical slats)
def build_screens(cfg, ms):
    p = cfg.p
    for sc in cfg.screens:
        if sc.get("type") != "slats":
            continue
        c, a0, a1 = sc["at"], sc["from"], sc["to"]
        mid = (c, (a0 + a1) / 2.0) if sc["orient"] == "v" else ((a0 + a1) / 2.0, c)
        z0 = slab_top_at(cfg, *mid)
        z1 = cfg.clear_height
        n = max(1, int((a1 - a0) / cfg.slat_pitch + 1e-6))
        pitch = (a1 - a0) / n
        sw, sd = cfg.slat_w, cfg.slat_d
        rail = 0.05

        def box(s0, s1, d0, d1, za, zb, skip=()):
            if sc["orient"] == "v":
                ms.box("screen_slats", c + d0, s0, za, c + d1, s1, zb, skip=skip, id=sc["id"], uvmode="box_v")
            else:
                ms.box("screen_slats", s0, c + d0, za, s1, c + d1, zb, skip=skip, id=sc["id"], uvmode="box_v")

        for k in range(n):
            sc_ = a0 + (k + 0.5) * pitch
            box(sc_ - sw / 2.0, sc_ + sw / 2.0, -sd / 2.0, sd / 2.0, z0 + rail, z1 - rail, skip=("-z", "+z"))
        box(a0, a1, -sd / 2.0, sd / 2.0, z0, z0 + rail)
        box(a0, a1, -sd / 2.0, sd / 2.0, z1 - rail, z1, skip=("+z",))
