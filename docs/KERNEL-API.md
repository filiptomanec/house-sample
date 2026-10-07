# Kernel API (`src/lib/model`)

The kernel is the data model of the house in TypeScript: the zod schema of `model/house.json`, the validator, the
deriver (geometry), the metrics and a few helpers. It is **pure** (no DOM, no I/O, deterministic), so it runs in Server
Components, Client Components, tests and scripts alike. Read `docs/HOUSE-FORMAT.md` for the meaning of the fields.

```ts
import { derived, house, metrics } from "@/lib/model/instance"; // the project's house, parsed and derived once
import { derive, computeMetrics, analyzeHouse, validateHouse } from "@/lib/model"; // everything else
```

Rules for page authors:

* **Never hard-code a number of the house** and never branch on an id (`R04`, `W02`, `T1`). Find things by `type`, `kind`,
  `role`, `side`, `zone`, or loop over the arrays. Ids are labels.
* **Texts are bilingual objects** (`room.name.cs / .en`); pick with `name[locale]` (or `pick(name, locale)`). Numbers go
  through `src/lib/i18n/format.ts`, not through `toFixed`.
* Coordinates are house-frame metres (`x` east, `y` north, `z` up). For SVG flip `y`; for three.js/glTF map
  `(x, y, z) -> (x, z, -y)`. True orientation: `azimuthTrue` fields already include `location.houseAxisBearingDeg`.
* `derived` is read-only data: do not mutate it (it is shared by all pages).

## 1. Getting the data

| what | how |
|---|---|
| shared instance (pages) | `import { house, derived, metrics } from "@/lib/model/instance"`; cheap (schema parse + derive + metrics, no validator) |
| validate and derive in one call | `analyzeHouse(json, { inputHash? })` returns `{house, derived, metrics, warnings}`, throws `ModelError` (with `.issues`) when the model has errors |
| derive without the design rules | `deriveAll(house)` returns `{derived, metrics}` |
| parse only | `parseHouse(json)` returns the typed `House` or throws `ModelError` |
| full report | `validateHouse(json)` / `validateHouseJson(text)` return `{valid, errors, warnings, house, derived, metrics}`; `formatReport(result, "cs" \| "en")` makes plain text |
| precomputed | `generated/derived.json` (identical to `derive(house)`; written by `scripts/build-derived.ts`, checked by a test) |

`derive()` takes a few milliseconds; do not call it per render, import the shared instance.

## 2. Exports of `src/lib/model/index.ts`

### Types (`types.ts`, all `export type`)

`House`, `Room`, `Opening`, `Roof`, `Outdoor`, `Accent`, `FurnitureItem`, `Screen`, `Assembly`, `Layer`, `Camera`,
`LocalizedText`, `Locale`; derived: `Derived`, `DerivedWall`, `DerivedRoom`, `DerivedOpening`, `DerivedAccent`,
`DerivedRoof`, `RoofFace`, `RoofEdge`, `RoofFrame`, `PvLayout`, `PvPanel`, `DerivedOutdoor`, `DerivedScreen`,
`DerivedLightpipe`, `DerivedFurniture`, `DerivedAccess`, `DerivedFacing`, `DerivedAssembly`, `DerivedOutline`,
`DerivedBBox`, `Glazing`, `Metrics`; validation: `Issue`, `Severity`, `ValidationResult`; geometry: `Rect`, `Pt`, `Pt3`, `BBox`, `Label`.
Enumerations: `RoomType`, `RoomRole`, `FloorKind`, `OpeningKind`, `OutdoorType`, `ZoneKey`, `Dir` (`N|E|S|W`),
`Facing8`, `EdgeKind`.

### Catalogue (`catalog.ts`)

Constant lists and tables: `ROOM_TYPES`, `ROOM_ROLES`, `FLOORS`, `OPENING_KINDS`, `OUTDOOR_TYPES`, `ZONE_KEYS`, `DIRS`,
`DIR_AZIMUTH` (`{N:0, E:90, S:180, W:270}`), `FACINGS8`, `FURNITURE` (footprint and bilingual name per type),
`ROOM_TYPE_NAMES`, `OUTDOOR_TYPE_NAMES`, `DIR_NAMES` (bilingual), `OPENING_LIMITS`, `MIN_AREA`, `U_LIMITS`, `HABITABLE`,
`UNHEATED_TYPES`.

### Functions

| function | purpose |
|---|---|
| `derive(house, {inputHash?}): Derived` | all geometry (walls, net rooms, outline, openings with orientation, roof faces, PV layout, access, facings, assemblies) |
| `computeMetrics(house, derived): Metrics` | areas, volumes, glazing by direction, roof areas, A/V, PV, heated envelope, U-values |
| `roofIntegrals(derived)` | exact roof integrals used by the metrics (roof area, area over the footprint, volume) |
| `buildRoofFaces(roofs, bearingDeg): RoofFace[]` | the roof decomposition on its own (synthetic roofs, experiments) |
| `roofSurfaceAt(faces, x, y): {face, z} \| null` | height of the roof surface at a point; `faceZAt(face, x, y)`, `faceContains(face, x, y)` |
| `layoutPv(faces, pvSpec, obstacles): PvLayout` | PV layout rule for any faces (what-if: another module, other setbacks) |
| `assemblyU(assembly): {thickness, R, U}` | U-value of a layer build-up |
| `roofInputs(house)` | roofs with defaults resolved (overhang 0, wall top) |
| `azimuthInRange(az, from, to)` | is an azimuth in a clockwise range (the blind rule) |
| `validateHouse`, `validateHouseJson`, `formatReport`, `ISSUE_CODES` | validation (section 6) |
| `analyzeHouse`, `deriveAll`, `parseHouse`, `ModelError` | loading helpers |
| `HouseSchema`, `houseJsonSchema()` | the zod schema, the JSON Schema |
| `sha256Hex`, `hashModelFiles`, `isHashedModelFile`, `shortHash` | content hash of the model (section 7) |
| `pick(text, locale)`, `roomTypeName(type, locale)` | bilingual text |
| `wallBody`, `unionOf`, `rectArea`, `inRect`, `ringArea`, `ringCentroid`, `furnitureRect`, `doorSwing`, `rectHitsSwing`, `trueAzimuth`, `facing8`, `poleOfInaccessibility` | geometry helpers |

## 3. What `Derived` contains

Short map (full shapes in `types.ts` and `docs/HOUSE-FORMAT.md`, section 6):

* **`rooms[]`**: `name {cs,en}`, `type`, `role?`, `zone`, `heated`, `cleanRects` (net rectangles), `area` (net, m²), `volume`,
  `glazing {total,N,E,S,W}`, `openings[]` (ids), `label {x,y,r}` (best label point and its free radius), `centroid`,
  `exteriorWallLength/Area`.
* **`walls[]`**: axis segments with `kind`, thickness `t`, rooms on both sides (`lo`, `hi`), exterior walls with
  `azimuth/azimuthTrue/facing/height`. `wallBody(w, walls)` gives the filled rectangle of a wall.
* **`outline`** (footprint with walls) and `bbox` (whole building incl. eaves and ridge, with `z0`, `z1`).
* **`openings[]`**: position and size, `wallId`, `exterior`, `room` or `connects [roomA, roomB]`, `swing`, `hinge`, `azimuth`
  (house), `azimuthTrue`, `facing`, `dir`, `glazingArea`, `area`, `center [x,y,z]`, `blind`, `overhang {depth, eaveHeight, wallTop}` (the roof above an exterior opening; for roof shading).
* **`roofPlanes[]`**: convex faces with `pts3`, `side`, `pitch`, `azimuthTrue`, `aspect` (PVGIS), `area`, `edges[].kind`, local
  frame `frame {origin,u,v,n}` and `uv`. **`roofs[]`**: per roof ridge, eaves, areas.
* **`pv`**: `count`, `kwp`, `panels[]` with 3D `corners`; **`lightpipes[]`**, **`outdoor[]`**, **`screens[]`**, **`furniture[]`**.
* **`access`**: entry room, door graph, door-count `depth` per room. **`facings`**: totals per house direction.
  **`assemblies`**: `{thickness, R, U}`.

## 4. Recipes (executed in `src/lib/model/__tests__/examples.test.ts`)

### 4.1 Floor plan (page "Floor plan")

```ts
function planSvg(d: Derived, locale: Locale): string {
  const b = d.bbox;
  const flip = (y: number): number => b.y1 - y; // SVG y points down, house y points north
  const rect = (r: [number, number, number, number], cls: string): string =>
    `<rect class="${cls}" x="${r[0]}" y="${flip(r[3])}" width="${r[2] - r[0]}" height="${r[3] - r[1]}"/>`;
  const parts: string[] = [];
  for (const r of d.rooms) for (const q of r.cleanRects) parts.push(rect(q, `room zone-${r.zone}`));
  for (const w of d.walls) parts.push(rect(wallBody(w, d.walls), `wall wall-${w.kind}`));
  for (const o of d.openings) {
    const half = o.w / 2;
    const [x0, x1, y0, y1] = o.orient === "h" ? [o.cx - half, o.cx + half, o.cy, o.cy] : [o.cx, o.cx, o.cy - half, o.cy + half];
    parts.push(`<line class="opening ${o.kind}" x1="${x0}" y1="${flip(y0)}" x2="${x1}" y2="${flip(y1)}"/>`);
  }
  for (const r of d.rooms) parts.push(`<text x="${r.label.x}" y="${flip(r.label.y)}" text-anchor="middle">${r.name[locale]}</text>`);
  return `<svg viewBox="${b.x0} 0 ${b.w} ${b.d}" xmlns="http://www.w3.org/2000/svg">${parts.join("")}</svg>`;
}
```

Colour rooms by `zone`, outline walls by `kind`, draw door arcs with `doorSwing(opening, wallThickness)` (hinge, leaf end,
radius) and furniture rectangles from `derived.furniture[].rect` (rotate `x, y, rot` for symbols). Put the label at
`room.label` and shrink the text until it fits `2 * room.label.r`.

### 4.2 Plot (page "Plot")

The plot model uses the same house frame, so the house footprint goes in as is: `derived.outline.polygons[0].pts` (outer ring),
`derived.bbox`, `derived.roofs[].eaveRect`. Rotate the north arrow by `-derived.houseAxisBearingDeg`. The terrace and
paving are `derived.outdoor[]` (with `area`, `covered`).

### 4.3 3D model and roof (page "Model")

```ts
function roofTriangles(d: Derived): Float32Array {
  const out: number[] = [];
  for (const f of d.roofPlanes) {
    const p = f.pts3.map(([x, y, z]) => [x, z, -y]);
    for (let i = 1; i < p.length - 1; i++) out.push(...p[0], ...p[i], ...p[i + 1]); // fan: faces are convex
  }
  return new Float32Array(out);
}
```

Roof faces are convex, so a triangle fan is correct. Group faces by `face.plane` to give one material or one toggle per
plane. PV modules: `derived.pv.panels[].corners` (four corners, counter-clockwise from above) are ready for a quad each;
the module normal is the face normal `faces[face].frame.n`. Blind boxes: for each `derived.openings` with `blind`, a box of
`house.shading.blinds.boxHeight` above `center` (width `w`) on the wall `azimuth`. Light pipes: `derived.lightpipes[]`
(`x, y, z`, `diameter`; `house.roof.lightpipes.domeHeight`). Furniture comes from the GLB, not from the kernel.

### 4.4 Sun (page "Sun")

```ts
/** Unit vector towards the sun in the house frame, from true azimuth and elevation in degrees. */
function sunVector(azTrue: number, elev: number, bearing: number): [number, number, number] {
  const a = ((azTrue - bearing) * Math.PI) / 180; // house azimuth
  const e = (elev * Math.PI) / 180;
  return [Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), Math.sin(e)];
}
function cosIncidence(d: Derived, azTrue: number, elev: number): Record<string, number> {
  const s = sunVector(azTrue, elev, d.houseAxisBearingDeg);
  return Object.fromEntries(d.roofPlanes.map((f) => [f.id, Math.max(0, f.frame.n[0] * s[0] + f.frame.n[1] * s[1] + f.frame.n[2] * s[2])]));
}
```

Use `face.azimuthTrue` and `face.pitch` (or `frame.n`) for roofs and `opening.azimuthTrue` for facades; both already include
the 12° bearing of the house. A window of an opening gets a shadow from the roof overhang: `roofs[].overhang`,
`wallTop`, `openings[].head`. Blinds: `opening.blind` plus `house.shading.blinds.closedFactor` and `closeAboveIrradiance`.
Location for the solar position: `house.location.lat/lon/tz`.

### 4.5 Energy (page "Energy")

```ts
function transmissionUA(h: House, d: Derived, m: Metrics): { walls: number; windows: number; doors: number; roof: number; floor: number } {
  const windows = d.openings.filter((o) => o.exterior && o.glazingArea > 0 && d.rooms.find((r) => r.id === o.room)?.heated);
  const uOf = (kind: string): number => (kind === "slider" && h.windows.slider ? h.windows.slider.Uw : h.windows.Uw);
  return {
    walls: m.heated.wallOpaque * d.assemblies.exteriorWall.U,
    windows: windows.reduce((s, o) => s + o.glazingArea * uOf(o.kind), 0),
    doors: m.heated.doors * h.windows.Ud,
    roof: m.roofAreaOverFootprint * d.assemblies.roof.U,
    floor: m.heated.floorArea * d.assemblies.groundFloor.U,
  };
}
```

Inputs: `metrics.heated` (heated floor area and net volume, exposed wall perimeter, gross and opaque wall area, glazing, doors), `derived.assemblies[*].U`,
`house.windows` (U-values, g, frame share), `derived.facings[dir]` (glazing and blinded glazing per direction),
`house.equipment` (heat pump SCOP, MVHR efficiency and airflow, PV, battery options), `derived.pv` (modules and their
tilt/azimuth via `faces`), `metrics.volume` and `derived.rooms[].volume` (net volume of heated rooms: filter by
`heated`). The PV layout power is `derived.pv.kwp`; `metrics.pvKwp` is only the rule-of-thumb potential.

### 4.6 Budget (page "Budget")

```ts
function quantities(d: Derived, m: Metrics): Record<string, number> {
  const windowsByKind: Record<string, number> = {};
  for (const o of d.openings) windowsByKind[o.kind] = (windowsByKind[o.kind] ?? 0) + 1;
  return {
    footprint: m.footprintArea,
    roofSloped: m.roofArea,
    exteriorWallGross: d.walls.filter((w) => w.ext).reduce((s, w) => s + w.len * (w.height ?? 0), 0),
    interiorWallLength: d.walls.filter((w) => !w.ext).reduce((s, w) => s + w.len, 0),
    pvModules: d.pv.count,
    ...Object.fromEntries(Object.entries(windowsByKind).map(([k, v]) => [`count_${k}`, v])),
  };
}
```

Quantities available: footprint and floor areas (`metrics`, `rooms[].area` by `type`/`zone`), wall lengths and areas
(`walls[]`, `facings`), opening counts and areas by `kind` and `dir` (`openings[]`), roof areas by face and by edge kind
(sum `edges[].length` by `kind`: eaves for gutters, ridges and hips for ridge cap, valleys), downpipes
(`house.roof.downpipes`), PV modules (`pv.count`), outdoor areas (`outdoor[]`), assemblies (layer thicknesses and areas give
material volumes). Prices live in `model/pricebook.json`, not in the kernel.

## 5. Roof faces and PV in detail

* A roof plane (`"T1.S"`) can consist of several faces (`"T1.N#1"`, `"T1.N#2"`) when a valley cuts it. They share `plane`,
  `frame` and `side`. Sum `area` over faces of one plane for plane totals.
* `edges[i]` is the edge from `pts[i]` to `pts[(i + 1) % n]`: `eave`, `ridge`, `hip`, `valley`, `step`, `seam`. A `seam` is
  not a real edge (two faces of the same plane meet).
* `uv[i]` are local coordinates; `point3D = frame.origin + u * frame.u + v * frame.v`. Convert a rectangle in `(u, v)` to
  3D that way (this is what `pv.panels[].corners` are).
* `side` is the house-frame direction the plane descends to (`S` = towards the garden); `azimuthTrue` includes the bearing;
  `aspect` is the PVGIS convention (0 = south, east negative).
* `layoutPv(faces, spec, obstacles)` lets a page show a what-if (another module size, other setbacks, `orientation: "auto"`)
  without touching the model: pass `{...house.equipment.pv, layout: {...house.equipment.pv.layout, gap: 0.05}}`.

## 6. Validation

`validateHouse` returns structured issues: `{code, severity, message: {cs, en}}`. `ISSUE_CODES` lists all codes with
bilingual titles (table in `docs/HOUSE-FORMAT.md`, section 7). Show warnings of the model on the Floor plan page with
`result.warnings.map((w) => w.message[locale])`. Never show raw `code` strings to visitors.

## 7. Content hash

`hashModelFiles(files)` hashes `model/*.json` (without generated schemas) as documented in `docs/HOUSE-FORMAT.md`
section 8; `derived.inputHash` is set by `scripts/build-derived.ts`. The web uses `shortHash(hash)` as the `?v=` cache-buster
of the GLB files. The hash function works in the browser too (pure TypeScript).

## 8. Scripts

| command | what |
|---|---|
| `npx tsx scripts/model-validate.ts [file] [--lang cs\|en] [--json]` | report; exit code 0 ok, 1 errors, 2 input problem |
| `npx tsx scripts/build-derived.ts` | validate, write `generated/derived.json` and `model/house.schema.json` |
| `npx tsx scripts/build-derived.ts --check` | write nothing; exit 1 when the committed files are stale (for CI) |
| `npx vitest run src/lib/model` | kernel tests (oracle comparison, invariants, mutation tests of the validator) |

## 9. Tests as documentation

* `oracle.test.ts`: the kernel against the independent concept-stage derivation (`__fixtures__/oracle-*.json`) to 1e-6.
* `invariants.test.ts`: areas add up, openings lie on walls, rooms are reachable, roof faces tile the roofs (checked with
  polygon-clipping), the roof surface equals the maximum of the hips at sampled points, PV modules fit and keep clearances.
* `roofs.test.ts`: synthetic roofs and 300 random configurations against the definition of the roof surface.
* `validate.test.ts`: every issue code is provoked by a mutation of the model.
* `examples.test.ts`: the recipes of this document.
