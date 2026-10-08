# Pipeline

The Blender pipeline turns the data model into 3D files and pictures. This document describes the **house model** part
(procedural building geometry, GLB and USDZ export, verification). The furniture part is in `PIPELINE-FURNITURE.md`; the
renders are documented with their own tools.

```
generated/derived.json ─┐
model/house.json       ─┼─► pipeline/blender/build_house.py ─► public/models/house.glb       (desktop, Draco + WebP 1k)
model/style.json       ─┘        (Blender 5.1, Python)       ├─► public/models/house-lite.glb  (phones, 512 px)
                                                              └─► public/models/house.usdz      (AR Quick Look)
scripts/verify-glb.ts ◄── checks the contract                 public/models/manifest.json ◄── scripts/build-models-manifest.ts
```

## 1. Building the model

```bash
pipeline/build_model.sh                # house.glb, house-lite.glb, house.usdz, verification, manifest
pipeline/build_model.sh --lite-only    # only the phone variant (fast check)
BLENDER=/path/to/Blender pipeline/build_model.sh
```

The script runs Blender three times (`high`, `lite`, `lite --usdz`), then `scripts/verify-glb.ts` on both GLBs, the 6 MB check of
the USDZ and `scripts/build-models-manifest.ts`. It stops on the first failure. The build takes about 10 seconds; textures
are cached in `pipeline/out/tex` (git-ignored). The GLB files are deterministic (the same inputs give byte-identical files, also with a
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
| `derived.rooms[].rects`, `.floor` | which grid cells are floor of which room; floor material `floor_<kind>` |
| `derived.openings` (`kind`, `wallId`, `from/to`, `sill`, `head`, `swing/hinge`) | holes in the wall faces, frames, glazing, doors |
| `derived.outline` (rects, polygon) | plinth, gravel border, what is "outside the house" |
| `derived.roofs` (`rect`, `pitch`, `overhang`, `wallTop`) | the roof surface (section 4); cross-checked against `derived.roofPlanes` |
| `derived.outdoor`, `.accents`, `.screens`, `.lightpipes` | slabs, posts, cladding, slat screens, light pipes |
| `house.clearHeight`, `house.slab` | ceiling height, roof structure depth |
| `house.roof` (`covering.type`, `downpipes`, `snowGuards`, `lightpipes`) | roof covering style, downpipes, snow guards, dome size |
| `house.shading.slats` | slat pitch, width and depth of the screens |
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
| `hb/exterior.py` | outdoor slabs, posts, gravel border, timber cladding, slat screens |
| `hb/materials.py`, `hb/textures.py`, `hb/floor_textures.py` | one material per role, texture preparation, procedural floors |
| `hb/export.py` | GLB (Draco, WebP, extras) and USDZ |
| `hb/selfcheck.py` | polygon sanity checks (non-finite, non-planar, duplicated faces) that run on every build |
| `preview.py` | quick Cycles / Workbench previews for visual checks (see section 7) |

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
* `post` (the terrace and porch posts) is white like the plaster and follows the façade look (`style.json` sets it with `plaster`).
* `toggle: "roof"`: `roof_tile`, `ridge_cap`, `fascia`, `gutter`, `soffit` (overhang undersides, flat terrace ceilings, light pipe
  domes) and `ceiling`. Downpipes, snow guards and light pipe collars are in the `gutter` / `ridge_cap` nodes, so they hide too.
* Glass: one node per glazed opening (every exterior opening except garage doors), two opposite quads per pane.
* UVs: plaster, plinth and paving by box projection in metres (the role's tile size is a property of the material); wood
  vertical; roof along the eave and the slope; floors in metres with the planks along x.
* Not in the GLB (generated in JS): terrain, trees, blinds, PV, labels. Furniture is a separate file.
* Heights: the terrain plateau around the house is at z = 0, so outdoor slabs stand a few millimetres above it
  (`outdoor_top` in `params.py`); the plinth and the foundation slab reach down to -0.45.

## 5. Levels of detail and budgets

| | `house.glb` (high) | `house-lite.glb` (lite) | `house.usdz` |
|---|---|---|---|
| textures | 1024 px WebP, normal maps | 512 px, no normal maps | 1024 px JPEG, tints baked in |
| geometry | timber boards, skirting, seams, fine gutters | cladding as panels, no skirting, coarser arcs | the lite geometry without drive, path, gravel |
| budget | 7 MB | 2.5 MB, 70 000 triangles | 6 MB |
| current | about 2.1 MB, 7 000 triangles, 54 nodes | about 0.3 MB, 5 200 triangles | about 0.85 MB |

The lite variant is built with a lower detail parameter, not by decimation. USDZ: 1 unit = 1 m, Y-up, the centre of the
footprint at the origin, UV set `st`; the constant glass opacity is carried by a 4 x 4 px opacity texture (the USD exporter
drops constant alpha), the style tints are baked into the textures.

## 6. Verification

* `scripts/verify-glb.ts` (Node, no dependencies; `npx tsx scripts/verify-glb.ts public/models/house.glb [--lite]`) parses the
  GLB container and checks: Draco and WebP extensions, roles, extras on every mesh node, no transforms, material = role without
  numeric suffixes, roof toggles, one glass node per glazed opening, the roles the data requires (floors per room kind,
  cladding, screens, posts), the bounding box of the exterior walls against the outline and of the roof covering against the
  eave rectangle and ridge height (+-2 cm), triangle and size budgets, texture sizes.
* `scripts/__tests__/glb.test.ts` (vitest) runs those rules on synthetic files and, when the GLBs exist, on the real files,
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
   --views sw,se,ne,nw,top,topr,section,living,street,garden,aerial,room:R04 [--lod lite] [--wb 1] [--cut 5.0]
```

Cycles previews with a sky (about 4 s per view); `--wb 1` renders Workbench with back-face culling, which shows missing or
flipped faces. Custom cameras: `--views "c:x,y,z:tx,ty,tz:lens|c:..."`. `top` hides the roof (plan), `section` cuts at `--cut`.

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

## 9. Known limits

Axis-parallel rectangles only (rooms, walls, roofs); hip roofs only; openings only in straight wall segments between
junctions; windows have one frame (no separate sash). The standing-seam covering is built when `roof.covering.type` contains
"steel"; any other type gets tile courses (clay and concrete look alike in geometry).
