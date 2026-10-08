# Render inputs

The Blender render scripts (stills, day sequence, orbit, compare pair, Open Graph image) **never compute geometry, terrain or the
position of the sun**. They read everything from one JSON file, `generated/render-inputs.json`, which
`scripts/build-render-inputs.ts` makes from the single source of truth (the model in `model/*.json` and the TypeScript kernel in
`src/lib/model`). What to shoot (cameras, times, frame counts, the moving parts of each shot) is data in `model/render.json`.

```
model/house.json ─┐
model/site.json  ─┤  src/lib/model (derive with the plot, graded terrain, PV layout, blinds rule)
model/style.json ─┤                  │
model/render.json ┘                  ▼
generated/derived.json         scripts/build-render-inputs.ts ──► generated/render-inputs.json   (git-ignored)
public/models/*.glb                  ▲                                     │
pipeline/out/furniture-report.json ──┘ (optional: lamp positions)         ▼
                                                              pipeline/render/*.py (Blender, Python stdlib only)
scripts/render-preview.mjs: fast three.js proxy of every camera ──► contact sheets (section 10)
```

```bash
npx tsx scripts/build-render-inputs.ts            # write generated/render-inputs.json
npx tsx scripts/build-render-inputs.ts --check    # write nothing; exit 1 when the file is stale
npx tsx scripts/build-render-inputs.ts --summary  # print a short summary (counts, sun table, cameras, orbit radius)
npx vitest run scripts/__tests__/render-inputs.test.ts scripts/__tests__/cameras.test.ts
node scripts/render-preview.mjs --all             # contact sheets of the stills, the day and the orbit (section 10)
```

Options: `--out <file>`, `--furniture-report <file>` (default `pipeline/out/furniture-report.json`, used when it exists and was
built from the same model), `--no-furniture-report`. The output is deterministic: the same inputs give a byte-identical file. The
file is about 0.6 MB (the terrain grid is most of it). Run it again after every change of `model/*.json`; the render scripts must
refuse to run when `modelHash` differs from the hash of the current `model/*.json` (`hashModelFiles`, see `docs/HOUSE-FORMAT.md`
section 8) or when `hash` does not match the content. The build refuses to run when `generated/derived.json` is not the geometry
the kernel produces now (`derivedFile(house, site)`, compared without its `inputHash`).

## 1. Conventions

* House frame, metres, degrees (`docs/ARCHITECTURE.md`, section 1): `x` east, `y` north, `z` up, `z = 0` is the finished floor.
  **Blender builds in this frame (Z up) and so does this file; no axis swap.**
* Angles: azimuths are clockwise from north. `azimuthHouseDeg` is relative to the house `+y` axis, `azimuthTrueDeg` to true north
  (`true = house + houseAxisBearingDeg`). Elevations are above the horizon.
* Times are local wall-clock time of `location.tz` (CEST, UTC+2, on the date used) written `"HH:MM"`; every shot also carries the
  ISO string with offset and the UTC instant. Dates are `"YYYY-MM-DD"`.
* Texts are `{cs, en}`, stored with the typography of `nb()` (`src/lib/i18n/format.ts`: no-break spaces after one-letter Czech
  prepositions and conjunctions), without digits (numbers of the model belong to the pages, never to a picture) and without the
  house name except in the Open Graph alt text.
* Lens: `focalMm` is the focal length for a **36 mm sensor along the longer image side** (Blender `sensor_fit = 'AUTO'`,
  `sensor_width = 36`). `fov` in the same object gives the resulting angles, so a script can check what it sets.
* `file` is a logical base name below the render output folder, without extension and without any resolution suffix, for example
  `day/0800`, `day/portrait/0800` or `orbit/landscape/0035`. The scripts add the folder and the extension (`.png`).
* Everything that is a list keeps the order of the source; indexes (`blinds.items[i]`, `shot.blinds[i]`, `screens[i]`) are positions
  in these lists. Ids (`R04`, `W02`, `GT01`) are labels only: scripts must not branch on them. Shots name what they show by **feature
  words** (`subjects`, orbit captions), never by ids: outdoor types (`terrace`, `pool`, `deck`, `drive`, `path`), opening kinds
  (`entry`, `garage`, `slider` = the main glazing, `window`), `terrace-corner` (the outer post of the covered terrace), `louvres`,
  `pv` (the roof plane with the most modules), `gate-drive`, `gate-walk`, `pillar`, a tree species (`walnut`) and furniture types
  (`island`, `bed180`, `shower`, ...); `scripts/lib/render-features.ts` resolves them from the model.
* Numbers are rounded (positions to 0.1 mm, angles to 0.001 degrees, terrain to 1 mm) so the file is stable.

## 2. `model/render.json` (what to shoot)

Schema `render/1`, validated by the zod schema in `scripts/lib/render-schema.ts` (unknown keys are errors). Numbers here are
**data**: cameras are positions in the house frame, tuned in the proxy preview (section 10) until the tests pass.

| key | content |
|---|---|
| `schema`, `fictional` | `"render/1"`, `true` |
| `date` | date of every sequence (summer solstice, so that the evening is long and the lawn green) |
| `sensorWidthMm` | 36 |
| `sky` | `{model: "MULTIPLE_SCATTERING" \| "SINGLE_SCATTERING", airDensity, aerosolDensity, ozoneDensity, clouds?}`: the Sky Texture node (`sky_type`, Blender 4.1 and later). `clouds` = `{hdri, strength, rotationDeg, visibleTo}`: a partly cloudy CC0 sky photo below the git-ignored `assets/` (repo-relative path) seen only by the listed ray types (`camera`, `glossy`, `transmission`); the sun and the sky light stay the sky model's. Passed through unchanged; the render scripts skip it when the file is missing |
| `terrain` | `{extentM, stepM}`: the terrain grid covers `extentM x extentM` metres centred on the building, at `stepM` |
| `lights` | schedule and power of the lamps (section 7) |
| `blinds` | the state rule of the external blinds (`autoDrop`, `maxDrop`, `cutoffMarginDeg`, `closedSlatAngleDeg`); the product is `house.json` `shading.blinds.product` (section 6) |
| `pv` | build details of the modules (thickness, frame, stand-off above the roof) |
| `vegetation` | per species hints (`form`, `leaf` colour, `flower`) keyed by the species of `site.json` |
| `stills` | 8 to 12 still shots (section 8.1) |
| `day` | the day sequence: time ranges, the landscape camera and its own portrait camera (section 8.2) |
| `orbit` | the orbit video and the scroll frames, per-variant lens and elevation, lifts, caption features (section 8.3) |
| `compare` | the afternoon / dusk pair from one camera, with a title and alt text per half (section 8.4) |
| `og` | the Open Graph shot (section 8.5) |

**Camera.** `{position, aboveGround?, target, focalMm, shift?, roll?, level?}`.

* `position` is `[x, y, z]`, or `[x, y]` together with `aboveGround`: the eye height above the **graded** terrain at that point
  (`groundAt` of `createSite(site, bearing, house.outdoor)`, the ground the web, walk mode and the renders share). Every eye-level
  camera uses `aboveGround` (1.6 to 1.8 m), so a terrain change can never lift or bury a camera. Interior and aerial cameras keep an
  absolute `z`.
* `level` (default `true` for a camera less than 5 m above the ground, `LEVEL_BELOW_M`): the viewing axis stays horizontal and the
  vertical lens shift puts the target where an aimed camera would put it, so verticals stay vertical. `shift` (Blender lens shift,
  fractions of the longer image side) is added on top, `roll` turns about the viewing axis.

**Shot.** A still adds `id`, `label`, `alt`, `category` (`exterior | interior | evening | aerial`, the gallery filter), `time`,
optional `date`, `size`, `lights` (`"auto" | "on" | "off"` or `{interior, exterior}` levels), `blinds` (`"auto" | "open" | "closed"`
or `{drop, slatAngleDeg}`), optional English `notes` for the artist (not shown on the site) and the moving parts (all optional):

| field | values | default |
|---|---|---|
| `gates` | `{driveway?, walkway?}`, open fraction 0..1: the sliding leaf moves along its park span, the swing leaf turns into the plot | closed |
| `garageDoor` | open fraction 0..1 of the garage doors (the leaf lifts) | 0 |
| `screens` | louvre walls: `"auto"` (the cut-off rule), `"open"` (90), `"closed"` (the physical stop), `"rest"` (the static model) or `{angleDeg}` (clamped to `[closedDeg, 90]`) | `"auto"` |
| `subjects` | feature words the alt text talks about (section 1); the tests check they are in the frame, face the camera and are not hidden | none |

The day sequence, the orbit, both halves of the compare pair and the Open Graph shot take the same `lights`, `blinds`, `gates`,
`garageDoor` and `screens` fields.

## 3. `generated/render-inputs.json`

Top level:

| key | content |
|---|---|
| `schema` | `"render-inputs/1"` |
| `hash` | SHA-256 over the canonical JSON of everything except `hash` itself |
| `modelHash` | `hashModelFiles` of `model/*.json` (includes `render.json`) |
| `inputs` | repo-relative paths of the Blender inputs (section 4) |
| `location` | `{lat, lon, elevationM, tz, houseAxisBearingDeg, region}` |
| `date`, `daylight` | the date and `{sunrise, sunset, civilDawn, civilDusk, solarNoon, noonElevationDeg}` (local `"HH:MM"`) |
| `sky` | `render.json` `sky` plus `altitudeM` |
| `sensor` | `{widthMm, fit: "AUTO"}` |
| `house` | `{bbox, footprint, clearHeight, wallTop, ridgeHeight, center, roofs[]}` |
| `terrain` | the height grid and the holes under the pools (section 5) |
| `site` | plot, street, surfaces, fence, gates, pillar, pools, rainwater tank, access (section 5) |
| `vegetation` | `trees[]`, `shrubs[]` (section 5) |
| `neighbours[]` | neighbour houses as boxes with a hip or gable roof (section 5) |
| `pv` | the modules in 3D (section 6) |
| `blinds` | `{rule, details, items[]}` (section 6) |
| `screens[]` | the louvre walls with their blades (section 6) |
| `lights` | `{sources, schedule, items[]}` (section 7) |
| `stills[]`, `day`, `orbit`, `compare`, `og` | the shots (section 8) |

### Camera (`shot.camera`)

```json
{ "position": [x, y, z], "target": [x, y, z], "forward": [fx, fy, 0], "up": [0, 0, 1], "roll": 0,
  "focalMm": 20, "sensorWidthMm": 36, "shift": [0, 0.011], "near": 0.1, "far": 600,
  "fov": { "horizontalDeg": 84, "verticalDeg": 53.1 }, "level": true, "groundZ": -0.31, "aboveGround": 1.65 }
```

Blender: `cam.location = position`; orientation from `forward` and `up` with
`quat = Vector(forward).to_track_quat('-Z', 'Y')` (then roll about the viewing axis if `roll != 0`); `cam.data.sensor_fit = 'AUTO'`,
`sensor_width = sensorWidthMm`, `lens = focalMm`, `shift_x, shift_y = shift`, `clip_start/clip_end = near/far`. The resolution comes
from the shot `size`. A `level` camera has a horizontal `forward`, and `shift` already contains the vertical shift that keeps the
target in place: never aim a level camera at its target. `position[2]` is absolute (`aboveGround` already resolved); `groundZ` is the
ground under the camera.

### Sun (`shot.sun`)

```json
{ "azimuthTrueDeg": 290.1, "azimuthHouseDeg": 278.1, "elevationDeg": 13.8, "elevationGeomDeg": 13.7,
  "direction": [x, y, z], "phase": "day",
  "blender": { "sunElevationRad": 0.241, "sunRotationRad": 4.854 } }
```

`direction` is the unit vector **towards the sun** in the house frame (= Blender world). A sun lamp: `rot_quat =
Vector(direction).to_track_quat('Z', 'Y')` (a sun lamp shines along its local `-Z`). A Sky Texture node: `sun_elevation =
blender.sunElevationRad`, `sun_rotation = blender.sunRotationRad`. In Blender 5.1 the node's `sun_rotation` is **the sun azimuth
measured clockwise from +Y** (checked by rendering an equirectangular view of the sky), so the value is the house azimuth in radians,
with no `pi - az` term. `elevationDeg` is the apparent elevation (refraction included), `elevationGeomDeg` the geometric one;
`direction` uses the apparent elevation. `phase`: `day` (above 10 degrees), `golden` (below 10 and the disc above the horizon),
`civil`, `nautical`, `astronomical`, `night`.

### Time, lamps, blinds, louvres, gates and garage door of a shot

```json
"time": { "date": "2026-06-21", "local": "20:15", "iso": "2026-06-21T20:15:00+02:00", "utc": "2026-06-21T18:15:00Z", "utcOffsetMinutes": 120 },
"lights": { "mode": "auto", "interior": 0.14, "exterior": 0.3 },
"blinds": [ { "drop": 0, "slatAngleDeg": 0, "irradiance": 12.3 }, ... ],
"screens": { "mode": "auto", "angleDeg": 35, "items": [ { "angleDeg": 35 } ] },
"gates": { "driveway": 0.5, "walkway": 0 }, "garageDoor": 1,
"sunScreen": { "x": -0.4, "y": 0.2, "inFrame": true, "visible": true },
"subjects": ["gate-drive", "drive", "garage", "entry"]
```

* `lights.interior` / `lights.exterior` are the 0..1 levels of the two lamp groups (section 7). Multiply the lamp power by it
  (below about 0.02 switch the lamps off). `mode` is the request from `render.json`.
* `blinds[i]` is the state of `blinds.items[i]` (section 6). `screens.items[i]` is the blade angle of `screens[i]`; `angleDeg` repeats
  the first one.
* `gates` and `garageDoor` are the open fractions (0 closed). An open sliding leaf moves `leaf x fraction` along its `park` span; a
  swing leaf turns by `fraction` of the angle from `swing.closedEnd` to `swing.openEnd` about `swing.hinge`.
* `sunScreen`: where the sun disc is on the image, `x, y` in -1..1 (right, up). `inFrame` is true when the disc is inside the
  frame; `visible` additionally needs the sun above the horizon and not hidden by the roof that covers the camera. `null` when the
  sun is behind the camera or more than 0.5 degree below the horizon.

## 4. `inputs`

```json
{ "derived": "generated/derived.json", "derivedHash": "...", "house": "model/house.json", "site": "model/site.json",
  "style": "model/style.json", "render": "model/render.json",
  "glb": { "house": "public/models/house.glb", "houseLite": "...", "furniture": "public/models/furniture.glb",
           "furnitureLite": "...", "footprints": "public/models/furniture-footprints.json", "manifest": "public/models/manifest.json" },
  "furnitureReport": "pipeline/out/furniture-report.json", "sunSource": "src/lib/calc/sun.ts" }
```

`furnitureReport` is `null` when the report was missing or built from another model. The house is built from `generated/derived.json`
(`docs/PIPELINE.md`; slabs from `derived.outdoor[].grade`, pools from `outdoor[].pool`); the furniture GLB is imported as it is. This
file adds what the house builder does not make: terrain, street, fence, gates and pillar, vegetation, neighbours, PV, blinds,
louvres, lamps and the shots.

## 5. Terrain, site, vegetation, neighbours

**`terrain`**

```json
{ "zeroLevelAsl": 240, "grid": { "x0": -33.5, "y0": -37.9, "step": 0.5, "nx": 181, "ny": 181, "unit": "mm", "heightsMm": [ ... ] },
  "plateau": { "level": -0.15, "rects": [[x0,y0,x1,y1]], "blend": 10 }, "voids": [[x0, y0, x1, y1]] }
```

`heightsMm[j * nx + i]` is the ground height (integer millimetres, z of the house frame) at `(x0 + i * step, y0 + j * step)`, from
`groundAt` of the **graded** terrain (`createSite(site, bearing, house.outdoor)`: the plateau around the house, the natural ground
elsewhere, cut under every slab and following the drive and path ramps). Build one mesh from it (two triangles per cell) and leave out
the cells inside `voids` (the pool basins, `derived.groundVoids`). Sample between grid nodes bilinearly; objects placed on the ground
carry their own `z`. Never re-compute the terrain in Python.

**`site`**

| key | content |
|---|---|
| `plot` | `{polygon: [[x,y]...] (counter-clockwise), edgeKinds: ["field","neighbour","street","neighbour"]}` |
| `zones` | `{street: {verge, pavement, green, carriageway, centreLine, kerbHeight, kerbWidth}, field, neighbourPlots: [{polygon}]}`: ground zones around the plot; the verge is the green strip plus the pavement along the kerb |
| `surfaces[]` | `{kind, role, polygon, inGlb, drape}`: paved areas, beds and the aprons in front of the gates. `role` is a style material role (`terrace_paving`, `drive_paving`, `path`, `gravel`, `mulch`). `inGlb: true` = already in the house GLB (the outdoor slabs); `drape: true` = follow the terrain height |
| `fences[]` | `{kind, height, thickness, parts, plinthHeight, slat: {orient, board, gap, depth}, postSize, postSpacing, posts: [{x, y, z}]}`: the slat fence on all four edges; `parts` already have the gate and pillar openings cut out |
| `gates[]` | `{id, access: "driveway" \| "walkway", kind: "sliding" \| "swing", leaf, height, postSize, thickness, tail, side, center, along, inward, opening, width, z, posts: [{x, y, z}], leafPolygon, park \| null, swing \| null}`: the closed leaf; `park` = `{from, to, offset, polygon}` of a sliding leaf, `swing` = `{hinge, radius, closedEnd, openEnd, arc}` of a swing leaf |
| `pillars[]` | `{id, access, side, size: [w, d, h], items, center, along, inward, footprint, z}`: the technical pillar (meter box, mailbox, intercom, house number, light) |
| `hedges[]` | `{species, evergreen, height, width, path}` plus the vegetation hints (none in the current model) |
| `access` | `{driveGate: {center, width, opening}, walkGate: {...}, driveKerb, walkKerb, droppedKerbReveal}`: the dropped kerbs are polygons |
| `pools[]` | `derived.outdoor[].pool` plus the slab `rect` and `top`: water rect, `waterZ`, `floorZ`, `copingTop`, `outer`, `polygons` (water, coping ring, deck minus water). Basin, coping and water are in the GLB; listed for the water material, the caustics and the lamps |
| `rainwater` | `{tank: {x, y, z, volumeM3, diameter, overflow}}` (buried; only its lid shows) |

**`vegetation.trees[]`**: `{species, latin, evergreen, x, y, z, height, crown, crownBase, uplight, form, leaf, flower?, seed, yawDeg, scale}`.
`z` is the ground height under the trunk, `crown` the crown diameter, `crownBase` the height of the lowest branches, `uplight` marks a
tree lit from the ground at night, `form` / `leaf` the hints of `render.json`, `seed` an integer derived from the position (choose a
model and variation with it), `yawDeg` a stable rotation, `scale` a 0.92..1.08 jitter. **`shrubs[]`** the same with `width` instead of
`crown`.

**`neighbours[]`**: `{footprint: [[x,y] x4], center, size: [w, d], rotDeg, baseZ, eaveHeight, ridgeHeight, eaveZ, ridgeZ, roof: {kind, pitchDeg, overhang}}`;
`eaveHeight` and `ridgeHeight` are measured from `baseZ`, `eaveZ` and `ridgeZ` are absolute.

## 6. PV, blinds, louvres

**`pv`**: `{moduleWp, width, height, thickness, frame, standoff, count, kwp, panels[]}`. A panel is
`{plane, face, wp, corners: [[x,y,z] x4], center, normal}` (`derived.pv.panels`); the corners lie in the roof plane. Build the module
`standoff` above the roof along `normal`, `thickness` deep, all black.

**`blinds`** (external venetian blinds on every glazed opening of a heated room, `derived.openings[].blind`):

* `rule` repeats the model (`kinds`, `azimuthFrom`, `azimuthTo`, `boxHeight`, `closedFactor`, `closeAboveIrradiance`).
* `details` is the **one product** of `house.json` `shading.blinds.product` (`slatWidth`, `slatPitch`, `slatThickness`, `railWidth`,
  `railDepth`, `boxDepth`, `reveal`, `maxSectionWidth`) plus the state rule of `render.json` (`autoDrop`, `maxDrop`,
  `cutoffMarginDeg`, `closedSlatAngleDeg`) and `tilt: "outer-edge-down"`.
* `items[i]`: `{openingId, kind, room, dir, azimuthHouseDeg, azimuthTrueDeg, normal, along, width, sill, head, height, faceCenter,
  planeCenter, sections: [{center, width}], box: {center, size, hidden: true}, overhang: {depth, eaveHeight} | null}`. The curtain
  runs in the reveal (`planeCenter` is `reveal` behind the outer face), in `sections` no wider than `maxSectionWidth` with shared middle
  rails; the headrail box is hidden in the wall above the head (only a dark slot shows under the lintel). `overhang` is the roof edge
  above the opening (`derived.openings[].overhang`: the real horizontal depth beyond the face, 7.45 m for the slider under the covered
  terrace).
* Per shot, `blinds[i]` = `{drop, slatAngleDeg, irradiance}`: `drop` 0 = raised .. 1 = lowered over the whole opening (from the
  top), `slatAngleDeg` 0 = horizontal .. 90 = closed, **a tilted slat has its outer edge lower** (like every real external blind),
  `irradiance` the direct clear-sky irradiance on the sunlit part of the glazing.
* Rule for `blinds: "auto"`: irradiance = DNI (Meinel clear sky) x cos(incidence) x (1 - `overhangShadedFraction`) (the shaded share of
  the glazing under its roof edge, the same function the energy page uses, `src/lib/calc/sun.ts`). Above `closeAboveIrradiance` the
  blind goes down to `autoDrop` with the slats at the cut-off tilt plus `cutoffMarginDeg` (at most `closedSlatAngleDeg`); otherwise
  it stays up. The cut-off tilt for slats of width `w` at pitch `p` and the sun's profile angle `alpha` is
  `beta = asin(p cos(alpha) / w) - alpha`, never below 0 (a steep summer sun is stopped by horizontal slats). So a blind under a deep
  roof stays up, and the south blinds stay up at a midsummer noon. `"open"` = drop 0; `"closed"` = `maxDrop` with
  `closedSlatAngleDeg`; `{drop, slatAngleDeg}` sets every blind.

**`screens[]`** (the louvre wall of the terrace, `derived.screens[]`): `{id, orient, from, to, length, azimuthHouseDeg, normal, axis,
baseZ, height, blades: {count, pitch, chord, thickness, positions}, closedDeg, openDeg, restDeg, slat}`. A blade turns about its
vertical centre line; at angle `a` its chord points along the wall `axis` turned counterclockwise (seen from above) by `a`: 0 = in the
wall plane, `closedDeg` = the physical stop where the neighbours touch (`ceil5(asin(thickness / pitch))`, "zavřeno"), 90 = square to
the wall (open). `slat` is a deprecated summary kept for older readers. Per shot, `screens.items[i].angleDeg` comes from the request;
`"auto"` is the most open whole-degree angle in `[closedDeg, 90]` that still stops the direct sun (90 without direct sun on the wall).

## 7. Lights

`lights.items[]`: `{kind, group, pos: [x,y,z], room, space, lumens, watts, kelvin, radius, spot}`.

* `group`: `"interior"` or `"exterior"`; the level of the shot (`shot.lights.interior` / `.exterior`) scales the group.
* `kind`: `downlight` (ceiling grid of rooms), `pendant`, `floor_lamp`, `table_lamp`, `desk_lamp`, `lantern` (furniture decor, from
  the furniture report), `terrace_downlight` (soffit of covered outdoor areas), `wall_light` (entrance, garage), `bollard` (path),
  and the garden lights of the site (contract C3):
  * `pool`: underwater lights in both long walls of every pool, `depthM` below the water, aimed across the basin;
  * `garden`: `space: "tree_uplight"` beside every tree marked `uplight` (on the side facing the house, aimed into the crown) and
    `space: "deck_step"` along the edges of the deck areas where they meet the lawn;
  * `pillar`: the light of a technical pillar that carries the item `light`, on its street face.
* `room`: the room id the lamp is in (`null` outside), `space` the room type, outdoor type or the garden sub-kind.
* `lumens`: luminous flux; `watts`: a starting value for a Blender point light (about `lumens / 10`); `kelvin` 2700 to 4000;
  `radius`: light size in metres; `spot`: `null` or `{direction, coneDeg, blend}`.
* `lights.sources`: `{rooms: true, furnitureReport: bool}`; `lights.schedule`: `{interior: {offAboveElevationDeg,
  fullBelowElevationDeg}, exterior: {...}}`: the level of a group is a smooth step of the apparent sun elevation. A shot with
  `mode: "on"` has level 1, `"off"` 0.

## 8. Shots

All shots have `id`, `file`, `size: [w, h]`, `time`, `camera`, `sun`, `lights`, `blinds`, `screens`, `gates`, `garageDoor`,
`sunScreen` and `subjects` as above. The shot list (PLAN 3.5) is house-first and eye-level at golden and blue hour: the camera stands
1.6 to 1.8 m above the ground, verticals are level, the house fills 55 to 75 % of the width.

| shot | camera | time and state | what it shows |
|---|---|---|---|
| `day` (landscape) | SW garden across the pool, 1.65 m above the ground, 20 mm | 08:00-15:00 hourly, 16:00-19:40 every 20 min, 19:50-21:40 every 10 min; lamps and blinds auto; still 19:20 | terrace corner and the main glazing in the middle, the walnut crown in the right quarter, sky or roof behind the title (top left) |
| `day.portrait` | its own camera nearer the terrace corner, 24 mm | the same moments | roofline in the top third, terrace and glazing in the middle, lawn under the clock |
| `compare` | SE across the pool (the opposite diagonal), 24 mm | 17:45 lamps off, blinds auto / 21:15 lamps on, blinds open | the terrace and the living room in raking afternoon sun and lit after sunset |
| `og` | the hero camera, 22 mm, 1200 x 630 (rendered larger by the quality preset) | 21:10, lamps auto | the house at dusk, the walnut on the right; the name is composited by the media step |
| `orbit` | low loop from 225 degrees counterclockwise, landscape 18 degrees / 29 mm, portrait 24 degrees / 26 mm, lifts over the walnut and the cherry | 17:00, lamps off, blinds open | captions for the terrace, the PV roof, the entrance, the garage and the pool |
| `garden-walnut` | SE lawn under the walnut crown, 26 mm | 16:30 | pool, terrace and south facade framed by the walnut trunk and crown |
| `street-approach` | the pavement in front of the drive gate, 20 mm | 20:15, drive gate half open, garage door open, lamps 0.45 | the sliding gate, the drive to the garage with the cars, the porch |
| `terrace-louvres` | under the terrace roof, 30 mm | 17:00, louvres at 35 degrees | stripes of light on the deck, the lounge against the garage wall |
| `entrance` | the path axis just inside the walk gate, 24 mm | 21:10, lamps on | porch, wall light, bollards, the grasses along the path |
| `living`, `kitchen`, `bedroom-morning`, `bathroom` | interiors at 20-22 mm | 15:30 / 10:30 / 07:30 (blinds half down, slats 40) / 08:00 | the rooms after the re-plan and re-furnish |
| `aerial` | the only aerial, from the south-west, 35 mm | 17:30 | roof with PV, pool, fence, gates |

### 8.1 `stills[]`

Extra fields: `label`, `alt` (`{cs, en}`), `category`, `notes`. The gallery keeps the order of `render.json`. Alt texts are written
from the proxy frames (section 10) and name only what the frame shows (`subjects`).

### 8.2 `day`

```json
{ "date": "2026-06-21", "size": [1920, 1080], "camera": { ... }, "portrait": { "size": [1080, 1620], "camera": { ... } },
  "stillTime": "19:20", "subjects": ["terrace-corner", "slider", "pool"],
  "frames": [ { "index": 0, "id": "0800", "file": "day/0800", "time": {..}, "sun": {..}, "lights": {..}, "blinds": [..],
                "screens": {..}, "gates": {..}, "garageDoor": 0, "sunScreen": {..},
                "portrait": { "file": "day/portrait/0800", "sunScreen": {..} } }, ... ] }
```

One frame per time of `day.ranges` (both ends included). One static landscape camera and **one static portrait camera** of its own: the
phone version is rendered at `portrait.size` with the same times, lamps, blinds and louvres (`frames[].portrait.file`), not cropped
from the landscape frames. `stillTime` is the frame used as the poster and the reduced-motion still. (`render.json` `day.portrait`
still accepts the old `aspect` and `centerX`; they are deprecated and ignored here.)

### 8.3 `orbit`

```json
{ "time": {..}, "sun": {..}, "lights": {..}, "blinds": [..], "screens": {..}, "gates": {..}, "garageDoor": 0,
  "fps": 24, "frameCount": 240, "durationSec": 10, "loop": true, "startAzimuthDeg": 225, "direction": "counterclockwise",
  "breathing": { "heightM": 0, "radiusFraction": 0 }, "lifts": [ { "azimuthDeg": 158, "halfWidthDeg": 60, "elevationDeg": 32 }, ... ],
  "scrollStep": 4, "scrollCount": 60, "target": [x, y, z], "captionHalfWindowDeg": 30,
  "captions": [ { "feature": "pool", "azimuthDeg": 205.1, "point": [x, y, z], "normal": null, "frames": [0, 1, ...] }, ... ],
  "variants": [ { "id": "landscape", "size": [1920, 1080], "frameSelection": "all", "fitMargin": 0.04, "radiusMin": 25.3, "radiusMax": 34.9,
                  "elevationDeg": 18, "focalMm": 29, "fov": {..},
                  "frames": [ { "index": 0, "scrollIndex": 0, "angleDeg": 225, "elevationDeg": 18, "radius": 31.6, "file": "orbit/landscape/0000", "camera": {..} }, ... ] },
                { "id": "portrait", "size": [1080, 1620], "frameSelection": "scroll", "fitMargin": -0.1, "elevationDeg": 24, "focalMm": 26, ... } ] }
```

* The camera goes once round the building in `frameCount` equal steps; frame `i` is at the azimuth `startAzimuthDeg + s * 360 * i /
  frameCount` (`s` = +1 clockwise, -1 counterclockwise seen from above; `angleDeg` = azimuth of the direction from `target` to the
  camera), so the video loops without a jump when frames `0 .. frameCount - 1` are rendered. `target` is the centre of `derived.bbox`
  at `targetZ`.
* **Per variant** `focalMm`, `elevationDeg` and `fitMargin` (the orbit values are the defaults). The elevation of frame `i` is the
  variant's elevation plus the `lifts`: around `azimuthDeg` it rises with a raised-cosine profile to `elevationDeg`, back to the base
  `halfWidthDeg` away (a crane move over a tree that would hide the house; periodic, so the loop closes). The camera height is
  `target.z + radius * tan(elevation)` (no breathing).
* `frames[i].radius` (horizontal distance) is the smallest distance at which the house silhouette stays inside the frame shrunk by
  `fitMargin` (negative = may be cropped) and the feature of every caption that shows in that frame stays inside the frame (the pool
  in front of the house); the series is slope-limited (`ORBIT_RADIUS_SLOPE`, 0.1 m per degree), lightly smoothed as a closed loop and
  scaled so that the fit holds at every frame, times `radiusSlack`. The orbit never passes within 4 m of a neighbouring house.
* `captions[]`: the features the home page names while the orbit plays (`render.json` `orbit.captions.features`). `azimuthDeg` is the
  azimuth the feature faces (the facing of a facade element or roof plane, or the direction of an area from `target`,
  `facingAzimuth` in `render-features.ts`); `frames` are the frame indexes whose camera azimuth lies within `captionHalfWindowDeg` of
  it. The web shows a caption by the same rule from `startAzimuthDeg`, `direction` and the model; the captions are listed in the order
  the camera meets them.
* The `landscape` variant lists all frames and is the video (24 fps); the `portrait` variant lists only the scroll frames
  (`scrollIndex != null`, every `scrollStep`-th frame).

### 8.4 `compare`

`{id, size, alt, before: Shot, after: Shot}`: one camera, two moments. Each half carries `label` (the chip on the slider), `title` and
`alt` (the half as a picture of its own) and `gallery` (default `true`; the `before` half is `false`: it lives only in the slider).

### 8.5 `og`

One shot (`id: "og"`) from the hero camera family with its own lens, alt text `{cs, en}` naming the house. Important content stays in
the middle 80 % so the 1200 x 600 Twitter crop is safe.

## 9. Checks and guarantees (tests)

`scripts/__tests__/render-inputs.test.ts` (output and framing) and `scripts/__tests__/cameras.test.ts` (placement) check, with counts
taken from the config and framing measured on the model (`scripts/lib/render-framing.ts`):

* `render.json`: the strict schema, unique ids, the four gallery categories with exactly one aerial, texts without digits, with the
  `nb()` typography and without "v zlatém", the house name in the Open Graph alt, a title and alt per compare half, `gallery: false`
  on the first half;
* counts: one still per entry, one day frame per time of the ranges, a portrait camera of its own, the orbit frames, scroll frames and
  per-variant lens, elevation and margin of the config, the PV modules and blinds of the kernel, the cloud sky passed through;
* lamps: the C3 garden kinds (`pool` under the water in a basin wall, `garden` uplights at every tree marked `uplight`, `pillar`);
* the sun against an independent almanac formula and the web sun module, its physical limits, the lamps by day and after sunset;
* blinds: the product of `house.json`, the cut-off tilt (outer edge down) against a numeric search, the auto rule, blinds kept up while
  their roof edge shades the glazing, no south blind down at midsummer noon, explicit requests;
* louvres within `[closedDeg, 90]`, the cut-off angle (blocks, one degree more does not), gates and garage door per shot;
* the graded terrain grid against `groundAt`, the pool holes, the extent;
* cameras: exterior cameras outside the walls, interior cameras inside a room and looking into the building, the field of view, the
  target near the centre, every `subject` inside the frame, facing the camera and at most half hidden behind the plot;
* the hero: on the plot, 1.2 to 2.6 m above the ground, level, house at least 60 % of the landscape width and 45 % of the portrait
  width, terrace corner and main glazing in the central 80 % of both, the walnut crown in the right quarter, the title zone (top-left
  45 x 35 %) at least 90 % sky or roof, the portrait roofline in the top third and its lower third free of the house, the Open Graph
  image from the hero position at dusk, the compare pair on the opposite diagonal;
* the orbit: the house in the frame at every frame, equal steps, smooth position and distance, the configured elevation, a low loop in
  afternoon light, trees hiding more than 30 % of the house in at most 20 frames (`occluders.rayChord`), never in a caption window or
  frame 0, every caption feature facing the camera, in the frame and at most half hidden while its caption shows, frame 0 showing the
  terrace, the pool and the PV roof;
* placement (`cameras.test.ts`): the web presets of `house.json` stand on the plot at eye height, in the street at eye height looking
  through a gate opening, or high; no camera (web preset, still, day, compare, Open Graph, every orbit frame) inside a crown, shrub,
  fence, gate leaf or neighbouring building; every ground-level render camera 1.2 to 2.6 m above the graded ground and level; a render
  camera in the street opens the gate it looks through; nothing between a camera and its target; no two published pictures from the
  same camera at the same time, no two stills from one place; every orbit camera at least 4 m outside every neighbouring house;
* the hash: byte-identical output when built twice, a changed camera changes it, `modelHash` is the project-wide `hashModelFiles`,
  no private strings, no absolute paths, no NaN, at most 6 decimals.

## 10. Proxy preview (`scripts/render-preview.mjs`)

A fast stand-in for the Cycles renders, used to frame every camera before a long render. It builds the render inputs in memory (the
same `buildRenderInputs`) and renders them with three.js in a headless Chromium (software WebGL): the house (`public/models/house.glb`
when it was built from the current model, else a proxy from `generated/derived.json`: walls with openings, roof planes, slabs with
their grades, the pool, posts, louvres, furniture boxes), the graded terrain with the street, pavement and neighbour plots, the slat
fence, the gates at each shot's open fraction, the pillar, trees with crowns, shrubs, beds and paved areas, neighbours, PV, blinds,
lamps and the sun of each shot. Each tile carries guides (central 80 %, the title zone, thirds) and the numbers the tests measure:
house share of the width, eye height, where each subject lands and how much of it is hidden, the walnut and the title zone of the
hero, how much of the house the trees hide in an orbit frame, and a warning when a camera stands inside an occluder.

```bash
node scripts/render-preview.mjs --all                         # sheets of the stills, the day sequence and the orbit
node scripts/render-preview.mjs --sheet stills                 # one sheet (stills | day | orbit)
node scripts/render-preview.mjs --only day,garden-walnut       # single large frames (still ids, day, day-portrait, og,
                                                               # compare-before, compare-after, orbit-<variant>-<frame>)
node scripts/render-preview.mjs --only street-approach --render-json /tmp/try.json   # try a camera without editing render.json
```

Options: `--out <dir>` (default `pipeline/out/preview`), `--width <px>`, `--house auto|glb|proxy`. It writes `sheet-*.png`, the tiles
and `framing.txt` (the numbers of every view). Needs the Playwright Chromium of the dev dependencies and ImageMagick (`magick`); a
full run takes well under a minute. The look (flat sky, simple materials) is only for framing; light and exposure are judged on the
Cycles draft (`docs/PIPELINE-RENDER.md`).

## 11. Sun source

The position of the sun comes from `src/lib/calc/sun.ts` when it works (`resolveSunProvider`), else from `scripts/lib/solar.ts`
(NOAA algorithm); the test asserts that both agree within 0.1 degree. `inputs.sunSource` says which one made the file. Sunrise, sunset
and the twilight times (`daylight`) are found by bisection on the elevation function of the provider in use. The clear-sky direct
irradiance that drives the blind rule (`clearSkyDni`), the louvre cut-off and the lamp schedule are part of this script, not of
Python: Python only applies `drop`, `slatAngleDeg`, the blade angles, the gate and door fractions and the lamp levels it finds here.
