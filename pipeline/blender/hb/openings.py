"""Openings: reveals, frames, glazing, sills, entry door, garage door, sliding walls and interior doors.

Local coordinates of an opening: s along the wall (global x or y), d depth measured inwards from the outer face
(0 = outer face, t = inner face; for interior doors the "outer" side is arbitrary), z height.
"""
from __future__ import annotations

from . import geom as G


class Frame:
    """Local <-> global mapping for one wall."""

    def __init__(self, cfg, o):
        w = cfg.wall_by_id[o["wallId"]]
        self.w = w
        self.orient = w["orient"]
        self.a = w["at"]
        self.t = w["t"]
        out = cfg.wall_outward(w)
        self.exterior = out != 0
        self.ns = out if out != 0 else 1
        if self.orient == "h":
            self.es, self.ed = (1, 0, 0), (0, -self.ns, 0)
        else:
            self.es, self.ed = (0, 1, 0), (-self.ns, 0, 0)

    def pt(self, s, d, z):
        c = self.a + self.ns * (self.t / 2.0 - d)
        return (s, c, z) if self.orient == "h" else (c, s, z)

    def box(self, ms, role, s0, s1, d0, d1, z0, z1, skip=(), id=None, toggle=None):
        if s1 - s0 < 1e-7 or d1 - d0 < 1e-7 or z1 - z0 < 1e-7:
            return
        P, es, ed = self.pt, self.es, self.ed
        neg = lambda v: (-v[0], -v[1], -v[2])
        faces = {
            "-s": ([P(s0, d0, z0), P(s0, d1, z0), P(s0, d1, z1), P(s0, d0, z1)], neg(es)),
            "+s": ([P(s1, d0, z0), P(s1, d1, z0), P(s1, d1, z1), P(s1, d0, z1)], es),
            "-d": ([P(s0, d0, z0), P(s1, d0, z0), P(s1, d0, z1), P(s0, d0, z1)], neg(ed)),
            "+d": ([P(s0, d1, z0), P(s1, d1, z0), P(s1, d1, z1), P(s0, d1, z1)], ed),
            "-z": ([P(s0, d0, z0), P(s1, d0, z0), P(s1, d1, z0), P(s0, d1, z0)], (0, 0, -1)),
            "+z": ([P(s0, d0, z1), P(s1, d0, z1), P(s1, d1, z1), P(s0, d1, z1)], (0, 0, 1)),
        }
        for name, (pts, n) in faces.items():
            if name not in skip:
                ms.poly(role, pts, n, id=id, toggle=toggle)

    def quad(self, ms, role, s0, s1, d0, d1, z0, z1, normal, id=None):
        """Rectangle in a local plane: exactly one of the three ranges is degenerate."""
        P = self.pt
        if abs(s1 - s0) < 1e-9:
            pts = [P(s0, d0, z0), P(s0, d1, z0), P(s0, d1, z1), P(s0, d0, z1)]
        elif abs(d1 - d0) < 1e-9:
            pts = [P(s0, d0, z0), P(s1, d0, z0), P(s1, d0, z1), P(s0, d0, z1)]
        else:
            pts = [P(s0, d0, z0), P(s1, d0, z0), P(s1, d1, z0), P(s0, d1, z0)]
        ms.poly(role, pts, normal, id=id)


def _neg(v):
    return (-v[0], -v[1], -v[2])


def pane_layout(a, b, n, mw):
    """Split [a, b] into n panes separated by mullions of width mw: ([(p0, p1)], [mullion centres])."""
    pw = (b - a - (n - 1) * mw) / n
    panes, mulls = [], []
    x = a
    for k in range(n):
        panes.append((x, x + pw))
        x += pw
        if k < n - 1:
            mulls.append(x + mw / 2.0)
            x += mw
    return panes, mulls


def _room_floor_role(cfg, rid):
    room = cfg.room_by_id.get(rid) if rid else None
    return cfg.floor_role(room) if room else "slab"


def _reveals(cfg, ms, F, o, z0, z1, bottom):
    """Reveal faces of an opening in an exterior wall: plaster outside the frame, plaster_in behind it."""
    p = cfg.p
    sb, fd, t = p["setback"], p["frame_depth"], F.t
    s0, s1 = o["from"], o["to"]
    spans = [(0.0, sb, "plaster"), (sb + fd, t, "plaster_in")]
    for (d0, d1, role) in spans:
        if d1 - d0 < 1e-6:
            continue
        F.quad(ms, role, s0, s0, d0, d1, z0, z1, F.es)
        F.quad(ms, role, s1, s1, d0, d1, z0, z1, _neg(F.es))
        F.quad(ms, role, s0, s1, d0, d1, z1, z1, (0, 0, -1))
    if bottom == "floor":
        F.quad(ms, "slab", s0, s1, 0.0, sb, z0, z0, (0, 0, 1))
        fr = _room_floor_role(cfg, o.get("room"))
        F.quad(ms, fr, s0, s1, sb + fd, t, z0, z0, (0, 0, 1), id=o.get("room") if fr.startswith("floor_") else None)


def _sills(cfg, ms, F, o):
    """Outer aluminium sill plate and inner board (windows that start above the floor)."""
    p = cfg.p
    sb, fd, t = p["setback"], p["frame_depth"], F.t
    s0, s1, z0 = o["from"], o["to"], o["sill"]
    ov, lip, st = p["sill_over"], p["sill_lip"], p["sill_t"]
    F.box(ms, "sill", s0 - ov, s1 + ov, -lip, sb, z0 - st, z0, skip=("-z",))
    it, il = p["inner_sill_t"], p["inner_sill_lip"]
    F.box(ms, "plaster_in", s0 - ov, s1 + ov, sb + fd, t + il, z0 - 0.0, z0 + it, skip=("-d",))


def build_window(cfg, ms, o, slider=False):
    p = cfg.p
    F = Frame(cfg, o)
    sb, fd, t = p["setback"], p["frame_depth"], F.t
    fw, mw = p["frame_w"], p["mullion_w"]
    s0, s1, z0, z1 = o["from"], o["to"], o["sill"], o["head"]
    floor_level = z0 <= 1e-6
    _reveals(cfg, ms, F, o, z0, z1, "floor" if floor_level else None)
    if not floor_level:
        _sills(cfg, ms, F, o)
    target = p["slider_pane"] if slider else p["window_pane"]
    zb0 = z0 + fw
    inner = (s1 - s0) - 2 * fw
    n = max(2 if slider else 1, int(inner / target + 0.5))
    panes, mulls = pane_layout(s0 + fw, s1 - fw, n, mw if not slider else mw + 0.01)
    d0, d1 = sb, sb + fd
    # outer frame
    F.box(ms, "frame", s0, s0 + fw, d0, d1, z0, z1, skip=("-s",))
    F.box(ms, "frame", s1 - fw, s1, d0, d1, z0, z1, skip=("+s",))
    F.box(ms, "frame", s0 + fw, s1 - fw, d0, d1, z1 - fw, z1, skip=("+z",))
    F.box(ms, "frame", s0 + fw, s1 - fw, d0, d1, z0, zb0, skip=("-z",))
    mwid = mw if not slider else mw + 0.01
    for m in mulls:
        F.box(ms, "frame", m - mwid / 2.0, m + mwid / 2.0, d0, d1, zb0, z1 - fw)
    # glazing: thin panel at mid-depth (alternating tracks for sliders)
    for k, (a, b) in enumerate(panes):
        dg = (d0 + d1) / 2.0 + (0.025 if (slider and k % 2) else 0.0)
        glass(ms, F, a, b, dg, zb0, z1 - fw, o["id"])
    if slider:
        # handle on the stile of the first sliding pane
        hx = panes[0][1] - 0.05 if len(panes) else (s0 + s1) / 2.0
        F.box(ms, "sill", hx - 0.012, hx + 0.012, -0.012 + d0, d0, z0 + 0.85, z0 + 1.25, skip=("+d",))


def glass(ms, F, a, b, d, z0, z1, oid):
    """One thin glazing panel as two quads facing both ways (single-sided glTF materials)."""
    F.quad(ms, "glass", a, b, d, d, z0, z1, _neg(F.ed), id=oid)
    F.quad(ms, "glass", a, b, d, d, z0, z1, F.ed, id=oid)


def build_entry(cfg, ms, o):
    p = cfg.p
    F = Frame(cfg, o)
    sb, fd, t = p["setback"], p["frame_depth"], F.t
    fw, mw = p["frame_w"], p["mullion_w"]
    s0, s1, z0, z1 = o["from"], o["to"], o["sill"], o["head"]
    d0, d1 = sb, sb + fd
    thr = 0.02
    _reveals(cfg, ms, F, o, z0, z1, "floor")
    F.box(ms, "sill", s0, s1, d0, d1, z0, z0 + thr, skip=("-z",))
    F.box(ms, "frame", s0, s0 + fw, d0, d1, z0, z1, skip=("-s",))
    F.box(ms, "frame", s1 - fw, s1, d0, d1, z0, z1, skip=("+s",))
    F.box(ms, "frame", s0 + fw, s1 - fw, d0, d1, z1 - fw, z1, skip=("+z",))
    side = 0.30 if (s1 - s0) > 1.0 else 0.0
    hinge_low = o.get("hinge", "-") == "-"
    # leaf on the hinge side, sidelight on the other
    inner0, inner1 = s0 + fw, s1 - fw
    if side > 0:
        if hinge_low:
            leaf = (inner0, inner1 - side - mw)
            sl = (inner1 - side, inner1)
            mull = (inner1 - side - mw, inner1 - side)
        else:
            leaf = (inner0 + side + mw, inner1)
            sl = (inner0, inner0 + side)
            mull = (inner0 + side, inner0 + side + mw)
        F.box(ms, "frame", mull[0], mull[1], d0, d1, z0 + thr, z1 - fw)
        glass(ms, F, sl[0], sl[1], (d0 + d1) / 2.0, z0 + thr, z1 - fw, o["id"])
    else:
        leaf = (inner0, inner1)
    lt = 0.05
    dl0 = d0 + 0.015
    zt = z1 - fw
    F.box(ms, "door_leaf", leaf[0] + 0.004, leaf[1] - 0.004, dl0, dl0 + lt, z0 + thr, zt - 0.004)
    # long handle bar on the free edge of the leaf
    hx = leaf[1] - 0.10 if hinge_low else leaf[0] + 0.10
    F.box(ms, "sill", hx - 0.012, hx + 0.012, dl0 - 0.05, dl0 - 0.026, z0 + 0.9, z0 + 1.9)
    F.box(ms, "sill", hx - 0.012, hx + 0.012, dl0 - 0.05, dl0 - 0.0, z0 + 0.92, z0 + 0.944)
    F.box(ms, "sill", hx - 0.012, hx + 0.012, dl0 - 0.05, dl0 - 0.0, z0 + 1.856, z0 + 1.88)


def build_garage(cfg, ms, o):
    p = cfg.p
    F = Frame(cfg, o)
    sb, t = p["setback"], F.t
    s0, s1, z0, z1 = o["from"], o["to"], o["sill"], o["head"]
    lw = 0.07
    gd = sb
    _reveals(cfg, ms, F, o, z0, z1, "floor")
    F.box(ms, "frame", s0, s0 + lw, gd - 0.02, gd + 0.06, z0, z1, skip=("-s",))
    F.box(ms, "frame", s1 - lw, s1, gd - 0.02, gd + 0.06, z0, z1, skip=("+s",))
    F.box(ms, "frame", s0 + lw, s1 - lw, gd - 0.02, gd + 0.06, z1 - 0.10, z1, skip=("+z",))
    a, b, zt = s0 + lw, s1 - lw, z1 - 0.10
    h = zt - z0
    n = max(2, int(h / p["garage_section_h"] + 0.5))
    g = p["garage_groove"]
    # back plate closes the grooves (seen from both sides)
    F.quad(ms, "frame", a, b, gd + 0.04, gd + 0.04, z0, zt, F.ed)
    F.quad(ms, "frame", a, b, gd + 0.04, gd + 0.04, z0, zt, _neg(F.ed))
    if p["garage_grooves"]:
        sec = (h - (n - 1) * g) / n
        z = z0
        for k in range(n):
            F.box(ms, "frame", a, b, gd, gd + 0.04, z, z + sec, skip=("+d",))
            z += sec + g
    else:
        F.box(ms, "frame", a, b, gd, gd + 0.04, z0, zt, skip=("+d",))


def build_door(cfg, ms, o):
    """Interior door: lining + closed leaf + handles + threshold strip in the floors of the rooms on both sides."""
    p = cfg.p
    F = Frame(cfg, o)
    t = F.t
    s0, s1, z0, z1 = o["from"], o["to"], o["sill"], o["head"]
    lw, pr, lt, gap = p["door_frame_w"], p["door_frame_proud"], p["door_leaf_t"], p["door_gap"]
    F.box(ms, "door_leaf", s0, s0 + lw, -pr, t + pr, z0, z1, skip=("-s", "-z"))
    F.box(ms, "door_leaf", s1 - lw, s1, -pr, t + pr, z0, z1, skip=("+s", "-z"))
    F.box(ms, "door_leaf", s0 + lw, s1 - lw, -pr, t + pr, z1 - lw, z1, skip=("+z",))
    dm = t / 2.0
    a, b = s0 + lw + gap, s1 - lw - gap
    zt = z1 - lw - gap
    zb = z0 + 0.012
    F.box(ms, "door_leaf", a, b, dm - lt / 2.0, dm + lt / 2.0, zb, zt, skip=("-z",))
    hinge_low = o.get("hinge", "-") == "-"
    hx = (b - 0.07) if hinge_low else (a + 0.07)
    hz = z0 + p["handle_h"]
    for (dd0, dd1) in ((dm - lt / 2.0 - 0.045, dm - lt / 2.0), (dm + lt / 2.0, dm + lt / 2.0 + 0.045)):
        F.box(ms, "sill", hx - 0.065, hx + 0.015, dd0, dd1, hz - 0.01, hz + 0.01)
    # threshold in the floors of the two rooms (lo side = lower coordinate)
    w = F.w
    lo_role = _room_floor_role(cfg, w.get("lo"))
    hi_role = _room_floor_role(cfg, w.get("hi"))
    c0, c1 = F.a - F.t / 2.0, F.a + F.t / 2.0
    for (ca, cb, role, rid) in ((c0, F.a, lo_role, w.get("lo")), (F.a, c1, hi_role, w.get("hi"))):
        if F.orient == "h":
            pts = [(s0, ca, z0), (s1, ca, z0), (s1, cb, z0), (s0, cb, z0)]
        else:
            pts = [(ca, s0, z0), (cb, s0, z0), (cb, s1, z0), (ca, s1, z0)]
        ms.poly(role, pts, (0, 0, 1), id=rid if role.startswith("floor_") else None)


def build_openings(cfg, ms):
    n_glazed = 0
    for o in cfg.openings:
        if o.get("wallId") not in cfg.wall_by_id:
            continue
        kind = o.get("kind")
        if kind == "door":
            build_door(cfg, ms, o)
        elif kind == "slider":
            build_window(cfg, ms, o, slider=True)
            n_glazed += 1
        elif kind == "entry":
            build_entry(cfg, ms, o)
            n_glazed += 1
        elif kind == "garage":
            build_garage(cfg, ms, o)
        else:
            build_window(cfg, ms, o)
            n_glazed += 1
    return n_glazed
