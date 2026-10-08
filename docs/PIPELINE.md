# Pipeline

The Blender pipeline turns the data model into 3D files and pictures. This document describes the **house model** part
(procedural building geometry, GLB and USDZ export, verification). The furniture part is in `PIPELINE-FURNITURE.md`; the
renders are documented with their own tools.

```
generated/derived.json ─┐
model/house.json       ─┼─► pipeline/blender/build_house.py ─► public/models/house.glb       (desktop, Draco + WebP 1k)
model/style.json       ─┘        (Blender 5.1, Python)       ├─► public/models/house-lite.glb  (phones, 512 px)
                                                              └─► public/models/house.usdz      (AR Quick Look)
assets/models/tree_small_02 ─► pipeline/blender/vegetation_bake.py ─► public/models/tree.glb, tree-lite.glb (web trees)
scripts/verify-glb.ts ◄── checks the contract                 public/models/manifest.json ◄── scripts/build-models-manifest.ts
```

## 1. Building the model

```bash
pipeline/build_model.sh                # house.glb, house-lite.glb, house.usdz, verification, manifest
pipeline/build_model.sh --lite-only    # only the phone variant (fast check)
BLENDER=/path/to/Blender pipeline/build_model.sh
```

The script runs Blender for the house (`high`, `lite`, `lite --usdz`), the furniture (`high`, `lite`, `PIPELINE-FURNITURE.md`) and
the web trees (section 9, only when the asset, the style or the bake script changed), then `scripts/verify-glb.ts` on both house
GLBs, the 6 MB check of the USDZ, `scripts/verify-furniture.ts` and `scripts/build-models-manifest.ts`. A failing Blender run stops
it; a failing check makes it exit 1 after the manifest is written. The house builds take a few seconds; textures are cached in
`pipeline/out/tex` (git-ignored). Options: `--lite-only`, `--no-usdz`, `--no-furniture`, `--no-trees`. The GLB files are deterministic (the same inputs give byte-identical files, also with a
cold texture cache). Blender's USD exporter is **not** byte-reproducible (the token table of the `.usdc` is ordered by pointer
hash, textures and geometry are the same), so the script rebuilds `house.usdz` only when an input changed (derived data without its
model hash, `house.json`, `style.json`, the builder code, the list of texture files); the key of the last build is kept in
`pipeline/out/house.usdz.key` (git-ignored, delete it to force a rebuild). Running the script twice therefore gives the same manifest.

Direct call (all paths are explicit, so a different house can be built the same way):

```bash
BLENDER -b --factory-startup --python pipeline/blender/build_house.py -- \
  --derived generated/derived.json --house model/house.json --style model/style.json \
  --out public/models [--lod high|lite] [--for-render [--blinds] [--pv] [--vegetation]] [--usdz] [--blend file.blend] [--glb path] [--tex-px 1024]
```

Requirements: Blender 5.1 (glTF exporter with Draco and WebP, USD exporter), the CC0 textures in `assets/` (see `ASSETS.md`),
Node 22 with `tsx` for the verifier and the manifest.

## 2. What is read from where

Nothing about the house is written in the Python code: coordinates, sizes, materials and the structure all come from data.

| data | used for |
|---|---|
| `derived.walls` (axis, thickness `t`, rooms on both sides, `height`) | wall rectangles; exterior side = the side without a room |
| `derived.rooms[].rects`, `.floor`, `.height` | which grid cells are floor of which room; floor material `floor_<kind>`; ceiling height |
| `derived.openings` (`kind`, `wallId`, `from/to`, `sill`, `head`, `swing/hinge`) | holes in the wall faces, frames, glazing, doors, the garage door |
| `derived.outline` (rects, polygon) | plinth, gravel border, what is "outside the house" |
| `derived.roofs` (`rect`, `pitch`, `overhang`, `wallTop`) | the roof surface (section 4); cross-checked against `derived.roofPlanes` |
| `derived.outdoor[]` (`role`, `rect`, `holes`, `grade.plane` / `grade.corners`, `posts`, `postSize`, `pool`) | slab tops (flat or a ramp), the slab role, holes cut out of a deck, posts, the pool (section 4a) |
| `derived.screens[]` (`at`, `from/to`, `z0/z1`, `blades.positions/chord/thickness`, `restDeg`) | louvre blades on their pivots at the rest angle, head and sill rails |
| `derived.outdoorUnit` (`footprint`, `size`, `z`) | the heat-pump outdoor unit and its slatted screen |
| `derived.site.terrain.plateau.level`, `derived.site.paved` | the finished ground around the house (gravel strip, slab edges, downpipe feet); site paving next to a slab (no free edge there) |
| `derived.accents`, `.lightpipes` | cladding, light pipes |
| `house.clearHeight`, `house.slab` | ceiling height, roof structure depth |
| `house.roof` (`covering.type`, `downpipes`, `snowGuards`, `lightpipes`) | roof covering style, downpipes, snow guards, dome size |
| `style.materials[role]` | colour, roughness, metallic, alpha of every role |
| `style.construction` (optional) | overrides of the build details in `hb/params.py` |

Build details that the data model does not describe (frame width, sill thickness, seam height, gutter radius, skirting height
and so on) are in `pipeline/blender/hb/params.py`, one dictionary with a `high` and a `lite` set of detail switches.

## 3. Code layout (`pipeline/blender/`)

| file | job |
|---|---|
| `build_house.py` | command line, `build_geometry(cfg)` (pure Python), `build_scene(cfg)` (Blender objects, collections) |
| `hb/config.py` | loads the three JSON files, accessors, wall tops, levels of detail |
| `hb/params.py` | build details and the `high` / `lite` switches |
| `hb/mesh.py` | `MeshSet`: polygons per node (role, id, toggle); faces are wound outwards from a normal hint; UVs in metres |
| `hb/walls.py` | wall grid (clean corners and T-junctions), wall faces with openings cut out, tops, floors, ceilings, plinth |
| `hb/openings.py` | reveals, frames, glazing, sills, entry door with side light, garage door, sliding walls, interior doors |
| `hb/roof.py` | roof model: planes, visible convex pieces, edges (ridges, hips, valleys, eaves) |
| `hb/roof_cover.py` | standing seams or tile courses, ridge and hip caps, valley flashings |
| `hb/roof_eaves.py` | fascia, gutter, downpipes, soffits, snow guards, light pipes |
| `hb/exterior.py` | outdoor slabs (paving and ramps with edges and edging, timber decks, pools), posts, gravel border, timber cladding, louvre wall, heat-pump unit |
| `hb/materials.py`, `hb/textures.py`, `hb/floor_textures.py` | one material per role, texture preparation, procedural floors |
| `hb/export.py` | GLB (Draco, WebP, extras) and USDZ |
| `hb/selfcheck.py` | polygon sanity checks (non-finite, non-planar, duplicated faces) that run on every build |
| `preview.py` | quick Cycles / Workbench previews for visual checks (see section 7) |
| `vegetation_bake.py` | the web trees `tree.glb` / `tree-lite.glb` from the CC0 tree asset (section 9) |

### Walls

Every wall becomes a rectangle (axis +- thickness / 2, each end extended by half the thickness of the perpendicular walls that
meet there). The rectangles are merged on a grid; faces are generated only on the boundary of the union, so corners and
T-junctions are clean and no face exists twice (no z-fighting). A boundary face is `plaster_in` when the neighbouring free cell
lies in a room, otherwise `plaster`; the lowest `plinth_h` of exterior faces is `slab` (plinth). Openings are cut out of the
faces; reveals are `plaster` in front of the frame (set 10 cm behind the outer face) and `plaster_in` behind it. Wall tops
stay `wall_top_inset` below the roof plane so no plaster pokes through the covering. The net room rectangles of
`derived.netRooms` are carved out of the wall union (corner caps of thick walls never reach into a room), so every floor equals the
kernel's net area; the build compares both and warns on a difference.

### Roof

Each roof is a hip roof on its rectangle (the outer wall faces): the plane through `wallTop` at the rectangle edge, rising
with the pitch; the eave is `overhang` outside. The visible surface is the maximum over all roofs (a cross hip gives valleys).
Per plane the visible part is computed with convex clipping: the plane's own cell (lowest plane of its roof) minus the region
where another roof is higher. The result is compared with the kernel's `roofPlanes` (plan area per face); a mismatch prints a
warning. Edges are classified from shared polygon edges: convex = ridge or hip (cap), concave = valley (flashing), free =
eave (fascia, gutter, soffit); where the surfaces of two roofs do not meet (an eave stands above a lower roof, e.g. different
overhangs) the gap is closed with a fascia board ("step"). The nominal roof surface equals the kernel's (ridge height within 2 cm); with standing seams the
seam tops lie on it and the sheet is one seam height below. The structure is `slab` deep at the wall line (the underside is
exactly the ceiling height there) and `eave_depth` at the eave, so the soffit continues the flat terrace ceiling without a step.

## 4. GLB contract as implemented

* Frame: the model is built in house coordinates and exported with Y-up: house `(x, y, z)` becomes glTF `(x, z, -y)`.
  Nodes have identity transforms (no `translation`, `rotation`, `scale`, no hierarchy): all nodes are roots of the scene.
* One node per role, with exceptions that carry an `id`: floors per room (`floor_oak_R04`), glass per glazed opening
  (`glass_W02`), cladding per accent, screens, outdoor slabs and posts per outdoor area. The node name is `<role>` or
  `<role>_<id>`; `extras` is `{role, toggle?, id?}`.
* Material = role, named exactly like the role, one material per role, single-sided. Colours, roughness, metalness and alpha
  from `style.json`; textured roles carry a neutral texture and the style colour as `baseColorFactor`.
* Doors: the **entrance door leaf** is built in the dark `frame` role (graphite like the window frames, handle bar in `sill`);
  the role `door_leaf` is only the **interior doors** (lining and leaf, warm white in `style.json`). The web recolours both through
  the roles, so no extra role is needed; `scripts/verify-glb.ts` requires `door_leaf` only when the data has interior doors.
* `post` (the single terrace column and the porch posts, `postSize` from the model) is graphite in every look; the downpipe
  of the terrace corner runs inside the column (a downpipe inside a post is not drawn).
* Since R2 (contract C2): `deck`, `pool_coping`, `pool_liner`, `water`, `garage_door`, `screen_rail`, `equipment` (section 4a).
* `toggle: "roof"`: `roof_tile`, `ridge_cap`, `fascia`, `gutter`, `soffit` (overhang undersides, flat terrace ceilings, light pipe
  domes) and `ceiling`. Downpipes, snow guards and light pipe collars are in the `gutter` / `ridge_cap` nodes, so they hide too.
* Glass: one node per glazed opening (every exterior opening except garage doors), two opposite quads per pane.
* UVs: plaster, plinth and paving by box projection in metres (the role's tile size is a property of the material); wood
  vertical; roof along the eave and the slope; floors in metres with the planks along x.
* Not in the GLB (generated in JS): terrain, trees, blinds, PV, labels, fences, gates and the pillar. Furniture is a separate file.
* Heights: every level comes from the data. Slab tops are the derived grade (`outdoor[].top`, default -0.02, and the ramps of
  the drive and the path); the ground around the house is the plateau level of the site (-0.15 for the sample house), so the
  exterior walls show a 0.30 m graphite plinth band (`slab` role: 0.15 m of the slab below the floor plus `plinth_h` above it).
  The plinth and the foundation slab reach down to `plinth_depth` (-0.45). The builder never computes a level itself; the
  kernel cuts the terrain under every slab (`docs/SITE.md`, section 3).

## 4a. Outdoor areas, pool, louvres, garage door, unit (since R2)

* **Paving and ramps** (`terrace_paving`, `drive_paving`, `path`): one planar top per area from `grade.plane`
  (`z = z0 + gx (x - ox) + gy (y - oy)`), so the drive and the path are sloped slabs that run from the house down to their gate.
  Edges that border open ground get a `slab_edge` (0.15 m) side and a 5 x 80 mm graphite steel edging (role `frame`); an edge
  against the house, another slab, a hole or a paved surface of the site (aprons, service path) gets neither.
* **Timber decks** (`deck`, areas with `role: "deck"`): the area minus its `holes` (the pool cut out of the pool deck). High:
  145 mm boards running along x with 6 mm joints and staggered end joints, a dark substructure (`slab`) one board thickness
  below, a timber fascia on free edges; each board maps onto one board of the `wood_floor_deck` texture. Lite: one textured
  quad per piece (same texture, same tile).
* **Pool** (`pool_coping`, `pool_liner`, `water`, from `outdoor[].pool`): a coping ring from `outer` to `water` at `copingTop`,
  `coping_t` thick, overhanging the basin wall by `coping_overhang` (30 mm); the basin (walls and floor, `pool_liner`) from
  `floorZ` up to the coping; the water plane at `waterZ` (= copingTop - waterBelowTop) over the whole basin. The terrain has a
  hole there (`derived.groundVoids`, drawn by the web and the renders). The USDZ leaves the pool and its deck out (AR Quick
  Look stands a model on its lowest point).
* **Louvre wall** (`screen_slats`, `screen_rail`): one blade per `blades.positions` entry, `chord` x `thickness`, turned by
  `restDeg` about its own vertical pivot on the screen axis `at` (0 = in the wall plane, 90 = square to it; the web turns the
  blades between `closedDeg` and 90). Graphite head and sill rails (U-channels, `rail_h` x `rail_d`) at `z0` and `z1`; the web
  hides only `screen_slats`.
* **Garage door** (`garage_door`, node id = the opening id): 0.5 m sections with 20 mm V-grooves, timber look (the wood looks
  set it); the web lifts the node to open it. Lining and head in `frame`.
* **Downpipes**: from the gutter outlet a swan neck slopes back under the soffit (`swan_deg`) to `downpipe_wall_gap` off the
  wall (at a corner when the outlet sits on the eave mitre), then down the facade into the slab or the ground.
* **Heat-pump outdoor unit** (`equipment`, from `derived.outdoorUnit`): the unit on a small pad with a recessed fan ring on
  the side away from the house, inside a slatted timber screen (`wood_cladding`, id `unit`) on every side but the back.
* **Roof seam stripe**: the `roof_tile` material carries a seam normal map and a metallic-roughness stripe, one seam per
  `seam_pitch` repeat, aligned with the modelled seams, so the seam rhythm stays even where the geometry is thinner than a pixel.

## 5. Levels of detail and budgets

| | `house.glb` (high) | `house-lite.glb` (lite) | `house.usdz` |
|---|---|---|---|
| textures | 1024 px WebP, normal maps | 512 px, no normal maps | 1024 px JPEG, tints baked in |
| geometry | timber boards, deck boards, skirting, seams, fine gutters | cladding as panels, deck as a textured quad, no skirting, coarser arcs | the lite geometry without drive, path, gravel, pool, pool deck, unit |
| budget | 7 MB | 2.5 MB, 70 000 triangles | 6 MB |
| current | about 2.8 MB, 10 400 triangles, 65 nodes | about 0.43 MB, 6 400 triangles | about 1.0 MB |

The web trees: `tree.glb` about 165 kB / 5 600 triangles, `tree-lite.glb` about 69 kB / 2 400 triangles.

The lite variant is built with a lower detail parameter, not by decimation. USDZ: 1 unit = 1 m, Y-up, the centre of the
footprint at the origin, UV set `st`; the constant glass opacity is carried by a 4 x 4 px opacity texture (the USD exporter
drops constant alpha), the style tints are baked into the textures.

## 6. Verification

* `scripts/verify-glb.ts` (Node, no dependencies; `npx tsx scripts/verify-glb.ts public/models/house.glb [--lite] [--no-geometry]`)
  parses the GLB container and checks: Draco and WebP extensions, roles, extras on every mesh node, no transforms, material =
  role without numeric suffixes, roof toggles, one glass node per glazed opening, the roles the data requires (floors per room
  kind, cladding, louvres and rails, posts, deck, pool, garage door, unit), one slab node per outdoor area topping out at its
  derived grade, the pool levels (coping top, water, floor), the rail levels of the louvres, the bounding box of the exterior
  walls against the outline and of the roof covering against the eave rectangle and ridge height (+-2 cm), triangle and size
  budgets, texture sizes. With derived data it also decodes the geometry (the web's Draco decoder in `public/draco`): every
  vertex of a slab node lies on or below its derived top and the top face exists; every louvre blade stands on its pivot and
  is as deep across the wall as the rest angle gives.
* `scripts/__tests__/glb.test.ts` (vitest) runs those rules on synthetic files and, when the GLBs exist, on the real files:
  the contract, the decoded geometry (slab tops on the grade and never below the kernel's graded terrain, the ramps falling
  as derived, no deck board over the water, blades at the rest angle), the web trees (triangles, roles, atlas size, unit size),
  the manifest (hashes match the files) and the USDZ size. `npm test` skips the file tests when `public/models` is empty.
* `scripts/build-models-manifest.ts` writes `public/models/manifest.json` (SHA-256, size, triangles, bounding box in the house
  frame, `inputHash` of `derived.json`, one content hash of all files); `--check` fails when it is stale. The web busts the cache
  with the SHA-256 of each file (`?v=`), not with the manifest hash.
* What the model hash binds: `inputHash` (also in `derived.json`) is the hash of **all** `model/*.json`, including `render.json`,
  `assumptions.json` and `pricebook.json` (the renders need `render.json` in it, see `docs/RENDER-INPUTS.md`). The GLBs, the USDZ,
  the furniture and the footprints do **not** depend on those three files (the footprints carry their own `inputHash` of furniture,
  rooms and openings, not the model hash), so editing only them leaves every model file byte-identical and only the `inputHash`
  strings stale: run `npx tsx scripts/build-derived.ts && npx tsx scripts/build-models-manifest.ts` (no Blender needed).
* `hb/selfcheck.py` runs inside every build and fails it on non-finite, non-planar or duplicated faces.

## 7. Previews

```bash
BLENDER -b --factory-startup --python pipeline/blender/preview.py -- --derived D --house H --style S --out DIR \
   --views sw,se,ne,nw,top,topr,section,living,street,garden,aerial,room:R04,cam:<camera id> [--lod lite] [--wb 1] [--cut 5.0] \
   [--terrain grid.json] [--site 1] [--gate 0.6] [--garage 1] [--furniture public/models/furniture.glb] [--exposure -2] [--device cpu]
```

Cycles previews with a sky (about 4 s per view); `--wb 1` renders Workbench with back-face culling, which shows missing or
flipped faces. Custom cameras: `--views "c:x,y,z:tx,ty,tz:lens|c:..."`, `cam:<id>` uses a camera of `derived.cameras`. `top`
hides the roof (plan), `section` cuts at `--cut`. The ground is flat at the plateau level with the pool voids cut out, or a
height grid (`--terrain`, `{x0, y0, step, nx, ny, h[]}` sampled from the kernel's `groundAt`; the pipeline never computes the
terrain). `--site 1` adds plain stand-ins for the fence, gates and pillar from `derived.site` (they are not in the GLB),
`--gate` slides the drive gate open (0..1), `--garage 1` hides the garage door leaf (open door), `--furniture` imports a
furniture GLB, `--device cpu` renders on the CPU (leaves the GPU to a render that is running).

## 8. Using the builder from other tools (renders)

```python
sys.path.insert(0, "pipeline/blender")
import build_house
from hb import config
cfg = config.Config.load("generated/derived.json", "model/house.json", "model/style.json",
                         lod="high", for_render=True)          # 2k textures, Glass BSDF for the glass role
res = build_house.build_scene(cfg)                              # clears the Blender file first (clear=False keeps it)
res["house"]          # collection with one object per node (extras as custom properties role / toggle / id)
res["blinds"], res["pv"], res["vegetation"], res["terrain"]    # empty collections for the render-only details
res["geometry"], res["info"]   # the MeshSet and the roof model (height(x, y), loops, ridges) for placing things
```

The render details (blinds, PV, vegetation, terrain) are added by their own modules into these collections; the web GLB never
contains them.

## 9. Web trees (`vegetation_bake.py`)

```bash
BLENDER -b --factory-startup --python pipeline/blender/vegetation_bake.py -- \
  --asset assets/models/tree_small_02/tree_small_02_1k.gltf --out public/models --style model/style.json
```

Bakes the CC0 tree (`ASSETS.md`) into an instancing-friendly tree for the 3D viewer: `tree.glb` (desktop, at most 6 000
triangles, 512 px WebP leaf atlas) and `tree-lite.glb` (phones, fewer cards, 256 px), both Draco. The trunk and branches are
decimated; the leaves become cards, one per occupied voxel of the crown, centred on its leaves and turned towards their mean
normal and the outside of the crown, with normals pointing out of the crown (it shades as one soft volume). The atlas is
2 x 2 leaf clusters rendered from the asset itself (unlit, transparent; transparent texels carry the mean leaf colour so the
mipmaps keep it), stored **neutral** (luminance, mean 0.8); the colour is the material's base colour factor
(`generated.foliage_tree` and `generated.bark` of `style.json`), so the web can tint each species.

Contract: two nodes `tree_bark` (role `bark`, single sided) and `tree_foliage` (role `foliage`, double sided, `alphaMode`
MASK), materials named the same; **normalised** geometry: trunk base at the origin, height 1, crown diameter 1 in both plan
directions (each axis scaled by the crown's own extent; the leaf cards are scaled uniformly and stay square), so an instance
is scaled by (crown, height, crown) of `site.trees[]`. Scene extras: `crownBase` (lowest leaf as a fraction of the height),
`crownCentre` (the crown centre in plan relative to the trunk, normalised, house frame x / y: shift an instance by
-crownCentre x crown to centre the crown instead of the trunk on the site position), `sourceHeight` / `sourceCrown` (the
asset's metres), `source`. Deterministic (seeded). `build_model.sh` rebakes only when
the asset, `style.json` or the script changed (key in `pipeline/out/tree.key`); without the asset it keeps the committed files.

## 10. Known limits

Axis-parallel rectangles only (rooms, walls, roofs); hip roofs only; openings only in straight wall segments between
junctions; windows have one frame (no separate sash). The standing-seam covering is built when `roof.covering.type` contains
"steel"; any other type gets tile courses (clay and concrete look alike in geometry).
