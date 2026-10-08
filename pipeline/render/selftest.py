"""Checks of the render pipeline (docs/PIPELINE-RENDER.md, section 8).

    python3 pipeline/render/selftest.py                          # data checks, standard library only
    BLENDER -b --factory-startup --python pipeline/render/selftest.py [-- --inputs FILE --no-verify --quality draft]
                                                                  # the data checks plus the scene checks (builds the scene)

Data checks (no Blender):
* `render-inputs.json` is current (content hash and model hash, ported from the TypeScript writer);
* the shot lists: unique file names, every shot has a size, the portrait orbit frames are scroll frames;
* `config.json`: the presets of every mode are complete and no key is unknown (dead keys fail);
* **missing blinds**: every opening the model gives a blind (`derived.openings[].blind`) has a blind item;
* **slabs below terrain**: the terrain grid never rises above an outdoor slab (`derived.outdoor[].grade`), sampled inside it;
* **house share**: in every exterior shot the house covers at least `qa.minHouseShare` of the frame width.
Scene checks (Blender): the scene builds; **no grass on paving** (no lawn patch centre inside a paved, street, house or pool
polygon); **bare lawn**: an eye-level render of open lawn (1.6 m high, 20 degrees down, 85 mm) with the ground under the blades
in a key colour shows at most `qa.maxBareLawn` of it;
the pool water, the fence and the gates exist when the model has them.
"""
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.dont_write_bytecode = True

from rn import inputs as I  # noqa: E402
from rn import shots as S   # noqa: E402
from rn.util import repo_path  # noqa: E402

CONFIG_KEYS = {
    "_comment", "cycles", "look", "lamps", "fallbackLights", "siteParts", "quality", "seed", "ground", "landscape", "trees",
    "shrubs", "qa",
}
LOOK_KEYS = {"viewTransform", "look", "exposure", "coveredEv", "skyStrength", "bounceSaturation", "dusk", "belowHorizonHoldDeg", "belowHorizonFalloff", "skyCamera", "twilight", "haze", "atmosphere", "clouds",
             "whiteBalance", "glare", "autoExposure"}
PRESET_KEYS = {"scale", "samples", "threshold", "quality"}
RESULTS = []


def check(cond, msg):
    RESULTS.append(bool(cond))
    print(("ok   " if cond else "FAIL ") + msg)
    return bool(cond)


def args():
    a = {"inputs": None, "verify": True, "quality": "draft"}
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    it = iter(argv)
    for tok in it:
        if tok == "--inputs":
            a["inputs"] = next(it)
        elif tok == "--no-verify":
            a["verify"] = False
        elif tok == "--quality":
            a["quality"] = next(it)
    return a


# ------------------------------------------------------------------ geometry helpers (stdlib)
def pip(poly, x, y):
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i][0], poly[i][1]
        xj, yj = poly[j][0], poly[j][1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def grid_z(t, x, y):
    g = t["grid"]
    fx = min(max((x - g["x0"]) / g["step"], 0), g["nx"] - 1.000001)
    fy = min(max((y - g["y0"]) / g["step"], 0), g["ny"] - 1.000001)
    i, j = int(fx), int(fy)
    u, v = fx - i, fy - j
    h, nx = g["heightsMm"], g["nx"]
    z = lambda a, b: h[b * nx + a] / 1000.0  # noqa: E731
    return z(i, j) * (1 - u) * (1 - v) + z(i + 1, j) * u * (1 - v) + z(i, j + 1) * (1 - u) * v + z(i + 1, j + 1) * u * v


def house_points(inp):
    h = inp["house"]
    pts = []
    eave = min((r["eaveHeight"] for r in h["roofs"]), default=h.get("wallTop", 3.0))
    for x, y in h["footprint"]:
        pts += [(x, y, 0.0), (x, y, eave)]
    for r in h["roofs"]:
        x0, y0, x1, y1 = r["eaveRect"]
        pts += [(x0, y0, r["eaveHeight"]), (x1, y0, r["eaveHeight"]), (x1, y1, r["eaveHeight"]), (x0, y1, r["eaveHeight"])]
        for p in r.get("ridge") or []:
            pts.append((p[0], p[1], r["ridgeHeight"]))
    return pts


def house_share(cam, size, pts):
    """Share of the frame width covered by the projected house points (clipped to the frame)."""
    f = cam["forward"]
    n = math.sqrt(sum(c * c for c in f))
    f = [c / n for c in f]
    up = (0.0, 0.0, 1.0)
    rgt = (f[1] * up[2] - f[2] * up[1], f[2] * up[0] - f[0] * up[2], f[0] * up[1] - f[1] * up[0])
    rn = math.sqrt(sum(c * c for c in rgt)) or 1.0
    rgt = [c / rn for c in rgt]
    k = cam["focalMm"] / (cam.get("sensorWidthMm", 36) / 2.0)
    w, h = size
    half_x = 1.0 if w >= h else w / float(h)
    sx = (cam.get("shift") or [0, 0])[0]
    xs = []
    for p in pts:
        d = [p[i] - cam["position"][i] for i in range(3)]
        zc = sum(d[i] * f[i] for i in range(3))
        if zc <= 0.05:
            continue
        xc = sum(d[i] * rgt[i] for i in range(3))
        xs.append(xc / zc * k - 2 * sx)
    if not xs:
        return 0.0
    lo, hi = max(min(xs), -half_x), min(max(xs), half_x)
    return max(0.0, hi - lo) / (2 * half_x)


# ------------------------------------------------------------------ data checks
def data_checks(data, cfg):
    st, dl, dp = S.stills(data), S.day(data, "landscape"), S.day(data, "portrait")
    ob, op = S.orbit(data, "landscape"), S.orbit(data, "portrait")
    every = st + dl + dp + ob + op
    check(len({s["file"] for s in every}) == len(every), "shots: %d file names, all unique" % len(every))
    check(all(s["size"][0] > 0 and s["size"][1] > 0 for s in every), "shots: every shot has a size")
    check(all(o["scroll"] is not None for o in op), "orbit: the portrait frames are scroll frames")
    check(len(st) == len(data["stills"]) + 3, "stills: %d shots (stills + compare pair + og)" % len(st))
    # config
    check(set(cfg) <= CONFIG_KEYS, "config: no unknown top-level keys %s" % sorted(set(cfg) - CONFIG_KEYS))
    check(set(cfg["look"]) <= LOOK_KEYS, "config: no unknown look keys %s" % sorted(set(cfg["look"]) - LOOK_KEYS))
    for q in ("draft", "final"):
        for mode in ("stills", "day", "orbit"):
            check(PRESET_KEYS <= set(cfg["quality"][q][mode]), "config %s/%s has its preset keys" % (q, mode))
        check({"grassDensity", "farTrees"} <= set(cfg["quality"][q]), "config %s has grassDensity and farTrees" % q)
    for key in ("copies", "farCopies", "keep"):
        check(set(cfg["trees"][key]) == {"stills", "day", "orbit"}, "config trees.%s per mode" % key)
    check(set(cfg["ground"]["grassDensityPerM2"]) == {"stills", "day", "orbit"}, "config grass density per mode")
    # derived data named by the inputs
    with open(repo_path(data["inputs"]["derived"]), "r", encoding="utf-8") as f:
        derived = json.load(f)
    # missing blinds
    want = [o["id"] for o in derived.get("openings", []) if o.get("blind")]
    have = {it["openingId"] for it in data["blinds"]["items"]}
    missing = [w for w in want if w not in have]
    check(not missing, "blinds: every opening with a blind has a blind item (%d of %d)%s"
          % (len(want) - len(missing), len(want), (" missing " + ", ".join(missing)) if missing else ""))
    shots = data["day"]["frames"] + data["stills"]
    check(all(len(s["blinds"]) == len(data["blinds"]["items"]) for s in shots), "blinds: every shot has a state per blind")
    # slabs below terrain
    worst = (0.0, None)
    for o in derived.get("outdoor", []):
        gr = o.get("grade")
        if not gr:
            continue
        pl = gr["plane"]
        x0, y0, x1, y1 = o["rect"]
        for i in range(1, 8):
            for j in range(1, 8):
                x, y = x0 + (x1 - x0) * i / 8.0, y0 + (y1 - y0) * j / 8.0
                if any(h[0] < x < h[2] and h[1] < y < h[3] for h in o.get("holes") or []):
                    continue
                top = pl["z0"] + pl["gx"] * (x - pl["ox"]) + pl["gy"] * (y - pl["oy"])
                over = grid_z(data["terrain"], x, y) - top
                if over > worst[0]:
                    worst = (over, o.get("id"))
    check(worst[0] <= 0.002, "slabs: the terrain stays below every outdoor slab (worst %+.3f m%s)"
          % (worst[0], " at " + worst[1] if worst[1] else ""))
    # house share in the exterior shots
    pts = house_points(data)
    minshare = float(cfg["qa"]["minHouseShare"])
    low = []
    ext = [s for s in st if s.get("category") not in cfg["look"]["autoExposure"]["categories"]]
    ext += dl[:1] + dp[:1] + ob[::10] + op[::5]
    for s in ext:
        sh = house_share(s["camera"], s["size"], pts)
        if sh < minshare:
            low.append("%s %.0f %%" % (s["file"], 100 * sh))
    check(not low, "framing: the house covers at least %.0f %% of the width in %d exterior shots%s"
          % (100 * minshare, len(ext), (": " + ", ".join(low[:8])) if low else ""))
    return derived


# ------------------------------------------------------------------ scene checks (Blender)
def scene_checks(data, a, cfg_data):
    import bpy
    import numpy as np
    from rn import config as CONFIG
    from rn.scene import Scene
    cfg = CONFIG.Config.load(a["quality"])
    scn = Scene(data, cfg, "stills")
    check(True, "scene: built")
    c3 = scn.c3
    check((not c3.pools()) or any(o.name.startswith("pool_water") for o in bpy.data.objects), "pool: water volume present")
    check((not c3.fences()) or bpy.data.objects.get("fence_0") is not None, "boundary: fence built")
    n_gates = sum(1 for o in bpy.data.objects if o.name.startswith("gate_sliding") or o.name.startswith("gate_swing"))
    check(n_gates == len([g for g in c3.gates() if g.get("park") or g.get("swing")]), "boundary: %d gates built" % n_gates)
    # grass on paving: lawn patch centres inside non-lawn polygons
    dg = bpy.context.evaluated_depsgraph_get()
    terrain = scn.terrain.near
    pts = []
    for inst in dg.object_instances:
        if inst.is_instance and inst.parent and inst.parent.original == terrain:
            t = inst.matrix_world.translation
            pts.append((t.x, t.y))
    polys = [s["polygon"] for s in data["site"]["surfaces"] if s["role"] in ("terrace_paving", "drive_paving", "path", "deck",
                                                                              "pool_coping", "gravel", "mulch")]
    polys.append(data["house"]["footprint"])
    stz = c3.street()
    polys += [p for p in (stz.get("pavement"), stz.get("carriageway")) if p]
    polys += scn.terrain.voids
    bad = 0
    where = []
    sample = pts[::max(1, len(pts) // 40000)]
    for x, y in sample:
        for k, p in enumerate(polys):
            if pip(p, x, y):
                bad += 1
                where.append("(%.2f, %.2f) in polygon %d" % (x, y, k))
                break
    if where:
        print("     " + "; ".join(where[:5]))
    check(len(pts) > 0 and bad == 0, "lawn: %d patches, none on paving, beds, the street, the house or the pool (%d found in "
          "a sample of %d)" % (len(pts), bad, len(sample)))
    # bare lawn: an eye-level render of open lawn, the ground under the blades in a key colour. The camera stands on open lawn
    # too, 1.6 m above it, and looks down at 20 degrees towards a point `back` metres away (as an eye-level still sees a lawn)
    plot = data["site"]["plot"]["polygon"]
    xs = [p[0] for p in plot]
    ys = [p[1] for p in plot]
    pitch = math.radians(20.0)
    back = 1.6 / math.tan(pitch)

    def open_lawn(x, y, margin):
        if not all(pip(plot, x + dx, y + dy) for dx in (-margin, margin) for dy in (-margin, margin)):
            return None
        if any(pip(p, x, y) for p in polys):
            return None
        return min(math.hypot(x - q[0], y - q[1]) for p in polys for q in p)

    best = None
    for i in range(1, 30):
        for j in range(1, 30):
            x, y = min(xs) + (max(xs) - min(xs)) * i / 30.0, min(ys) + (max(ys) - min(ys)) * j / 30.0
            dmin = open_lawn(x, y, 1.5)
            if dmin is None:
                continue
            for k in range(8):
                a = 2 * math.pi * k / 8
                cx, cy = x - math.cos(a) * back, y - math.sin(a) * back
                dc = open_lawn(cx, cy, 0.5)
                if dc is None:
                    continue
                score = min(dmin, dc + 1.0)
                if best is None or score > best[0]:
                    best = (score, x, y, a)
    if best is None:
        check(False, "lawn: no open lawn to measure")
        return
    _, x, y, a = best
    soil = bpy.data.materials.new("qa_soil")
    soil.use_nodes = True
    nt = soil.node_tree
    for n in list(nt.nodes):
        if n.type != "OUTPUT_MATERIAL":
            nt.nodes.remove(n)
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (1.0, 0.0, 1.0, 1.0)
    em.inputs["Strength"].default_value = 3.0
    nt.links.new(em.outputs[0], next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL").inputs[0])
    me = terrain.data
    me.materials[0] = soil                     # slot 0 = the lawn zone
    cam = scn.cam
    cx, cy = x - math.cos(a) * back, y - math.sin(a) * back
    cam.location = (cx, cy, scn.terrain.z(cx, cy) + 1.6)
    cam.rotation_mode = "XYZ"
    cam.rotation_euler = (math.pi / 2 - pitch, 0, a - math.pi / 2)
    cam.data.type = "PERSP"
    cam.data.lens = 85.0
    cam.data.shift_x = cam.data.shift_y = 0.0
    sc = bpy.context.scene
    sc.render.resolution_x = sc.render.resolution_y = 256
    sc.cycles.samples = 8
    sc.cycles.use_denoising = False
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    sc.view_settings.exposure = 0.0
    import tempfile
    out = os.path.join(tempfile.gettempdir(), "qa_lawn_%d.png" % os.getpid())
    sc.render.image_settings.file_format = "PNG"
    sc.render.filepath = out
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(out)
    px = np.array(img.pixels[:], dtype=np.float32).reshape(-1, 4)
    os.remove(out)
    key = (px[:, 0] > 0.6) & (px[:, 2] > 0.6) & (px[:, 1] < 0.35)
    bare = float(key.mean())
    check(bare <= float(cfg_data["qa"]["maxBareLawn"]), "lawn: bare ground %.1f %% of an eye-level view of open lawn at (%.1f, %.1f) "
          "(limit %.0f %%)" % (100 * bare, x, y, 100 * float(cfg_data["qa"]["maxBareLawn"])))


def main():
    a = args()
    try:
        data = I.load(a["inputs"], verify=a["verify"])
        check(True, "render-inputs.json is current (content hash and model hash)" if a["verify"] else "render-inputs.json loaded")
    except SystemExit as e:
        print("FAIL", e)
        return 1
    with open(os.path.join(HERE, "config.json"), "r", encoding="utf-8") as f:
        cfg = json.load(f)
    data_checks(data, cfg)
    try:
        import bpy  # noqa: F401
        in_blender = True
    except ImportError:
        in_blender = False
    if in_blender:
        scene_checks(data, a, cfg)
    ok = all(RESULTS)
    print("all good" if ok else "FAILED (%d of %d checks)" % (RESULTS.count(False), len(RESULTS)))
    return 0 if ok else 1


if __name__ == "__main__":
    code = main()
    if "bpy" in sys.modules:
        import bpy
        if code:
            sys.exit(code)
    else:
        sys.exit(code)
