# The plot: format and algorithms

**The plot is invented.** It is not a copy of any real parcel, survey or cadastral map. Its shape, area, terrain,
neighbours, trees and the street are made up for this portfolio project; the only real-world anchor is the fictional
region "South Moravia" with coordinates rounded to 0.1 degree, kept in `house.json` (`location`). `site.json` carries the
flag `"fictional": true`, and the web app shows it on the Plot page.

Everything about the plot lives in `model/site.json` (format `site/1`) and is processed by pure TypeScript in
`src/lib/model/site/` (no DOM, no dependency on the house schema or on `derive.ts`). The house is passed in
structurally (see "Inputs from the house model").

## 1. Frame and orientation

* Same frame as the house (`docs/ARCHITECTURE.md`, section 1): metres from the house origin, `x` east, `y` north in the
  frame of the house axes, heights relative to the finished floor (+-0.000).
* `location.houseAxisBearingDeg` (12 degrees, from `house.json`) is the azimuth of the house `+y` axis. The long south
  facade therefore faces azimuth 192 (south-south-west). The site never stores the bearing; functions that need it take
  it as a parameter (`createSite(raw, bearingDeg)`, `houseSetbacks(..., { bearingDeg })`, `measureBetween(..., bearingDeg)`).
* **The plot follows the street, not true north.** The street runs perpendicular to the house axis (about 102 degrees
  true, ESE to WNW), so the plot is a quadrilateral that is nearly axis-parallel in the house frame (edges tilted by
  2 to 4 degrees, deliberately not a rectangle) and slightly rotated against the compass. The house is parallel to
  the street, as usual for streets with detached houses. Sides are therefore reported twice: relative to the house
  frame (`house.N` = towards the street) and relative to true north (`trueNorth.N`).
* Conversions: `houseToTrueAzimuth(a, bearing) = (a + bearing) mod 360`, `houseToTrueXY` / `trueToHouseXY` rotate vectors.

## 2. `model/site.json`

| key | content |
|---|---|
| `schema`, `fictional`, `name` | `"site/1"`, always `true`, bilingual title |
| `location` | `{ "source": "house.json#/location" }`: a pointer, never values |
| `plot` | `polygon` counter-clockwise ring (4 vertices) and `edges[i].kind` (`street`, `neighbour`, `field`) for the edge from vertex `i` to `i+1` |
| `limits` | `maxBuiltUpRatio` 0.35 (maximum built-up share), `minGreenRatio` 0.40 |
| `setbackRules` | `minToBoundary` 3.5 m (wall to any boundary), `minToStreetAtDriveway` 6.0 m (free run in front of the garage door), `minRoofEdgeToBoundary` 2.0 m, `minTreeTrunkToHouse` 4.0 m, `minCrownEdgeToHouse` 2.0 m. Invented rules in the spirit of typical practice; not legal advice |
| `terrain` | analytic heightfield parameters (section 3) |
| `street` | which edge is the street, `verge` and `carriageway` widths (m), `kerbHeight` |
| `field` | the edge beyond which the open field lies, and its `depth` |
| `access` | which outdoor `type` of the house model carries the driveway (`drive`) and the walkway (`path`), gate margins, apron flare |
| `domain` | `margin`: terrain and zone domain = plot bounding box plus this margin (35 m) |
| `species` | catalogue: Latin name, bilingual common name, `kind` (`tree`, `shrub`, `hedge`), `evergreen`, light `extinction` per metre (`leafOn`, `leafOff`) |
| `trees`, `shrubs` | position, height, crown diameter / width, optional `crownBase`; referencing `species` |
| `hedges`, `fences` | declarative paths along the boundary: `from` / `to` = `{ edge, t }` (position `t` in 0..1 on edge `edge`), `inset` into the plot; fences have `gates: true` to get openings where the driveway and walkway cross |
| `beds`, `paved` | mulch and gravel beds (rendered as `mulch`), garden path, service path, pad (surface role of the GLB) |
| `neighbours` | per neighbour: shared plot `edge`, `plotWidth`, house `center`, `size`, `rotDeg`, `eaveHeight`, `roof` (`hip` / `gable` / `flat`, pitch, overhang) |

No ids are used for logic: elements refer to each other through `species`, edge numbers, `type` and `kind`.
User-visible names (species) are bilingual strings in the data; the orchestrator may move them into the i18n
dictionaries. The schema is strict (`siteSchema.ts`, zod): unknown keys are errors. `validateSite` adds semantic
checks (references, winding, self-crossing, trees and shrubs inside the plot, neighbour houses inside their own plot).

### The invented plot

A slightly irregular quadrilateral of about 1,179 m2 (frontage about 32 m, depth about 37 m). The street is on the north
side with the driveway to the north (the garage is in the north-west corner of the house, the entrance on the north
facade, the covered terrace in the south-west corner), the open field adjoins the south, neighbours with hip-roofed
houses on the west and east. The south and west boundaries carry hedges (hornbeam in the south, evergreen yew in the
west), the east boundary a wooden fence, the street side a plinth fence with a vehicle gate and a pedestrian gate.
Eight trees (walnut, black pine, two apples, pear, birch, crab apple, wild cherry), 14 shrubs, three beds, three
extra hard surfaces.

With the house of the current concept (footprint 253 m2): wall set-backs south 14.3 m, north (street) 8.8 m, east 4.1 m,
west 4.4 m; eaves at least 3.2 m from the boundary; free run in front of the garage door 8.9 m; built-up area
(footprint plus covered terrace and porch) 297.7 m2 = 25.2 % (limit 35 %); paved 142.3 m2 = 12.1 %; green 739.2 m2 = 62.7 %.

## 3. Terrain

`groundAt(x, y)` is an analytic function of parameters in `terrain` (no height data in the JSON):

```
natural(x, y) = plane + sum of waves + micro relief
plane   = z0 + sN * n + sE * e         (n, e = true north / east distance from `plane.origin`)
wave    = amplitude * sin(2 pi (dir . p) / wavelength + phase)        (2 to 3 smooth waves)
micro   = seeded lattice value noise, quintic interpolation (C2), 2 octaves, amplitude 2 cm
ground  = natural * (1 - k) + plateau.level * k,   k = smoothstep(1 - d / blend)
```

* The plane falls to the **true south** by `slopeSouthPct` and to the **true west** by `slopeWestPct` (2.6 % and
  0.6 %); it is rotated into the house frame with the axis bearing.
* `d` is the distance to the levelled plateau (union of axis-parallel rectangles around the house, its terrace, paving
  and porch). Inside the plateau `ground` is exactly `plateau.level` (0.000), the transition is `blend` = 8 m wide, and
  the value and the slope are continuous across both edges (smoothstep has zero derivative at both ends). With more
  than one rectangle the distance (a minimum) has creases in concave corners; the model uses one rectangle.
* Deterministic everywhere: `latticeHash` uses 32-bit integer arithmetic only, so a port to Python gives the same heights.
  The seed (`noise.seed`) only changes the micro relief.
* `terrain.zeroLevelAsl` = 240.0 m is the fictional height of +-0.000 above sea level (labels in "asl" style).
* Rendering helpers: `terrain.grid(bbox, step)` returns a `HeightGrid` (`Float64Array`, row major), `gridToMesh`
  builds positions, normals, uvs and indices (house frame, z up; the web converts to glTF Y-up as `(x, z, -y)`),
  `gridHeight` samples a grid bilinearly. The plateau is at +-0.000, so paving and the terrace slab must sit a few
  millimetres above it in the scene to avoid z-fighting.
* Result for the plot: graded height from -0.72 to +0.49 m, mean slope 3.3 %, 95th percentile 10 %, steepest 11.8 %
  (the grading embankments); earthworks about 94 m3 cut and 89 m3 fill (nearly balanced), at most 0.38 m deep.

## 4. Algorithms

**Contours** (`contours.ts`). Marching squares on a `HeightGrid` at multiples of 0.2 m (`major` for multiples of 1 m).
A node counts as above the level when `z > level` (strict), so the exactly flat plateau is below the 0.0 contour.
Every crossing edge gets an integer id (2 * node + orientation), so segments from neighbouring cells link exactly
(no tolerance). Saddle cells are resolved by the cell centre value. Result: polylines that are either **closed** or run
from border to border of the grid (`closed: false`); the tests assert that no line ends inside the grid.
`clipContours` clips to the plot, `smoothPolyline` is Chaikin corner cutting, `contourLabels` places labels:
every line of at least 8 m gets a label in the middle, long lines get one per about 30 m (coarse) or 60 m (fine lines;
`minorSpacing: Infinity` switches them off), rotated along the line and kept upright, with a minimum separation.
Text is `+0.4`, `-1.0`, `+-0.0` (relative) or the absolute height; pass `format` for localised numbers.

**Slope and statistics** (`stats.ts`). `slopeAt` uses central differences of `groundAt` (h = 5 cm). `slopeStats`
samples a polygon on a regular grid: height range and mean, mean / 95th percentile / maximum slope, area per slope class
(`DEFAULT_SLOPE_LIMITS` 0-2-5-10-above in %; the last class has `toPct = Infinity`, which JSON turns into `null`),
mean fall direction relative to true north. `cutFillVolume` integrates `ground - natural` (midpoint rule).

**Profile and measuring** (`profile.ts`). `sampleProfile` samples the straight line a to b (spacing or count) and returns
length, extremes, rise, total ascent and descent, steepest and mean slope. `measureBetween` returns horizontal and
sloping distance, height difference, signed slope (positive when the ground rises towards the second point), azimuth in
the house frame and relative to true north, and the steepest part of the line.

**Set-backs** (`setbacks.ts`). For every plot edge the shortest distance between the house outline and the edge
(segment to segment, with both closest points). An edge belongs to a side when its outward normal is within 30 degrees
of that side; the result is given for the house frame (`house.N/E/S/W`, N = towards +y) and for true compass sides
(`trueNorth`, normal azimuth + bearing). `byEdgeKind` gives the nearest approach to `street`, `neighbour`, `field`
edges. `inside` is false if a house vertex lies outside the plot.

**Areas** (`geometry.ts`, `stats.ts`). `unionArea(shapes, clip)` is an exact area of a union of arbitrary polygons clipped
by a polygon: the plane is cut into strips between all vertex abscissae and all edge crossings; inside a strip the
cross-sections are fixed y-intervals, so the length at the strip centre times the width is exact. `plotStats`:
plot area (shoelace), footprint, **built-up area = footprint + roofed outdoor areas outside the outline** (covered
terrace, porch), uncovered hard surfaces (outdoor types `terrace`, `paving`, `drive`, `path`, plus `paved[]` and the
derived aprons), green = the rest. Overlaps count once, everything is clipped to the plot, and
`built-up + paved + green = plot` holds exactly.

**Access and boundary elements** (`layout.ts`). `accessGeometry` takes the outdoor areas of type `drive` and `path`
from the house model (the strip reaching furthest to the street), continues them in straight lines to the plot boundary
(apron, inside the plot), and then across the public verge to the carriageway edge (with flare for the drive). Gate
openings are centred on the strips and as wide as the strip plus a post margin. `pathAlongPlot` walks the boundary
between two `{ edge, t }` references on the inset ring (mitred corners); `resolveFences` cuts the gate openings,
`resolveHedges`, `streetGeometry` (verge, carriageway, centre line), `fieldZone` and `neighbourPlot` (the plot of a
neighbour: the shared edge extended along the street and field lines) generate the surrounding ground zones.

**Shading** (`occluders.ts`, `shading.ts`). `buildOccluders(site, terrain, access)` returns 3D solids in the house frame
(z up): neighbour walls (convex prism) and hip / gable / flat roofs (convex solid from half-spaces: sloping planes
through the eave edges plus the bottom plane), tree crowns and tall shrubs (sphere when width equals height, else
ellipsoid), hedge and fence segments (convex prisms; segments are at most 3 m long so they follow the slope), all
standing on the graded terrain. `rayChord` gives the entry and exit parameters of a ray (slab method, half-space
clipping, quadratic for ellipsoids); `rayTransmittance(occluders, origin, dir, dayOfYear)` multiplies the transmittance
of every hit: 0 for solids, `exp(-k * chord)` for crowns and hedges with `k` blended between `leafOn` and `leafOff` by
`leafFactor(dayOfYear)` (leaves open 15 April to 15 May and fall 5 October to 5 November; evergreens constant).
Directions are `[east, north, up]` unit vectors of the house frame; convert sun azimuth with `trueToHouseAzimuth`.

**Export for the pipeline** (`export.ts`). `exportSiteDerived(site, outdoor, { gridStep, precision })` returns one plain
JSON object (`site-derived/1`: terrain grid in millimetres, trees and shrubs with ground height, fences with gate
openings, aprons, neighbour footprints with base and ridge heights, zones). About 76 kB at a 1 m grid. The orchestrator
embeds it into `generated/derived.json`; Blender never re-derives geometry.

## 5. Inputs from the house model

`HouseInput` (`types.ts`) is structural: `bearingDeg` (`location.houseAxisBearingDeg`), `footprint` (the polygon of
`derived.json` `outline.polygons[0].pts`), `outdoor` (`house.json` `outdoor[]`: `type`, `covered`, `rect`),
`roofs` (`rect`, `overhang`) and `openings` (`kind`, `cx`, `cy`, `w`, `azimuth`, `exterior` as in the derived openings;
used for the free run in front of garage doors). With the house kernel the adapter is a plain object literal (checked against the real types):

```ts
const { house, derived } = analyzeHouse(houseJson);
const input: HouseInput = {
  bearingDeg: house.location.houseAxisBearingDeg,
  footprint: derived.outline.polygons[0].pts,
  outdoor: house.outdoor,
  roofs: house.roofs,
  openings: derived.openings,
};
const site = createSite(siteJson, input.bearingDeg);
const analysis = analyzeSite(site.model, input, site.terrain);
```

`analyzeSite(site, house)` returns the plot geometry, `PlotStats`,
set-backs (walls and eaves), garage runs, the list of rule checks (`SiteCheck`: `key`, `ok`, `actual`, `limit`, `rule`,
`unit`; keys `houseInside`, `boundary`, `roofEdge`, `garageDrive`, `builtUp`, `green`, `treeTrunk`, `treeCrown`), slope
statistics and cut / fill. `createSite(raw, bearingDeg)` bundles parsed model, plot ring, bounds, terrain, validation,
zones and `withHouse(outdoor)` (access, fences, occluders).

## 6. Tests

`src/lib/model/site/__tests__/` (vitest, about 120 tests; the house is a small fixture of the fictional concept):

* geometry: shoelace area (winding, translation and rotation invariance), exact union and intersection areas checked
  against fine sampling, closest points, polyline clipping, mitred inset, frame conversions;
* terrain: exact plane falling to true south and west (rotated by the bearing), zero **inside** the plateau,
  continuity and bounded curvature everywhere (no creases, no jumps), determinism and seed dependence of the noise,
  parameters of the transition, mesh winding;
* contours: closed rings for a radial hill (area against the analytic circle), every contour of the model terrain is
  closed or border to border, points lie on their level, contours of different levels keep a distance of at least
  gap over steepest slope, clipping, labels on their line;
* profile and measuring: exact on a plane, endpoints, ascent minus descent equals rise, azimuth conversions;
* set-backs: exact rectangle cases, both windings, true-compass rotation, brute-force sampling of the real plot,
  `from` / `to` on the outline and boundary, minimum 3.5 m, garage run, a too-tight plot fails;
* statistics: hand-computed overlapping areas, `built-up + paved + green = plot`, 35 % and 40 % limits, slope classes
  add up to 1, balanced cut and fill on a symmetric platform;
* site data: schema strictness, semantic validation, plot is a simple counter-clockwise quadrilateral of 1,100 to
  1,300 m2, street north, field south, trees inside the plot and away from the house, hedges at their inset, gates
  cut the street fence, neighbour houses clear of the plot, shading rays (high sun free, low evening sun blocked by the
  neighbour, walnut screens the terrace in summer much more than in winter), export round trip. If `model/house.json`
  exists, its outdoor areas and roofs are also checked against the plot.

## 7. Limits

Terrain is a smooth analytic surface: no walls, steps, ditches or retaining structures. Set-backs are distances, not
a legal assessment. Tree crowns are single ellipsoids, hedges are boxes; the occluders are meant for a daylight
estimate, not for rendering. Plot, neighbours and street are invented and carry no information about any real place.
