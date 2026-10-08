"""Generic construction parameters (details of how things are built, not the house itself) and level of detail.

The house (rooms, walls, openings, roofs, outdoor areas) always comes from the data model. These values are the
build details that the data does not describe: frame width, sill thickness, seam height, gutter size and so on.
`model/style.json` may override any of them under its "construction" key.
"""
from __future__ import annotations

BASE = {
    # structure below the floor
    "plinth_depth": 0.45,           # slab/plinth from z = -depth to 0
    "skirting_h": 0.07,             # skirting board (plaster_in) along interior walls, high detail only
    "skirting_t": 0.012,
    "wall_top_inset": 0.04,         # wall tops stay this far below the roof plane so no plaster pokes through the roof
    # windows, sliders and doors
    "setback": 0.10,                # glazing frame sits this far behind the outer wall face
    "frame_w": 0.06,                # visible width of frame bars
    "frame_depth": 0.07,
    "mullion_w": 0.05,
    "glass_t": 0.02,
    "window_pane": 1.2,             # target pane width of windows (m); wider windows get mullions
    "slider_pane": 1.1,             # target pane width of sliding walls
    "sill_t": 0.03,                 # outer aluminium sill plate thickness
    "sill_lip": 0.035,              # how far the plate projects past the facade
    "sill_over": 0.02,              # plate overhang beyond the jambs
    "inner_sill_t": 0.025,
    "inner_sill_lip": 0.03,
    "door_frame_w": 0.05,           # interior door lining (zarubna) width
    "door_frame_proud": 0.012,      # lining projects this far past each wall face
    "door_leaf_t": 0.04,
    "door_gap": 0.006,
    "handle_h": 1.0,                # handle height above the floor
    "garage_section_h": 0.5,        # target height of one garage door section
    "garage_groove": 0.020,         # V-groove between sections: depth (its width is twice the depth)
    "garage_leaf_t": 0.045,         # thickness of the door leaf
    "garage_set": 0.05,             # garage door plane behind the outer face (d)
    # wood cladding and slats
    "clad_t": 0.03,
    "clad_board": 0.105,
    "clad_pitch": 0.12,
    "clad_edge_gap": 0.003,
    # outdoor areas. Tops, ramps, pools and posts come from derived.outdoor (grade, pool, postSize); the ground level around
    # the house is the plateau level of the site (derived.site.terrain.plateau.level). These are only construction details.
    "slab_edge": 0.15,              # visible depth of a slab edge below its top
    "edging_t": 0.005,              # steel edging along the free edges of paved areas (thickness x height)
    "edging_h": 0.08,
    "deck_board": 0.145,            # deck boards along x: width, joint gap, thickness, longest board
    "deck_gap": 0.006,
    "deck_t": 0.028,
    "deck_board_len": 4.2,
    "deck_texture_boards": 12,      # boards per repeat of the deck texture (rows along u), so a board maps onto one texture board
    "coping_t": 0.05,               # pool coping slab thickness and how far it overhangs the basin wall
    "coping_overhang": 0.03,
    "gravel_w": 0.5,                # gravel strip around the house: width, top above the ground level, depth
    "gravel_up": 0.015,
    "gravel_depth": 0.25,
    "plinth_h": 0.15,               # exterior walls: this much above the floor is plinth (role slab) instead of plaster
    # louvre wall: head and sill rails (U-channels) around the blades
    "rail_h": 0.06,
    "rail_d": 0.14,
    # heat-pump outdoor unit: pad under it, slatted timber screen around its open sides
    "unit_pad": 0.10,
    "unit_screen_gap": 0.15,
    "unit_screen_up": 0.15,
    "unit_slat_w": 0.045,
    "unit_slat_pitch": 0.075,
    "unit_slat_t": 0.025,
    # downpipes: swan neck from the gutter outlet back to the wall, slope of the offset below the horizontal
    "downpipe_wall_gap": 0.05,
    "swan_deg": 35.0,
    # roof
    "eave_depth": 0.20,             # structure depth at the eave (underside below the covering)
    "fascia_t": 0.03,
    "fascia_up": 0.02,              # fascia stands this far above the covering at the eave
    "gutter_r": 0.055,
    "gutter_drop": 0.04,            # gutter top below the covering at the eave
    "seam_pitch": 0.6,
    "seam_w": 0.03,
    "seam_h": 0.035,
    "course_gauge": 0.37,           # slope length of one course (concrete tile covering)
    "course_step": 0.03,
    "ridge_w": 0.15,                # ridge / hip cap: width on each side
    "ridge_h": 0.035,
    "valley_w": 0.16,
    "snow_guard_up": 0.45,          # snow guard bar this far up the slope from the eave
    "lightpipe_flange": 0.25,       # radius of the roof flange around a lightpipe (m, beyond the tube)
}

# level of detail: "high" = desktop GLB and renders, "lite" = phone GLB
LOD = {
    "high": {
        "name": "high", "texture_px": 1024, "normal_maps": True, "clad_boards": True, "mullions": True,
        "gutter_arc": 7, "seams": True, "courses": True, "garage_grooves": True, "post_chamfer": False,
        "downpipe_sides": 12, "dome_segments": 12, "skirting": True, "deck_boards": True, "unit_slats": True,
    },
    "lite": {
        "name": "lite", "texture_px": 512, "normal_maps": False, "clad_boards": False, "mullions": True,
        "gutter_arc": 3, "seams": True, "courses": False, "garage_grooves": True, "post_chamfer": False,
        "downpipe_sides": 8, "dome_segments": 8, "skirting": False, "deck_boards": False, "unit_slats": True,
    },
}


def get(lod, style=None):
    """Merged parameter dict for a level of detail (plus style overrides)."""
    p = dict(BASE)
    p.update(LOD[lod])
    over = (style or {}).get("construction")
    if isinstance(over, dict):
        for k, v in over.items():
            if k in p:
                if isinstance(p[k], dict) and isinstance(v, dict):
                    q = dict(p[k])
                    q.update(v)
                    p[k] = q
                else:
                    p[k] = v
    return p
