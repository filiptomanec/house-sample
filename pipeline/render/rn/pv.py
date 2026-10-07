"""PV modules on the roof (render-inputs.json: pv.panels): a dark glass face with a cell grid in an aluminium frame, held
`standoff` above the roof plane."""
from __future__ import annotations

from mathutils import Vector

from . import ground_materials as GM
from .util import hex_to_linear, log


def _pv_glass():
    import bpy
    m = bpy.data.materials.new("pv_glass")
    m.use_nodes = True
    nodes, links = m.node_tree.nodes, m.node_tree.links
    bs = nodes.get("Principled BSDF")
    uv = nodes.new("ShaderNodeUVMap")
    mp = nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (6.0, 10.0, 1.0)         # 6 x 10 cells per module (uv 0..1 over the module)
    links.new(uv.outputs[0], mp.inputs[0])
    br = nodes.new("ShaderNodeTexBrick")
    br.offset = 0.0
    br.inputs["Scale"].default_value = 1.0
    br.inputs["Mortar Size"].default_value = 0.035
    br.inputs["Mortar Smooth"].default_value = 0.0
    br.inputs["Bias"].default_value = 0.0
    br.inputs["Brick Width"].default_value = 1.0
    br.inputs["Row Height"].default_value = 1.0
    br.inputs["Color1"].default_value = (*hex_to_linear("#101a2e"), 1)
    br.inputs["Color2"].default_value = (*hex_to_linear("#142038"), 1)
    br.inputs["Mortar"].default_value = (*hex_to_linear("#8a95a8"), 1)
    links.new(mp.outputs[0], br.inputs["Vector"])
    links.new(br.outputs["Color"], bs.inputs["Base Color"])
    bs.inputs["Roughness"].default_value = 0.12
    bs.inputs["Metallic"].default_value = 0.0
    for key, val in (("Coat Weight", 0.6), ("Coat Roughness", 0.03), ("Specular IOR Level", 0.8)):
        if key in bs.inputs:
            bs.inputs[key].default_value = val
    return m


def _frame_mat():
    import bpy
    m = bpy.data.materials.new("pv_frame")
    m.use_nodes = True
    bs = m.node_tree.nodes.get("Principled BSDF")
    bs.inputs["Base Color"].default_value = (*hex_to_linear("#9aa0a6"), 1)
    bs.inputs["Metallic"].default_value = 0.9
    bs.inputs["Roughness"].default_value = 0.4
    return m


def build(scn):
    import bpy
    pv = scn.inputs["pv"]
    thick, frame, stand = pv["thickness"], pv["frame"], pv["standoff"]
    col = bpy.data.collections.new("pv")
    bpy.context.scene.collection.children.link(col)
    verts, faces, fmat, uvs = [], [], [], []

    def quad(p, mat, uv=None):
        i0 = len(verts)
        verts.extend(p)
        faces.append((i0, i0 + 1, i0 + 2, i0 + 3))
        fmat.append(mat)
        uvs.append(uv or [(0, 0), (1, 0), (1, 1), (0, 1)])
    for panel in pv["panels"]:
        c = [Vector(p) for p in panel["corners"]]
        n = Vector(panel["normal"]).normalized()
        base = [p + n * stand for p in c]
        top = [p + n * (stand + thick) for p in c]
        # sides (frame), counter-clockwise outward
        for i in range(4):
            j = (i + 1) % 4
            quad([base[i], base[j], top[j], top[i]], 0)
        # frame rim on top: the glass is inset by `frame`
        ctr = sum(base, Vector()) / 4.0
        e01 = (c[1] - c[0]).normalized()
        e03 = (c[3] - c[0]).normalized()
        inner = []
        for i in range(4):
            sx = 1 if i in (1, 2) else -1
            sy = 1 if i in (2, 3) else -1
            inner.append(top[i] + e01 * (-sx * frame) + e03 * (-sy * frame))
        for i in range(4):
            j = (i + 1) % 4
            quad([top[i], top[j], inner[j], inner[i]], 0)
        glass_top = [p - n * 0.004 for p in inner]
        quad(glass_top, 1)
        # underside
        quad([base[3], base[2], base[1], base[0]], 0)
    me = bpy.data.meshes.new("pv")
    me.from_pydata(verts, [], faces)
    me.materials.append(_frame_mat())
    me.materials.append(_pv_glass())
    for p, m in zip(me.polygons, fmat):
        p.material_index = m
    uv = me.uv_layers.new(name="UVMap")
    k = 0
    for p, q in zip(me.polygons, uvs):
        for li, loop_index in enumerate(p.loop_indices):
            uv.data[loop_index].uv = q[li]
    me.update()
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new("pv", me)
    col.objects.link(ob)
    log("pv: %d modules" % len(pv["panels"]))
