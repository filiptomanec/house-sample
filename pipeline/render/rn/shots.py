"""Lists the shots of a mode from render-inputs.json: a flat list of dicts with the same keys for stills, day and orbit.

Every shot carries the C3 per-shot states when the inputs have them (`gates`, `garageDoor`, `screens`, optional `ev`) and its
`kind` (`still`, `compare`, `og`, `day`, `orbit`) for the run order of the driver (`--subset`)."""
from __future__ import annotations

STATE_KEYS = ("gates", "garageDoor", "screens", "ev")


def _shot(group, s, size, parent=None, **kw):
    d = {"group": group, "id": s["id"], "file": s["file"], "size": size, "camera": s["camera"], "sun": s["sun"],
         "lights": s["lights"], "blinds": s["blinds"], "time": s.get("time"), "label": s.get("label")}
    for k in STATE_KEYS:
        v = s.get(k)
        if v is None and parent is not None:
            v = parent.get(k)
        if v is not None:
            d[k] = v
    d.update(kw)
    return d


def stills(inp):
    out = [_shot("stills", s, s["size"], category=s.get("category"), kind="still") for s in inp["stills"]]
    cmp = inp["compare"]
    for key in ("before", "after"):
        s = cmp[key]
        out.append(_shot("stills", s, s["size"], parent=cmp, category=s.get("category") or cmp.get("category") or "exterior",
                         kind="compare"))
    og = inp["og"]
    out.append(_shot("stills", og, og["size"], category=og.get("category") or "exterior", kind="og"))
    return out


def day(inp, variant="landscape"):
    """Day frames. The portrait variant (C3 `day.portrait.camera`) has its own camera and size; its files come from
    `frames[].files.portrait` or sit under `day/portrait/`. Without a portrait camera the portrait list is empty (the media
    step crops the landscape frames, the older contract)."""
    d = inp["day"]
    port = d.get("portrait") or {}
    out = []
    if variant == "portrait":
        cam = port.get("camera")
        if not cam:
            return []
        size = port.get("size") or [1080, 1620]
        for f in d["frames"]:
            files = f.get("files") or {}
            fn = files.get("portrait") or f["file"].replace("day/", "day/portrait/", 1)
            out.append(_shot("day", dict(f, camera=cam, file=fn), size, parent=d, index=f["index"], variant="portrait",
                             category="exterior", kind="day"))
        return out
    for f in d["frames"]:
        files = f.get("files") or {}
        fn = files.get("landscape") or f["file"]
        out.append(_shot("day", dict(f, camera=f.get("camera") or d["camera"], file=fn), d["size"], parent=d, index=f["index"],
                         variant="landscape", category="exterior", kind="day"))
    return out


def orbit(inp, variant="landscape"):
    o = inp["orbit"]
    v = next(x for x in o["variants"] if x["id"] == variant)
    out = []
    for f in v["frames"]:
        s = {"id": "%04d" % f["index"], "file": f["file"], "camera": f["camera"], "sun": o["sun"], "lights": o["lights"],
             "blinds": o["blinds"], "time": o["time"]}
        out.append(_shot("orbit", s, v["size"], parent=o, index=f["index"], variant=variant, scroll=f.get("scrollIndex"),
                         category="exterior", kind="orbit"))
    return out


def subset(shots, name):
    """Run-order subsets: stills mode `stills` | `compare` | `og`; orbit `scroll` (scroll frames) | `rest`; `all`."""
    if not name or name == "all":
        return shots
    if name in ("stills", "compare", "og"):
        want = {"stills": "still", "compare": "compare", "og": "og"}[name]
        return [s for s in shots if s.get("kind") == want]
    if name == "scroll":
        return [s for s in shots if s.get("scroll") is not None]
    if name == "rest":
        return [s for s in shots if s.get("scroll") is None]
    raise SystemExit("unknown subset %s" % name)


def select(shots, only=None, rng=None):
    """Filters a list: `only` = set of ids (orbit frames also as plain numbers), `rng` = (a, b) positions in the list."""
    if rng:
        a, b = rng
        shots = shots[a:b]
    if only:
        want = set(only)
        want |= {w.zfill(4) for w in only if w.isdigit()}
        shots = [s for s in shots if s["id"] in want or s["file"] in want or str(s.get("index")) in want]
    return shots
