"""Inputs of the builder: derived.json + house.json + style.json, parsed once and exposed through simple accessors."""
from __future__ import annotations

import json
import os

from . import params as P


def _load(path):
    if not path or not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


class Config:
    def __init__(self, derived, house, style, lod="high", for_render=False, out_dir=".", assets_dir=None, tex_dir=None,
                 overrides=None):
        self.derived, self.house, self.style = derived, house, style
        self.lod = lod
        self.for_render = for_render
        self.out_dir = out_dir
        self.p = P.get(lod, style)
        if for_render and lod == "high":
            self.p["texture_px"] = 2048          # renders look at the facade up close: use the full 2k assets
        if overrides:
            self.p.update(overrides)
        here = os.path.dirname(os.path.abspath(__file__))
        self.repo = os.path.abspath(os.path.join(here, "..", "..", ".."))
        self.assets_dir = assets_dir or os.path.join(self.repo, "assets")
        self.tex_dir = tex_dir or os.path.join(self.repo, "pipeline", "out", "tex")
        self._index()

    @staticmethod
    def load(derived, house, style=None, **kw):
        return Config(_load(derived), _load(house), _load(style) if style else {}, **kw)

    # ------------------------------------------------------------------ indexing
    def _index(self):
        d, h = self.derived, self.house
        self.walls = d.get("walls", [])
        self.wall_by_id = {w["id"]: w for w in self.walls}
        self.rooms = d.get("rooms", [])
        self.room_by_id = {r["id"]: r for r in self.rooms}
        self.openings = d.get("openings", [])
        self.opening_by_id = {o["id"]: o for o in self.openings}
        self.outline = d.get("outline", {})
        self.accents = d.get("accents") or h.get("accents", [])
        roofs = d.get("roofs") or h.get("roofs", [])
        self.clear_height = float(h.get("clearHeight", 2.75))
        self.slab = float(h.get("slab", 0.30))
        self.default_wall_top = float(d.get("defaultWallTop", self.clear_height + self.slab))
        self.roofs = []
        for r in roofs:
            rr = dict(r)
            rr["pitch"] = float(r.get("pitch", 22))
            rr["overhang"] = float(r.get("overhang", 0.7))
            rr["wallTop"] = float(r.get("wallTop", self.default_wall_top))
            self.roofs.append(rr)
        self.outdoor = d.get("outdoor") or h.get("outdoor", [])
        self.screens = [self._screen(s) for s in (d.get("screens") or h.get("screens", []))]
        roof = h.get("roof", {}) or {}
        self.roof_cfg = roof
        self.covering = (roof.get("covering") or {}).get("type", "standing-seam-steel")
        self.downpipes = roof.get("downpipes", [])
        self.snow_guard_kinds = (roof.get("snowGuards") or {}).get("aboveOpeningKinds", [])
        lp = roof.get("lightpipes") or {}
        self.lightpipe_d = float(lp.get("diameter", 0.35)) if isinstance(lp, dict) else 0.35
        self.lightpipe_dome = float(lp.get("domeHeight", 0.12)) if isinstance(lp, dict) else 0.12
        pts = d.get("lightpipes") or h.get("lightpipes") or (lp.get("points") if isinstance(lp, dict) else None) or []
        self.lightpipes = [{"x": q[0], "y": q[1], "diameter": self.lightpipe_d} if isinstance(q, (list, tuple)) else q
                           for q in pts]
        slats = (h.get("shading") or {}).get("slats") or {}
        self.slat_pitch = float(slats.get("pitch", 0.10))
        self.slat_w = float(slats.get("width", 0.04))
        self.slat_d = float(slats.get("depth", 0.06))
        self.rooms_rects = {r["id"]: [tuple(x) for x in r.get("rects", [])] for r in self.rooms}
        # net room rectangles (inside the wall faces): the kernel's description of the free floor, authoritative for rooms
        net = {n["id"]: n.get("rects", []) for n in d.get("netRooms", [])} or {r["id"]: r.get("cleanRects", []) for r in self.rooms}
        self.net_rects = {rid: [tuple(x) for x in rs] for rid, rs in net.items()}

    @staticmethod
    def _screen(s):
        """Screen in the derived form {id, type, orient, at, from, to}; the model form (cx|cy, y0|x0, y1|x1) is converted."""
        if "at" in s:
            return s
        v = s.get("orient") == "v"
        return {"id": s.get("id"), "type": s.get("type"), "orient": s.get("orient"),
                "at": s.get("cx") if v else s.get("cy"), "from": s.get("y0" if v else "x0"), "to": s.get("y1" if v else "x1")}

    # ------------------------------------------------------------------ helpers
    @property
    def bbox(self):
        return self.outline.get("bbox", {})

    def room_at(self, x, y):
        """Room id whose axis rectangles contain the point (None outside all rooms)."""
        for rid, rects in self.rooms_rects.items():
            for (x0, y0, x1, y1) in rects:
                if x0 <= x <= x1 and y0 <= y <= y1:
                    return rid
        return None

    def wall_outward(self, wall):
        """+1 / -1: sign of the outward normal along the axis perpendicular to an exterior wall; 0 for interior walls."""
        if wall.get("lo") is None and wall.get("hi") is not None:
            return -1
        if wall.get("hi") is None and wall.get("lo") is not None:
            return 1
        return 0

    def roof_top_at(self, x, y):
        """wallTop of the highest roof whose rectangle contains the point, else the default."""
        best = None
        for r in self.roofs:
            x0, y0, x1, y1 = r["rect"]
            if x0 - 0.01 <= x <= x1 + 0.01 and y0 - 0.01 <= y <= y1 + 0.01:
                best = r["wallTop"] if best is None else max(best, r["wallTop"])
        return self.default_wall_top if best is None else best

    def wall_top(self, w):
        if w.get("height"):
            return float(w["height"])
        if w["orient"] == "h":
            mx, my = (w["from"] + w["to"]) / 2.0, w["at"]
        else:
            mx, my = w["at"], (w["from"] + w["to"]) / 2.0
        return self.roof_top_at(mx, my)

    def floor_role(self, room):
        kind = room.get("floor", "concrete")
        return "floor_" + str(kind)
