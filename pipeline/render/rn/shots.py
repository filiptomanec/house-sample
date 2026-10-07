"""Lists the shots of a mode from render-inputs.json: a flat list of dicts with the same keys for stills, day and orbit."""
from __future__ import annotations


def _shot(group, s, size, **kw):
    d = {"group": group, "id": s["id"], "file": s["file"], "size": size, "camera": s["camera"], "sun": s["sun"],
         "lights": s["lights"], "blinds": s["blinds"], "time": s.get("time"), "label": s.get("label")}
    d.update(kw)
    return d


def stills(inp):
    out = [_shot("stills", s, s["size"], category=s.get("category")) for s in inp["stills"]]
    for key in ("before", "after"):
        s = inp["compare"][key]
        out.append(_shot("stills", s, s["size"], category="compare"))
    out.append(_shot("stills", inp["og"], inp["og"]["size"], category="og"))
    return out


def day(inp):
    d = inp["day"]
    return [_shot("day", dict(f, camera=d["camera"]), d["size"], index=f["index"]) for f in d["frames"]]


def orbit(inp, variant="landscape"):
    o = inp["orbit"]
    v = next(x for x in o["variants"] if x["id"] == variant)
    out = []
    for f in v["frames"]:
        s = {"id": "%04d" % f["index"], "file": f["file"], "camera": f["camera"], "sun": o["sun"], "lights": o["lights"],
             "blinds": o["blinds"], "time": o["time"]}
        out.append(_shot("orbit", s, v["size"], index=f["index"], variant=variant, scroll=f.get("scrollIndex")))
    return out


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
