"""Neighbouring houses (`neighbours[]`: footprint, heights, hip or gable roof): rendered walls in the style
`neighbour_wall` colour on a graphite plinth band, a graphite roof (style `neighbour_roof`) with fascia and gutters, and windows
in anthracite frames with sills and opaque dark glazing (never the clear glass of our house, which would show the white wall
behind it). A seeded share of the windows glows faintly from inside: invisible in daylight, a lived-in light at dusk. The door
faces the street."""
from __future__ import annotations

import math

from mathutils import Vector

from .fences import MeshBuilder
from .util import hex_to_linear, log, rng

LIT_SHARE = 0.35
LIT_STRENGTH = 0.9


def _mat(name, hex_color, rough=0.9, metal=0.0, emit=0.0, var=0.0, scale=3.0):
    import bpy
    m = bpy.data.materials.get(name)
    if m is not None:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bs = nt.nodes.get("Principled BSDF")
    c = hex_to_linear(hex_color)
    bs.inputs["Base Color"].default_value = (*c, 1)
    bs.inputs["Roughness"].default_value = rough
    bs.inputs["Metallic"].default_value = metal
    if emit > 0:
        bs.inputs["Emission Color"].default_value = (1.0, 0.86, 0.68, 1)
        bs.inputs["Emission Strength"].default_value = emit
    if var > 0:
        tc = nt.nodes.new("ShaderNodeTexCoord")
        nz = nt.nodes.new("ShaderNodeTexNoise")
        nz.inputs["Scale"].default_value = scale
        nz.inputs["Detail"].default_value = 4
        nt.links.new(tc.outputs["Object"], nz.inputs["Vector"])
        ramp = nt.nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].color = (*[x * (1 - var) for x in c], 1)
        ramp.color_ramp.elements[1].color = (*[min(1.0, x * (1 + var * 0.5)) for x in c], 1)
        nt.links.new(nz.outputs["Fac"], ramp.inputs["Fac"])
        nt.links.new(ramp.outputs["Color"], bs.inputs["Base Color"])
    return m


def _wall_material(c3):
    from . import ground_materials as GM
    import bpy
    m = bpy.data.materials.get("nb_wall")
    if m is not None:
        return m
    return (GM.tinted_texture("nb_wall", "painted_plaster_wall", 2.5, c3.color("neighbour_wall", "#d9d5cb"), nstr=0.4,
                              anti_tile=False) or _mat("nb_wall", c3.color("neighbour_wall", "#d9d5cb")))


def build(scn, terrain):
    import bmesh
    import bpy
    c3 = scn.c3
    col = bpy.data.collections.new("neighbours")
    bpy.context.scene.collection.children.link(col)
    wall = _wall_material(c3)
    roof = _mat("nb_roof", c3.color("neighbour_roof", "#565b60"), 0.55, 0.15, var=0.12, scale=1.5)
    dark = _mat("nb_frame", "#2a2d30", 0.45, 0.4)
    plinth = _mat("nb_plinth", "#3a3d40", 0.85)
    glass = _mat("nb_glass", "#1d2327", 0.06)
    lit = _mat("nb_glass_lit", "#1d2327", 0.06, emit=LIT_STRENGTH)
    sill = _mat("nb_sill", "#8c9196", 0.35, 0.7)
    gutter = _mat("nb_gutter", "#3a3f43", 0.4, 0.7)
    st = c3.street()
    cl = st.get("centreLine") or []
    up = Vector((0, 0, 1))
    n_lit = 0
    for k, n in enumerate(scn.inputs.get("neighbours", [])):
        r = rng("neighbour", k)
        w, d = n["size"]
        cx, cy = n["center"]
        rot = math.radians(n["rotDeg"])
        ax = Vector((math.cos(rot), math.sin(rot), 0))
        ay = Vector((-ax.y, ax.x, 0))
        base = n["baseZ"] - 0.3
        eave, ridge = n["eaveZ"], n["ridgeZ"]
        o = n["roof"]["overhang"]
        pitch = math.radians(n["roof"]["pitchDeg"])
        hw, hd = w / 2.0, d / 2.0
        c = Vector((cx, cy, 0))

        def P(x, y, z):
            q = c + ax * x + ay * y
            return (q.x, q.y, z)
        # body and roof (local x along w)
        bm = bmesh.new()
        lo = [bm.verts.new(P(x, y, base)) for x, y in ((-hw, -hd), (hw, -hd), (hw, hd), (-hw, hd))]
        hi = [bm.verts.new(P(x, y, eave)) for x, y in ((-hw, -hd), (hw, -hd), (hw, hd), (-hw, hd))]
        for j in range(4):
            bm.faces.new((lo[j], lo[(j + 1) % 4], hi[(j + 1) % 4], hi[j]))
        long_x = w >= d
        ew, ed = hw + o, hd + o
        ez = eave - o * math.tan(pitch)
        rb = bmesh.new()
        if n["roof"]["kind"] == "hip":
            a = max(0.0, (hw - hd) if long_x else (hd - hw))
            rp = [(-a, 0), (a, 0)] if long_x else [(0, -a), (0, a)]
            e = [rb.verts.new(P(x, y, ez)) for x, y in ((-ew, -ed), (ew, -ed), (ew, ed), (-ew, ed))]
            rr = [rb.verts.new(P(x, y, ridge)) for x, y in rp]
            if long_x:
                for q in ((e[0], e[1], rr[1], rr[0]), (e[1], e[2], rr[1]), (e[2], e[3], rr[0], rr[1]), (e[3], e[0], rr[0])):
                    rb.faces.new(q)
            else:
                for q in ((e[0], e[1], rr[0]), (e[1], e[2], rr[1], rr[0]), (e[2], e[3], rr[1]), (e[3], e[0], rr[0], rr[1])):
                    rb.faces.new(q)
        else:
            if long_x:
                e = [rb.verts.new(P(x, y, ez)) for x, y in ((-ew, -ed), (ew, -ed), (ew, ed), (-ew, ed))]
                rr = [rb.verts.new(P(x, 0, ridge)) for x in (-ew, ew)]
                rb.faces.new((e[0], e[1], rr[1], rr[0]))
                rb.faces.new((e[2], e[3], rr[0], rr[1]))
                for x in (-hw, hw):
                    g = [bm.verts.new(P(x, -hd, eave)), bm.verts.new(P(x, hd, eave)), bm.verts.new(P(x, 0, ridge))]
                    bm.faces.new(g)
            else:
                e = [rb.verts.new(P(x, y, ez)) for x, y in ((-ew, -ed), (ew, -ed), (ew, ed), (-ew, ed))]
                rr = [rb.verts.new(P(0, y, ridge)) for y in (-ed, ed)]
                rb.faces.new((e[3], e[0], rr[0], rr[1]))
                rb.faces.new((e[1], e[2], rr[1], rr[0]))
                for y in (-hd, hd):
                    g = [bm.verts.new(P(-hw, y, eave)), bm.verts.new(P(hw, y, eave)), bm.verts.new(P(0, y, ridge))]
                    bm.faces.new(g)
        for b, mat, name in ((bm, wall, "neighbour_%d" % k), (rb, roof, "neighbour_roof_%d" % k)):
            bmesh.ops.recalc_face_normals(b, faces=b.faces)
            me = bpy.data.meshes.new(name)
            b.to_mesh(me)
            b.free()
            uv = me.uv_layers.new(name="UVMap")
            del uv
            me.materials.append(mat)
            col.objects.link(bpy.data.objects.new(name, me))
        # details: plinth band, fascia, gutters, windows, door
        mb = MeshBuilder()
        gz = n["baseZ"]
        for (x, y, L, dirv, nrm) in ((0, -hd, w, ax, -ay), (hw, 0, d, ay, ax), (0, hd, w, -ax, ay), (-hw, 0, d, -ay, -ax)):
            p = c + ax * x + ay * y + nrm * 0.015
            mb.box(Vector((p.x, p.y, base + (gz + 0.4 - base) / 2)), dirv, nrm, up, (L + 0.03, 0.03, gz + 0.4 - base), 0)
        for (x, y, L, dirv, nrm) in ((0, -ed, 2 * ew, ax, -ay), (ew, 0, 2 * ed, ay, ax), (0, ed, 2 * ew, -ax, ay), (-ew, 0, 2 * ed, -ay, -ax)):
            p = c + ax * x + ay * y
            mb.box(Vector((p.x, p.y, ez - 0.08)), dirv, nrm, up, (L, 0.03, 0.18), 1)
            q = p + nrm * 0.08
            mb.box(Vector((q.x, q.y, ez - 0.12)), dirv, nrm, up, (L, 0.12, 0.1), 5)
        # the facade facing the street gets the door
        sides = [((0, -hd), ax, -ay, w), ((hw, 0), ay, ax, d), ((0, hd), -ax, ay, w), ((-hw, 0), -ay, -ax, d)]
        door_side = 0
        if len(cl) >= 2:
            a0, a1 = Vector((*cl[0], 0)), Vector((*cl[-1], 0))
            def street_dist(pt):
                u = (a1 - a0).normalized()
                q = pt - a0
                return abs(q.x * u.y - q.y * u.x)
            door_side = min(range(4), key=lambda i: street_dist(c + ax * sides[i][0][0] + ay * sides[i][0][1]))
        for si, ((x, y), dirv, nrm, L) in enumerate(sides):
            face = c + ax * x + ay * y
            count = max(1, int(L // 3.2))
            span = L - 1.6
            for j in range(count):
                t = -span / 2 + span * (j + 0.5) / count if count > 1 else 0.0
                is_door = si == door_side and j == count // 2
                z0, z1 = (gz + 0.02, gz + 2.1) if is_door else (gz + 0.9, gz + 2.1)
                hwid = 0.5 if is_door else 0.6
                p = face + dirv * t
                fr = 0.06
                # frame ring proud of the wall, the pane set back in it, a sill below
                for (dx, dz, sx, sz) in ((0, z1 + fr / 2, 2 * hwid + 2 * fr, fr), (0, z0 - fr / 2, 2 * hwid + 2 * fr, fr),
                                         (hwid + fr / 2, (z0 + z1) / 2, fr, z1 - z0), (-hwid - fr / 2, (z0 + z1) / 2, fr, z1 - z0)):
                    q = p + dirv * dx + nrm * 0.04
                    mb.box(Vector((q.x, q.y, dz)), dirv, nrm, up, (sx, 0.08, sz), 1)
                lit_now = (not is_door) and r.random() < LIT_SHARE
                n_lit += lit_now
                q = p + nrm * 0.012
                mb.box(Vector((q.x, q.y, (z0 + z1) / 2)), dirv, nrm, up, (2 * hwid, 0.02, z1 - z0), 2 if is_door else (4 if lit_now else 3))
                if not is_door:
                    q = p + nrm * 0.06
                    mb.box(Vector((q.x, q.y, z0 - fr - 0.02)), dirv, nrm, up, (2 * hwid + 0.16, 0.14, 0.04), 6)
        mb.object("neighbour_details_%d" % k, [plinth, dark, dark, glass, lit, gutter, sill], col)
    log("neighbours: %d houses, %d lit windows" % (len(scn.inputs.get("neighbours", [])), n_lit))
