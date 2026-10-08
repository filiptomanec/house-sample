"""The render loop: resumable (skips existing frames), writes each JPEG atomically, logs the seconds per frame."""
from __future__ import annotations

import os
import time

from . import cycles_setup
from .scene import Scene
from .util import log, repo_path, strip_jpeg_metadata


def _log_file(out, mode, quality):
    d = repo_path("pipeline", "out", "logs")
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, "render-%s-%s.log" % (mode, quality))


def run(inp, cfg, mode, shots, out, args):
    import bpy
    sc_mode = cfg.mode(mode)
    quality = cfg.quality
    todo = []
    for s in shots:
        size = cfg.size(mode, s["size"], portrait=s.get("variant") == "portrait")
        path = os.path.join(out, s["file"] + ".jpg")
        if args["skip"] and os.path.exists(path) and os.path.getsize(path) > 1000:
            continue
        todo.append((s, size, path))
    log("mode %s (%s): %d of %d shots to render -> %s" % (mode, quality, len(todo), len(shots), out))
    if not todo:
        return
    scn = Scene(inp, cfg, mode, args["device"])
    sc = scn.sc
    seed = cfg["seed"][mode]
    cycles_setup.apply_mode(sc, sc_mode, seed)
    if mode == "orbit":
        from . import orbit
        orbit.prepare(scn, [t[0] for t in todo], sc_mode)
    sc.render.use_file_extension = False
    if args.get("blend"):
        bpy.ops.wm.save_as_mainfile(filepath=args["blend"])
    lf = open(_log_file(out, mode, quality), "a", encoding="utf-8")
    t_all = time.time()
    done = 0
    for s, size, path in todo:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        info = scn.apply(s, size)
        if mode == "orbit":
            orbit.set_frame(scn, s)
        tmp = path + ".part"
        sc.render.filepath = tmp
        t0 = time.time()
        bpy.ops.render.render(write_still=True)
        strip_jpeg_metadata(tmp)
        os.replace(tmp, path)
        dt = time.time() - t0
        done += 1
        if args.get("qa"):
            from . import qa
            res = qa.measure(path, size)
            qa.append_report(out, s["file"], dict(res, time=(s.get("time") or {}).get("local"), category=s.get("category")))
            info += "  qa " + " ".join("%s=%s" % (k, v) for k, v in res.items() if k != "plasterRGB")
        line = "%s %s %dx%d %d spp %.1f s  %s" % (time.strftime("%H:%M:%S"), s["file"], size[0], size[1], sc_mode["samples"], dt, info)
        log(line)
        lf.write(line + "\n")
        lf.flush()
    log("rendered %d shots in %.0f s (%.1f s per shot)" % (done, time.time() - t_all, (time.time() - t_all) / max(1, done)))
    lf.close()
