"""Render-only additions to the house: terrain, draped surfaces, the street, the boundary (fence, gates, pillar), the pool
water, neighbours, PV, blinds, louvres, the garage door and the vegetation.
RENDER_SKIP=lawn,trees,far,furniture,... leaves parts out (profiling and debugging)."""
from __future__ import annotations

import os


def skipped():
    return {s for s in os.environ.get("RENDER_SKIP", "").split(",") if s}


def build_all(scn):
    from . import blinds, equipment, fences, neighbours, pool, pv, street, surfaces, terrain, vegetation
    scn.terrain = terrain.Terrain(scn.inputs, scn.cfg, scn.c3)
    surfaces.build(scn, scn.terrain)
    street.build(scn, scn.terrain)
    fences.build(scn, scn.terrain)
    pool.build(scn, scn.terrain)
    neighbours.build(scn, scn.terrain)
    pv.build(scn)
    scn.blinds = blinds.Blinds(scn)
    scn.movables.append(equipment.Louvres(scn))
    scn.movables.append(equipment.GarageDoor(scn))
    veg = vegetation.Vegetation(scn, scn.terrain)
    veg.build()
    # the vegetation and the ground bounce desaturated light (shading.py)
    from . import shading
    sat = float(scn.cfg["look"].get("bounceSaturation", 1.0))
    if sat < 1.0:
        import bpy
        lib = bpy.data.collections.get("LIB")
        obs = list(veg.col.all_objects) + list(scn.terrain.collection.all_objects) + (list(lib.all_objects) if lib else [])
        n = sum(shading.desaturate_bounces(m, sat) for m in shading.materials_of(obs))
        from .util import log
        log("bounce light: %d vegetation and ground materials desaturated to %.2f for diffuse rays" % (n, sat))
    # aerial perspective on everything that can stand far away: the ground, the plants, the neighbours (sky.py)
    import bpy
    far = list(veg.col.all_objects) + list(scn.terrain.collection.all_objects)
    for name in ("LIB", "neighbours"):
        c = bpy.data.collections.get(name)
        if c is not None:
            far += list(c.all_objects)
    n_h = sum(scn.sky.apply_haze(m) for m in shading.materials_of(far))
    from .util import log as _log
    _log("aerial haze on %d materials" % n_h)
