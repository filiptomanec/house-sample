"""Blender helpers (run inside Blender 5.1): materials, meshes from triangle soup, scene set-up for previews."""
import math
import os
import tempfile
import numpy as np
import bpy
from mathutils import Vector

from . import grain, palette as PAL

_IMG = {}


def reset():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.lights, bpy.data.cameras):
        for d in list(coll):
            coll.remove(d)
    for c in list(bpy.data.collections):
        bpy.data.collections.remove(c)


def wood_image(n=512):
    """Shared grain image (generated once per size) and the array it was made from."""
    if n not in _IMG:
        d = tempfile.mkdtemp(prefix='grain_')
        path, tex = grain.make(os.path.join(d, 'oak_grain.jpg'), n)
        img = bpy.data.images.load(path)
        img.name = 'oak_grain'
        img.pack()
        _IMG[n] = (img, tex, path)
    return _IMG[n]


def _sock(socks, ident):
    return next(s for s in socks if s.identifier == ident)


def material(name, tex_px=512, textured=True):
    """Get or create a palette material. Woods get the shared grain as base colour x tint."""
    m = bpy.data.materials.get(name)
    if m:
        return m
    col, rough, metal, alpha = PAL.PALETTE[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bs = nt.nodes.get('Principled BSDF')
    lin = PAL.srgb_to_linear(col)
    bs.inputs['Base Color'].default_value = (*lin, 1)
    bs.inputs['Roughness'].default_value = rough
    bs.inputs['Metallic'].default_value = metal
    if alpha < 1:
        bs.inputs['Alpha'].default_value = alpha
        try:
            m.surface_render_method = 'BLENDED'
        except Exception:
            pass
    m.use_backface_culling = False
    if name in PAL.WOOD and textured:
        img, tex, _ = wood_image(tex_px)
        f = grain.tint(lin, tex)
        ti = nt.nodes.new('ShaderNodeTexImage')
        ti.image = img
        ti.interpolation = 'Linear'
        ti.extension = 'REPEAT'
        mx = nt.nodes.new('ShaderNodeMix')
        mx.data_type = 'RGBA'
        mx.blend_type = 'MULTIPLY'
        _sock(mx.inputs, 'Factor_Float').default_value = 1.0
        _sock(mx.inputs, 'B_Color').default_value = (*f, 1.0)
        nt.links.new(ti.outputs['Color'], _sock(mx.inputs, 'A_Color'))
        nt.links.new(_sock(mx.outputs, 'Result_Color'), bs.inputs['Base Color'])
    return m


def mesh_object(name, pos, nrm, mat_name, uv=None, weld=True, collection=None, tex_px=512):
    """Object from triangle corners (n, 3, 3) with split normals (vertices shared where position, normal and UV agree)."""
    P3 = pos.reshape(-1, 3)
    N3 = nrm.reshape(-1, 3)
    parts = [np.round(P3 * 1e5), np.round(N3 * 1e4)]
    U2 = None
    if uv is not None:
        U2 = uv.reshape(-1, 2)
        parts.append(np.round(U2 * 1e5))
    key = np.concatenate(parts, axis=1).astype(np.int64)
    _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    inv = inv.reshape(-1, 3)
    ok = (inv[:, 0] != inv[:, 1]) & (inv[:, 1] != inv[:, 2]) & (inv[:, 0] != inv[:, 2])
    _, uniq = np.unique(np.sort(inv, axis=1), axis=0, return_index=True)
    keep = np.zeros(len(inv), bool)
    keep[uniq] = True
    ok &= keep
    inv = inv[ok]
    vp, vn = P3[first], N3[first]
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(vp))
    me.vertices.foreach_set('co', vp.astype(np.float32).ravel())
    nt = len(inv)
    me.loops.add(nt * 3)
    me.loops.foreach_set('vertex_index', inv.astype(np.int32).ravel())
    me.polygons.add(nt)
    me.polygons.foreach_set('loop_start', np.arange(0, nt * 3, 3, dtype=np.int32))
    me.update(calc_edges=True)
    me.polygons.foreach_set('use_smooth', np.ones(nt, dtype=bool))
    vn = vn / np.maximum(np.linalg.norm(vn, axis=1, keepdims=True), 1e-12)
    me.normals_split_custom_set_from_vertices([tuple(v) for v in vn])
    if U2 is not None:
        layer = me.uv_layers.new(name='UVMap')
        layer.data.foreach_set('uv', U2[first][inv].astype(np.float32).ravel())
    me.materials.append(material(mat_name, tex_px))
    o = bpy.data.objects.new(name, me)
    (collection or bpy.context.scene.collection).objects.link(o)
    return o, int((~ok).sum())


# ---- preview scene ----------------------------------------------------------------------------------------------

def setup_render(res=(1600, 1000), samples=48, engine='CYCLES', exposure=0.0):
    sc = bpy.context.scene
    sc.render.engine = engine
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = 'PNG'
    if engine == 'CYCLES':
        cy = sc.cycles
        cy.samples = samples
        cy.use_adaptive_sampling = True
        cy.adaptive_threshold = 0.03
        cy.max_bounces = 5
        cy.diffuse_bounces = 3
        cy.glossy_bounces = 3
        cy.transmission_bounces = 2
        cy.transparent_max_bounces = 6
        cy.sample_clamp_indirect = 4.0
        cy.use_denoising = True
        try:
            cy.denoiser = 'OPENIMAGEDENOISE'
        except Exception:
            pass
        try:
            prefs = bpy.context.preferences.addons['cycles'].preferences
            prefs.compute_device_type = 'METAL'
            prefs.get_devices()
            n = 0
            for d in prefs.devices:
                d.use = d.type != 'CPU'
                n += 1 if d.use else 0
            cy.device = 'GPU' if n else 'CPU'
        except Exception:
            cy.device = 'CPU'
    vs = sc.view_settings
    for vt in ('Khronos PBR Neutral', 'Standard'):
        try:
            vs.view_transform = vt
            break
        except Exception:
            continue
    try:
        vs.look = 'None'
    except Exception:
        pass
    vs.exposure = exposure


def setup_world(strength=1.0, color=(0.93, 0.95, 1.0)):
    sc = bpy.context.scene
    w = bpy.data.worlds.new('World')
    sc.world = w
    w.use_nodes = True
    nt = w.node_tree
    bg = nt.nodes.get('Background')
    bg.inputs['Color'].default_value = (*color, 1)
    bg.inputs['Strength'].default_value = strength


def add_sun(az_deg, el_deg, strength=3.0, size_deg=4.0):
    """Sun from compass azimuth (0 = +y north, 90 = +x east) and elevation."""
    d = bpy.data.lights.new('sun', 'SUN')
    d.energy = strength
    d.angle = math.radians(size_deg)
    o = bpy.data.objects.new('sun', d)
    bpy.context.scene.collection.objects.link(o)
    az, el = math.radians(az_deg), math.radians(el_deg)
    # direction the light comes from
    frm = Vector((math.sin(az) * math.cos(el), math.cos(az) * math.cos(el), math.sin(el)))
    o.rotation_euler = (-frm).to_track_quat('-Z', 'Y').to_euler()
    return o


def add_area(loc, size, energy, target=None, color=(1.0, 0.97, 0.92)):
    d = bpy.data.lights.new('area', 'AREA')
    d.energy = energy
    d.size = size
    d.color = color
    o = bpy.data.objects.new('area', d)
    bpy.context.scene.collection.objects.link(o)
    o.location = loc
    if target is not None:
        o.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    return o


def add_camera(eye, target, lens=24.0, ortho=None, clip=(0.05, 200.0)):
    cd = bpy.data.cameras.new('cam')
    cd.lens = lens
    cd.clip_start, cd.clip_end = clip
    if ortho:
        cd.type = 'ORTHO'
        cd.ortho_scale = ortho
    o = bpy.data.objects.new('cam', cd)
    bpy.context.scene.collection.objects.link(o)
    o.location = eye
    o.rotation_euler = (Vector(target) - Vector(eye)).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = o
    return o


def render(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return path
