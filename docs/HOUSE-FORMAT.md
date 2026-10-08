# House format `house/1`

`model/house.json` describes the whole fictional house in one file. It is a superset of the compact `concept/1` plan
format: every plan key of `concept/1` is kept (`wall`, `clearHeight`, `slab`, `bearingAxes`, `rooms`, `openings`,
`roofs`, `outdoor`, `accents`, `furniture`, `lightpipes`, `screens`, `notes`) and the rest of the building (location,
zones, assemblies, windows, equipment, shading, roof details, cameras) is added around it.

* The definition is the zod schema in `src/lib/model/schema.ts`. `model/house.schema.json` (JSON Schema, draft 2020-12) is
  exported from it by `npx tsx scripts/build-derived.ts`; a test fails when the two differ.
* Everything that can be computed is **not** stored: net room areas, walls, the footprint, openings' walls and
  orientation, roof faces, PV modules, metrics. They come from `derive()` (see `docs/KERNEL-API.md`) and are written to
  `generated/derived.json` for the Blender pipeline (part 2 of this document).
* All user-visible text is bilingual: `{ "cs": "...", "en": "..." }` (type `LocalizedText`). The model stores plain spaces;
  pages show model text through `localized(text, locale)` (`src/lib/model/metrics.ts`), which applies the site's typography
  (`nb()`: no-break spaces after single-letter Czech prepositions and between a number and its unit). A test checks every
  text of the model through `localized()`.
* Code must never branch on an id (`R04`, `W02`, `T1`). Use `type`, `kind`, `role`, or the derived fields.

## 1. Conventions

| topic | rule |
|---|---|
| units | metres, degrees, W, kWp, W/(m² K); thickness and sizes in metres |
| house frame | `x` east, `y` north, `z` up, in the frame of the house axes; origin at the outer axis corner at the south-west of the main block; `z = 0` is the top of the finished floor |
| true orientation | `location.houseAxisBearingDeg` is the azimuth (clockwise from true north) of the house `+y` axis. True azimuth of a house azimuth `a` is `(a + bearing) mod 360` |
| house azimuth | 0 = house north (`+y`), 90 = east (`+x`), 180 = south (`-y`), 270 = west. Keys `N`, `E`, `S`, `W` always mean these house-frame directions (`S` is the garden side) |
| true compass name | 8 winds (`N`, `NE`, `E`, `SE`, `S`, `SW`, `W`, `NW`) of the true azimuth; `facing` fields hold them |
| PVGIS aspect | `aspect = azimuthTrue - 180` wrapped to (-180, 180]: 0 = south, east negative, west positive |
| glTF | Y-up; house `(x, y, z)` becomes glTF `(x, z, -y)` |
| rectangles | `[x0, y0, x1, y1]` with `x0 < x1`, `y0 < y1` |
| ids | labels for humans (`R01` rooms, `W02`/`D01`/`S01`/`E01`/`G01` openings, `T1` roofs, `O1` outdoor, `A1` cladding, `L1` screens); unique within their list |
| privacy | the model is fictional (`fictional: true`); `location` is the fictional region, coordinates rounded to 0.1° (`E-LOKACE`) |

## 2. Top-level keys

| key | type | meaning |
|---|---|---|
| `schema` | `"house/1"` | format id |
| `id` | string | model id |
| `name` | text | name of the house (the visible brand of the site) |
| `tagline` | text, optional | one line of about 70 characters under the name: the hero lede and the meta description (`V-TAGLINE` if missing) |
| `idea` | text, optional | 2-3 sentences of description in plain words (`V-IDEA` if missing) |
| `fictional` | `true` | must be true |
| `location` | object | region, coordinates, elevation, time zone, axis bearing |
| `wall` | `{ext, bearing, part}` | wall thicknesses: exterior, internal bearing, partition (m, at most 1.5) |
| `clearHeight` | number 2-5 | clear room height (m) |
| `slab` | number 0-1.5 | ceiling slab thickness (m); default wall top = `clearHeight + slab` |
| `bearingAxes` | `{x: number[], y: number[]}` | axes on which internal walls are bearing (`x` for walls running along y) |
| `rooms` | room[] | the floor plan (at least one) |
| `zones` | object | day / night / service / outdoor: lists of types with labels |
| `openings` | opening[] | windows, doors, entry, garage doors, sliding walls |
| `roofs` | roof[] | hip roofs |
| `outdoor` | outdoor[] | terraces, paving, drive, paths |
| `accents` | accent[] | timber cladding strips on exterior walls |
| `furniture` | item[] | furniture and cars |
| `lightpipes` | `[x, y][]` | positions of tubular daylight devices in the roof |
| `screens` | screen[] | free-standing slat screens |
| `assemblies` | object | layer build-ups: exteriorWall, bearingWall, partitionWall, ceiling, roof, groundFloor |
| `windows` | object | U-values, g-value and frame share of the glazing |
| `equipment` | object | pv, battery, heating, ventilation |
| `shading` | object | rule for external blinds, style of slat screens |
| `roof` | object | roof covering, light-pipe parameters, downpipes, snow guards |
| `cameras` | camera[] | named views for the web and the renders |
| `notes` | `{[key]: text}` | free construction notes |

Unknown keys are errors (`E-TYP`), so typos are caught.

## 3. Plan (the concept/1 part)

### 3.1 `location`

```json
{ "region": {"cs": "Jižní Morava", "en": "South Moravia"},
  "lat": 49.2, "lon": 16.6, "elevation": 240, "tz": "Europe/Prague", "houseAxisBearingDeg": 12 }
```

`lat`/`lon` must be multiples of 0.1° (privacy). `elevation` is metres above sea level. `houseAxisBearingDeg` in
[0, 360). With 12° the longer south facade faces azimuth 192 (south-south-west).

### 3.2 `rooms[]`

```json
{ "id": "R04", "name": {"cs": "...", "en": "..."}, "shortName": {"cs": "Obývák", "en": "Living"}, "type": "living",
  "role": "main-living", "floor": "oak", "rects": [[6.65, 0, 13.5, 5.4], [9, 5.4, 13.5, 8.7]] }
```

* `shortName` (optional): a short label for tight places (3D room tags, chips); pages fall back to `name`.
* Visitors never see the id: the room number is derived (`derived.rooms[].displayNo`, "1.01", section 5.3).

* `rects` are rectangles **between wall axes**. Together all rooms tile the plan exactly (no overlap `E-PREKRYV`, no hole
  `E-DIRA`, one connected part `E-NESOUVISLY`). A room may have several rectangles (L shapes).
* Walls are derived: wherever two cells differ in owner there is a wall on the axis; between a room and the outside it is
  `exterior` (thickness `wall.ext`), on a bearing axis `bearing`, else `partition`.
* The net room is the axis rectangle reduced by half the wall thickness on every side.
* `type` (required): `hall living kitchen dining bedroom kids office guest bath wc wardrobe utility pantry garage storage corridor technical`.
  The garage is not heated; everything else is.
* `floor` (optional): `oak tile concrete stone`.
* `role` (optional, unique except `children`): `main-living entry primary-bedroom primary-bath primary-wardrobe children family-bath guest-wc home-office plant pantry garage night-corridor`
  (`E-ROLE` when a unique role is used twice). Roles let pages find "the living room" without ids.

### 3.3 `zones`

```json
{ "day": {"label": {...}, "types": ["living", "kitchen", "dining", "office", "guest", "hall"]},
  "night": {...}, "service": {...}, "outdoor": {"label": {...}, "types": ["terrace", "paving", "drive", "path", "deck", "pool"]} }
```

Every room type that is used belongs to exactly one of `day`, `night`, `service` (`E-ZONA`); every used outdoor type to
`outdoor`. Derived rooms carry `zone`.

### 3.4 `openings[]`

| field | meaning |
|---|---|
| `kind` | `window`, `door` (interior), `entry` (main entrance), `garage` (garage door), `slider` (sliding wall) |
| `orient` | `"h"`: the wall runs along x at `y = cy`, the position along the wall is `cx`. `"v"`: the wall runs along y at `x = cx`, the position is `cy` |
| `cx`, `cy` | centre of the opening **on the wall axis** (tolerance 1 cm) |
| `w`, `sill`, `head` | width, sill height, head height above the floor (m) |
| `swing`, `hinge` | required for `door` and `entry`. `swing`: `+` opens towards larger y/x, `-` towards smaller. `hinge`: `+`/`-` end of the opening (larger/smaller coordinate along the wall) where the hinge is. The leaf is drawn from the hinge on the wall face of the swing side; an `entry` has a leaf of at most 0.9 m and a side light for the rest |

Rules: windows, `entry`, `garage` and `slider` only in exterior walls, `door` only in interior walls (`E-OTVOR-DRUH`);
size limits (m, `E-OTVOR-ROZMER`):

| kind | width | sill | head |
|---|---|---|---|
| window | 0.4-6 | 0.6-1.2 | at most 2.4, height at least 0.3 |
| door | 0.8-1.0 | 0 | 2.0-2.4 |
| entry | 1.0-1.3 | 0 | 2.2-2.4 |
| garage | 2.4-5.0 | 0 | 2.2-2.4 |
| slider | 1.8-4.5 | 0 | 2.2-2.4 |

and `head <= clearHeight`. At least 0.2 m of clear masonry from a corner or junction (`E-OTVOR-ROH`) and between two
openings on one wall (`E-OTVOR-OTVOR`). The opening must lie on one wall segment (`E-OTVOR-ZED`).

### 3.5 `roofs[]`

```json
{ "id": "T1", "rect": [-0.25, -0.25, 23.25, 12.05], "pitch": 22, "overhang": 0.8, "wallTop": 3.05 }
```

One **hip roof** (four planes) per rectangle. `rect` is the outer faces of the walls it covers; `pitch` in degrees (0, 70];
`overhang` (default 0, at most 3) moves the eaves out and down along the same planes; `wallTop` (default `clearHeight +
slab`) is the height of the planes at the wall face. Ridge: along the longer side, length `longer - shorter`, height
`wallTop + shorter / 2 * tan(pitch)`. Roofs may overlap; the visible surface is the maximum of all roofs, so valleys appear
where a transverse hip meets the main roof (see 5.4). Every exterior wall and the whole footprint must be under a roof
(`E-STRECHA`); covered outdoor areas under a roof incl. overhang (`E-TERASA`).

### 3.6 `outdoor[]`, `accents[]`, `furniture[]`, `screens[]`, `lightpipes`

* `outdoor`: `{id, type, name?, covered?, rect, top?, surface?, posts?: [x, y][], postSize?}` with `type`
  `terrace | paving | drive | path | deck | pool`. Covered areas need posts (`V-TERASA-SLOUPY`).

  | field | meaning |
  |---|---|
  | `name` | optional name for visitors ("Závětří u vstupu", "Bazén"); pages fall back to `OUTDOOR_TYPE_NAMES` |
  | `top` | height of the slab top above ±0.000 (m, default `DEFAULT_OUTDOOR_TOP` = −0.02). The drive and the path that the site extends to the street are ramps from this top at the house end to their gate (section 5.7) |
  | `surface` | `paving` or `deck` (timber boards). Default `deck` for type `deck`, `paving` otherwise. Gives the GLB role (`derived.outdoor[].role`) |
  | `postSize` | side of the square posts (m); required when there are posts |
  | `depth`, `waterBelowTop`, `coping` | **pool only, all required**: depth of the basin below the coping top, water level below the coping top, width of the coping ring (m). `rect` is the water surface. Not allowed on other types |

  A pool must lie, coping included, inside an outdoor area of type `deck`, `paving` or `terrace` (`POOL_SURROUND_TYPES`) and
  must not touch the house (`E-BAZEN`). Catalogue lists that pages and the pipeline use instead of type names:
  `GROUND_VOID_OUTDOOR` (`pool`: the terrain has a hole there), `SUN_SAMPLED_OUTDOOR` (`terrace`, `pool`: the sun analysis
  samples them), `WATER_OUTDOOR` (`pool`).
* `accents`: `{id, type: "wood", orient, cx, cy, w}`: a timber cladding strip on an **exterior** wall (`E-OBKLAD`).
* `furniture`: `{type, x, y, rot, w?, d?}`: `x, y` is the centre, `rot` is 0/90/180/270 counter-clockwise in the plan; at
  rot 0 the width `w` runs along x, the depth `d` along y and the back of the object (bed head, sofa back) faces +y. Types
  and default sizes are in `FURNITURE` (`src/lib/model/catalog.ts`): `bed160 bed180 bed90 sofaL sofa3 armchair tv table6
  table8 chair island kitchenLine fridge wardrobe desk shelf wc sink sink2 shower bath washer coffeeTable car lounger swingbed grill bench`.
* `screens`: `{id, type: "slats", orient: "v", cx, y0, y1}` or `{id, type: "slats", orient: "h", cy, x0, x1}`: a louvre wall
  of vertical blades that **turn** (they never slide). The blades are in `shading.slats` (section 4.4).
* `lightpipes`: positions `[x, y]` (plan). Diameter and dome height are in `roof.lightpipes`. Derived data places each
  on its roof face with the roof height and the room below.

## 4. Extensions of house/1

### 4.1 `assemblies`

Six build-ups: `exteriorWall`, `bearingWall`, `partitionWall`, `ceiling`, `roof`, `groundFloor`, plus the optional
`wallToUnheated` (an insulated wall between heated and unheated rooms, e.g. to the garage). The walls it applies to are
derived: `derived.walls[].toUnheated` marks every interior wall with a heated room on one side and an unheated room on the
other (`metrics.unheatedBoundary` gives their wall and door areas).

```json
{ "name": {...}, "rsi": 0.13, "rse": 0.04,
  "layers": [ { "id": "render", "name": {...}, "t": 0.010, "lambda": 0.80, "role": "finish" }, ... ] }
```

* Layers are listed **from the outside to the inside** of the heated volume (the floor from the ground upwards).
* A layer has either `lambda` (W/(m K)) or a fixed resistance `r` (m² K/W, air gaps, membranes), plus optional `role`
  (`finish insulation structure cladding air membrane screed`) and `ventilated: true`.
* `U = 1 / (rsi + sum(t / lambda or r) + rse)` (EN ISO 6946, no thermal-bridge correction). Layers **outside** a
  ventilated layer are ignored and `rse` is replaced by `rsi`.
* Consistency with the plan (`E-SKLADBA`, 5 mm): thickness of `exteriorWall` = `wall.ext`, `bearingWall` = `wall.bearing`,
  `partitionWall` = `wall.part`; the `structure` layers of `ceiling` add up to `slab`.
* Warnings `V-U-ZED` (> 0.20), `V-U-STRECHA` (> 0.15), `V-U-PODLAHA` (> 0.25 W/(m² K)): rules of thumb for a low-energy house.

### 4.2 `windows`

`{Uw, Ug, g, frameShare, Ud, slider?: {Uw, g, frameShare}}`: whole-window and glazing U-value, solar transmittance,
frame share, U-value of opaque doors; `slider` overrides the values for sliding walls.

### 4.3 `equipment`

```json
"pv": { "module": {"name": {...}, "wp": 430, "width": 1.134, "height": 1.722},
        "layout": { "facings": ["S"], "orientation": "portrait", "gap": 0.02,
                    "setback": {"eave": 0.8, "ridge": 0.4, "hip": 1.0, "valley": 0.5, "step": 0.5},
                    "obstacleClearance": 0.3 },
        "inverter": {"ratedKw": 10} },
"battery": { "options": [{"id": "b10", "name": {...}, "capacityKwh": 10, "powerKw": 5}, ...], "default": "b10" },
"heating": { "type": "air-water-heat-pump", "name": {...}, "ratedPowerKw": 8, "scop": 4.3, "scopDhw": 3.0,
             "emission": "underfloor", "flowTemperatureC": 35, "dhw": {"tankLiters": 200, "setpointC": 50},
             "outdoorUnit": { "pos": [-0.75, 10.6], "size": [1.1, 0.45, 1.0], "rot": 90 } },
"ventilation": { "type": "mvhr", "name": {...}, "heatRecoveryEfficiency": 0.88, "nominalAirflowM3h": 240, "specificFanPower": 0.35 }
```

`heating.outdoorUnit` (optional): the outdoor unit of an air-source heat pump standing on the ground: plan centre, size
`[w, d, h]` (w along x at rot 0), rotation 0/90/180/270. `derived.outdoorUnit` gives its footprint and the ground height
(GLB role `equipment`).

The PV **layout is derived**, not stored: modules go on roof faces whose `side` is in `layout.facings`, in rows parallel
to the eave, at the given distance from edges of each kind, around light pipes (see 5.5). The count is a result
(`derived.pv.count`), not an input.

### 4.4 `shading`

```json
"blinds": { "type": "external-venetian", "name": {...}, "kinds": ["window", "slider"],
            "azimuthFrom": 0, "azimuthTo": 360, "boxHeight": 0.2, "closedFactor": 0.15, "closeAboveIrradiance": 250,
            "product": { "slatWidth": 0.08, "slatPitch": 0.072, "slatThickness": 0.0035, "railWidth": 0.024,
                         "railDepth": 0.03, "boxDepth": 0.09, "reveal": 0.051, "maxSectionWidth": 2.4 } },
"slats": { "pitch": 0.10, "width": 0.025, "depth": 0.12, "restDeg": 60 }
```

**Rule:** an exterior opening gets a blind (`derived.openings[].blind`) when its kind is in `kinds`, it has glazing, it
belongs to a heated room, and its **true** azimuth lies in the clockwise range `azimuthFrom → azimuthTo`. **0 → 360 (any
range of 360° or more) means every facade**; otherwise the ends are taken modulo 360, so 350 → 10 wraps through north and
135 → 315 is the south and west half. `closedFactor` multiplies the solar gain with the blind closed; the blind closes
above `closeAboveIrradiance` W/m² on the facade.

`blinds.product` is the **one** blind product, read by the web 3D and the renders (never two definitions): slat width,
pitch and thickness, guide rail width and depth, the depth of the box hidden in the reveal and of the blind plane behind
the outer wall face (`reveal`), and the widest section; a wider opening gets `derived.openings[].blindSections` sections
with shared middle rails.

`slats` are the blades of the louvre walls (`screens`): centre-to-centre `pitch`, `depth` = the **chord** (across the wall
when open), `width` = the **thickness**, `restDeg` = the angle of the static model and the default of the controls. The
blades turn about their centres; angles are measured from the wall plane: **90° = open** (square to the wall), and the
closed stop is where neighbouring blades touch, `closedDeg = ceil5(asin(width / pitch))` (15° for 25 mm blades at a
100 mm pitch), derived as `derived.screens[].closedDeg`. Validation (`E-LAMELY`): chord > pitch (the closed wall is
opaque), `closedDeg` ≤ 30 and `closedDeg` ≤ `restDeg`.

### 4.5 `roof`

`{attic, covering: {type, name}, lightpipes: {diameter, domeHeight}, downpipes: [{x, y, diameter}], snowGuards: {aboveOpeningKinds}}`.

* `attic`: `"cold"` (a ventilated attic above the insulated ceiling: the `ceiling` assembly closes the heated volume) or
  `"warm"` (the `roof` assembly does). `derived.topEnvelope` is `"ceiling"` or `"roof"` accordingly; `V-U-STRECHA` checks that
  assembly.
* `covering.type` is `standing-seam-steel | clay-tile | concrete-tile`.
* Downpipes should stand at the low end of every roof valley (`V-SVOD-UDOLI`). The gutters follow the outer edge of the
  roof plan (union of the eave rectangles); every downpipe within 1.5 m of it is an outlet (a pipe inside a terrace column
  counts), and water runs to the nearer outlet, so a gutter may run at most `GUTTER_RUN_MAX` = 12.5 m to an outlet
  (outlets at most 25 m apart along the gutter, `V-SVOD-OKAP`).
* Snow guards run over openings of the listed kinds.

### 4.6 `cameras[]`

```json
{ "id": "garden", "name": {...}, "short": {"cs": "Zahrada", "en": "Garden"}, "kind": "perspective",
  "position": [6.0, -15.0, 1.4], "aboveGround": 1.6, "target": [10.0, 1.0, 1.5], "fov": 55, "use": ["web", "render"] }
```

House-frame metres, `z` absolute (0 = top of the finished floor, **not** height above the ground). `aboveGround` (optional)
gives the eye height above the graded ground instead: `derived.cameras[].position[2]` = `groundAt(x, y) + aboveGround`
(the site's terrain with the slabs cut in), and `position[2]` of the model is then only a fallback for code without the
site (keep it close). `fov` is the vertical field of view (degrees, required for perspective), `orthoHeight` the visible
height (m, required for orthographic). Other fields:

| field | meaning |
|---|---|
| `short` | short chip label ("Ulice", "Zahrada"); pages fall back to `name` |
| `use` | `web` (3D page presets, in this order), `sun` (presets of the Sun page), `render` (suitable for stills; the stills are planned in `model/render.json` with their own cameras, which follow the same rules), `og` (shows the whole building at 1200 x 630, checked by a test) |
| `default` | the opening view of the 3D pages; at most one camera, and it must have `use` `web` or `sun` (`E-KAMERA`) |
| `defaultFor` | stage classes this camera opens on instead: `["narrow"]` = phones (read after mount) |

The cameras of the model, in chip order: the aerial view from the south-west (chip "Celý pozemek" / "Whole plot": the
default of both 3D pages and of phones), the street at eye level on the far side of the carriageway (it looks through
the drive gate, so the gate is open in that view), the entrance on the path axis, the garden from the south-west lawn
across the pool, the pool and terrace from the south-east, the covered terrace from the pool deck, the living room, the
main bedroom and the top view; the aerial view from the south-east is for the renders only. Eye-level cameras give
`aboveGround`; their stored `z` is the resolved height rounded to 1 cm.

**How cameras are chosen** (checked by `scripts/__tests__/cameras.test.ts`, compare `docs/SITE.md`):

* The plot is closed on every side by one slat fence (on a plinth) with a sliding drive gate, a walk gate and a pillar on the
  street (`docs/SITE.md`). A camera outside the plot at eye height only sees the fence. So an **eye-level camera stands on
  the plot** (or on the street when it is meant to show the gate): inside the plot polygon, at least 0.8 m from the boundary
  (the fence stands 0.1 m inside it), 1.0 to 2.6 m above the ground (use `aboveGround`), not inside a tree, shrub or the fence.
* A **high camera** (8 m or more above the ground: aerial and street-side views) may stand outside the plot, over the street,
  the field or a neighbour, if its line of sight passes above the boundary: steep enough that the street fence is not in the
  frame, no hedge, fence or neighbouring building between it and the house.
* Nothing stands between the camera and the house: the ray to the target is free of crowns and the ray to the centre of the house
  is free of hedges, fences and walls. Trees and shrubs of the garden may frame a view at its edges. Look for the corridors
  between the crowns in `site.json` (`trees`, `shrubs`) and keep the camera and the target on a line through one.
* Frame the house for the stage of the web page (about 1.45 : 1, `fov` is vertical): the whole roof for aerial views, the part
  the view is named after for the others. Interior cameras stand in a room, at least 0.2 m from the walls, and look into it.
* Check a view visually on `/model` in the dev server: `window.__stage.viewer.setView({ id, name, position, target, fov, ortho: false },
  { animate: false })` takes scene-frame coordinates (`(x, y, z)` of the house becomes `(x, z, -y)`).

### 4.7 `notes`

`{[key]: text}`: construction notes with free keys (`structure`, `terrace`, `roof`, `light`).

## 5. How geometry is derived (`src/lib/model/derive.ts`)

### 5.1 Plan

Coordinate compression: all x and y values of the room rectangles form a grid; every cell has at most one owner. Walls are
runs of cell edges whose two sides have different owners. Net rooms, areas, glazing per direction and the outline (union of
the axis cells extended by `ext/2` on the outer sides) are exact. `outline.polygons` holds the footprint ring (positive area)
and any holes (negative). The area identity "footprint = sum of net rooms + wall bodies" and the offset identity
"footprint = axis area + ext/2 * perimeter + (ext/2)² * (convex - concave corners)" are checked by tests. The deriver does not use `polygon-clipping`: unions of axis-parallel rectangles on a compressed grid are
exact, whereas a general clipper is sensitive to float noise at shared edges. The tests use `polygon-clipping` as an
independent check of the roof faces.

### 5.2 Orientation of openings

An exterior opening inherits the outward normal of its wall: `azimuth` (house frame, 0/90/180/270), `azimuthTrue`
(`+ bearing`), `facing` (8-wind name of the true azimuth), `dir` (`N|E|S|W` of the house frame).

### 5.2a Overhang in front of an opening

`derived.openings[].overhang` (exterior openings under a roof): start at the centre of the head on the **outer wall face** and
march along the outward normal until the point leaves the union of the roof plan (the eave rectangles; exact, from far edge
to far edge). `depth` is that distance, so an opening onto a covered terrace is shaded by the whole terrace roof (a slider
onto a 6.65 m deep terrace under a roof with a 0.8 m overhang: 7.45 m). `eaveHeight` is the height of the shading edge: the
soffit (`clearHeight`) when the strip in front of the opening lies over a covered outdoor area, otherwise the roof surface
at the exit point (the eave). `wallTop` is that of the roof above the opening.

### 5.3 Access graph and room numbers

`derived.access`: the first `entry` opening defines the entry room; `edges` are the `door` openings between rooms; `depth[roomId]`
is the number of doors to pass from the entry room; `unreachable` lists the rooms without a path (`E-DOSTUPNOST`).

`derived.rooms[].displayNo` is the room number for visitors: `"<storey>.<two digits>"` ("1.01" on the ground floor), in the
order of a breadth-first walk through the doors from the entry room (neighbours in the order of their doors in
`openings`); rooms without a path follow in model order. Ids stay internal.

### 5.4 Roof faces

Each hip roof is decomposed into four planes `z = wallTop + tan(pitch) * d`, where `d` is the distance from the side line
(negative in the overhang). Sides: `S` (descends towards -y), `E`, `N`, `W`. The visible surface is the maximum over all
roofs. Per plane: (1) the cell of the plane inside its roof (the eave rectangle clipped by `d_side <= d_other`), (2) minus the
region where another roof is higher (that roof's eave rectangle clipped by "each of its planes is above this plane"), using
half-plane splitting so that every piece is **convex**. A plane cut by a valley may therefore consist of several faces; they
share `plane` (e.g. `T1.N`) and the local frame, and are named `T1.N#1`, `T1.N#2` (largest first).

Edge kinds (`faces[].edges[i]` runs from vertex `i` to `i + 1`): `eave`, `ridge` (between opposite planes of one roof),
`hip` (between adjacent planes of one roof), `valley` (where two roofs meet, the other face is on the other side), `step`
(on the lower roof: the line under the eave of a higher roof, where the surface jumps up), `seam` (internal edge between two faces of the same plane;
not a real edge). Vertices may include collinear points where the kind of the edge changes.

Local frame of a face: `origin` (on the eave line of the plane, nearest to the house origin), `u` horizontal along the eave
(looking up the slope from outside, `u` points to the right), `v` up the slope (unit 3D vector), `n = u x v` the upward
normal. `uv[i]` are the coordinates of vertex `i`; 3D point = `origin + u * u_coord + v * v_coord`.

### 5.5 PV layout

For every face whose `side` is in `layout.facings`: the face polygon in `(u, v)` is moved inwards by the setback of each
edge kind (`seam` = 0), giving the usable convex area. Rows start at the lowest `v` of the usable area, parallel to the eave,
with module length along the slope (`portrait`; `landscape` swaps the sides; `auto` takes whichever fits more). For each
row the free interval is the intersection of the usable area at the bottom and top of the row, minus the rectangles of
roof penetrations (light-pipe radius + `obstacleClearance`); in each free interval `n = floor((length + gap) / (w + gap))`
modules are centred. Output: `derived.pv.panels` with local rectangle `uv` and four 3D corners.

### 5.6 Assemblies and metrics

`derived.assemblies[key] = {thickness, R, U}` (R without surface films). `computeMetrics` (see KERNEL-API) integrates the
roof exactly: enclosed volume = integral of the roof height over the footprint (floor to roof surface), sloped roof area =
sum of the faces, envelope = footprint perimeter x average wall top + roof area over the footprint + footprint.

Areas and counts for the pages (one definition each, used everywhere):

| metric | definition |
|---|---|
| `netArea`, `heatedArea` | net floor area of the heated rooms (užitná plocha bez garáže) |
| `heatedAreaGross` | gross heated area (energy reference area): the outline split between the rooms, each heated room reaching the outer face of its exterior walls and the axis of its walls to other rooms |
| `footprintArea` | the outline of the house with its walls |
| `builtUpArea` | zastavěná plocha: the outline plus the roofed outdoor areas outside it (covered terrace, porch); equals the plot statistics |
| `layoutCode` | Czech layout code: rooms of `LAYOUT_ROOM_TYPES` (living, bedroom, kids, office, guest) + `kk` (no separate kitchen) or `1` ("5+kk") |
| `bedroomCount` | rooms of `BEDROOM_TYPES` (bedroom, kids, guest) |
| `unheatedBoundary` | `{wallArea, doorArea}` of the walls with `toUnheated` (clear height x length, doors apart) |

### 5.7 Levels and pools

±0.000 is the finished floor. Every outdoor area gets a planar top, `derived.outdoor[].grade`:

* `kind: "flat"`: at `top` (default −0.02). `corners` (heights at the rect corners `[x0 y0, x1 y0, x1 y1, x0 y1]`) are all `top`.
* `kind: "ramp"`: the strips that the site extends to the street (`site.access.driveway/walkway.outdoorType`, the strip
  reaching furthest to the street) rise linearly along +y from `top` at the house end to the graded ground at their gate
  plus 0.03 m (`ramp.z0`, `ramp.z1`, `ramp.slope`; at most 8 %, `E-RAMP` of the site validation). `plane` gives the top
  everywhere (`z = z0 + gx (x - ox) + gy (y - oy)`); `ramp.apron` is the continuation to the plot boundary with the top at
  its vertices.

Without the site (`derive(house)`) every slab is flat. The terrain is cut under the slabs (`docs/SITE.md`, section 3).

A pool (`type: "pool"`, `rect` = water) gets `derived.outdoor[].pool`: `water`, `outer` (the water grown by the coping: the
hole in the deck and in the terrain), `copingTop` (= its top), `waterZ = top − waterBelowTop`, `floorZ = top − depth`,
plan `polygons` (water, coping ring, the deck with its hole), the id of its `deck`, `waterArea` and `waterVolume`. The deck
area gets the pool in `holes` and `netArea` = area − holes. `derived.groundVoids` lists the `outer` rects of all
`GROUND_VOID_OUTDOOR` areas.

## 6. `generated/derived.json` (derived data)

Written by `npx tsx scripts/build-derived.ts` as `derivedFile(house, site)` = `derive(house, { site })` plus `metrics`;
read by the Blender pipeline (which never re-derives geometry) and by tests. It is a **superset of the concept/1 derived format**: all keys and shapes of that format are
kept (except that `rooms[].name` is now a bilingual object), plus new keys. All coordinates are house-frame metres.

| key | content |
|---|---|
| `schemaVersion` | `1` |
| `inputHash` | SHA-256 of `model/*.json` (section 8) the data was built from |
| `houseId`, `houseAxisBearingDeg` | id of the model, bearing of the house +y axis |
| `wall`, `defaultWallTop` | wall thicknesses, default wall top (`clearHeight + slab`) |
| `grid` | `{xs, ys}`: the compressed coordinate grid |
| `overlaps`, `holes`, `components` | diagnostics (empty in a valid model; one component) |
| `walls[]` | `{id, orient, at, from, to, len, kind: exterior\|bearing\|partition, ext, t, lo, hi}` on wall axes; `lo`/`hi` = room ids on the low/high side (`null` = outside). Exterior walls add `room`, `azimuth`, `azimuthTrue`, `facing`, `height`; interior walls between a heated and an unheated room add `toUnheated: true` |
| `rooms[]` | `{id, name, shortName, displayNo, type, role?, zone, floor?, heated, rects, cleanRects, area, axisArea, bbox, rectsClear, minWidth, mainClear, glazing: {total,N,E,S,W}, openings[], height, volume, label: {x,y,r}, outlineDistance, centroid, exteriorWallLength, exteriorWallArea}`. `cleanRects` are the net rectangles |
| `netRooms[]` | pipeline view: `{id, type, floor?, heated, rects (= cleanRects), area}` |
| `outline` | `{rects, polygons: [{pts, area}], bbox, area, perimeter}`: the footprint including walls; `outer` is its outer ring `{pts, area}` |
| `bbox` | `{x0, y0, x1, y1, w, d, z0, z1, h}`: whole building including roof eaves and ridge |
| `openings[]` | `{id, kind, orient, cx, cy, w, sill, head, swing, hinge, c, axis, from, to, wallId, problem, exterior, wallKind, azimuth, room, connects, swingRoom, glazingArea, clearStart, clearEnd, azimuthTrue, facing, dir, area, center: [x,y,z], blind, blindSections, overhang: {depth, eaveHeight, wallTop} \| null}` (overhang: section 5.2a) |
| `accents[]` | the input plus `{wallId, exterior, problem, azimuth, azimuthTrue, facing}` |
| `roofs[]` | `{id, rect, pitch, overhang, wallTop, w, d, ridgeAlong, ridgeLength, ridgeHeight, ridgeRise, ridge: [[x,y],[x,y]], eaveRect, eaveHeight, planAreaWithOverhang, slopedArea, faces[]}` |
| `roofPlanes[]` | convex roof faces: `{id, plane, roofId, side, pitch, azimuth, azimuthTrue, aspect, facing, pts, pts3, uv, edges: [{kind, length}], area, planArea, centroid, zMin, zMax, frame: {origin, u, v, n}}` (section 5.4) |
| `outdoor[]` | `{id, type, name, covered, rect, area, netArea, holes, posts, postSize, zone: "outdoor", surface, role, top, grade, pool}` (sections 3.6, 5.7); `role` is the GLB role of the slab top (`terrace_paving`, `deck`, `drive_paving`, `path`, `pool_coping`) |
| `screens[]` | `{id, type, orient, at, from, to, length, azimuth, azimuthTrue, facing, blades: {count, pitch, chord, thickness, positions}, closedDeg, openDeg, restDeg, z0, z1}`; `azimuth` is the outward direction; blades spread evenly (`count = floor(length / pitch)`, centres at `from + (i + 0.5) * length / count`) from the slab top `z0` to the soffit `z1` |
| `lightpipes[]` | `{x, y, diameter, room, face, z}` |
| `furniture[]` | `{index, type, x, y, rot, w, d, rect, room, outdoor}` |
| `access` | `{entryOpening, entryRoom, edges: [{a, b, opening}], depth: {roomId: n}, unreachable}` |
| `facings` | `{N, E, S, W}`: `{dir, houseAzimuthDeg, azimuthDeg, facing, wallLength, wallArea, glazingArea, doorArea, blindedGlazingArea, roofArea}` (the key names match `src/lib/data/pvgis.json`) |
| `assemblies` | `{exteriorWall, bearingWall, partitionWall, ceiling, roof, groundFloor}`: `{thickness, R, U}` |
| `pv` | `{moduleWp, count, kwp, area, byFace: [{face, plane, orientation, count, rows[]}], panels: [{id, plane, face, row, col, wp, uv, center, corners}]}` |
| `attic`, `topEnvelope` | `roof.attic` and the assembly that closes the heated volume at the top (`roof` or `ceiling`) |
| `cameras[]` | `{id, name, short, kind, position (z resolved, section 4.6), target, fov, orthoHeight, use, default, defaultFor, aboveGround, ground}` |
| `groundVoids` | rects where the terrain has a hole (pool basins with their coping) |
| `outdoorUnit` | `{center, size, rot, footprint, z}` of the heat-pump outdoor unit, or null |
| `catalog` | `{groundVoidOutdoor, sunSampledOutdoor, waterOutdoor, bedroomTypes}`: the catalogue lists, so Python never copies them |
| `site` | the plot resolved for this house (`exportSiteLayout`, `docs/SITE.md` section 4): plot, street with pavement and green strip, access aprons, verges and dropped kerbs, fences with parts, posts (with ground z) and slat spec, gates (posts, leaf, park span or swing arc), pillars, hedges, trees (with ground z and `uplight`), shrubs, beds, paved, neighbours, rainwater tank. Null without the site |
| `metrics` | `computeMetrics(house, derived)` (section 5.6); written by `scripts/build-derived.ts`, not part of `derive()` |

Numbers in the file are rounded to 9 decimals so that the output is stable. Opening `problem` is `null` in a valid model
(otherwise `no-axis`, `off-wall`, `span`).

## 7. Validation

`validateHouse(input, { site? })` / `validateHouseJson(text, { site? })` return `{valid, errors, warnings, house, derived, metrics}`
(with `site` the derived data include the grades, camera heights and the resolved plot); every issue has
`code`, `severity` and a bilingual `message`. A structural error (`E-JSON`, `E-SCHEMA`, `E-TYP`, `E-ID`, `E-RECT`) stops the
run: geometry is not derived from a broken structure. Run it from the shell:

```sh
npx tsx scripts/model-validate.ts [model/house.json] [--lang cs|en] [--json]    # exit 0 / 1 (errors) / 2 (input)
npx tsx scripts/build-derived.ts [--check]                                      # validate house and site, write derived.json + house.schema.json
```

Every code below is provoked by a mutation test (`src/lib/model/__tests__/validate.test.ts`).

**Errors** (block: the model is invalid)

| code | Czech | English |
|---|---|---|
| `E-JSON` | Neplatný JSON | Invalid JSON |
| `E-SCHEMA` | Pole "schema" není "house/1" | Field "schema" is not "house/1" |
| `E-TYP` | Chybějící nebo špatně typované pole, hodnota mimo seznam nebo rozsah | Missing or wrongly typed field, value outside the list or range |
| `E-ID` | Duplicitní id v jednom seznamu | Duplicate id within one list |
| `E-RECT` | Obdélník s přehozenými souřadnicemi (musí platit x0<x1, y0<y1) | Rectangle with swapped coordinates (x0<x1, y0<y1 required) |
| `E-LOKACE` | Souřadnice polohy nejsou zaokrouhlené na 0,1 stupně | Location coordinates are not rounded to 0.1 degree |
| `E-ZONA` | Typ místnosti nebo venkovní plochy nepatří právě do jedné zóny | Room or outdoor type does not belong to exactly one zone |
| `E-ROLE` | Role místnosti, která má být jedinečná, je použita vícekrát | A role that must be unique is used more than once |
| `E-SKLADBA` | Tloušťka skladby neodpovídá tloušťce zdi nebo stropu v půdorysu | Assembly thickness does not match the wall or slab thickness in the plan |
| `E-PREKRYV` | Překryv místností | Overlapping rooms |
| `E-DIRA` | Díra uvnitř půdorysu | Hole inside the floor plan |
| `E-NESOUVISLY` | Půdorys se skládá z oddělených částí | Floor plan is made of disconnected parts |
| `E-MISTNOST` | Místnost je po odečtení zdí příliš úzká | Room is too narrow after subtracting the walls |
| `E-OTVOR-ZED` | Otvor neleží na zdi | Opening does not lie on a wall |
| `E-OTVOR-DRUH` | Druh otvoru neodpovídá druhu zdi | Opening kind does not fit the wall kind |
| `E-OTVOR-ROZMER` | Rozměr otvoru mimo povolený rozsah | Opening size outside the allowed range |
| `E-OTVOR-ROH` | Otvor je příliš blízko rohu nebo styku zdí | Opening too close to a corner or wall junction |
| `E-OTVOR-OTVOR` | Otvory na jedné zdi jsou příliš blízko nebo se překrývají | Openings on one wall are too close or overlap |
| `E-OBKLAD` | Dřevěný obklad neleží na obvodové zdi | Timber cladding is not on an exterior wall |
| `E-STRECHA` | Zeď nebo část půdorysu není pod střechou | A wall or part of the plan is not under the roof |
| `E-TERASA` | Krytá venkovní plocha není celá pod střechou | Covered outdoor area is not entirely under a roof |
| `E-ZASKLENI` | Zasklení obytné místnosti je pod 1/10 podlahy | Glazing of a habitable room is below 1/10 of the floor |
| `E-VSTUP` | Chybí hlavní vstup | No main entrance |
| `E-DOSTUPNOST` | Místnost není dosažitelná dveřmi z hlavního vstupu | Room is not reachable by doors from the main entrance |
| `E-GARAZ-ROZMER` | Garáž je menší než 5,5 x 5,5 m | Garage is smaller than 5.5 x 5.5 m |
| `E-BAZEN` | Bazén neleží v ploše terasy nebo dlažby, nebo zasahuje do domu | Pool does not lie inside a deck or paved area, or overlaps the house |
| `E-LAMELY` | Lamely stěny terasy se nedají zavřít | The louvre blades cannot close |
| `E-KAMERA` | Výchozí pohled kamer je zadán chybně | The default camera view is set wrongly |

**Warnings** (the model is valid, but check it)

| code | Czech | English |
|---|---|---|
| `V-IDEA` | Chybí popis "idea" | Missing "idea" description |
| `V-PLOCHA` | Čistá plocha pod doporučeným minimem | Net area below the recommended minimum |
| `V-ZASKLENI` | Zasklení pod 1/8 podlahy | Glazing below 1/8 of the floor |
| `V-JIH` | Hlavní obytná místnost má na jih méně než 40 % zasklení | Main living room has less than 40 % of its glazing facing south |
| `V-OBYTNA` | Chybí hlavní obytná místnost | No main living room |
| `V-SEVER` | Ložnice nebo dětský pokoj zasklené jen na sever | Bedroom or children's room glazed to the north only |
| `V-CHODBA` | Chodba užší než 1,0 m | Corridor narrower than 1.0 m |
| `V-UZKA` | Místnost užší než 0,9 m | Room narrower than 0.9 m |
| `V-BEZ-OKNA` | Obytná místnost bez okna | Habitable room without a window |
| `V-NABYTEK-MIMO` | Nábytek přesahuje místnost nebo leží mimo vše | Furniture exceeds the room or lies outside everything |
| `V-NABYTEK-DVERE` | Nábytek koliduje s otevíráním dveří | Furniture collides with a door swing |
| `V-VICE-VSTUPU` | Více vstupních dveří | More than one entrance door |
| `V-PRUCHOD` | Místnost je dostupná jen přes soukromou místnost | Room is reachable only through a private room |
| `V-GARAZ-VRATA` | Garáž nemá vrata nebo vrata nejsou v garáži | Garage has no garage door, or the door is not in a garage |
| `V-TERASA-SLOUPY` | Krytá plocha bez sloupů | Covered area without posts |
| `V-SLOUP-MIMO` | Sloup mimo svou plochu | Post outside its area |
| `V-VENKU-DUM` | Venkovní plocha zasahuje do obrysu domu | Outdoor area overlaps the house outline |
| `V-STRECHA-VYSKA` | Střecha začíná níž než strop | Roof starts lower than the ceiling |
| `V-STRECHA-PRESAH` | Neobvykle velký přesah střechy | Unusually large roof overhang |
| `V-U-ZED` | Součinitel U obvodové zdi nad doporučenou hodnotou | U-value of the exterior wall above the recommended value |
| `V-U-STRECHA` | Součinitel U střechy nad doporučenou hodnotou | U-value of the roof above the recommended value |
| `V-U-PODLAHA` | Součinitel U podlahy nad doporučenou hodnotou | U-value of the floor above the recommended value |
| `V-FVE-NULA` | Do střechy se nevejde žádný fotovoltaický modul | No photovoltaic module fits on the roof |
| `V-SVOD-UDOLI` | U spodního konce údolí střechy chybí dešťový svod | No downpipe at the low end of a roof valley |
| `V-SVETLOVOD-MIMO` | Světlovod neleží nad místností pod střechou | Light pipe is not above a room under the roof |
| `V-SVOD-OKAP` | Voda v okapovém žlabu teče k nejbližšímu svodu dál než 12,5 m | A gutter runs more than 12.5 m to the nearest downpipe |
| `V-TAGLINE` | Chybí podtitul "tagline" | Missing "tagline" |

## 8. Content hash of the model

`derived.inputHash` and the manifests of the GLB and media files carry the hash of the data model, so that CI can check that
the committed artefacts match the sources. Definition (implemented in `src/lib/model/hash.ts`; Python can reproduce it):

```
files   = model/*.json without "*.schema.json"
sorted  = by file name, plain byte order
message = for every file:  name + "\0" + content + "\0"      (UTF-8, CRLF line ends normalised to LF)
hash    = SHA-256(message) as lowercase hex (64 characters); the first 12 characters are the cache-buster `?v=`
```

```python
import hashlib, pathlib
files = sorted(p for p in pathlib.Path("model").glob("*.json") if not p.name.endswith(".schema.json"))
msg = b"".join(p.name.encode() + b"\0" + p.read_bytes().replace(b"\r\n", b"\n") + b"\0" for p in files)
print(hashlib.sha256(msg).hexdigest())
```

## 9. Relation to concept/1

| concept/1 | house/1 |
|---|---|
| `schema: "concept/1"` | `schema: "house/1"` |
| `name`, `idea` (strings) | `name`, `idea` as `{cs, en}` |
| `rooms[].name` (string) | `{cs, en}`; optional `role` |
| `rooms`, `openings`, `roofs`, `outdoor`, `accents`, `furniture`, `wall`, `clearHeight`, `slab`, `bearingAxes`, `lightpipes`, `screens` | unchanged |
| `notes` (record of strings with Czech keys) | `notes` record of `{cs, en}` with English keys |
| not present | `fictional`, `location`, `zones`, `assemblies`, `windows`, `equipment`, `shading`, `roof`, `cameras`, `tagline` |

The geometry derived from the concept plan is identical to the stored oracle output (`src/lib/model/__fixtures__/oracle-*.json`); the oracle test compares them to 1e-6. The concept plan itself is frozen as `__fixtures__/oracle-house.json`, so later re-plans of `model/house.json` (the east wing, the sliders, the cold attic) do not touch the oracle.

## 10. Changing the format

1. Edit `src/lib/model/schema.ts` (and `catalog.ts` for enumerations); update `model/house.json`.
2. If the change needs a rule, add it to `validate.ts` with a bilingual message, register the code in `ISSUE_CODES`, and add a
   mutation test (the registry test fails for a code no test provokes).
3. If a value is derived, compute it in `derive.ts`/`roofs.ts`/`metrics.ts`, add the type to `types.ts` and an invariant test.
4. `npx tsx scripts/build-derived.ts` (rewrites `generated/derived.json` and `model/house.schema.json`), then
   `npm run typecheck && npm run lint && npm test`.
5. Update this document and `docs/KERNEL-API.md`.
