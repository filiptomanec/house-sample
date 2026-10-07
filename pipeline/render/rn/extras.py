"""Render-only additions to the house: terrain, surfaces, fences, vegetation, neighbours, PV and blinds.
RENDER_SKIP=lawn,trees,far,furniture,... leaves parts out (profiling and debugging)."""
from __future__ import annotations

import os


def skipped():
    return {s for s in os.environ.get("RENDER_SKIP", "").split(",") if s}


def build_all(scn):
    from . import blinds, fences, neighbours, pv, surfaces, terrain, vegetation
    scn.terrain = terrain.Terrain(scn.inputs, scn.cfg)
    surfaces.build(scn, scn.terrain)
    fences.build(scn, scn.terrain)
    neighbours.build(scn, scn.terrain)
    pv.build(scn)
    scn.blinds = blinds.Blinds(scn)
    vegetation.Vegetation(scn, scn.terrain).build()
