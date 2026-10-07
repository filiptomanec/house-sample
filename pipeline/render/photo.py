"""Photoreal renders of the house (Blender 5.1, Cycles). Data driven: reads generated/render-inputs.json (docs/RENDER-INPUTS.md).

    BLENDER -b --factory-startup --python pipeline/render/photo.py -- --mode stills|day|orbit [--quality draft|final]
        [--variant landscape|portrait] [--only id,id] [--range a:b] [--skip-existing] [--out DIR] [--inputs FILE]
        [--device auto|gpu|cpu] [--list] [--blend FILE] [--no-verify]

Output: <out>/<file>.jpg per shot (`file` from the inputs, for example stills/street-sunset, day/0800, orbit/landscape/0035).
Default <out> is pipeline/out for final and pipeline/out/draft for draft. A log with the time per frame goes to
pipeline/out/logs. See docs/PIPELINE-RENDER.md.
"""
from __future__ import annotations

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

from rn import config as CONFIG  # noqa: E402
from rn import inputs as INPUTS  # noqa: E402
from rn import shots as SHOTS    # noqa: E402
from rn import runner            # noqa: E402
from rn.util import argv_after_dashes, log, repo_path  # noqa: E402


def parse(argv):
    a = {"mode": "stills", "quality": "draft", "variant": "landscape", "only": None, "range": None, "skip": False,
         "out": None, "inputs": None, "device": None, "list": False, "blend": None, "verify": True}
    it = iter(argv)
    for tok in it:
        if tok in ("--mode", "--quality", "--variant", "--out", "--inputs", "--device", "--blend"):
            a[tok[2:]] = next(it)
        elif tok == "--only":
            a["only"] = [s for s in next(it).split(",") if s]
        elif tok == "--range":
            lo, _, hi = next(it).partition(":")
            a["range"] = (int(lo or 0), int(hi) if hi else 10 ** 9)
        elif tok == "--skip-existing":
            a["skip"] = True
        elif tok == "--list":
            a["list"] = True
        elif tok == "--no-verify":
            a["verify"] = False
        else:
            raise SystemExit("unknown argument: %s" % tok)
    if a["mode"] not in ("stills", "day", "orbit"):
        raise SystemExit("--mode must be stills, day or orbit")
    if a["variant"] not in ("landscape", "portrait"):
        raise SystemExit("--variant must be landscape or portrait")
    return a


def main():
    a = parse(argv_after_dashes())
    cfg = CONFIG.Config.load(a["quality"])
    inp = INPUTS.load(a["inputs"], verify=a["verify"])
    mode = a["mode"]
    shots = {"stills": SHOTS.stills, "day": SHOTS.day}.get(mode) or (lambda i: SHOTS.orbit(i, a["variant"]))
    shots = SHOTS.select(shots(inp), a["only"], a["range"])
    out = a["out"] or (repo_path("pipeline", "out") if a["quality"] == "final" else repo_path("pipeline", "out", "draft"))
    if a["list"]:
        for s in shots:
            print(s["file"], s["size"], s["time"]["local"] if s.get("time") else "")
        return
    runner.run(inp, cfg, mode, shots, out, a)


if __name__ == "__main__":
    main()
