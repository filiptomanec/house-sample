"""Walls, floors, ceilings and the plinth from derived.json.

All walls are turned into axis-aligned rectangles (axis +- thickness/2, ends extended by half the thickness of the
perpendicular walls that meet there) and merged on a grid: the union has clean corners and T-junctions, every boundary
face exists exactly once (no coplanar overlaps, no z-fighting). Openings are cut out of the boundary faces.
"""
from __future__ import annotations

from . import geom as G

TOL = 1e-6


class Structure:
    """Result of the wall grid: lets other modules ask what is where."""

    def __init__(self):
        self.xs, self.ys = [], []
        self.height = {}       # (i, j) -> wall top for covered cells
        self.ext_cell = set()  # covered cells that belong to an exterior wall
        self.rects = []        # (x0, y0, x1, y1, top, wall)

    def cell_center(self, i, j):
        return ((self.xs[i] + self.xs[i + 1]) / 2.0, (self.ys[j] + self.ys[j + 1]) / 2.0)


def wall_rects(cfg):
    out = []
    for w in cfg.walls:
        th = w["t"]
        a = w["at"]
        ends = []
        for coord in (w["from"], w["to"]):
            ext = 0.0
            for v in cfg.walls:
                if v["orient"] == w["orient"]:
                    continue
                if abs(v["at"] - coord) < TOL and v["from"] - TOL <= a <= v["to"] + TOL:
                    ext = max(ext, v["t"] / 2.0)
            ends.append(ext)
        lo, hi = w["from"] - ends[0], w["to"] + ends[1]
        if w["orient"] == "h":
            r = (lo, a - th / 2.0, hi, a + th / 2.0)
        else:
            r = (a - th / 2.0, lo, a + th / 2.0, hi)
        out.append((r, w))
    return out


def hole_table(cfg):
    """{(orient, line): [(s0, s1, z0, z1, id)]} for both faces of every wall that has openings."""
    tab = {}
    for o in cfg.openings:
        w = cfg.wall_by_id.get(o.get("wallId"))
        if w is None:
            continue
        for sgn in (-1, 1):
            line = round(w["at"] + sgn * w["t"] / 2.0, 6)
            tab.setdefault((w["orient"], line), []).append((o["from"], o["to"], o["sill"], o["head"], o["id"]))
    return tab


def holes_on(tab, orient, line):
    for (ori, ln), lst in tab.items():
        if ori == orient and abs(ln - line) < 1e-5:
            return lst
    return []


def subtract_holes(s0, s1, z0, z1, holes):
    """Rectangle [s0,s1]x[z0,z1] minus non-overlapping rectangular holes -> list of rectangles."""
    hs = sorted(((max(h[0], s0), min(h[1], s1), max(h[2], z0), min(h[3], z1)) for h in holes
                 if h[1] > s0 + TOL and h[0] < s1 - TOL and h[3] > z0 + TOL and h[2] < z1 - TOL))
    out = []
    cur = s0
    for (a, b, lo, hi) in hs:
        if a > cur + TOL:
            out.append((cur, a, z0, z1))
        if lo > z0 + TOL:
            out.append((a, b, z0, lo))
        if hi < z1 - TOL:
            out.append((a, b, hi, z1))
        cur = max(cur, b)
    if s1 > cur + TOL:
        out.append((cur, s1, z0, z1))
    return out


def build_grid(cfg):
    st = Structure()
    rects = wall_rects(cfg)
    inset = cfg.p["wall_top_inset"]
    xs, ys = [], []
    for (r, w) in rects:
        xs += [r[0], r[2]]
        ys += [r[1], r[3]]
    net = [r for rs in cfg.net_rects.values() for r in rs]
    for r in net:
        xs += [r[0], r[2]]
        ys += [r[1], r[3]]
    st.xs, st.ys = G.uniq_sorted(xs), G.uniq_sorted(ys)
    for (r, w) in rects:
        top = cfg.wall_top(w) - inset
        st.rects.append((r[0], r[1], r[2], r[3], top, w))
        i0, i1 = G.snap_index(st.xs, r[0]), G.snap_index(st.xs, r[2])
        j0, j1 = G.snap_index(st.ys, r[1]), G.snap_index(st.ys, r[3])
        for i in range(i0, i1):
            for j in range(j0, j1):
                cur = st.height.get((i, j))
                st.height[(i, j)] = top if cur is None else max(cur, top)
                if w.get("ext"):
                    st.ext_cell.add((i, j))
    # the net rooms are free floor: corner caps of thick walls never reach into them
    for r in net:
        i0, i1 = G.snap_index(st.xs, r[0]), G.snap_index(st.xs, r[2])
        j0, j1 = G.snap_index(st.ys, r[1]), G.snap_index(st.ys, r[3])
        for i in range(i0, i1):
            for j in range(j0, j1):
                st.height.pop((i, j), None)
                st.ext_cell.discard((i, j))
    return st


def _is_interior(cfg, st, i, j):
    x, y = st.cell_center(i, j)
    return cfg.room_at(x, y) is not None


def build_walls(cfg, ms, st):
    """Boundary faces of the wall union (plaster outside, plaster_in inside) and the wall tops."""
    nx, ny = len(st.xs) - 1, len(st.ys) - 1
    tab = hole_table(cfg)
    ph = cfg.p["plinth_h"]
    segs = {}

    def add(orient, li, sign, zlo, zhi, cls, k):
        segs.setdefault((orient, li, sign, round(zlo, 6), round(zhi, 6), cls), []).append(k)

    h = st.height
    # horizontal grid lines (faces normal to y), run along x
    for j in range(ny + 1):
        for i in range(nx):
            hb = h.get((i, j - 1)) if j > 0 else None
            ha = h.get((i, j)) if j < ny else None
            if hb is None and ha is None:
                continue
            if hb is not None and ha is None:
                cls = "in" if (j < ny and _is_interior(cfg, st, i, j)) else "ext"
                add("h", j, 1, 0.0, hb, cls, i)
            elif ha is not None and hb is None:
                cls = "in" if (j > 0 and _is_interior(cfg, st, i, j - 1)) else "ext"
                add("h", j, -1, 0.0, ha, cls, i)
            elif abs(ha - hb) > TOL:
                if hb < ha:
                    add("h", j, 1, hb, ha, "ext", i)
                else:
                    add("h", j, -1, ha, hb, "ext", i)
    # vertical grid lines (faces normal to x), run along y
    for i in range(nx + 1):
        for j in range(ny):
            hl = h.get((i - 1, j)) if i > 0 else None
            hr = h.get((i, j)) if i < nx else None
            if hl is None and hr is None:
                continue
            if hl is not None and hr is None:
                cls = "in" if (i < nx and _is_interior(cfg, st, i, j)) else "ext"
                add("v", i, 1, 0.0, hl, cls, j)
            elif hr is not None and hl is None:
                cls = "in" if (i > 0 and _is_interior(cfg, st, i - 1, j)) else "ext"
                add("v", i, -1, 0.0, hr, cls, j)
            elif abs(hr - hl) > TOL:
                if hl < hr:
                    add("v", i, 1, hl, hr, "ext", j)
                else:
                    add("v", i, -1, hr, hl, "ext", j)

    for (orient, li, sign, zlo, zhi, cls), ks in sorted(segs.items()):
        ks = sorted(ks)
        runs, start, prev = [], ks[0], ks[0]
        for k in ks[1:]:
            if k != prev + 1:
                runs.append((start, prev))
                start = k
            prev = k
        runs.append((start, prev))
        role = "plaster_in" if cls == "in" else "plaster"
        line = st.ys[li] if orient == "h" else st.xs[li]
        holes = holes_on(tab, orient, line)
        for (ka, kb) in runs:
            if orient == "h":
                s0, s1 = st.xs[ka], st.xs[kb + 1]
            else:
                s0, s1 = st.ys[ka], st.ys[kb + 1]
            for (a, b, z0, z1) in subtract_holes(s0, s1, zlo, zhi, holes):
                # exterior faces: the lowest part of the wall is the plinth (own material)
                cuts = [(z0, z1, role)]
                if cls == "ext" and zlo < 1e-9 and z0 < ph < z1:
                    cuts = [(z0, ph, "slab"), (ph, z1, role)]
                elif cls == "ext" and zlo < 1e-9 and z1 <= ph + 1e-9:
                    cuts = [(z0, z1, "slab")]
                for (c0, c1, r_) in cuts:
                    if orient == "h":
                        pts = [(a, line, c0), (b, line, c0), (b, line, c1), (a, line, c1)]
                        nrm = (0, sign, 0)
                    else:
                        pts = [(line, a, c0), (line, b, c0), (line, b, c1), (line, a, c1)]
                        nrm = (sign, 0, 0)
                    ms.poly(r_, pts, nrm)
                if cls == "in" and cfg.p["skirting"] and zlo < 1e-9 and z0 < 1e-9 and b - a > 0.05:
                    # skirting board; walls along y are 0.1 mm lower so the tops of boards meeting in a corner never coincide
                    sk_h = cfg.p["skirting_h"] + (0.0001 if orient == "v" else 0.0)
                    sk_t = cfg.p["skirting_t"]
                    if orient == "h":
                        y0_, y1_ = (line, line + sign * sk_t) if sign > 0 else (line + sign * sk_t, line)
                        ms.box("plaster_in", a, y0_, 0.0, b, y1_, sk_h, skip=("-z", "-y" if sign > 0 else "+y"))
                    else:
                        x0_, x1_ = (line, line + sign * sk_t) if sign > 0 else (line + sign * sk_t, line)
                        ms.box("plaster_in", x0_, a, 0.0, x1_, b, sk_h, skip=("-z", "-x" if sign > 0 else "+x"))

    # wall tops: merge cells of equal height / kind
    groups = {}
    for (i, j), top in h.items():
        groups.setdefault((round(top, 6), (i, j) in st.ext_cell), set()).add((i, j))
    for (top, ext), cells in sorted(groups.items()):
        for (i0, j0, i1, j1) in G.merge_cell_rects(cells):
            x0, x1, y0, y1 = st.xs[i0], st.xs[i1 + 1], st.ys[j0], st.ys[j1 + 1]
            ms.poly("plaster" if ext else "plaster_in", [(x0, y0, top), (x1, y0, top), (x1, y1, top), (x0, y1, top)],
                    (0, 0, 1))


def room_cells(cfg, st):
    """{room id: set of free grid cells inside the room (the net floor)}."""
    out = {}
    nx, ny = len(st.xs) - 1, len(st.ys) - 1
    for i in range(nx):
        for j in range(ny):
            if (i, j) in st.height:
                continue
            x, y = st.cell_center(i, j)
            rid = cfg.room_at(x, y)
            if rid is not None:
                out.setdefault(rid, set()).add((i, j))
    return out


def build_floors_and_ceilings(cfg, ms, st):
    cells = room_cells(cfg, st)
    for rid in sorted(cells):
        room = cfg.room_by_id[rid]
        role = cfg.floor_role(room)
        rects = G.merge_cell_rects(cells[rid])
        for (i0, j0, i1, j1) in rects:
            x0, x1, y0, y1 = st.xs[i0], st.xs[i1 + 1], st.ys[j0], st.ys[j1 + 1]
            ms.poly(role, [(x0, y0, 0.0), (x1, y0, 0.0), (x1, y1, 0.0), (x0, y1, 0.0)], (0, 0, 1), id=rid)
        # ceiling: top of the walls above the room minus the slab (= the clear height)
        cx, cy = st.cell_center(*sorted(cells[rid])[0])
        zc = cfg.roof_top_at(cx, cy) - cfg.slab
        for (i0, j0, i1, j1) in rects:
            x0, x1, y0, y1 = st.xs[i0], st.xs[i1 + 1], st.ys[j0], st.ys[j1 + 1]
            ms.poly("ceiling", [(x0, y0, zc), (x1, y0, zc), (x1, y1, zc), (x0, y1, zc)], (0, 0, -1), toggle="roof")
    return cells


def check_floor_areas(cfg, st, cells, tol=2e-3):
    """Net floor area of every room (free grid cells) against derived.rooms[].area: messages when they differ."""
    out = []
    for rid, cs in sorted(cells.items()):
        area = sum((st.xs[i + 1] - st.xs[i]) * (st.ys[j + 1] - st.ys[j]) for (i, j) in cs)
        want = cfg.room_by_id[rid].get("area")
        if want is not None and abs(area - want) > tol * max(1.0, want):
            out.append("room %s: floor area %.3f here, %.3f in derived" % (rid, area, want))
    missing = [r["id"] for r in cfg.rooms if r["id"] not in cells]
    return out + ["room %s has no floor cells" % rid for rid in missing]


def footprint_polygons(cfg):
    polys = cfg.outline.get("polygons")
    if polys:
        return [[tuple(p) for p in pg["pts"]] for pg in polys]
    # fall back to the outline rectangles (each becomes its own prism)
    return [G.rect_poly(*r) for r in cfg.outline.get("rects", [])]


def build_plinth(cfg, ms):
    """Slab/plinth under the house: z from -depth to 0 (top face omitted: the floors lie on it)."""
    depth = cfg.p["plinth_depth"]
    for poly in footprint_polygons(cfg):
        if G.area2(poly) < 0:
            poly = poly[::-1]
        n = len(poly)
        for k in range(n):
            (x0, y0), (x1, y1) = poly[k], poly[(k + 1) % n]
            dx, dy = x1 - x0, y1 - y0
            ms.poly("slab", [(x0, y0, -depth), (x1, y1, -depth), (x1, y1, 0.0), (x0, y0, 0.0)], (dy, -dx, 0))
        ms.poly("slab", [(x, y, -depth) for (x, y) in poly], (0, 0, -1))
