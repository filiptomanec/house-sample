"""Quick previews of the procedural house (Cycles, few samples) for visual checks.

    BLENDER -b --factory-startup --python pipeline/blender/preview.py -- --derived D --house H [--style S] --out DIR \
        [--views sw,se,ne,nw,top,topr,section,living,cam:<camera id>,c:x,y,z:tx,ty,tz:lens] [--lod high|lite]
        [--res 1000x640] [--samples 24] [--cut 5.0] [--terrain grid.json] [--furniture furniture.glb] [--site 1]
        [--gate 0.6] [--garage 1] [--exposure -2] [--device gpu|cpu]

`--terrain` reads a ground height grid ({x0, y0, step, nx, ny, h[], voids[]}, written from the TypeScript terrain, which
the pipeline never computes itself); without it the ground is flat at the plateau level with the pool voids cut out.
`--site 1` adds simple stand-ins for the fence, gates and pillar from derived.site (they are not in the GLB);
`--gate` opens the sliding gate (0..1). `--furniture` imports a furniture GLB.
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy                       # noqa: E402
from mathutils import Vector     # noqa: E402
import build_house as BH         # noqa: E402
from hb import config as C       # noqa: E402


def args():
    argv = sys.argv[sys.argv.index("--") + 1:]
    a = {"views": "sw,se,ne,nw,top,topr,section,living", "lod": "high", "res": "1000x640", "samples": "24",
         "cut": "5.0", "sun": "225,38"}
    for i in range(0, len(argv), 2):
        a[argv[i][2:]] = argv[i + 1]
    return a


def setup_workbench(scene, res):
    """Flat-shaded Workbench with back-face culling: shows missing/flipped faces (what a single-sided glTF material does)."""
    scene.render.engine = "BLENDER_WORKBENCH"
    sh = scene.display.shading
    sh.type = "SOLID"
    sh.light = "STUDIO"
    sh.color_type = "MATERIAL"
    sh.show_backface_culling = True
    sh.background_type = "VIEWPORT"
    sh.background_color = (0.75, 0.82, 0.9)
    scene.render.resolution_x, scene.render.resolution_y = [int(v) for v in res.split("x")]
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    for m in bpy.data.materials:
        bs = m.node_tree.nodes.get("Principled BSDF") if m.node_tree else None
        if bs:
            c = bs.inputs["Base Color"].default_value
            m.diffuse_color = (c[0], c[1], c[2], 1.0)


def setup_render(scene, res, samples):
    scene.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    try:
        if args().get("device", "gpu") != "gpu":
            raise RuntimeError("CPU requested")          # --device cpu: leave the GPU to a running render
        prefs.compute_device_type = "METAL"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        scene.cycles.device = "GPU"
    except Exception:
        scene.cycles.device = "CPU"
    scene.cycles.samples = int(samples)
    scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = [int(v) for v in res.split("x")]
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.exposure = float(args().get("exposure", "-2.0"))
    scene.render.image_settings.file_format = "PNG"


def setup_world(scene, sun):
    az, el = [float(v) for v in sun.split(",")]
    w = bpy.data.worlds.new("w")
    w.use_nodes = True
    scene.world = w
    nt = w.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    sky = nt.nodes.new("ShaderNodeTexSky")
    sky.sky_type = "MULTIPLE_SCATTERING"
    sky.sun_elevation = math.radians(el)
    sky.sun_rotation = math.radians(180 - az)
    sky.sun_size = math.radians(2.0)
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = 0.35
    out = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(sky.outputs["Color"], bg.inputs["Color"])
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])


def _mat(name, color, rough=0.9, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (color[0], color[1], color[2], 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    m.diffuse_color = (color[0], color[1], color[2], 1)
    return m


def _link_mesh(name, verts, faces, mat):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def _in_void(voids, x, y):
    return any(v[0] < x < v[2] and v[1] < y < v[3] for v in voids)


def ground(cfg, color=(0.16, 0.2, 0.1), grid=None):
    """Lawn: the terrain grid when given, else flat at the plateau level; holes at the pool voids."""
    voids = cfg.derived.get("groundVoids") or []
    m = _mat("lawn", color, 0.95)
    if grid:
        x0, y0, st, nx, ny, h = grid["x0"], grid["y0"], grid["step"], grid["nx"], grid["ny"], grid["h"]
        verts = [(x0 + i * st, y0 + j * st, h[j * nx + i]) for j in range(ny) for i in range(nx)]
        faces = []
        for j in range(ny - 1):
            for i in range(nx - 1):
                cx, cy = x0 + (i + 0.5) * st, y0 + (j + 0.5) * st
                if not _in_void(voids, cx, cy):
                    a = j * nx + i
                    faces.append((a, a + 1, a + nx + 1, a + nx))
        _link_mesh("ground", verts, faces, m)
        return
    z = cfg.ground_z - 0.001
    xs = sorted({-120.0, 120.0} | {v[0] for v in voids} | {v[2] for v in voids})
    ys = sorted({-120.0, 120.0} | {v[1] for v in voids} | {v[3] for v in voids})
    verts, faces = [], []
    for i in range(len(xs) - 1):
        for j in range(len(ys) - 1):
            if _in_void(voids, (xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2):
                continue
            k = len(verts)
            verts += [(xs[i], ys[j], z), (xs[i + 1], ys[j], z), (xs[i + 1], ys[j + 1], z), (xs[i], ys[j + 1], z)]
            faces.append((k, k + 1, k + 2, k + 3))
    _link_mesh("ground", verts, faces, m)


def _prism(name, poly, z0, z1, mat):
    n = len(poly)
    verts = [(x, y, z0) for (x, y) in poly] + [(x, y, z1) for (x, y) in poly]
    faces = [tuple(range(n))[::-1], tuple(range(n, 2 * n))] + [(k, (k + 1) % n, n + (k + 1) % n, n + k) for k in range(n)]
    return _link_mesh(name, verts, faces, mat)


def _wall(name, a, b, z0, z1, t, mat):
    dx, dy = b[0] - a[0], b[1] - a[1]
    L = math.hypot(dx, dy) or 1.0
    nx_, ny_ = -dy / L * t / 2, dx / L * t / 2
    poly = [(a[0] + nx_, a[1] + ny_), (b[0] + nx_, b[1] + ny_), (b[0] - nx_, b[1] - ny_), (a[0] - nx_, a[1] - ny_)]
    return _prism(name, poly, z0, z1, mat)


def _style_lin(cfg, key, fallback):
    """Linear colour of `generated.<key>` in style.json (the colours of code-built elements), else the fallback."""
    from hb.materials import srgb_to_linear
    h = ((cfg.style.get("generated") or {}).get(key) or {}).get("color")
    return srgb_to_linear(h) if h else fallback


def site_proxies(cfg, gate_open):
    """Plain stand-ins for the fence (plinth + slat panel), gates and pillar from derived.site (not part of the GLB), in the
    style colours of the fence."""
    site = cfg.derived.get("site") or {}
    wood = _mat("p_fence_wood", _style_lin(cfg, "fence_wood", (0.5, 0.45, 0.35)), 0.8)
    dark = _mat("p_fence_dark", _style_lin(cfg, "fence_plinth", (0.04, 0.045, 0.05)), 0.5, 0.3)
    for f in site.get("fences") or []:
        h, ph, t = f.get("height", 1.6), f.get("plinthHeight", 0.3), f.get("thickness", 0.06)
        zg = min((q.get("z", 0.0) for q in f.get("posts") or []), default=cfg.ground_z)
        for part in f.get("parts") or []:
            for a, b in zip(part[:-1], part[1:]):
                _wall("p_plinth", a, b, zg - 0.1, zg + ph, 0.06, dark)
                _wall("p_slats", a, b, zg + ph, zg + h, t * 0.5, wood)
    for g in site.get("gates") or []:
        z = g.get("z", cfg.ground_z)
        leaf = [tuple(q) for q in g["leafPolygon"]]
        if g.get("park") and gate_open > 0:
            sh = (g["park"]["polygon"][0][0] - leaf[0][0], g["park"]["polygon"][0][1] - leaf[0][1])
            leaf = [(x + sh[0] * gate_open, y + sh[1] * gate_open) for (x, y) in leaf]
        _prism("p_gate", leaf, z + 0.05, z + g.get("height", 1.6), wood)
        for q in g.get("posts") or []:
            s_ = g.get("postSize", 0.1) / 2
            _prism("p_post", [(q["x"] - s_, q["y"] - s_), (q["x"] + s_, q["y"] - s_), (q["x"] + s_, q["y"] + s_),
                              (q["x"] - s_, q["y"] + s_)], q.get("z", z) - 0.1, z + g.get("height", 1.6), dark)
    for pl in site.get("pillars") or []:
        _prism("p_pillar", [tuple(q) for q in pl["footprint"]], pl.get("z", cfg.ground_z) - 0.1,
               pl.get("z", cfg.ground_z) + pl["size"][2], dark)


def camera(name, loc, target, lens=28, ortho=None, clip_start=0.1, clip_end=400, shift=(0, 0)):
    cd = bpy.data.cameras.new(name)
    cd.lens = lens
    cd.clip_start, cd.clip_end = clip_start, clip_end
    if ortho:
        cd.type = "ORTHO"
        cd.ortho_scale = ortho
    cd.shift_x, cd.shift_y = shift
    ob = bpy.data.objects.new(name, cd)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = Vector(loc)
    d = Vector(target) - Vector(loc)
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    return ob


def main():
    a = args()
    cfg = C.Config.load(a["derived"], a["house"], a.get("style"), lod=a["lod"], for_render=False, out_dir=a["out"])
    res = BH.build_scene(cfg)
    print("[preview] triangles", res["stats"]["triangles"], "nodes", res["stats"]["nodes"])
    scene = bpy.context.scene
    if a.get("furniture"):
        bpy.ops.import_scene.gltf(filepath=a["furniture"])
    if float(a.get("garage", "0")) > 0:
        # an open garage door: the leaf is hidden (the web lifts and tilts it under the ceiling)
        for o in res["objects"]:
            if o.get("role") == "garage_door":
                o.hide_render = True
    grid = None
    if a.get("terrain"):
        import json
        with open(a["terrain"], "r", encoding="utf-8") as f:
            grid = json.load(f)
    lawn = (cfg.style.get("materials") or {}).get("lawn", {}).get("color") or (cfg.style.get("generated") or {}).get("lawn", {}).get("color")
    from hb.materials import srgb_to_linear
    default_lawn = ",".join("%.4f" % c for c in srgb_to_linear(lawn)) if lawn else "0.07,0.12,0.035"
    ground(cfg, tuple(float(v) for v in a.get("lawn", default_lawn).split(",")), grid)
    if a.get("site"):
        site_proxies(cfg, float(a.get("gate", "0")))
    if a.get("wb"):
        setup_workbench(scene, a["res"])
    else:
        setup_render(scene, a["res"], a["samples"])
        setup_world(scene, a["sun"])
    b = cfg.bbox
    cx, cy = (b["x0"] + b["x1"]) / 2.0, (b["y0"] + b["y1"]) / 2.0
    W, D = b["x1"] - b["x0"], b["y1"] - b["y0"]
    roofobjs = [o for o in res["objects"] if o.get("toggle") == "roof"]
    views = a["views"].split("|") if "|" in a["views"] or a["views"].startswith("c:") else a["views"].split(",")
    os.makedirs(a["out"], exist_ok=True)
    R = 22.0
    living = next((r for r in cfg.rooms if r.get("type") == "living"), cfg.rooms[0])
    lb = living["bbox"]
    cams = {
        "sw": (camera("sw", (cx - R * 0.8, cy - R * 0.9, 3.2), (cx, cy, 1.8), 30), False),
        "se": (camera("se", (cx + R * 0.8, cy - R * 0.9, 3.2), (cx, cy, 1.8), 30), False),
        "ne": (camera("ne", (cx + R * 0.8, cy + R * 0.9, 3.2), (cx, cy, 1.8), 30), False),
        "nw": (camera("nw", (cx - R * 0.8, cy + R * 0.9, 3.2), (cx, cy, 1.8), 30), False),
        "top": (camera("top", (cx, cy, 60), (cx, cy, 0), ortho=max(W, D) * 1.15), True),
        "topr": (camera("topr", (cx, cy, 60), (cx, cy, 0), ortho=max(W, D) * 1.15), False),
        "section": (camera("section", (cx, -30 + float(a["cut"]) - float(a["cut"]), 1.5), (cx, 10, 1.5), ortho=W * 1.1,
                           clip_start=30 + float(a["cut"])), True),
        "living": (camera("living", (lb["x1"] - 0.5, lb["y1"] - 0.6, 1.55), (lb["x0"], lb["y0"], 1.1), 22), False),
        "street": (camera("street", (cx + 8, cy + 30, 1.7), (cx, cy, 2.2), 30), False),
        "garden": (camera("garden", (cx + 6, cy - 32, 2.2), (cx, cy, 1.8), 30), False),
        "aerial": (camera("aerial", (cx - 30, cy - 34, 26), (cx, cy, 0.5), 30), False),
    }
    for k, v in enumerate(views):
        if v.startswith("room:"):
            rb = cfg.room_by_id[v[5:]]["bbox"]
            cam, hide_roof = camera("r%d" % k, (rb["x1"] - 0.35, rb["y1"] - 0.35, 1.5), (rb["x0"], rb["y0"], 1.2), 20), False
            v = v.replace(":", "_")
            ld = bpy.data.lights.new("rl", "POINT")
            ld.energy = 900
            ld.shadow_soft_size = 0.4
            lo = bpy.data.objects.new("rl", ld)
            bpy.context.scene.collection.objects.link(lo)
            lo.location = ((rb["x0"] + rb["x1"]) / 2.0, (rb["y0"] + rb["y1"]) / 2.0, 2.5)
        elif v.startswith("cam:"):
            c = next(cc for cc in cfg.derived.get("cameras", []) if cc["id"] == v[4:])
            asp = [int(t) for t in a["res"].split("x")]
            fov = math.radians(c.get("fov") or 50)
            # vertical field of view -> lens on a 36 mm sensor fitted horizontally
            lens = 18.0 / math.tan(fov / 2) * asp[1] / asp[0]
            cam, hide_roof = camera("k%d" % k, c["position"], c["target"], lens), False
            v = v.replace(":", "_")
        elif v.startswith("c:"):
            _, loc, tgt, lens = v.split(":")
            cam, hide_roof = camera("c%d" % k, [float(t) for t in loc.split(",")], [float(t) for t in tgt.split(",")],
                                    float(lens)), False
            v = "c%d" % k
        else:
            cam, hide_roof = cams[v]
        scene.camera = cam
        for o in roofobjs:
            o.hide_render = hide_roof
        scene.render.filepath = os.path.join(a["out"], "pv_%s.png" % v)
        bpy.ops.render.render(write_still=True)
        print("[preview] wrote", scene.render.filepath)


main()
