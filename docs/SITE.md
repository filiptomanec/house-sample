# The plot: format and algorithms

**The plot is invented.** It is not a copy of any real parcel, survey or cadastral map. Its shape, area, terrain,
neighbours, trees and the street are made up for this portfolio project; the only real-world anchor is the fictional
region "South Moravia" with coordinates rounded to 0.1 degree, kept in `house.json` (`location`). `site.json` carries the
flag `"fictional": true`, and the web app shows it on the Plot page.

Everything about the plot lives in `model/site.json` (format `site/1`) and is processed by pure TypeScript in
`src/lib/model/site/` (no DOM, no dependency on the house schema or on `derive.ts`). The house is passed in
structurally (see "Inputs from the house model"). The house kernel uses the site module the other way round:
`derive(house, { site })` grades the outdoor slabs and embeds the resolved plot in `generated/derived.json` (`site`).

## 1. Frame and orientation

* Same frame as the house (`docs/ARCHITECTURE.md`, section 1): metres from the house origin, `x` east, `y` north in the
  frame of the house axes, heights relative to the finished floor (+-0.000).
* `location.houseAxisBearingDeg` (from `house.json`) is the azimuth of the house `+y` axis. The site never stores the
  bearing; functions that need it take it as a parameter (`createSite(raw, bearingDeg)`, `houseSetbacks(..., { bearingDeg })`,
  `measureBetween(..., bearingDeg)`).
* **The plot follows the street, not true north.** The street runs perpendicular to the house axis, so the plot is a
  quadrilateral that is nearly axis-parallel in the house frame (edges tilted by 2 to 4 degrees, deliberately not a
  rectangle) and slightly rotated against the compass. Sides are therefore reported twice: relative to the house frame
  (`house.N` = towards the street) and relative to true north (`trueNorth.N`).
* Conversions: `houseToTrueAzimuth(a, bearing) = (a + bearing) mod 360`, `houseToTrueXY` / `trueToHouseXY` rotate vectors.
* **Edge direction.** Edge `i` runs from vertex `i` to vertex `i + 1` of the counter-clockwise plot; the plot lies on its
  left. Positions on the boundary are `{ edge, t }` (t in 0..1 along the edge). The `side` of gates and pillars is relative
  to this direction: `"+"` towards the end of the edge, `"-"` towards its start.

## 2. `model/site.json`

| key | content |
|---|---|
| `schema`, `fictional`, `name` | `"site/1"`, always `true`, bilingual title |
| `location` | `{ "source": "house.json#/location" }`: a pointer, never values |
| `plot` | `polygon` counter-clockwise ring (4 vertices) and `edges[i].kind` (`street`, `neighbour`, `field`) for the edge from vertex `i` to `i+1` |
| `limits` | `maxBuiltUpRatio` (maximum built-up share), `minGreenRatio` |
| `setbackRules` | `minToBoundary` (wall to any boundary), `minToStreetAtDriveway` (free run in front of the garage door), `minRoofEdgeToBoundary`, `minTreeTrunkToHouse`, `minCrownEdgeToHouse`, optional `minCrownEdgeToPool` (crown edge to the water of a pool). Invented rules in the spirit of typical practice; not legal advice |
| `terrain` | analytic heightfield parameters (section 3) |
| `street` | which edge is the street, `verge` and `carriageway` widths (m), `kerbHeight`; optional `pavement` (the strip of the verge along the kerb that is paved; the rest of the verge is green, default 0) and `kerbWidth` (default 0.15) |
| `field` | the edge beyond which the open field lies, and its `depth` |
| `access` | which outdoor `type` of the house model carries the driveway (`drive`) and the walkway (`path`), `gateMargin`, optional `gateWidth` (the clear opening of a crossing without a gate), apron `flare` |
| `domain` | `margin`: terrain and zone domain = plot bounding box plus this margin |
| `species` | catalogue: Latin name, bilingual common name, `kind` (`tree`, `shrub`, `hedge`), `evergreen`, light `extinction` per metre (`leafOn`, `leafOff`) |
| `trees`, `shrubs` | position, height, crown diameter / width, optional `crownBase`; trees optional `uplight` (garden lights after dusk); referencing `species` |
| `hedges` | declarative paths along the boundary: `from` / `to` = `{ edge, t }`, `inset` into the plot (may be empty) |
| `fences` | paths along the boundary like hedges; `kind` `slat_fence` (or the older `plinth_fence`, `wood_fence`, `mesh_fence`), `height` (total, plinth included), `thickness`, `gates: true` to get openings where the driveway and walkway cross. A fence from `{edge 0, t 0}` to `{edge n-1, t 1}` runs once around the plot. `slat_fence` requires `plinthHeight`, `slat {orient: "h"\|"v", board, gap, depth}`, `postSize`, `postSpacing` |
| `gates` | optional, at most one per access: `{id, access: driveway\|walkway, kind: sliding\|swing, leaf, height, postSize, side: "+"\|"-", tail?, thickness?}`. `leaf` is the clear opening; the fence opening is leaf + 2 posts. Sliding: the leaf parks on `side` behind the fence (on the plot side), `tail` is its counterbalance tail. Swing: hinged on `side`, opening into the plot |
| `pillars` | optional technical pillars beside a gate: `{id, access, side, size: [w, d, h], items: [meter-box, mailbox, intercom, house-number, light]}` |
| `beds`, `paved` | mulch and gravel beds, garden path, service path, pad, `bins` (the bin pad beside the pillar: renderers place bins on it); `surface` is the role of the GLB / style |
| `neighbours` | per neighbour: shared plot `edge`, `plotWidth`, house `center`, `size`, `rotDeg`, `eaveHeight`, `roof` (`hip` / `gable` / `flat`, pitch, overhang) |
| `rainwater` | optional underground retention tank: `{tank: {pos, volumeM3, diameter, overflow: soakaway\|sewer}}` |

No ids are used for logic: elements refer to each other through `species`, edge numbers, `access`, `type` and `kind`.
User-visible names (species) are bilingual strings in the data. The schema is strict (`siteSchema.ts`, zod): unknown keys
are errors. `validateSite` adds semantic checks (references, winding, self-crossing, trees and shrubs inside the plot,
neighbour houses inside their own plot, at most one gate per access, the rainwater tank inside the plot), and
`validateSiteWithHouse` the checks that need the outdoor areas of the house (section 5).

### The invented plot

A slightly irregular quadrilateral of about 1,200 m2. The street is on the north side with the driveway to the north
(the garage is in the north-west corner of the house, the entrance on the north facade, the covered terrace in the
south-west corner), the open field adjoins the south, neighbours with pitched roofs on the west and east. One boundary
system closes the plot: a slat fence on a graphite plinth on every edge, with a sliding drive gate that parks behind the
street fence, an inward-opening walk gate and a technical pillar beside it. The garden carries an old walnut and fruit
trees, a pool in a timber deck in front of the terrace, beds and a bin pad. The house stands on a slightly raised, levelled
platform: the lawn around it lies below the finished floor (the graphite plinth shows), and from the platform the ground falls
away on every side, gently to the south-west across the garden and down to the street, which lies about a third of a metre
below the floor. So the driveway and the front path fall from the house to their gates steeply enough to drain (`W-RAMP-FALL`
guards it) and water runs away from the garage, the entrance and the terrace; the earthworks are mostly fill. The numbers (set-backs, built-up, paved, water and green shares, slopes, earthworks) are computed
by `analyzeSite` and shown on the Plot page; they are not repeated here.

## 3. Terrain

`groundAt(x, y)` is an analytic function of parameters in `terrain` (no height data in the JSON):

```
natural(x, y) = plane + sum of waves + micro relief
plane   = z0 + sN * n + sE * e         (n, e = true north / east distance from `plane.origin`)
wave    = amplitude * sin(2 pi (dir . p) / wavelength + phase)        (2 to 3 smooth waves)
micro   = seeded lattice value noise, quintic interpolation (C2), 2 octaves, amplitude 2 cm
base    = natural * (1 - k) + plateau.level * k,   k = smoothstep(1 - d / blend)
ground  = base, cut under the slabs of the house (below)
```

* The plane falls to the **true south** by `slopeSouthPct` and to the **true west** by `slopeWestPct`; it is rotated into
  the house frame with the axis bearing.
* `d` is the distance to the levelled plateau (union of axis-parallel rectangles around the house, its terrace, deck,
  pool and paving). Inside the plateau `base` is exactly `plateau.level` (the lawn around the house, below the finished
  floor, so the graphite plinth band of the facade shows), the transition is `blend` wide, and the value and the slope are
  continuous across both edges (smoothstep has zero derivative at both ends). With more than one rectangle the distance
  (a minimum) has creases in concave corners; the model uses one rectangle.
* Deterministic everywhere: `latticeHash` uses 32-bit integer arithmetic only, so a port to Python gives the same heights.
  The seed (`noise.seed`) only changes the micro relief.
* `terrain.zeroLevelAsl` is the fictional height of +-0.000 above sea level (labels in "asl" style).
* Rendering helpers: `terrain.grid(bbox, step)` returns a `HeightGrid` (`Float64Array`, row major), `gridToMesh`
  builds positions, normals, uvs and indices (house frame, z up; the web converts to glTF Y-up as `(x, z, -y)`),
  `gridHeight` samples a grid bilinearly.

### Slabs, ramps and the cut (`grading.ts`, `terrain.ts`)

Every outdoor area of the house is a slab with a planar top (`gradeOutdoor(outdoor, base, access)`):

* **flat** at `outdoor[].top` (default −0.02): terrace, paving, deck, pool coping, porch;
* **ramp** for the driveway and the walkway (the strips of `access.*.outdoorType` reaching furthest to the street): linear
  along +y from `top` at the house end of the strip to `base(gate) + RAMP_GATE_RISE` (0.03 m) at the centre of its crossing
  on the boundary; the apron to the boundary lies on the same plane. Steeper than `RAMP_MAX_SLOPE` (8 %) is `E-RAMP`; a ramp
  that falls from the house to its gate by less than `RAMP_MIN_FALL` (1 %), or rises towards the gate, is the warning
  `W-RAMP-FALL` (the paving would not drain away from the house).

`createTerrain(params, bearing, slabs)` then cuts the ground under the slabs: inside a slab the ground is
`min(base, top - SLAB_GROUND_GAP)` (0.03 m), and beside it the cut fades out over `SLAB_SIDE_BLEND` (0.6 m, smoothstep of
the distance, measured to the top at the nearest point of the slab). Where the base is already lower (the plateau around
the house) nothing changes; where the street side of the plot rises, the ground follows the ramp and a slab never sinks
under the lawn (tested on a 0.25 m grid: every slab top at least 4 mm above the ground). `terrain.baseAt` is the ground
before the cut, `terrain.slabs` the slabs. `createSite(raw, bearing, house.outdoor)` returns this graded terrain; without
the outdoor areas it is the plateau terrain. The pool basin is a hole in the terrain mesh (`derived.groundVoids`), which
the renderers cut.

## 4. Algorithms

**Contours** (`contours.ts`). Marching squares on a `HeightGrid` at multiples of 0.2 m (`major` for multiples of 1 m).
A node counts as above the level when `z > level` (strict), so an exactly flat plateau is below its own contour.
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
terrace, porch; the same number as the kernel's `metrics.builtUpArea`), **water** = pools (`WATER_OUTDOOR_TYPES`) outside
the built-up area, **paved** = the other uncovered hard surfaces (`HARD_OUTDOOR_TYPES`: terrace, paving, drive, path, deck,
pool, plus `paved[]` and the derived aprons) without the water, green = the rest. Overlaps count once, everything is clipped
to the plot, and `built-up + paved + water + green = plot` holds exactly.

**Access** (`layout.ts`). `accessGeometry` takes the outdoor areas of type `drive` and `path` from the house model (the
strip reaching furthest to the street; `driveIndex` / `walkIndex` say which), continues them in straight lines to the plot
boundary (apron, inside the plot), and then across the public verge to the carriageway edge (with flare for the drive).
Each crossing has a `center` on the boundary, an `opening` (the gate leaf, else `gateWidth` or strip + 2 x `gateMargin`)
and the `width` cut into the fence (leaf + 2 posts with a gate, else the opening). `driveKerb` / `walkKerb` are the
dropped kerbs: the kerb strip along the carriageway edge across the crossing (reveal `DROPPED_KERB_REVEAL` 0.02 m instead
of `kerbHeight`). `streetGeometry` gives the verge split into `pavement` (along the kerb) and `green`, the carriageway and
its centre line; `fieldZone` and `neighbourPlot` (the plot of a neighbour: the shared edge extended along the street and
field lines) generate the surrounding ground zones.

**Fences, gates, pillars** (`layout.ts`, `resolveBoundary`). `pathAlongPlot` walks the boundary between two `{ edge, t }`
references on the inset ring (mitred corners). A fence with `gates: true` that passes a crossing within 0.5 m + its inset
gets an opening there: `gaps` (arc lengths along the uncut `path`) for the gate (leaf + 2 posts) and the pillar beside it;
`parts` are the rest (a fence once around the plot is joined across its start point). Slat fences get `posts` at every
corner and evenly between, at most `postSpacing` apart; a part that ends at a gate or pillar has no end post there (the gate
post or the pillar carries the panel). `resolveGates` gives per gate the centre on the fence line, unit vectors `along`
(edge direction) and `inward`, the two `posts`, the `leafPolygon` in the closed position, and for a sliding gate the `park`
span (the open leaf with its tail behind the fence, offset inward by the fence and leaf thickness plus 3 cm), for a swing
gate the `swing` hinge, radius and quarter-circle `arc` into the plot. `resolvePillars` places each pillar beside the gate
post on its side, its street face flush with the fence. `resolveHedges` gives hedge paths. `cutGap` remains for simple
openings.

**Shading** (`occluders.ts`, `shading.ts`). `buildOccluders(site, terrain, access)` returns 3D solids in the house frame
(z up): neighbour walls (convex prism) and hip / gable / flat roofs (convex solid from half-spaces: sloping planes
through the eave edges plus the bottom plane), tree crowns and tall shrubs (sphere when width equals height, else
ellipsoid), hedge and fence segments (convex prisms; segments are at most 3 m long so they follow the slope; a slat fence
is treated as solid), closed gate leaves and pillars, all standing on the graded terrain. `rayChord` gives the entry and
exit parameters of a ray (slab method, half-space clipping, quadratic for ellipsoids); `rayTransmittance(occluders, origin,
dir, dayOfYear)` multiplies the transmittance of every hit: 0 for solids, `exp(-k * chord)` for crowns and hedges with `k`
blended between `leafOn` and `leafOff` by `leafFactor(dayOfYear)` (leaves open 15 April to 15 May and fall 5 October to
5 November; evergreens constant). Directions are `[east, north, up]` unit vectors of the house frame; convert sun azimuth
with `trueToHouseAzimuth`.

**Export for the pipeline** (`export.ts`). `exportSiteLayout(model, outdoor, bearing, { precision, terrain })` returns one
plain JSON object with everything resolved for the house: bounds, plot, plateau, street (verge, pavement, green,
carriageway, kerb height and width), field and neighbour plots, access (aprons, verges, gate openings, dropped kerbs and
their reveal), fences (parts, slat spec, posts with ground z), gates (posts with z, leaf, park or swing), pillars (footprint,
items, ground z), hedges, trees (with ground z and `uplight`), shrubs, beds, paved (with aprons), neighbours (footprint,
base and ridge heights) and the rainwater tank (with ground z). It is `derived.site` in `generated/derived.json`.
`exportSiteDerived(site, outdoor, { gridStep, precision })` adds the terrain grid in millimetres (graded with the house's
slabs) for `generated/render-inputs.json`. Blender never re-derives geometry.

## 5. Inputs from the house model

`HouseInput` (`types.ts`) is structural: `bearingDeg` (`location.houseAxisBearingDeg`), `footprint` (the polygon of
`derived.json` `outline.polygons[0].pts`), `outdoor` (`house.json` `outdoor[]`: `type`, `covered`, `rect`, `top`),
`roofs` (`rect`, `overhang`) and `openings` (`kind`, `cx`, `cy`, `w`, `azimuth`, `exterior` as in the derived openings;
used for the free run in front of garage doors). With the house kernel the adapter is a plain object literal (checked
against the real types):

```ts
const { house, derived } = analyzeHouse(houseJson);
const input: HouseInput = {
  bearingDeg: house.location.houseAxisBearingDeg,
  footprint: derived.outline.polygons[0].pts,
  outdoor: house.outdoor,
  roofs: house.roofs,
  openings: derived.openings,
};
const site = createSite(siteJson, input.bearingDeg, house.outdoor); // terrain graded with the house's slabs
const analysis = analyzeSite(site.model, input, site.terrain);
```

`createSite(raw, bearingDeg, outdoor?)` bundles the parsed model, plot ring, bounds, terrain (graded when `outdoor` is
given), validation, zones and `withHouse(outdoor)`: access, fences, gates, pillars, `grading` (the slab levels), the graded
`terrain`, `validation` (with the house checks) and `occluders()`. `withHouse` caches its result per outdoor array.

`analyzeSite(site, house, terrain?)` returns the plot geometry, `PlotStats`, set-backs (walls and eaves), garage runs, the
list of rule checks (`SiteCheck`: `key`, `ok`, `actual`, `limit`, `rule`, `unit`; keys `houseInside`, `boundary`,
`roofEdge`, `garageDrive`, `builtUp`, `green`, `treeTrunk`, `treeCrown`, and `treePool` when the house has a pool and the
site a `minCrownEdgeToPool`), slope statistics and cut / fill. Without `terrain` it grades the terrain with the house's
slabs (`gradedTerrain`).

`validateSiteWithHouse(site, outdoor, bearingDeg)` reports:

| code | when |
|---|---|
| `E-BRANA` | a gate that no fence with gates crosses; a paved strip wider than its leaf; a fence opening that is not leaf to leaf + 0.25 m; the open sliding leaf running past the end of its fence or across another opening (gate or pillar); a tree trunk (0.25 m) or a shrub within 0.1 m of where a leaf moves (park band or swing sector). `validateSite` adds: more than one gate per access |
| `E-RAMP` | a drive or path ramp steeper than 8 % |
| `W-RAMP-FALL` (warning) | a drive or path ramp that falls from the house to its gate by less than 1 % or rises towards it: the paving does not drain away from the house |
| `E-TANK` | the rainwater tank under a paved area or outdoor slab (`validateSite`: outside the plot) |
| `E-ACCESS` | no outdoor area of the access types |

`scripts/build-derived.ts` runs both validations and fails on errors.

## 6. Tests

`src/lib/model/site/__tests__/` (vitest; the house is a fixture that mirrors the outline, roofs, openings and outdoor
areas of `model/house.json`, plus the real `model/house.json` where noted):

* geometry: shoelace area (winding, translation and rotation invariance), exact union and intersection areas checked
  against fine sampling, closest points, polyline clipping, mitred inset, frame conversions;
* terrain: exact plane falling to true south and west (rotated by the bearing), the model plane falling by its stated percentages, the street below the finished floor, the plateau level **inside** the plateau (house, terrace, paving and pool deck),
  continuity and bounded curvature everywhere (no creases, no jumps), determinism and seed dependence of the noise,
  parameters of the transition, mesh winding;
* grading: inside a slab the ground stays the gap under the top, beyond the blend it is untouched, the transition is
  continuous; ramps run from the top at the house end to the ground at the gate, aprons lie on the same plane, no ramp is
  steeper than the limit; **for the model every slab and apron top is at least 4 mm above the graded ground on a 0.25 m grid**;
* contours: closed rings for a radial hill (area against the analytic circle); the model terrain has a contour at every
  0.2 m level of its range, each closed or border to border; on a terrain of the model's family with a 3 % plane (enough
  relief whatever the content) points lie on their level, contours of different levels keep a distance of at least gap
  over steepest slope, clipping, labels on their line;
* profile and measuring: exact on a plane, endpoints, ascent minus descent equals rise, azimuth conversions;
* set-backs: exact rectangle cases, both windings, true-compass rotation, brute-force sampling of the real plot,
  `from` / `to` on the outline and boundary, minimum distance, garage run, a too-tight plot fails;
* statistics: hand-computed overlapping areas, `built-up + paved + water + green = plot`, the pool counted as water, the
  tree-to-pool check, limits, slope classes add up to 1, balanced cut and fill on a symmetric platform;
* boundary (a one-system boundary on the real plot: slat fence once around it, sliding and swing gate, pillar): the fence
  is closed except the openings, each gate opening is leaf + 2 posts and centred on its access, posts at most `postSpacing`
  apart and none at an end that touches an opening, a sliding leaf parks on its `side` behind the fence and is leaf + tail
  long, a swing leaf opens into the plot by a quarter turn, the pillar stands inside the plot beside the gate; `E-BRANA`,
  `E-RAMP`, `E-TANK` and the warning `W-RAMP-FALL` provoked by mutations; pavement + green = verge; dropped kerbs on the kerb strip across each crossing;
* site data (invariants of any valid plot, no counts of the content): schema strictness, semantic validation, plot is a
  simple counter-clockwise quadrilateral of 1,100 to 1,300 m2, street north, field south, trees inside the plot, away from
  the house and from each other, hedges at their inset, openings exactly where the accesses cross fences, neighbour houses
  clear of the plot, shading rays (the sky above the house free, a neighbour blocks a low ray at its wall, a deciduous crown
  screens more in summer than in winter), export round trip and the layout = export without the grid. If
  `model/house.json` exists, its outdoor areas and roofs are also checked against the plot.

## 7. Limits

Terrain is a smooth analytic surface: no walls, steps, ditches or retaining structures (the cut beside a slab is a smooth
0.6 m bank). Set-backs are distances, not a legal assessment. Tree crowns are single ellipsoids, hedges and fences are
boxes; the occluders are meant for a daylight estimate, not for rendering. Plot, neighbours and street are invented and
carry no information about any real place.
