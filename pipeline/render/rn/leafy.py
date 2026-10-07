"""Procedural leafy volumes: crown fillers for the scanned trees, shrubs, topiary balls, mounds, hedges and a pine. A leafy volume
is a noise-displaced mesh with a Voronoi leaf shader (colour from the species hint, darker inside, translucent edges)."""
from __future__ import annotations

import math

from mathutils import Matrix, Vector, noise

from .util import hex_to_linear, rng


def leaf_material(name, hex_color, dark=0.45, light=1.12, scale=14.0, flower=None, bump=0.6, rough=0.65):
    """Voronoi leaf-cluster shading in object space. `flower` = (hex, share) adds spots of a second colour."""
    import bpy
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nodes, links = m.node_tree.nodes, m.node_tree.links
    bs = nodes.get("Principled BSDF")
    tc = nodes.new("ShaderNodeTexCoord")
    vo = nodes.new("ShaderNodeTexVoronoi")
    vo.inputs["Scale"].default_value = scale
    links.new(tc.outputs["Object"], vo.inputs["Vector"])
    nz = nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = scale * 0.18
    nz.inputs["Detail"].default_value = 3
    links.new(tc.outputs["Object"], nz.inputs["Vector"])
    mix = nodes.new("ShaderNodeMath")
    mix.operation = "MULTIPLY_ADD"
    mix.inputs[1].default_value = 0.6
    links.new(vo.outputs["Distance"], mix.inputs[0])
    links.new(nz.outputs["Fac"], mix.inputs[2])
    ramp = nodes.new("ShaderNodeValToRGB")
    base = hex_to_linear(hex_color)
    ramp.color_ramp.elements[0].color = (*[c * dark for c in base], 1)
    ramp.color_ramp.elements[1].color = (*[min(1.0, c * light) for c in base], 1)
    links.new(mix.outputs[0], ramp.inputs["Fac"])
    col = ramp.outputs["Color"]
    if flower:
        fx, share = flower
        nf = nodes.new("ShaderNodeTexNoise")
        nf.inputs["Scale"].default_value = scale * 0.5
        nf.inputs["Detail"].default_value = 1
        links.new(tc.outputs["Object"], nf.inputs["Vector"])
        mr = nodes.new("ShaderNodeMapRange")
        mr.inputs["From Min"].default_value = 1.0 - share - 0.05
        mr.inputs["From Max"].default_value = 1.0 - share + 0.05
        links.new(nf.outputs["Fac"], mr.inputs["Value"])
        mx = nodes.new("ShaderNodeMix")
        mx.data_type = "RGBA"
        links.new(mr.outputs[0], mx.inputs[0])
        links.new(col, mx.inputs[6])
        mx.inputs[7].default_value = (*hex_to_linear(fx), 1)
        col = mx.outputs[2]
    links.new(col, bs.inputs["Base Color"])
    bs.inputs["Roughness"].default_value = max(rough, 0.75)
    if "Specular IOR Level" in bs.inputs:
        bs.inputs["Specular IOR Level"].default_value = 0.2
    # two scales of bump: leaf clusters and single leaves
    vo2 = nodes.new("ShaderNodeTexVoronoi")
    vo2.inputs["Scale"].default_value = scale * 4.0
    links.new(tc.outputs["Object"], vo2.inputs["Vector"])
    hm = nodes.new("ShaderNodeMath")
    hm.operation = "ADD"
    links.new(vo.outputs["Distance"], hm.inputs[0])
    links.new(vo2.outputs["Distance"], hm.inputs[1])
    bu = nodes.new("ShaderNodeBump")
    bu.inputs["Strength"].default_value = bump
    bu.inputs["Distance"].default_value = 0.03
    links.new(hm.outputs[0], bu.inputs["Height"])
    links.new(bu.outputs[0], bs.inputs["Normal"])
    return m


def _ico(bm, radius, subdiv):
    import bmesh
    return bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=radius)


def _displace(bm, amp, freq, seed, flatten_below=None):
    off = Vector((seed * 7.31, seed * 3.17, seed * 1.93))
    for v in bm.verts:
        n = noise.fractal((v.co + off) * freq, 0.5, 2.0, 3)
        d = Vector(v.normal) if v.normal.length else v.co.normalized()
        v.co += d * (n * amp)
        if flatten_below is not None and v.co.z < flatten_below[0]:
            v.co.z = flatten_below[0] + (v.co.z - flatten_below[0]) * flatten_below[1]


def ball(name, radius, material, seed, squash=0.9, subdiv=5, amp=0.06, base_cut=0.55):
    """Clipped ball standing on the ground (topiary, shrub mound): origin at the base."""
    import bmesh
    import bpy
    bm = bmesh.new()
    _ico(bm, 1.0, subdiv)
    for v in bm.verts:
        v.co.x *= radius
        v.co.y *= radius * (0.94 + 0.08 * math.sin(seed))
        v.co.z *= radius * squash
    _displace(bm, amp * radius, 1.0 / max(radius, 0.2) * 2.0, seed, flatten_below=(-radius * squash * 0.5, 0.15))
    for v in bm.verts:
        v.co.z += radius * squash * 0.5
    bm.normal_update()
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    me.materials.append(material)
    return bpy.data.objects.new(name, me)


def hedge(name, path, zfunc, height, width, material, seed, step=0.1):
    """A clipped hedge along a polyline: rounded-rectangle profile, noise on the surface, ends capped. `zfunc(x, y)` = ground."""
    import bmesh
    import bpy
    pts = []
    for i in range(len(path) - 1):
        a, b = Vector((*path[i], 0)), Vector((*path[i + 1], 0))
        n = max(1, int((b - a).length / step))
        for k in range(n):
            pts.append(a.lerp(b, k / n))
    pts.append(Vector((*path[-1], 0)))
    # profile in (side, z): straight sides, rounded top
    prof = []
    for k in range(11):                          # left side, from the bottom to the shoulder
        prof.append((-0.5 * width, (height - 0.4 * width) * k / 10.0))
    for k in range(1, 13):                       # rounded top (half circle of the radius 0.4 x width, flattened)
        t = math.pi * k / 13
        prof.append((-0.5 * width + 0.5 * width * (1 - math.cos(t)), (height - 0.4 * width) + 0.4 * width * math.sin(t)))
    for k in range(11):                          # right side, down
        prof.append((0.5 * width, (height - 0.4 * width) * (1 - (k + 1) / 11.0)))
    bm = bmesh.new()
    rings = []
    for i, p in enumerate(pts):
        d = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)])
        d.z = 0
        d.normalize()
        side = Vector((-d.y, d.x, 0))
        g = zfunc(p.x, p.y) - 0.05
        wob = 1.0 + 0.04 * noise.noise(Vector((p.x, p.y, seed)) * 0.7)
        ring = [bm.verts.new((p.x + side.x * s * wob, p.y + side.y * s * wob, g + z * wob)) for s, z in prof]
        rings.append(ring)
    for i in range(len(rings) - 1):
        for k in range(len(prof) - 1):
            bm.faces.new((rings[i][k], rings[i][k + 1], rings[i + 1][k + 1], rings[i + 1][k]))
    bm.faces.new(rings[0][::-1])
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.normal_update()
    off = Vector((seed * 5.1, seed * 2.3, 0))
    for v in bm.verts:
        n = noise.fractal(v.co * 3.2 + off, 0.5, 2.0, 3) * 0.07 + noise.noise(v.co * 14.0 + off) * 0.035
        v.co += v.normal * n
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    me.materials.append(material)
    return bpy.data.objects.new(name, me)
