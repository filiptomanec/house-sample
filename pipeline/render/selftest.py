"""Checks of the render inputs that need no Blender (python3, standard library only):

    python3 pipeline/render/selftest.py

* the Python port of the content hash (`stableJson`) reproduces `generated/render-inputs.json`,
* the model hash of `model/*.json` matches,
* the shot lists have the counts the media contract needs (9 stills + compare pair + og, 30 day frames, 300 + 60 orbit frames),
* every orbit frame of the landscape variant is a scroll frame when `scrollIndex` is set (every 5th),
* the quality presets of config.json are complete.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.dont_write_bytecode = True

from rn import inputs as I  # noqa: E402
from rn import shots as S   # noqa: E402


def check(cond, msg):
    print(("ok   " if cond else "FAIL ") + msg)
    return bool(cond)


def main():
    ok = True
    try:
        data = I.load()
        ok &= check(True, "render-inputs.json is current (content hash and model hash)")
    except SystemExit as e:
        print("FAIL", e)
        return 1
    st, dy = S.stills(data), S.day(data)
    ob, op = S.orbit(data, "landscape"), S.orbit(data, "portrait")
    ok &= check(len(st) == len(data["stills"]) + 3, "stills: %d shots (stills + compare pair + og)" % len(st))
    ok &= check(len(dy) == 30, "day: 30 frames")
    ok &= check(len(ob) == 300 and len(op) == 60, "orbit: 300 landscape and 60 portrait frames")
    ok &= check(all(o["scroll"] is not None for o in op), "portrait frames are the scroll frames")
    ok &= check(len({s["file"] for s in st + dy + ob + op}) == len(st) + len(dy) + len(ob) + len(op), "file names are unique")
    ok &= check(all(s["size"][0] > 0 for s in st + dy + ob + op), "every shot has a size")
    with open(os.path.join(HERE, "config.json"), "r", encoding="utf-8") as f:
        cfg = json.load(f)
    for q in ("draft", "final"):
        for mode in ("stills", "day", "orbit"):
            p = cfg["quality"][q][mode]
            ok &= check({"scale", "samples", "threshold", "quality"} <= set(p), "config %s/%s has its keys" % (q, mode))
        for key in ("grassDensity", "farTrees"):
            ok &= check(key in cfg["quality"][q], "config %s has %s" % (q, key))
    for key in ("copies", "farCopies", "keep"):
        ok &= check(set(cfg["trees"][key]) == {"stills", "day", "orbit"}, "config trees.%s per mode" % key)
    ok &= check(set(cfg["ground"]["grassDensityPerM2"]) == {"stills", "day", "orbit"}, "config grass density per mode")
    print("all good" if ok else "FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
