"""Procedural herbaceous plants (own geometry, no asset): clumps of bent ribbons for the ornamental grass (miscanthus) and the
needle dome of the lavender, plus flower spikes and plumes. A ribbon is a tapered blade of a few segments that rises at a tilt
and arches over towards its tip; the clump is one mesh with UVs (v = 0 at the root .. 1 at the tip) and a per-blade random
value (`blade` attribute) that the shader uses for a gradient and a tone. Sizes come from the data (height, width of the plant)
and from `config.json` `shrubs` (counts, proportions); the colours from the species colours of the data."""
from __future__ import annotations

import math

from mathutils import Vector

from .util import hex_to_linear, rng


def ribbons(verts, faces, uvs, attr, base, h, w, tilt_deg, yaw, arch, rnd, segs=4, twist=0.0):
    """Appends one ribbon: root at `base`, length `h`, root width `w`, rising at `tilt_deg` from the vertical towards `yaw`,
    bending further over by `arch` (0 straight .. 1 strongly arched) towards its tip."""
    i0 = len(verts)
    t0 = math.radians(tilt_deg)
    out = Vector((math.cos(yaw), math.sin(yaw), 0.0))
    across = Vector((-math.sin(yaw + twist), math.cos(yaw + twist), 0.0))
    p = Vector(base)
    step = h / segs
    for k in range(segs + 1):
        t = k / segs
        half = 0.5 * w * (1.0 - t ** 1.4)
        if k == segs:
            verts.append(tuple(p))
            uvs.append((0.5, 1.0))
        else:
            verts.append(tuple(p - across * half))
            verts.append(tuple(p + across * half))
            uvs += [(0.0, t), (1.0, t)]
        ang = t0 + (math.pi / 2 - t0) * arch * (t + 0.5 / segs) ** 1.5      # tilt grows along the blade (the arch)
        d = out * math.sin(ang) + Vector((0.0, 0.0, 1.0)) * math.cos(ang)
        p = p + d * step
    for k in range(segs - 1):
        a = i0 + 2 * k
        faces.append((a, a + 1, a + 3, a + 2))
    tip = i0 + 2 * segs
    faces.append((tip - 2, tip - 1, tip))
    attr += [rnd] * (2 * segs + 1)


def build_mesh(name, verts, faces, uvs, attr, material):
    import bpy
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    uvl = me.uv_layers.new(name="UVMap")
    for poly in me.polygons:
        poly.use_smooth = True
        for li, vi in zip(poly.loop_indices, poly.vertices):
            uvl.data[li].uv = uvs[vi]
    at = me.attributes.new("blade", "FLOAT", "POINT")
    at.data.foreach_set("value", attr)
    me.update()
    me.materials.append(material)
    return bpy.data.objects.new(name, me)


def herb_material(name, root_hex, tip_hex, translucency=0.3, rough=0.55, tone=0.22, sheen=0.0):
    """Root-to-tip gradient, a random tone per blade, translucent like a thin leaf."""
    import bpy
    m = bpy.data.materials.get(name)
    if m is not None:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nodes, links = m.node_tree.nodes, m.node_tree.links
    bs = nodes.get("Principled BSDF")
    out = next(n for n in nodes if n.type == "OUTPUT_MATERIAL")
    bs.inputs["Roughness"].default_value = rough
    if "Specular IOR Level" in bs.inputs:
        bs.inputs["Specular IOR Level"].default_value = 0.35
    if sheen and "Sheen Weight" in bs.inputs:
        bs.inputs["Sheen Weight"].default_value = sheen
    uv = nodes.new("ShaderNodeUVMap")
    sep = nodes.new("ShaderNodeSeparateXYZ")
    links.new(uv.outputs[0], sep.inputs[0])
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (*hex_to_linear(root_hex), 1)
    ramp.color_ramp.elements[1].color = (*hex_to_linear(tip_hex), 1)
    links.new(sep.outputs["Y"], ramp.inputs["Fac"])
    at = nodes.new("ShaderNodeAttribute")
    at.attribute_name = "blade"
    mr = nodes.new("ShaderNodeMapRange")
    mr.inputs["To Min"].default_value = 1.0 - tone
    mr.inputs["To Max"].default_value = 1.0 + tone * 0.6
    links.new(at.outputs["Fac"], mr.inputs["Value"])
    hsv = nodes.new("ShaderNodeHueSaturation")
    links.new(mr.outputs[0], hsv.inputs["Value"])
    links.new(ramp.outputs["Color"], hsv.inputs["Color"])
    links.new(hsv.outputs[0], bs.inputs["Base Color"])
    tr = nodes.new("ShaderNodeBsdfTranslucent")
    links.new(hsv.outputs[0], tr.inputs["Color"])
    mix = nodes.new("ShaderNodeMixShader")
    mix.inputs[0].default_value = translucency
    links.new(bs.outputs[0], mix.inputs[1])
    links.new(tr.outputs[0], mix.inputs[2])
    links.new(mix.outputs[0], out.inputs[0])
    return m


def shade(hex_color, f, sat=1.0):
    """A colour `f` times as bright (linear), its saturation scaled by `sat` (towards its own grey)."""
    c = hex_to_linear(hex_color)
    g = sum(c) / 3.0
    c = [min(1.0, (g + (x - g) * sat) * f) for x in c]
    return "#" + "".join("%02x" % int(round(255 * (x ** (1 / 2.2)))) for x in c)


def lavender(name, s, z, cfg, leaf_mat, spike_mat, stem_mat):
    """Needle dome (grey-green), flower stems rising above it with violet spikes. Returns the objects."""
    sc = cfg["shrubs"]["lavender"]
    r = rng("lavender", s["seed"])
    w, h = float(s["width"]) * float(s.get("scale", 1.0)), float(s["height"]) * float(s.get("scale", 1.0))
    dome_h = h * float(sc["domeShare"])
    v, f, uv, at = [], [], [], []
    for _ in range(int(sc["needles"])):
        a = r.uniform(0, 2 * math.pi)
        rr = w * 0.12 * math.sqrt(r.random())
        base = (s["x"] + math.cos(a) * rr, s["y"] + math.sin(a) * rr, z - 0.02)
        tilt = r.uniform(5, 78)
        L = dome_h * r.uniform(0.75, 1.1) / max(0.35, math.cos(math.radians(tilt)) * 0.9 + 0.1)
        L = min(L, w * 0.62)
        ribbons(v, f, uv, at, base, L, r.uniform(0.003, 0.0045), tilt, a + r.uniform(-0.3, 0.3), 0.25, r.random(), segs=3)
    dome = build_mesh(name + "_leaves", v, f, uv, at, leaf_mat)
    # flower stems: straight, slightly splayed, from inside the dome to the full height; the spike is the top part
    v, f, uv, at = [], [], [], []
    tips = []
    for _ in range(int(cfg["shrubs"]["lavenderSpikes"])):
        a = r.uniform(0, 2 * math.pi)
        rr = w * 0.3 * math.sqrt(r.random())
        base = Vector((s["x"] + math.cos(a) * rr, s["y"] + math.sin(a) * rr, z + dome_h * 0.35))
        tilt = 4 + 30 * (rr / (w * 0.3))
        L = (h - dome_h * 0.35) * r.uniform(0.8, 1.05)
        ribbons(v, f, uv, at, base, L, 0.0025, tilt, a, 0.0, r.random(), segs=2)
        d = Vector((math.cos(a) * math.sin(math.radians(tilt)), math.sin(a) * math.sin(math.radians(tilt)),
                    math.cos(math.radians(tilt))))
        tips.append((base + d * L, d, r.uniform(0.05, 0.08)))
    stems = build_mesh(name + "_stems", v, f, uv, at, stem_mat)
    spikes = spikes_mesh(name + "_spikes", tips, 0.0065, spike_mat)
    return [dome, stems, spikes]


def spikes_mesh(name, tips, radius, material, whorls=5):
    """Flower spikes: a short column of small whorls (flattened spheres) below each tip along its direction."""
    import bmesh
    import bpy
    bm = bmesh.new()
    for tip, ax, L in tips:
        q = ax.to_track_quat("Z", "Y")
        for k in range(whorls):
            t = k / max(1, whorls - 1)
            c = tip - ax * (L * (1.0 - t))
            rad = radius * (1.0 - 0.45 * t)
            res = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0)
            for vv in res["verts"]:
                p = Vector((vv.co.x * rad, vv.co.y * rad, vv.co.z * L / whorls * 0.62))
                p.rotate(q)
                vv.co = c + p
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    me.materials.append(material)
    return bpy.data.objects.new(name, me)


def miscanthus(name, s, z, cfg, leaf_mat, plume_mat):
    """A fountain of long arching leaves and upright stems with feathery plumes."""
    sc = cfg["shrubs"]["miscanthus"]
    r = rng("miscanthus", s["seed"])
    w, h = float(s["width"]) * float(s.get("scale", 1.0)), float(s["height"]) * float(s.get("scale", 1.0))
    v, f, uv, at = [], [], [], []
    for _ in range(int(sc["leaves"])):
        a = r.uniform(0, 2 * math.pi)
        rr = w * 0.1 * math.sqrt(r.random())
        base = (s["x"] + math.cos(a) * rr, s["y"] + math.sin(a) * rr, z - 0.03)
        tilt = r.uniform(3, 32)
        L = h * float(sc["leafShare"]) * r.uniform(0.7, 1.12)
        ribbons(v, f, uv, at, base, L, r.uniform(0.008, 0.014), tilt, a, r.uniform(0.35, 0.8), r.random(), segs=6,
                twist=r.uniform(-0.4, 0.4))
    leaves = build_mesh(name + "_leaves", v, f, uv, at, leaf_mat)
    v, f, uv, at = [], [], [], []
    tips = []
    for _ in range(int(sc["plumes"])):
        a = r.uniform(0, 2 * math.pi)
        rr = w * 0.08 * math.sqrt(r.random())
        base = Vector((s["x"] + math.cos(a) * rr, s["y"] + math.sin(a) * rr, z))
        tilt = r.uniform(2, 14)
        L = h * r.uniform(0.92, 1.05)
        ribbons(v, f, uv, at, base, L, 0.004, tilt, a, 0.05, r.random(), segs=3)
        d = Vector((math.cos(a) * math.sin(math.radians(tilt)), math.sin(a) * math.sin(math.radians(tilt)),
                    math.cos(math.radians(tilt))))
        tips.append((base + d * L, d, h * r.uniform(0.12, 0.18)))
    stems = build_mesh(name + "_stems", v, f, uv, at, leaf_mat)
    plumes = plume_mesh(name + "_plumes", tips, r, plume_mat)
    return [leaves, stems, plumes]


def plume_mesh(name, tips, r, material, strands=7):
    """Feathery plumes: a few thin strands fanning from the top of each stem, nodding a little."""
    v, f, uv, at = [], [], [], []
    for tip, ax, L in tips:
        base = tip - ax * L
        yaw0 = math.atan2(ax.y, ax.x)
        for k in range(strands):
            a = yaw0 + r.uniform(-math.pi, math.pi)
            ribbons(v, f, uv, at, tuple(base + ax * (L * 0.1 * k / strands)), L * r.uniform(0.75, 1.0), 0.012,
                    r.uniform(2, 12), a, 0.25, r.random(), segs=3)
    return build_mesh(name, v, f, uv, at, material)


def segment(verts, faces, uvs, attr, p0, p1, w, rnd):
    """A flat stem piece from p0 to p1 (a quad facing sideways)."""
    d = (p1 - p0)
    side = d.cross(Vector((0.0, 0.0, 1.0)))
    side = (side.normalized() if side.length > 1e-9 else Vector((1.0, 0.0, 0.0))) * (w / 2)
    i0 = len(verts)
    verts += [tuple(p0 - side), tuple(p0 + side), tuple(p1 + side * 0.8), tuple(p1 - side * 0.8)]
    uvs += [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]
    faces.append((i0, i0 + 1, i0 + 2, i0 + 3))
    attr += [rnd] * 4


def leaf_quads(verts, faces, uvs, attr, base, direction, normal, length, width, rnd):
    """One ovate leaf as a small fan (a petiole point, two rows of outline points, the tip), lying in the plane spanned by
    `direction` and the side vector, its face turned towards `normal`; UV v along the leaf, u across."""
    side = direction.cross(normal).normalized()
    i0 = len(verts)
    verts.append(tuple(base))
    uvs.append((0.5, 0.0))
    prof = ((0.25, 0.75), (0.5, 1.0), (0.75, 0.7))
    for t, wf in prof:
        c = base + direction * (length * t) - normal * (length * 0.06 * t * t)       # the blade droops a little
        for sgn, u in ((-1, 0.0), (1, 1.0)):
            verts.append(tuple(c + side * (sgn * width * 0.5 * wf)))
            uvs.append((u, t))
    verts.append(tuple(base + direction * length - normal * (length * 0.08)))
    uvs.append((0.5, 1.0))
    # fan: base, rows (l0 r0) (l1 r1) (l2 r2), tip
    b, l0, r0, l1, r1, l2, r2, tp = range(i0, i0 + 8)
    faces += [(b, r0, l0), (l0, r0, r1, l1), (l1, r1, r2, l2), (l2, r2, tp)]
    attr += [rnd] * 8


def hydrangea(name, s, z, cfg, leaf_mat, panicle_mat, stem_mat):
    """A panicle hydrangea: arching stems from the base, opposite leaves along them, a cone-shaped panicle at every tip."""
    import bmesh
    import bpy
    from mathutils import noise
    sc = cfg["shrubs"]["hydrangea"]
    r = rng("hydrangea", s["seed"])
    w, h = float(s["width"]) * float(s.get("scale", 1.0)), float(s["height"]) * float(s.get("scale", 1.0))
    lv, lf, lu, la = [], [], [], []
    sv, sf, su, sa = [], [], [], []
    tips = []
    up = Vector((0.0, 0.0, 1.0))
    for k in range(int(sc["stems"])):
        a = 2 * math.pi * (k + r.uniform(-0.4, 0.4)) / int(sc["stems"])
        # a mound: every stem leaves the base sideways and rises; outer stems reach far and stay lower, inner ones are tall
        reach = w * 0.5 * r.uniform(0.3, 1.0)
        top = h * (1.0 - 0.4 * (reach / (w * 0.5)) ** 2) * r.uniform(0.85, 1.0)
        base = Vector((s["x"] + math.cos(a) * 0.06, s["y"] + math.sin(a) * 0.06, z - 0.02))
        n_pts = 6
        out = Vector((math.cos(a), math.sin(a), 0.0))
        pts = [base + out * (reach * (1.0 - (1.0 - i / n_pts) ** 2)) + up * (top * (i / n_pts) ** 0.9) for i in range(n_pts + 1)]
        for i in range(n_pts):
            segment(sv, sf, su, sa, pts[i], pts[i + 1], 0.012 * (1 - 0.5 * i / n_pts), r.random())
        d_tip = (pts[-1] - pts[-2]).normalized()
        tips.append((pts[-1], d_tip, r.uniform(0.12, 0.2) * h / 1.4))
        # opposite leaf pairs along the stem (two pairs per segment); the blades hang out and down at random rolls, so the
        # shrub reads as foliage from eye level, not as edge-on leaves
        for i in range(1, 3 * n_pts + 1):
            t = i / (3.0 * n_pts)
            j = min(int(t * n_pts), n_pts - 1)
            p = pts[j].lerp(pts[j + 1], t * n_pts - j)
            dstem = (pts[j + 1] - pts[j]).normalized()
            for pair in range(2):
                yaw = a + math.pi / 2 + pair * math.pi + r.uniform(-0.5, 0.5) + i * 0.9
                outv = Vector((math.cos(yaw), math.sin(yaw), 0.0))
                dleaf = (outv * 0.75 + dstem * 0.25 - up * r.uniform(0.1, 0.65)).normalized()
                side = dleaf.cross(up).normalized()
                face = side.cross(dleaf).normalized()
                roll = r.uniform(-1.1, 1.1)
                nrm = (face * math.cos(roll) + side * math.sin(roll)).normalized()
                L_leaf = float(sc["leafM"]) * r.uniform(0.75, 1.15) * (1.0 - 0.25 * t)
                leaf_quads(lv, lf, lu, la, p, dleaf, nrm, L_leaf, L_leaf * 0.55, r.random())
    objs = [build_mesh(name + "_leaves", lv, lf, lu, la, leaf_mat), build_mesh(name + "_stems", sv, sf, su, sa, stem_mat)]
    # panicles: noise-bumped cones (florets) on the stem tips
    bm = bmesh.new()
    for tip, ax, L in tips:
        q = (ax + up * 1.5).normalized().to_track_quat("Z", "Y")
        res = bmesh.ops.create_icosphere(bm, subdivisions=3, radius=1.0)
        seed = r.uniform(0, 100)
        for v in res["verts"]:
            zc = (v.co.z + 1) * 0.5                                     # 0 at the base .. 1 at the tip
            rad = L * 0.36 * (1.0 - 0.75 * zc ** 1.3)
            p = Vector((v.co.x * rad, v.co.y * rad, zc * L - L * 0.15))
            if p.length > 1e-6:
                p += p.normalized() * (noise.noise(p * 38.0 + Vector((seed, 0, 0))) * L * 0.1
                                       + noise.noise(p * 90.0 + Vector((0, seed, 0))) * L * 0.04)
            p.rotate(q)
            v.co = tip + p
    me = bpy.data.meshes.new(name + "_panicles")
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    me.materials.append(panicle_mat)
    objs.append(bpy.data.objects.new(me.name, me))
    return objs


def panicle_material(name, hex_color, leaf_hex):
    """Cream florets: Voronoi cells for the single flowers, a lime tint towards the tip, translucent petals."""
    import bpy
    m = bpy.data.materials.get(name)
    if m is not None:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nodes, links = m.node_tree.nodes, m.node_tree.links
    bs = nodes.get("Principled BSDF")
    out = next(n for n in nodes if n.type == "OUTPUT_MATERIAL")
    tc = nodes.new("ShaderNodeTexCoord")
    vo = nodes.new("ShaderNodeTexVoronoi")
    vo.feature = "DISTANCE_TO_EDGE"
    vo.inputs["Scale"].default_value = 120.0
    links.new(tc.outputs["Object"], vo.inputs["Vector"])
    ramp = nodes.new("ShaderNodeValToRGB")
    base = hex_to_linear(hex_color)
    ramp.color_ramp.elements[0].color = (*[c * 0.45 for c in base], 1)
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[1].color = (*base, 1)
    ramp.color_ramp.elements[1].position = 0.12
    links.new(vo.outputs["Distance"], ramp.inputs["Fac"])
    nz = nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 9.0
    links.new(tc.outputs["Object"], nz.inputs["Vector"])
    mx = nodes.new("ShaderNodeMix")
    mx.data_type = "RGBA"
    mr = nodes.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = 0.45
    mr.inputs["From Max"].default_value = 0.75
    mr.inputs["To Max"].default_value = 0.35
    links.new(nz.outputs["Fac"], mr.inputs["Value"])
    links.new(mr.outputs[0], mx.inputs[0])
    links.new(ramp.outputs["Color"], mx.inputs[6])
    mx.inputs[7].default_value = (*hex_to_linear(shade(leaf_hex, 1.6, 0.6)), 1)
    links.new(mx.outputs[2], bs.inputs["Base Color"])
    bs.inputs["Roughness"].default_value = 0.7
    bu = nodes.new("ShaderNodeBump")
    bu.inputs["Strength"].default_value = 0.6
    links.new(vo.outputs["Distance"], bu.inputs["Height"])
    links.new(bu.outputs[0], bs.inputs["Normal"])
    tr = nodes.new("ShaderNodeBsdfTranslucent")
    links.new(mx.outputs[2], tr.inputs["Color"])
    mix = nodes.new("ShaderNodeMixShader")
    mix.inputs[0].default_value = 0.3
    links.new(bs.outputs[0], mix.inputs[1])
    links.new(tr.outputs[0], mix.inputs[2])
    links.new(mix.outputs[0], out.inputs[0])
    return m
