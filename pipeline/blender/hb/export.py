"""Exporters: GLB (Draco geometry, WebP textures, node extras) and USDZ for AR Quick Look."""
from __future__ import annotations

import os


def _select(bpy, objs):
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


def export_glb(cfg, res, path):
    """Y-up GLB. Object custom properties become node extras ({role, toggle?, id?}); all transforms are baked
    (objects keep an identity matrix, vertices are in house coordinates)."""
    import bpy
    objs = res["objects"]
    _select(bpy, objs)
    q = 80 if cfg.lod == "high" else 70
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True, export_apply=False, export_yup=True,
        export_extras=True, export_cameras=False, export_lights=False, export_animations=False,
        export_image_format="WEBP", export_image_quality=q,
        export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
        export_draco_position_quantization=14, export_draco_normal_quantization=10,
        export_draco_texcoord_quantization=12,
    )
    print("[house] GLB %s %.0f kB" % (path, os.path.getsize(path) / 1024.0))
    return path


USDZ_DROP = ("drive_paving", "path", "gravel", "pool_coping", "pool_liner", "water", "equipment")


def usdz_dropped(cfg, ob):
    """Nodes left out of the AR model: the surroundings (drive, paths, gravel, the heat-pump unit and its screen), pools
    and the decks around them. AR Quick Look stands the model on its lowest point, so a basin 1.4 m deep would lift the
    house off the floor; the AR model is the house with its terrace."""
    if ob.get("role") in USDZ_DROP:
        return True
    pool_decks = {o["pool"].get("deck") for o in cfg.pools}
    if ob.get("role") == "deck" and ob.get("id") in pool_decks:
        return True
    return ob.get("role") == "wood_cladding" and ob.get("id") not in {a.get("id") for a in cfg.accents}


def export_usdz(cfg, res, path):
    """USDZ for AR Quick Look: 1 unit = 1 m, Y-up, house centre at the origin on the floor, UV set 'st', tints baked
    into the textures (the scene was built in 'usd' mode)."""
    import bpy
    keep = []
    for ob in res["objects"]:
        if usdz_dropped(cfg, ob):
            bpy.data.objects.remove(ob)
        else:
            keep.append(ob)
    res = dict(res, objects=keep)
    b = cfg.bbox
    cx, cy = (b["x0"] + b["x1"]) / 2.0, (b["y0"] + b["y1"]) / 2.0
    for ob in res["objects"]:
        me = ob.data
        for v in me.vertices:
            v.co.x -= cx
            v.co.y -= cy
        me.update()
        for uv in me.uv_layers[:1]:
            uv.name = "st"
    for m in bpy.data.materials:
        for nd in (m.node_tree.nodes if m.node_tree else []):
            if nd.bl_idname in ("ShaderNodeUVMap", "ShaderNodeNormalMap"):
                nd.uv_map = "st"
    _select(bpy, res["objects"])
    bpy.ops.wm.usd_export(
        filepath=path, selected_objects_only=True, export_materials=True, export_textures_mode="NEW",
        overwrite_textures=True, convert_orientation=True, export_global_forward_selection="NEGATIVE_Z",
        export_global_up_selection="Y", convert_scene_units="METERS", usdz_downscale_size="1024",
        convert_world_material=False, export_uvmaps=True,
    )
    print("[house] USDZ %s %.0f kB" % (path, os.path.getsize(path) / 1024.0))
    return path
