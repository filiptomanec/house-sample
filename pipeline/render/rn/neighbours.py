"""Neighbouring houses: plain volumes with a hip or gable roof, a few windows and a door (render-inputs.json: neighbours[])."""
from __future__ import annotations

import math

from .util import hex_to_linear, log, rng

WALLS = ("#d9d4c6", "#cfd0c8", "#dcd2c0")
ROOFS = ("#4d5157", "#5a4f4b", "#434950")


def _material(name, hex_color, rough=0.9, metal=0.0):
    import bpy
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bs = m.node_tree.nodes.get("Principled BSDF")
    bs.inputs["Base Color"].default_value = (*hex_to_linear(hex_color), 1)
    bs.inputs["Roughness"].default_value = rough
    bs.inputs["Metallic"].default_value = metal
    return m


def _mesh(name, verts, faces, mats, face_mats=None):
    import bpy
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    for m in mats:
        me.materials.append(m)
    me.update()
    if face_mats:
        for p, i in zip(me.polygons, face_mats):
            p.material_index = i
    return me


def build(scn, terrain):
    import bpy
    col = bpy.data.collections.new("neighbours")
    bpy.context.scene.collection.children.link(col)
    glass = bpy.data.materials.get("glass")
    frame = bpy.data.materials.get("frame")
    for k, n in enumerate(scn.inputs.get("neighbours", [])):
        r = rng("neighbour", k)
        wall = _material("nb_wall_%d" % k, WALLS[k % len(WALLS)], 0.92)
        roof = _material("nb_roof_%d" % k, ROOFS[k % len(ROOFS)], 0.55, 0.3)
        w, d = n["size"]
        cx, cy = n["center"]
        base = n["baseZ"] - 0.3
        eave, ridge = n["eaveZ"], n["ridgeZ"]
        o = n["roof"]["overhang"]
        pitch = math.radians(n["roof"]["pitchDeg"])
        hw, hd = w / 2.0, d / 2.0
        # body (local frame, x along w, y along d), then the roof; one mesh, material 0 = wall, 1 = roof
        v, f, fm = [], [], []

        def add(pts, quads, mat):
            i0 = len(v)
            v.extend(pts)
            for q in quads:
                f.append(tuple(i0 + j for j in q))
                fm.append(mat)
        add([(-hw, -hd, base), (hw, -hd, base), (hw, hd, base), (-hw, hd, base),
             (-hw, -hd, eave), (hw, -hd, eave), (hw, hd, eave), (-hw, hd, eave)],
            [(0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)], 0)
        ew, ed = hw + o, hd + o
        drop = o * math.tan(pitch)
        ez = eave - drop
        long_x = w >= d
        if n["roof"]["kind"] == "hip":
            if long_x:
                a = max(0.0, hw - hd)
                rp = [(-a, 0, ridge), (a, 0, ridge)]
            else:
                a = max(0.0, hd - hw)
                rp = [(0, -a, ridge), (0, a, ridge)]
            pts = [(-ew, -ed, ez), (ew, -ed, ez), (ew, ed, ez), (-ew, ed, ez)] + rp
            if long_x:
                quads = [(0, 1, 5, 4), (1, 2, 5), (2, 3, 4, 5), (3, 0, 4)]
            else:
                quads = [(0, 1, 4), (1, 2, 5, 4), (2, 3, 5), (3, 0, 4, 5)]
            add(pts, quads, 1)
        else:
            if long_x:
                pts = [(-ew, -ed, ez), (ew, -ed, ez), (ew, 0, ridge), (-ew, 0, ridge), (-ew, ed, ez), (ew, ed, ez)]
                quads = [(0, 1, 2, 3), (3, 2, 5, 4)]
                add(pts, quads, 1)
                add([(-hw, -hd, eave), (-hw, hd, eave), (-hw, 0, ridge)], [(0, 1, 2)], 0)
                add([(hw, hd, eave), (hw, -hd, eave), (hw, 0, ridge)], [(0, 1, 2)], 0)
            else:
                pts = [(-ew, -ed, ez), (0, -ed, ridge), (0, ed, ridge), (-ew, ed, ez), (ew, -ed, ez), (ew, ed, ez)]
                quads = [(0, 1, 2, 3), (1, 4, 5, 2)]
                add(pts, quads, 1)
                add([(hw, -hd, eave), (-hw, -hd, eave), (0, -hd, ridge)], [(0, 1, 2)], 0)
                add([(-hw, hd, eave), (hw, hd, eave), (0, hd, ridge)], [(0, 1, 2)], 0)
        me = _mesh("neighbour_%d" % k, v, f, [wall, roof], fm)
        me.validate()
        ob = bpy.data.objects.new("neighbour_%d" % k, me)
        ob.rotation_euler = (0, 0, math.radians(n["rotDeg"]))
        ob.location = (cx, cy, 0)
        # fix normals outwards
        import bmesh
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me)
        bm.free()
        for p in me.polygons:
            p.use_smooth = False
        col.objects.link(ob)
        # windows and a door on the long sides (dark quads standing 2 cm in front of the wall)
        wv, wf = [], []
        gz = n["baseZ"] + 0.3
        for side in (-1, 1):
            count = max(2, int((w if long_x else d) // 3.0))
            span = (w if long_x else d) - 1.6
            for j in range(count):
                t = -span / 2 + span * (j + 0.5) / count
                z0, z1 = gz + 0.9, gz + 2.1
                if j == 0 and side == -1:
                    z0, z1 = gz, gz + 2.1                    # the entrance
                halfw = 0.55 if not (j == 0 and side == -1) else 0.5
                if long_x:
                    y = side * (hd + 0.02)
                    pts = [(t - halfw, y, z0), (t + halfw, y, z0), (t + halfw, y, z1), (t - halfw, y, z1)]
                else:
                    x = side * (hw + 0.02)
                    pts = [(x, t - halfw, z0), (x, t + halfw, z0), (x, t + halfw, z1), (x, t - halfw, z1)]
                i0 = len(wv)
                wv.extend(pts)
                wf.append((i0, i0 + 1, i0 + 2, i0 + 3) if side > 0 else (i0 + 3, i0 + 2, i0 + 1, i0))
        wm = _mesh("neighbour_win_%d" % k, wv, wf, [glass or _material("nb_glass", "#2a3238", 0.1)])
        wo = bpy.data.objects.new(wm.name, wm)
        wo.parent = ob
        col.objects.link(wo)
    log("neighbours: %d houses" % len(scn.inputs.get("neighbours", [])))
