# Furniture pipeline

Data-driven furniture and decor for the fictional house. Input: `model/house.json` (`furniture[]`, `outdoor[]`,
`clearHeight`) and `generated/derived.json` (net rooms, openings, walls). Output: `public/models/furniture.glb` (desktop),
`public/models/furniture-lite.glb` (phones), `public/models/furniture-footprints.json` (walk collisions) and a validation
report. The code lives in `pipeline/furniture/`; the style is described in `pipeline/furniture/STYLE.md`.

```
house.json ─┐                                  ┌─► furniture.glb / furniture-lite.glb   (Draco, WebP grain)
            ├─► layout (rooms, variants,       ├─► furniture-footprints.json            (door zones cut out)
derived.json┘    validation) ─► pieces ─► decor ─► pipeline/out/furniture-report.json   (issues, decor placed / skipped)
                              (builders)  (rules)
```

## Commands

```sh
# desktop and phone files (default paths: model/house.json, generated/derived.json, public/models/*)
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python pipeline/furniture/build.py -- --detail high
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python pipeline/furniture/build.py -- --detail lite

# other inputs, no export, preview renders (plan view and one perspective per room) into a folder
... build.py -- --house path/house.json --derived path/derived.json --no-export --preview pipeline/out/furniture-preview
#   FURNITURE_PREVIEW_ROOMS=plan,R04,terrace  limits the renders; FURNITURE_PREVIEW_VIEWS=1 renders one view per room

# checks: GLB contract, budgets, footprints inside rooms (Node, no dependencies); layout self-test (python3 + numpy, no Blender)
npx tsx scripts/verify-furniture.ts [--dir public/models] [--house ...] [--derived ...]
python3 pipeline/furniture/selftest.py

# look development of single pieces and decor items
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python pipeline/furniture/dev.py -- --items bed160,sofaL,decor:olive --out pipeline/out/dev.png
```

Options: `--detail high|lite`, `--house`, `--derived`, `--style` (reserved), `--out`, `--footprints`, `--report`, `--preview DIR`,
`--no-decor`, `--no-export`, `--blend FILE`. The lite build and `--no-export` runs write no footprints unless `--footprints` is given (the desktop
export owns the file). Both builds are deterministic: the same inputs give the same file.

## GLB contract (see `docs/ARCHITECTURE.md`, section 3)

* One root node `furniture` (no transform), children `furniture_<roomId>_<material>`; `.` and `-` in a room id become `_`.
  Pieces on any outdoor area are merged into `furniture_terrace_<material>`. One node per room and material.
* Materials `f_*` (interior) and `t_*` (terrace), named exactly, one per role, double sided. Only the woods (`f_oak`,
  `f_oak_dark`, `t_teak`) have a texture: one seamless oak grain (WebP, 512 px desktop / 256 px phone), the palette colour is the
  base colour factor.
* Node `extras`: `{ "role": "<material>", "toggle": "furniture", "roomId": "<room id or terrace>" }`.
* Coordinates are the house frame baked into the vertices, Y-up export (house `(x, y, z)` becomes glTF `(x, z, -y)`).
* Budgets: `furniture.glb` at most 1.4 MB and 200 000 triangles; `furniture-lite.glb` at most 0.6 MB and 80 000 triangles. The
  committed files are about 0.75 MB / 155 k triangles and 0.49 MB / 62 k triangles for the sample house.

## Footprints (`public/models/furniture-footprints.json`)

```json
{ "schema": "furniture-footprints/1", "inputHash": "<hash of furniture, rooms, openings>", "units": "m",
  "items": [ { "id": "sofaL-3f2a9c1b", "type": "sofaL", "kind": "furniture", "room": "R04",
               "box": [x0, y0, x1, y1], "h": 0.85 } ],
  "trimmed": [ { "id": "...", "type": "...", "doors": ["D06"] } ], "leftOut": [ ... ] }
```

`box` is an axis-aligned rectangle in the house frame, `h` the height of the highest body part (m), `room` the room id or
`terrace`, `kind` is `furniture` or `decor` (plants, floor lamps and other floor objects taller than 0.3 m). L-shaped pieces give
several boxes. Boxes reaching into a door clear zone (the wall gap plus 0.55 m on both sides) are cut back; one that lies
completely inside the zone is listed in `leftOut`. Rugs and wall or surface decor have no box.

## Layout and validation (`fx/layout.py`)

* A piece belongs to the room whose net floor contains its centre, or to the outdoor area (zone `terrace`). Rotation is 0, 90,
  180 or 270 degrees counter-clockwise; at rot 0 the width runs along x and the back (wall side) faces +y.
* Variants come from `catalog.json` (`variants` rules by room type, size, outdoor, neighbouring piece type): a `shelf` in a
  garage becomes a rack, next to a bed a bedside table, in a wardrobe room an open shelf; a `wardrobe` in a wardrobe room is a
  walk-in with hanging garments; a `chair` next to an `island` is a stool, next to a `desk` a task chair; a small `table6` is a
  coffee table; the two cars of a garage alternate between two models.
* Pieces flagged `wallBacked` whose front (not back) touches a wall are turned by 180 degrees (issue `rot-corrected`).
* Checks (report `issues`, console warnings): `outside-room` (more than 2 % of the footprint outside the net floor),
  `door-zone` (clear zone or swing quarter circle of a door or entry), `collision` (overlap of two pieces),
  `unknown-type`, `outside`. Furniture is never moved; the report only says what is wrong.

## Decor (`decor_rules.json`, `fx/decor.py`)

Rules per room type, kinds `surface`, `cushions`, `floor`, `wall`, `rug`, `curtains`, `pendant` (see the file header). Items are
in `fx/decor_items.py` (plants, vases, bowls, lamps, books, towels, toys, frames, rugs, curtains, garage things). Placement is
relative to piece anchors (`top`, `free`, `seat`, `under`, `bed`), free floor (corners, wall spots, beside a piece, terrace
area), openings (curtains) and wall planes behind pieces (frames). Seeds come from the piece id or from room id plus rule key,
so adding one piece does not change the decor of the others. What could not be placed is in the report under `decor.skipped`
with a reason (no free corner, surface too small, tall furniture at the opening, ...).

## Detail levels

`high` uses rounded edges (`rbox`, chamfer boxes), fuller plants, 14 to 30 segment lathes and loft grids; `lite` drops edge
rounding unless a part is flagged `keep`, halves the segments and leaf counts and keeps outlines and colours. Cars: about 8 000
triangles at `high`, about 2 800 at `lite`.

## Code map

| File | Purpose |
|---|---|
| `build.py` | CLI entry, runs Blender once per detail level |
| `fx/mesh.py`, `fx/soft.py` | numpy geometry: boxes (plain, chamfered, rounded), lathe, tube, prism, grids, cushions, leaves, curtains |
| `fx/piece.py` | `Piece`: the drawing context of a builder (box, cyl, lathe, tube, sphere, prism, cushion, leaf, anchors) |
| `pieces/*.py` | builders per catalog type (beds, seating, chairs, tables, kitchen, cabinets, wet, outdoor, car) |
| `fx/plants.py`, `fx/props.py`, `fx/textiles.py`, `fx/stuff.py`, `fx/decor_items.py` | decor items |
| `fx/layout.py`, `fx/geom2d.py`, `fx/freespace.py`, `fx/inputs.py` | placement, validation, free floor, input adapter (stdlib) |
| `fx/decor.py` | rule engine |
| `fx/compose.py`, `fx/assemble.py`, `fx/export.py`, `fx/report.py` | scene assembly, GLB export, footprints and report |
| `fx/qa.py` | coplanar-face finder (z-fight) |
| `dev.py`, `preview.py` | look-development renders of single items and the house |

To add a furniture type: add it to `catalog.json` (size, builder, variants), write `@builder('name') def f(pc, w, d, variant)` in
`pieces/`, run `dev.py` (`--items type:variant@WxD`) and look at the render. Keep parts from sharing a plane.

## Limits

Geometry is procedural and stylised (no photogrammetry); the lite file keeps every piece but simplifies detail. Rotations other
than multiples of 90 degrees are drawn, but validation and footprints use the axis-aligned box. Decor is skipped, never forced,
when a spot is not free.
