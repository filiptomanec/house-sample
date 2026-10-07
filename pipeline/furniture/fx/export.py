"""Blender side of the build: scene objects per room and material, GLB export (Draco, WebP wood grain)."""
import json
import math
import os
import re
import struct
import bpy

from . import bl, assemble, palette as PAL


def node_zone(zone):
    """Room ids lose '.' and '-' in node names (three.js strips dots)."""
    return re.sub(r'[.\-]', '_', str(zone))


def make_objects(scene, tex_px):
    """Joins every item per (zone, material) and creates one Blender mesh object per bucket under the root `furniture`."""
    entries = [(it.zone, it.soup) for it in scene.items]
    buckets = assemble.bucket(entries)
    root = bpy.data.objects.new('furniture', None)
    bpy.context.scene.collection.objects.link(root)
    info = {}
    dropped = 0
    # terrace first, then rooms, then material (stable order)
    for (zone, mat) in sorted(buckets, key=lambda k: (k[0] != 'terrace', str(k[0]), k[1])):
        pos, nrm, uv = buckets[(zone, mat)]
        name = 'furniture_%s_%s' % (node_zone(zone), mat)
        o, dr = bl.mesh_object(name, pos, nrm, mat, uv, tex_px=tex_px)
        o.parent = root
        o['role'] = mat
        o['toggle'] = 'furniture'
        o['roomId'] = str(zone)
        dropped += dr
        info[name] = {'zone': str(zone), 'material': mat, 'triangles': len(o.data.polygons), 'vertices': len(o.data.vertices)}
    return root, info, dropped


def finish_materials():
    """Materials for the web: double sided, no sheen (the exporter writes sheen at full strength)."""
    for mt in bpy.data.materials:
        if mt.name not in PAL.PALETTE:
            continue
        bs = mt.node_tree.nodes.get('Principled BSDF')
        if bs and 'Sheen Weight' in bs.inputs:
            bs.inputs['Sheen Weight'].default_value = 0.0
        mt.use_backface_culling = False


def export_glb(path, texture_format='WEBP', quality=80):
    for o in bpy.data.objects:
        o.select_set(o.name.startswith('furniture'))
    kw = dict(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=False,
              export_texcoords=True, export_normals=True, export_tangents=False, export_materials='EXPORT',
              export_image_format=texture_format, export_image_quality=quality, export_extras=True,
              export_cameras=False, export_lights=False, export_animations=False, export_skins=False, export_morph=False,
              export_attributes=False, export_vertex_color='NONE',
              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=10,
              export_draco_position_quantization=14, export_draco_normal_quantization=10,
              export_draco_texcoord_quantization=12)
    bpy.ops.export_scene.gltf(**kw)
    return tidy_glb(path)


def tidy_glb(path, digits=5):
    """Rewrite the JSON chunk compactly: accessor min/max are rounded outwards to `digits` decimals (the exporter writes 16
    significant digits, which is noise for Draco-quantised positions) and the JSON is minified. The binary chunk is untouched."""
    with open(path, 'rb') as f:
        data = f.read()
    jl = struct.unpack_from('<I', data, 12)[0]
    j = json.loads(data[20:20 + jl].decode('utf-8'))
    q = 10 ** digits
    for a in j.get('accessors', []):
        if 'min' in a and 'max' in a and a.get('type') in ('VEC3', 'VEC2', 'SCALAR'):
            a['min'] = [math.floor(v * q) / q for v in a['min']]
            a['max'] = [math.ceil(v * q) / q for v in a['max']]
    blob = json.dumps(j, separators=(',', ':'), ensure_ascii=False).encode('utf-8')
    blob += b' ' * (-len(blob) % 4)
    rest = data[20 + jl:]                                   # BIN chunk (header and payload)
    out = struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(blob) + len(rest))
    out += struct.pack('<I4s', len(blob), b'JSON') + blob + rest
    with open(path, 'wb') as f:
        f.write(out)
    return len(out)
