"""The render-inputs contract C3 (docs/RENDER-INPUTS.md) read with safe defaults.

`generated/render-inputs.json` is the only file the renderer reads its scene data from. While a field of the contract is not in
that file yet (an older build of the inputs), the same data is taken from `generated/derived.json`, which the inputs name in
`inputs.derived` and whose hash they carry: the resolved plot (`site`: fences with posts and slat spec, gates, pillars, street
pavement and green, dropped kerbs, trees with `uplight`), the pools (`outdoor[].pool`) and the louvre walls (`screens[]` with
`blades`). Python never derives geometry: both files are written by the TypeScript kernel. Per-shot states that the inputs do
not carry default to "closed" (gates, garage door) and to the rest angle of the louvres.
"""
from __future__ import annotations

import json
import math
import os

from .util import repo_path


def _abs(p):
    return p if os.path.isabs(p) else repo_path(p)


class C3:
    def __init__(self, inputs):
        self.inp = inputs
        self._derived = None
        self._style = None
        self._house = None

    # ------------------------------------------------------------------ files named by the inputs
    def derived(self):
        if self._derived is None:
            p = _abs(self.inp["inputs"]["derived"])
            with open(p, "r", encoding="utf-8") as f:
                self._derived = json.load(f)
        return self._derived

    def style(self):
        if self._style is None:
            with open(_abs(self.inp["inputs"]["style"]), "r", encoding="utf-8") as f:
                self._style = json.load(f)
        return self._style

    def house(self):
        if self._house is None:
            with open(_abs(self.inp["inputs"]["house"]), "r", encoding="utf-8") as f:
                self._house = json.load(f)
        return self._house

    def _dsite(self):
        return self.derived().get("site") or {}

    def _site(self, key, default=None):
        v = (self.inp.get("site") or {}).get(key)
        if v is None:
            v = self._dsite().get(key)
        return default if v is None else v

    # ------------------------------------------------------------------ colours (model/style.json)
    def color(self, role, fallback="#808080"):
        """Colour of a style role: `generated` (site parts) first, then `materials`."""
        st = self.style()
        for group in ("generated", "materials"):
            m = (st.get(group) or {}).get(role)
            if m and m.get("color"):
                return m["color"]
        return fallback

    def material_spec(self, role):
        st = self.style()
        for group in ("generated", "materials"):
            m = (st.get(group) or {}).get(role)
            if m:
                return m
        return {}

    def lawn_colors(self):
        c = self.style().get("lawnColors")
        return list(c) if c else [self.color("lawn"), self.color("lawn")]

    # ------------------------------------------------------------------ plot
    def fences(self):
        """Fences with their build spec: `parts` (gaps cut), `posts` [{x,y,z}], `slat` {orient, board, gap, depth},
        `plinthHeight`, `postSize`, `height`, `thickness`. Render-input fences without a slat spec are completed from the
        derived plot (same order)."""
        fi = (self.inp.get("site") or {}).get("fences")
        fd = self._dsite().get("fences") or []
        if not fi:
            return fd
        out = []
        for k, f in enumerate(fi):
            if "slat" in f or k >= len(fd):
                out.append(f)
            else:
                g = dict(fd[k])
                g.update({key: v for key, v in f.items() if v is not None})
                for key in ("slat", "posts", "plinthHeight", "postSize", "postSpacing"):
                    g[key] = fd[k].get(key, g.get(key))
                out.append(g)
        return out

    def gates(self):
        return self._site("gates", [])

    def pillars(self):
        return self._site("pillars", [])

    def street(self):
        z = (self.inp.get("site") or {}).get("zones") or self._dsite().get("zones") or {}
        st = dict(z.get("street") or {})
        dz = (self._dsite().get("zones") or {}).get("street") or {}
        for key in ("pavement", "green", "kerbWidth"):
            if key not in st and key in dz:
                st[key] = dz[key]
        return st

    def access(self):
        a = dict((self.inp.get("site") or {}).get("access") or {})
        for key, v in (self._dsite().get("access") or {}).items():
            a.setdefault(key, v)
        return a

    def beds(self):
        return self._site("beds", [])

    def rainwater(self):
        return self._site("rainwater")

    def trees(self):
        """vegetation.trees with `uplight` (joined from the derived plot by position when the inputs lack it)."""
        trees = list((self.inp.get("vegetation") or {}).get("trees") or [])
        dt = self._dsite().get("trees") or []
        for t in trees:
            if "uplight" in t:
                continue
            best = min(dt, key=lambda d: math.hypot(d["x"] - t["x"], d["y"] - t["y"]), default=None)
            t["uplight"] = bool(best and math.hypot(best["x"] - t["x"], best["y"] - t["y"]) < 0.05 and best.get("uplight"))
        return trees

    # ------------------------------------------------------------------ house extras
    def pools(self):
        """[{water, outer, waterZ, floorZ, copingTop, coping, polygons{water, copingOuter, copingInner, deck}}]."""
        p = self.inp.get("pools") or (self.inp.get("site") or {}).get("pools")
        if p:
            return p
        return [o["pool"] for o in self.derived().get("outdoor", []) if o.get("pool")]

    def ground_voids(self):
        v = (self.inp.get("terrain") or {}).get("voids") or self.inp.get("groundVoids")
        if v is not None:
            return v
        return self.derived().get("groundVoids") or []

    def louvres(self):
        """Louvre walls with blades: `derived.screens[]` ({orient, at, from, to, azimuth, blades{count, chord, thickness,
        positions}, closedDeg, openDeg, restDeg, z0, z1})."""
        s = self.inp.get("screens") or []
        if s and all("blades" in x for x in s):
            return s
        return [x for x in self.derived().get("screens", []) if x.get("blades")]

    def blind_product(self):
        b = self.inp.get("blinds") or {}
        p = b.get("product")
        if p:
            return p
        return ((self.house().get("shading") or {}).get("blinds") or {}).get("product") or {}

    def blind_sections(self, item):
        sec = item.get("sections")
        if isinstance(sec, list) and sec:
            return len(sec)
        if isinstance(sec, (int, float)) and sec:
            return int(sec)
        for o in self.derived().get("openings", []):
            if o.get("id") == item.get("openingId") and o.get("blindSections"):
                return int(o["blindSections"])
        mw = float(self.blind_product().get("maxSectionWidth", 1e9))
        return max(1, int(math.ceil(item["width"] / mw - 1e-9)))

    def heated_glazed_openings(self):
        """Openings that need a blind (`derived.openings[].blind`): the QA check compares them with blinds.items."""
        return [o for o in self.derived().get("openings", []) if o.get("blind")]

    def garage_openings(self):
        return [o for o in self.derived().get("openings", []) if o.get("kind") == "garage"]

    def walls(self):
        return {w["id"]: w for w in self.derived().get("walls", [])}


def shot_state(shot):
    """Per-shot states of the movable parts (C3), with defaults: gates closed, garage door closed, louvres at rest."""
    g = shot.get("gates") or {}
    sc = shot.get("screens") or {}
    return {
        "gates": {k: max(0.0, min(1.0, float(v))) for k, v in g.items() if isinstance(v, (int, float))},
        "garageDoor": max(0.0, min(1.0, float(shot.get("garageDoor") or 0.0))),
        "screenDeg": sc.get("angleDeg") if isinstance(sc, dict) else None,
    }
