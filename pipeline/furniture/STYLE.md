# Furniture style: light Scandinavian

The fictional house is furnished for a family that likes calm rooms: light, warm, uncluttered, a little textured.
Every builder, material and decor rule follows this page.

## Palette

| Role | Materials | Share |
|---|---|---|
| Dominant | warm white `f_white`, light oak `f_oak` (with grain), natural linen `f_linen`, greige `f_greige` / `f_sand` / `f_fabric_grey` | about 80 % |
| Soft accents | sage `f_sage`, dusty blue-grey `f_blue`, pale clay `f_clay`, ochre `f_ochre` (one small touch per room at most) | about 15 % |
| Thin lines | anthracite `f_anthracite`, `f_black_metal`: lamp stems, handles, rails, hob, frames | about 5 % |
| Wet and metal | `f_ceramic`, `f_chrome`, `f_steel`, `f_brass` (tiny accents only) | as needed |
| Terrace | `t_teak` (grain), `t_alu`, `t_fabric`, `t_sage`, `t_pot`, plants `t_plant`, `t_buxus`, `t_grass`, `t_lavender`, glass `t_glass` | |

Rules: no saturated colour, no big dark blocks (dark wardrobe fronts, black sofas and dark rugs are out), no orange, no
shiny plastic. Only the woods carry a texture (a seamless procedural oak grain, one repeat 1.2 x 0.6 m); everything else is
a plain PBR colour. Interior materials are `f_*`, terrace materials `t_*`; a piece standing on the terrace is
automatically mapped to the `t_*` set (`palette.OUTDOOR`).

## Shapes

* Slim tapered oak legs, rounded edges (1 to 5 cm radius), handleless fronts with a thin oak or anthracite pull.
* Upholstery is soft: loose seat and back cushions, pillows with a sewn-corner silhouette, duvets with a turned cuff.
* Beds: oak platform frame, upholstered headboard, white or linen bedding, a folded throw in an accent colour.
* Tables: oak tops, trestle or four tapered legs. Chairs: oak with a linen pad. Kitchen: white or oak fronts, stone
  worktop, black induction hob, steel sink, floating oak shelves.
* Bathrooms: wall-hung toilet, oak vanity with vessel basins, round or wide mirror, glass screens with thin black profiles.
* Cars (garage): two neutral models, silver-white estate and graphite hatchback, built to read as cars from 8 m (wheel
  arches, glasshouse, lights), never shown in close-up.
* Outdoor room: a lounge set (sofa, two armchairs, a low table) against the garage wall, a dining table for eight under the
  roof, the grill out on the open paving beyond the eave, loungers on the pool deck; teak, light aluminium and linen-grey
  fabric (`t_*`), no hanging furniture.

## Composition (decor rules)

* Per room at most: one large plant, one or two small objects per surface, one or two framed prints, one textile accent.
* Plants are drawn simply but recognisably: olive tree, fiddle-leaf fig, monstera, snake plant, pampas in a tall vase,
  eucalyptus, trailing pothos, succulents; on the terrace box balls, lavender, ornamental grass.
* Rugs sit under groups of furniture (never a single piece alone), curtains hang at windows and sliders, pendant lamps
  hang over tables and the island.
* Nothing blocks a door: floor decor stays out of the clear zone in front of doors (0.55 m) and out of door swings.

## Technical rules for builders

* Frame: origin at the footprint centre on the floor, +x width, +y back (the wall side at rot 0), +z up. Metres.
* No coplanar faces of different parts (they render black in Cycles and z-fight in the web viewer): inset one part by
  3 mm or more. `fx/qa.py` finds them; the build report lists them under `qa`.
* Detail is a parameter: `hi` (desktop, rounded edges, more leaves) or lite (phones: plain boxes, fewer segments, fewer
  small props, same outline and colours).
* Everything is data driven: no room ids, no coordinates of any room in the code. Positions come from `model/house.json`
  furniture, the net room polygons, the openings and the free floor.
