# Render inputs

The Blender render scripts (stills, day sequence, orbit, compare pair, Open Graph image) **never compute geometry, terrain or the
position of the sun**. They read everything from one JSON file, `generated/render-inputs.json`, which
`scripts/build-render-inputs.ts` makes from the single source of truth (the model in `model/*.json` and the TypeScript kernel in
`src/lib/model`). What to shoot (cameras, times, frame counts) is data in `model/render.json`.

```
model/house.json ─┐
model/site.json  ─┤  src/lib/model (derive, site terrain, PV layout, blinds rule)
model/style.json ─┤                  │
model/render.json ┘                  ▼
generated/derived.json         scripts/build-render-inputs.ts ──► generated/render-inputs.json   (git-ignored)
public/models/*.glb                  ▲                                     │
pipeline/out/furniture-report.json ──┘ (optional: lamp positions)         ▼
                                                              pipeline/render/*.py (Blender, Python stdlib only)
```

```bash
npx tsx scripts/build-render-inputs.ts            # write generated/render-inputs.json
npx tsx scripts/build-render-inputs.ts --check    # write nothing; exit 1 when the file is stale
npx tsx scripts/build-render-inputs.ts --summary  # print a short summary (counts, sun table, orbit radius)
npx vitest run scripts/__tests__/render-inputs.test.ts
```

Options: `--out <file>`, `--furniture-report <file>` (default `pipeline/out/furniture-report.json`, used when it exists and was
built from the same model), `--no-furniture-report`. The output is deterministic: the same inputs give a byte-identical file. The
file is about 0.7 MB (the terrain grid is most of it). Run it again after every change of `model/*.json`; the render scripts must
refuse to run when `modelHash` differs from the hash of the current `model/*.json` (`hashModelFiles`, see `docs/HOUSE-FORMAT.md`
section 8) or when `hash` does not match the content.

## 1. Conventions

* House frame, metres, degrees (`docs/ARCHITECTURE.md`, section 1): `x` east, `y` north, `z` up, `z = 0` is the finished floor
  (the levelled plateau around the house). **Blender builds in this frame (Z up) and so does this file; no axis swap.**
* Angles: azimuths are clockwise from north. `azimuthHouseDeg` is relative to the house `+y` axis, `azimuthTrueDeg` to true north
  (`true = house + houseAxisBearingDeg`, 12 degrees for this house). Elevations are above the horizon.
* Times are local wall-clock time of `location.tz` (CEST, UTC+2, on the date used) written `"HH:MM"`; every shot also carries the
  ISO string with offset and the UTC instant. Dates are `"YYYY-MM-DD"`.
* Texts are `{cs, en}`. Czech strings use no-break spaces.
* Lens: `focalMm` is the focal length for a **36 mm sensor along the longer image side** (Blender `sensor_fit = 'AUTO'`,
  `sensor_width = 36`). `fov` in the same object gives the resulting angles, so a script can check what it sets.
* `file` is a logical base name below the render output folder, without extension and without any resolution suffix, for example
  `day/0800` or `orbit/landscape/0035`. The scripts add the folder and the extension (`.png`).
* Everything that is a list keeps the order of the source; indexes (`blinds.items[i]`, `shot.blinds[i]`) are positions in these
  lists. Ids (`R04`, `W02`) are labels only: scripts must not branch on them.
* Numbers are rounded (positions to 0.1 mm, angles to 0.001 degrees, terrain to 1 mm) so the file is stable.

## 2. `model/render.json` (what to shoot)

Schema `render/1`, validated by the zod schema in `scripts/lib/render-schema.ts` (unknown keys are errors). Numbers here are
**data**: cameras are positions in the house frame, not derived from anything.

| key | content |
|---|---|
| `schema`, `fictional` | `"render/1"`, `true` |
| `date` | date of every sequence (summer solstice, so that the evening is long and the lawn green) |
| `sensorWidthMm` | 36 |
| `sky` | `{model: "MULTIPLE_SCATTERING" \| "SINGLE_SCATTERING", airDensity, aerosolDensity, ozoneDensity}`: values for the Sky Texture node (`sky_type`, Blender 4.1 and later; the old "Nishita") |
| `terrain` | `{extentM, stepM}`: the terrain grid covers `extentM x extentM` metres centred on the building, at `stepM` |
| `lights` | schedule and power of the lamps (section 7) |
| `blinds` | build details of the external blinds and their state rule (section 6) |
| `pv` | build details of the modules (thickness, frame, stand-off above the roof) |
| `vegetation` | per species hints (`form`, `leaf` colour, ...) keyed by the species of `site.json` |
| `stills` | 9 still shots (section 8.1) |
| `day` | the day sequence: time ranges, one static camera, portrait crop (section 8.2) |
| `orbit` | the orbit video and the scroll frames (section 8.3) |
| `compare` | the day / evening pair from one camera (section 8.4) |
| `og` | the Open Graph shot, 1200 x 630 (section 8.5) |

A camera is `{position: [x,y,z], target: [x,y,z], focalMm, shift?: [sx, sy], roll?: deg}`. `shift` is the Blender lens shift (fractions
of the longer image side; use `sy` to keep verticals parallel with a level camera). A shot adds `lights` (`"auto" | "on" | "off"`),
`blinds` (`"auto" | "open" | "closed"`), `time`, optional `date`, `size`, optional English `notes` for the artist (not shown on the
site). Categories: `exterior`, `interior`, `evening`, `aerial` (they drive the gallery filter).

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
| `sky` | `{model, airDensity, aerosolDensity, ozoneDensity, altitudeM}` |
| `sensor` | `{widthMm, fit: "AUTO"}` |
| `house` | `{bbox, footprint, clearHeight, wallTop, ridgeHeight, center, roofs[]}` |
| `terrain` | the height grid (section 5) |
| `site` | plot, zones, surfaces, fences, hedges, beds, access (section 5) |
| `vegetation` | `trees[]`, `shrubs[]` (section 5) |
| `neighbours[]` | neighbour houses as boxes with a hip or gable roof (section 5) |
| `pv` | the 36 modules in 3D (section 6) |
| `blinds` | `{rule, details, items[]}` (section 6) |
| `screens[]` | the vertical slat screens of the terrace (section 6) |
| `lights` | `{sources, schedule, items[]}` (section 7) |
| `stills[]`, `day`, `orbit`, `compare`, `og` | the shots (section 8) |

### Camera (`shot.camera`)

```json
{ "position": [x, y, z], "target": [x, y, z], "forward": [fx, fy, fz], "up": [0, 0, 1], "roll": 0,
  "focalMm": 28, "sensorWidthMm": 36, "shift": [0, 0], "near": 0.1, "far": 600,
  "fov": { "horizontalDeg": 65.5, "verticalDeg": 40.3 } }
```

Blender: `cam.location = position`; orientation from `forward` and `up` with
`quat = Vector(forward).to_track_quat('-Z', 'Y')` (then roll about the viewing axis if `roll != 0`); `cam.data.sensor_fit = 'AUTO'`,
`sensor_width = sensorWidthMm`, `lens = focalMm`, `shift_x, shift_y = shift`, `clip_start/clip_end = near/far`. The resolution comes
from the shot `size`.

### Sun (`shot.sun`)

```json
{ "azimuthTrueDeg": 297.2, "azimuthHouseDeg": 285.2, "elevationDeg": 7.8, "elevationGeomDeg": 7.7,
  "direction": [x, y, z], "phase": "golden",
  "blender": { "sunElevationRad": 0.136, "sunRotationRad": 4.978 } }
```

`direction` is the unit vector **towards the sun** in the house frame (= Blender world). A sun lamp: `rot_quat =
Vector(direction).to_track_quat('Z', 'Y')` (a sun lamp shines along its local `-Z`). A Sky Texture node (`sky_type = MULTIPLE_SCATTERING`): `sun_elevation = blender.sunElevationRad`, `sun_rotation =
blender.sunRotationRad`. In Blender 5.1 the node's `sun_rotation` is **the sun azimuth measured clockwise from +Y** (checked by
rendering an equirectangular view of the sky: rotation 0 puts the sun to the north, 90 degrees to the east, 180 to the south), so
the value is the house azimuth in radians, with no `pi - az` term. Use the same direction for the sun lamp and for the sky, and
if a test render shows the disc and the lamp apart, trust the lamp direction. `elevationDeg` is the apparent elevation (refraction included, what the eye sees),
`elevationGeomDeg` the geometric one; `direction` uses the apparent elevation. `phase`: `day` (above 10 degrees), `golden` (below 10
and the disc above the horizon), `civil`, `nautical`, `astronomical`, `night`.

### Time, light level and blinds of a shot

```json
"time": { "date": "2026-06-21", "local": "20:15", "iso": "2026-06-21T20:15:00+02:00", "utc": "2026-06-21T18:15:00Z", "utcOffsetMinutes": 120 },
"lights": { "mode": "auto", "interior": 0.44, "exterior": 0.12 },
"blinds": [ { "drop": 0, "slatAngleDeg": 0, "irradiance": 12.3 }, ... ],
"sunScreen": { "x": -0.4, "y": 0.2, "inFrame": true, "visible": true }
```

* `lights.interior` / `lights.exterior` are the 0..1 levels of the two lamp groups (section 7). Multiply the lamp power by it
  (below about 0.02 switch the lamps off). `mode` is the request from `render.json`.
* `blinds[i]` is the state of `blinds.items[i]`: `drop` 0 = raised (box only) .. 1 = fully lowered, `slatAngleDeg` 0 = slats
  horizontal (open) .. 90 = closed, `irradiance` the direct clear-sky irradiance on that facade (W/m2) that the rule used.
* `sunScreen`: where the sun disc is on the image, `x, y` in -1..1 (right, up). `inFrame` is true when the disc is inside the
  frame; `visible` additionally needs the sun above the horizon and not hidden by the roof that covers the camera (a camera
  under an eave sees only a sun lower than the eave edge as seen from the camera; neighbours and trees are not considered).
  `null` when the sun is behind the camera or more than 0.5 degree below the horizon.

## 4. `inputs`

```json
{ "derived": "generated/derived.json", "house": "model/house.json", "site": "model/site.json", "style": "model/style.json",
  "render": "model/render.json", "derivedHash": "...", "sunSource": "scripts/lib/solar.ts",
  "glb": { "house": "public/models/house.glb", "houseLite": "...", "furniture": "public/models/furniture.glb",
           "furnitureLite": "...", "footprints": "public/models/furniture-footprints.json", "manifest": "public/models/manifest.json" },
  "furnitureReport": "pipeline/out/furniture-report.json" }
```

`furnitureReport` is `null` when the report was missing or built from another model. The house Blender scene is built with
`build_house.build_scene(Config.load(derived, house, style, lod="high", for_render=True))` (docs/PIPELINE.md, section 8); the GLB of
the furniture is imported as it is (it is already in the house frame, Y-up). This file adds only what the house builder does
not make: terrain, vegetation, neighbours, PV, blinds, screens, lights and the shots.

## 5. Terrain, site, vegetation, neighbours

**`terrain`**

```json
{ "zeroLevelAsl": 240, "grid": { "x0": -33.5, "y0": -38, "step": 0.5, "nx": 181, "ny": 181, "unit": "mm", "heightsMm": [ ... ] },
  "plateau": { "level": 0, "rects": [[x0,y0,x1,y1]], "blend": 8 } }
```

`heightsMm[j * nx + i]` is the ground height (integer millimetres, z of the house frame) at `(x0 + i * step, y0 + j * step)`,
from `groundAt` of `src/lib/model/site/terrain.ts` (graded plateau around the house, natural terrain elsewhere). Build one mesh
from it (two triangles per cell). Sample heights between grid nodes bilinearly; for objects placed on the ground use the `z` they
carry, which is `groundAt` at their position. Never re-compute the terrain in Python.

**`site`**

| key | content |
|---|---|
| `plot` | `{polygon: [[x,y]...] (counter-clockwise), edgeKinds: ["field","neighbour","street","neighbour"]}` |
| `zones` | `{street: {verge, carriageway, centreLine, kerbHeight}, field: [[x,y]...], neighbourPlots: [{polygon}]}`: ground zones around the plot (polygons) |
| `surfaces[]` | `{kind, role, polygon, inGlb, drape}`: paved areas. `role` is a style material role (`terrace_paving`, `drive_paving`, `path`, `gravel`, `mulch`). `inGlb: true` means the house GLB already contains it (the outdoor slabs of the house model): do not add it again. `drape: true` means follow the terrain height (add a few mm) |
| `fences[]` | `{kind, height, thickness, parts: [[[x,y]...]]}`: the polylines already have the gate openings cut out |
| `hedges[]` | `{species, evergreen, height, width, path: [[x,y]...]}` plus the vegetation hints |
| `access` | `{driveGate: {center, width}, walkGate: {center, width}}` |

**`vegetation.trees[]`**: `{species, latin, evergreen, x, y, z, height, crown, crownBase, kind, form, leaf, seed, yawDeg, scale}`.
`z` is the ground height under the trunk, `crown` the crown diameter, `crownBase` the height of the lowest branches above the
ground, `form` / `leaf` the hints of `render.json` (`vegetation.species`), `seed` an integer derived from the position (use it to
choose a model and variation), `yawDeg` a stable random rotation, `scale` a 0.9..1.1 jitter. **`shrubs[]`** the same with `width`
instead of `crown`. Trees are listed for a leafy summer day (`date`); the `leaf` hint says which green to use.

**`neighbours[]`**: `{footprint: [[x,y] x4], center, size: [w, d], rotDeg, baseZ, eaveHeight, ridgeHeight, roof: {kind, pitchDeg, overhang}}`;
`baseZ` is the ground height at the lowest corner; `eaveHeight` and `ridgeHeight` are measured from that `baseZ`; `eaveZ` and
`ridgeZ` are the same heights as absolute z. `roof` is `{kind: "hip" | "gable", pitchDeg, overhang}`. `footprint` is rotated by
`rotDeg` about `center`. They are plain boxes with a roof: no windows are modelled.

## 6. PV, blinds, screens

**`pv`**: `{moduleWp, width, height, thickness, frame, standoff, count, kwp, panels[]}`. A panel is
`{plane, wp, corners: [[x,y,z] x4], center, normal}`; the corners are counter-clockwise seen from above and lie in the roof plane
(`derived.pv.panels`, 36 modules, 15.48 kWp). Build the module `standoff` metres above the roof (along `normal`), `thickness` deep,
with a `frame` wide aluminium rim, dark blue-black glass with a faint cell grid. The roof itself is in the house GLB.

**`blinds`**: `rule` repeats the model (`kinds`, `azimuthFrom`, `azimuthTo`, `closedFactor`, `closeAboveIrradiance`), `details` the
build parameters of `render.json` (`boxDepth`, `railWidth`, `railDepth`, `slatPitch`, `slatWidth`, `slatThickness`, `maxDrop`, `cutoffMarginDeg`).
`items[i]`: `{openingId, kind, room, dir, azimuthHouseDeg, azimuthTrueDeg, normal: [nx, ny, 0], width, sill, head, height, faceCenter: [x,y,z], box: {center, size: [along, outward, height]}}`.
`faceCenter` is the middle of the opening on the outer wall face at mid height; `normal` points away from the building; the box
(headrail housing, `boxHeight` from `house.shading.blinds`) sits on the face above `head`. The blind runs on two guide rails at the
sides of the opening, the lowered curtain covers `sill..head`. Per shot, `blinds[i].drop` is the lowered fraction of the opening
height from the top and `slatAngleDeg` the slat tilt. Rule used for `blinds: "auto"`: the facade direct irradiance (clear-sky
Meinel model times the cosine of the incidence) is above `closeAboveIrradiance`: `drop = maxDrop`, the slats are tilted to the cut-off
angle (profile angle of the sun plus `cutoffMarginDeg`, limited to 15..80 degrees); otherwise raised and open. `"open"` forces
`drop 0`, `"closed"` forces `drop = maxDrop, slats 80`.

**`screens[]`** (the timber slat screens): `{orient, from: [x,y], to: [x,y], length, azimuthHouseDeg, baseZ, height, slat: {pitch, width, depth, count}}`.
Slats are vertical, `count` of them at `pitch` along the segment from `baseZ` to `baseZ + height` (up to the terrace soffit).

## 7. Lights

`lights.items[]`: `{kind, group, pos: [x,y,z], room, space, lumens, watts, kelvin, radius, spot}`.

* `group`: `"interior"` or `"exterior"`; the level of the shot (`shot.lights.interior` / `.exterior`) scales the group.
* `kind`: `downlight` (ceiling grid of rooms, aims down), `pendant`, `floor_lamp`, `table_lamp`, `desk_lamp` (from the furniture
  decor), `lantern`, `terrace_downlight`, `wall_light` (entrance, garage), `bollard` (path).
* `room`: the room id the lamp is in (`null` outside), `space` the room type or outdoor type.
* `lumens`: luminous flux; `watts`: a **starting value** for a Blender point light (tune by eye; about `lumens / 10`); `kelvin`: colour
  temperature (2700 to 3000, warm); `radius`: light size in metres (soft shadows); `spot`: `null` or `{direction, coneDeg, blend}`.
* `lights.sources`: `{rooms: true, furnitureReport: bool}`. Lamps of the furniture decor come from `pipeline/out/furniture-report.json`
  when it matches the model; the ceiling grid and the outdoor lights come from the model alone.
* `lights.schedule`: `{interior: {offAboveElevationDeg, fullBelowElevationDeg}, exterior: {...}}`: the level of a group is a smooth
  step of the apparent sun elevation (0 above `offAbove`, 1 below `fullBelow`). A shot with `mode: "on"` has level 1, `"off"` 0.

## 8. Shots

All shots have `id`, `file`, `size: [w, h]`, `time`, `camera`, `sun`, `lights`, `blinds`, `sunScreen` as above.

### 8.1 `stills[]` (9 shots, 1920 x 1080)

Extra fields: `label`, `alt` (`{cs, en}`), `category` (`exterior | interior | evening | aerial`), `notes`. The list: entrance and street at
sunset, garden and terrace in the afternoon, terrace in the evening with lights, bird's-eye view, terrace detail, living room with
kitchen towards the garden, bedroom, garage with the cars, south facade with PV and blinds. Stills ship as 1920 x 1080 PNG; the
web versions are made from them by the media scripts.

### 8.2 `day`

```json
{ "date": "2026-06-21", "size": [1920, 1080], "camera": { ... },
  "portrait": { "aspect": [2, 3], "size": [720, 1080], "crop": { "x": 600, "y": 0, "width": 720, "height": 1080 } },
  "stillTime": "13:00", "frames": [ { "index": 0, "id": "0800", "file": "day/0800", "time": {..}, "sun": {..}, "lights": {..}, "blinds": [..], "sunScreen": {..} }, ... ] }
```

30 frames with one static camera: 8:00 to 15:00 every hour (8 frames), 16:00 to 19:40 every 20 minutes (12), 20:00 to 21:30 every
10 minutes (10). Sunrise is 4:48, sunset 21:03; the last frames are civil twilight with the lamps on. File names `day/0800` ..
`day/2130` (`id` = the time without the colon).

The camera stands on the covered terrace close to its south-west corner (about 1.2 m from the west edge, eye height 1.45 m) and looks
west-south-west over the lawn: terrace posts and the roof edge frame the top of the picture, the garden and the sky fill the rest.
It looks that way because under a roof the only sun that can be seen is a low one: the disc is visible (`sunScreen.visible`)
from 17:40 to 20:50 (13 of 30 frames) and sets in the right half of the picture; before that the sun is above the roof edge, and
the daylight shows as light and shadows on the terrace floor and the garden. At dusk the terrace downlights and lanterns are on
(`lights.exterior` 1) and the sky glows. Frames from 21:10 have the sun below the horizon (`sunScreen: null`).

The **portrait version is a crop** of the same render (no extra rendering): `portrait.crop` is the pixel box in the landscape image
(2:3, `centerX` of `render.json` = the centre of the crop as a fraction of the width). `stillTime` is the frame used as the single
day still / poster.

### 8.3 `orbit`

```json
{ "date": "2026-06-21", "time": {..}, "sun": {..}, "lights": {..}, "blinds": [..], "fps": 24, "frameCount": 300, "durationSec": 12.5, "loop": true,
  "startAzimuthDeg": 215, "direction": "counterclockwise", "breathing": { "heightM": 0.9, "radiusFraction": 0 },
  "scrollStep": 5, "scrollCount": 60, "target": [x, y, z],
  "variants": [ { "id": "landscape", "size": [1920,1080], "frameSelection": "all", "fitMargin": 0.1, "radiusMin": 28.4, "radiusMax": 34.1,
                  "elevationDeg": 27, "focalMm": 28, "fov": {..}, "frames": [ ... ] },
                { "id": "portrait", "size": [1080,1620], "frameSelection": "scroll", "fitMargin": -0.12, ... } ] }
```

The camera goes once round the building in `frameCount` equal steps; frame `i` is at the angle `startAzimuthDeg + s * 360 * i / frameCount`
(`s` = +1 clockwise, -1 counterclockwise seen from above; `frames[i].angleDeg` = azimuth in the house frame of the direction from
the target to the camera), so frame `frameCount` would equal frame 0: the video loops without a jump if you render frames
`0 .. frameCount - 1` (24 fps, 12.5 s). `target` is the centre of the `derived.bbox` box at height `targetZ`.

Radius and height come from the data, not from guesses: `frames[i].radius` is the horizontal distance from `target`. For each frame the
smallest distance at which all eight corners of the `derived.bbox` box stay inside the frame (shrunk by `fitMargin`, a fraction of the half
size; negative = may be cropped, used by the tall portrait variant) is found by bisection; the series is then smoothed as a closed
loop (so the camera does not jerk between the long and the short sides) and scaled so that the fit still holds at **every** frame, times
`radiusSlack`. `radiusMin` / `radiusMax` of a variant are the extremes. The camera height is `target.z + radius * tan(elevationDeg)`
plus a small periodic breathing (two periods per loop, so it closes). The camera always looks at `target`.

The sun and the light are fixed for the whole orbit (`time` 19:55, golden hour: sun elevation about 9 degrees, lamps partly on). Blinds are
as the rule gives them at that time. `frames[k]`: `{index, scrollIndex, angleDeg, radius, file, camera}`; `scrollIndex` is 0..59 for
every 5th frame (index 0, 5, ...) and `null` otherwise. The `landscape` variant lists all 300 frames and is the video; the `portrait`
variant lists only the 60 scroll frames (`frameSelection: "scroll"`, the frames with `scrollIndex != null`; it has its own, larger radius
and focal length). Encode the video with ffmpeg from `orbit/landscape/0000 .. 0299` at 24 fps. The 60 landscape scroll frames are
the subset with `scrollIndex != null`.

### 8.4 `compare`

`{id, alt, size, before: Shot, after: Shot}`: the same camera twice, daytime and evening (`before.time` / `after.time`, lights off / on).
`before` and `after` carry `label` (`{cs, en}`).

### 8.5 `og`

One shot (`id: "og"`, 1200 x 630) with its own camera, composed for a link preview (important content in the middle 80 percent).

## 9. Checks and guarantees (tests)

`scripts/__tests__/render-inputs.test.ts` (38 tests, about 1 second) checks:

* the strict schema of `render.json` (unknown keys, bad clock times and sizes are errors) and the four gallery categories;
* the counts: 9 stills (1920 x 1080), the 1200 x 630 Open Graph shot, 30 day frames with exactly the required time steps, a 2:3 portrait
  crop inside the frame, 300 orbit frames (24 fps, 12.5 s) with 60 scroll frames, 36 PV modules lying in their roof planes, one blind
  per `derived.openings[].blind`, interior and exterior lamps, trees standing on the ground;
* the sun: azimuth and elevation of every shot against an independent almanac formula (0.3 degree), against `src/lib/calc/sun.ts`
  (0.1 degree) as soon as that module is implemented, noon elevation = 90 - latitude + declination, below the horizon after sunset,
  azimuth monotone from east to west, the direction vector consistent with the angles, lamps off by day and on after sunset, the
  sun disc visible in at least 8 day frames;
* the roof-occlusion rule used by `sunScreen.visible`;
* the terrain grid against `groundAt` at the nodes (1 mm) and between them (bilinear, 8 cm), the flat plateau, the 90 m extent;
* cameras: exterior cameras outside the walls, interior cameras inside a room (0.2 m from the walls) and looking into the building,
  the day camera on the covered terrace under the roof, the compare pair from one camera, the field of view, the target in the centre;
* the orbit: the building box inside the frame at all frames of both variants, equal angle steps, no jump between the last and the
  first frame, radius equal to the horizontal camera distance, golden hour sun;
* the hash: byte-identical output when built twice, the content hash recomputes, a changed camera changes it, `modelHash` is the
  project-wide `hashModelFiles`, no private strings, no NaN, at most 6 decimals.

## 10. Sun source

The position of the sun comes from `scripts/lib/solar.ts` (NOAA algorithm, Meeus based, a few lines of TypeScript) as long as
`src/lib/calc/sun.ts` throws "not implemented". As soon as `calc/sun.ts` works, `scripts/build-render-inputs.ts` uses it
(`resolveSunProvider`) and the test asserts that both agree within 0.1 degree. The field `inputs.sunSource` of the output says
which implementation made the file (`"scripts/lib/solar.ts"` or `"src/lib/calc/sun.ts"`). Sunrise, sunset and the twilight times
(`daylight`) are found by bisection on the elevation function of whichever provider is in use.

The clear-sky direct irradiance that drives the blind rule (`clearSkyDni`, Meinel model) and the lamp schedule are part of this
script, not of Python: Python only applies `drop`, `slatAngleDeg` and the lamp levels it finds in the file.
