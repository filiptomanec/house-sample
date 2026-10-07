"""Quick previews of the procedural house (Cycles, few samples) for visual checks.

    BLENDER -b --factory-startup --python pipeline/blender/preview.py -- --derived D --house H [--style S] --out DIR \
        [--views sw,se,ne,nw,top,topr,section,living] [--lod high|lite] [--res 1000x640] [--samples 24] [--cut 5.0]
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


def ground(bbox, color=(0.16, 0.2, 0.1)):
    me = bpy.data.meshes.new("ground")
    s = 120
    me.from_pydata([(-s, -s, -0.001), (s, -s, -0.001), (s, s, -0.001), (-s, s, -0.001)], [], [(0, 1, 2, 3)])
    ob = bpy.data.objects.new("ground", me)
    bpy.context.scene.collection.objects.link(ob)
    m = bpy.data.materials.new("lawn")
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (color[0], color[1], color[2], 1)
    b.inputs["Roughness"].default_value = 0.95
    me.materials.append(m)


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
    if a.get("wb"):
        setup_workbench(scene, a["res"])
    else:
        setup_render(scene, a["res"], a["samples"])
        setup_world(scene, a["sun"])
    b = cfg.bbox
    ground(b, tuple(float(v) for v in a.get("lawn", "0.16,0.2,0.1").split(",")))
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
