# House Sample: architecture and contracts

House Sample is a portfolio project: a **fictional** single-storey house ("Long Roof House") on a fictional plot.
Every number on the website (areas, U-values, sun hours, PV yield, budget quantities) and every picture (floor plan,
3D model, renders) is derived from **one data model** in `model/`.

```
model/house.json ─┐
model/site.json  ─┼─► src/lib/model   zod schema · validate · derive (pure TypeScript, no DOM)
model/style.json ─┘        │
                           ├─► web app (floor plan SVG, sun, energy, budget, 3D scene, STL export)
                           └─► generated/derived.json ─► pipeline/ (Blender, Python stdlib only)
                                                          ├─► public/models/*.glb, *.usdz, manifest.json
                                                          └─► renders ─► public/media/* + manifest.json
```

## 1. Conventions (apply everywhere)

* Units: metres, degrees, kilograms, Czech crowns (CZK, VAT included unless stated). Angles in degrees.
* **House frame** (plan coordinates, used in `model/*.json`, `generated/derived.json`, Blender):
  `x` = east, `y` = north, `z` = up, in the frame of the house axes. Origin = outer-axis corner at the south-west
  of the main block. `z = 0` is the top of the finished floor (±0.000).
* True orientation: `location.houseAxisBearingDeg` is the azimuth (clockwise from true north) of the house `+y` axis.
  The true azimuth of a direction with house azimuth `a` (clockwise from `+y`) is `(a + houseAxisBearingDeg) mod 360`.
* The plot (`model/site.json`) uses the **same house frame** (so plot coordinates are metres from the house origin).
* glTF is Y-up: house `(x, y, z)` maps to glTF `(x, z, -y)`. Blender builds in house coordinates and exports with Y-up.
* IDs (`R01`, `W02`, `T1`, `O1`, `A1`) are labels for humans. **Code must never branch on an ID.** Use `type`, `kind`, `role`.
* No numeric literals that describe the house in JSX or Python. Read them from the model (or from `derive()`).
* All user-visible text goes through the i18n dictionaries (`cs` and `en`), numbers through `src/lib/i18n/format.ts`.
  Czech typography: non-breaking spaces before units and single-letter prepositions.

## 2. Data model

* `model/house.json`, schema `house/1`: a superset of the `concept/1` format (see `docs/HOUSE-FORMAT.md`).
  Axis-based: rooms are rectangles between wall axes; walls, net areas, openings' walls and facings are *derived*.
* `model/site.json`: plot polygon, neighbours, analytic terrain, trees, access, setback rules, location.
* `model/style.json`: materials, looks (facade/wood/roof variants), palette used by web and renders.
* `model/pricebook.json`, `model/assumptions.json`: unit prices and energy/tariff assumptions (region: Czechia, 2026).
* The zod schema in `src/lib/model/schema.ts` is the single definition; `model/*.schema.json` is exported from it.
* `src/lib/model/derive.ts` is the only place that derives geometry (net room polygons, walls, openings with facing,
  roof planes with eave/ridge/hip edges, footprint, set-backs, metrics). Web code and `scripts/build-derived.ts` use it.
  The Python/Blender side never re-derives geometry; it reads `generated/derived.json`.

## 3. GLB contract (web ⇄ Blender)

Files in `public/models/`: `house.glb` (desktop), `house-lite.glb` (phones), `furniture.glb`, `furniture-lite.glb`,
`furniture-footprints.json` (collision boxes), `house.usdz` (AR), `manifest.json` (content hash, bounding box,
triangle counts, file sizes; the web uses the hash as `?v=` cache-buster).

* Built procedurally in Blender from `generated/derived.json` + `model/*.json`; lite variants are built with a
  lower detail parameter (not by decimation). Budgets: `house.glb` ≤ 7 MB, `house-lite.glb` ≤ 2.5 MB and ≤ 70 k triangles,
  `furniture-lite.glb` ≤ 0.6 MB. Draco geometry, WebP textures (1k desktop / 512 phone).
* No transform nodes: transforms are baked in house coordinates (glTF Y-up mapping above).
* Every mesh node has `extras`: `{ "role": string, "toggle"?: "roof"|"furniture", "id"?: string }` and a material named
  by role (no `.001` suffixes; one material per role).
* Material roles (house): `plaster`, `wood_cladding`, `frame`, `glass`, `sill`, `soffit`, `fascia`, `gutter`,
  `roof_tile`, `ridge_cap`, `ceiling`, `plaster_in`, `door_leaf`, `slab`, `floor_oak`, `floor_tile`, `floor_stone`,
  `floor_concrete`, `terrace_paving`, `drive_paving`, `path`, `gravel`, `post`, `screen_slats`.
  Terrain (`lawn`, `mulch`) is generated in JS from `model/site.json` (single source of truth for the ground), not in the GLB.
* `toggle: "roof"` marks everything hidden by the web "Roof" switch: `roof_tile`, `ridge_cap`, `fascia`, `gutter`,
  roof underside, `ceiling`.
* Generated at runtime in JS (not in the GLB), driven by `derive()`: terrain, trees and shrubs, exterior blinds,
  terrace screen animation, PV panels and battery, room labels, plot boundary. The Blender builder can add blinds, PV
  and vegetation for renders (`--blinds --pv --vegetation`), never for the web GLB.
* Furniture GLB: one root node `furniture`, children `furniture_<roomId>_<material>` (room id with `.`/`-` normalised to `_`),
  `furniture_terrace_<material>`; materials `f_*` (interior) and `t_*` (terrace); only the wood materials have textures.
  Style rules: light Scandinavian (see `pipeline/furniture/STYLE.md`).

## 4. Media contract (renders ⇄ web)

`public/media/manifest.json` is written by the pipeline and read by `src/lib/data/media.ts`; no media path is
hard-coded elsewhere. It lists: the day sequence (date, times, landscape/portrait frame patterns, sizes, still time),
the orbit sequence (frame count for scrolling, patterns, the MP4 and its poster), stills (id, file, size, time of day,
category, bilingual alt text), the before/after pair, and the Open Graph image. File names carry a content hash.
Frames are real renders (fixed seed, OIDN denoising); the video is real frames at 24 fps, no interpolation.

## 5. Web app

Next.js 16 (App Router), React 19, TypeScript, three.js. Read `node_modules/next/dist/docs/` before writing Next code
(this version has breaking changes). Czech is served at root URLs (rewrite in `proxy.ts`), English under `/en`;
route slugs are localised (`routes.ts`). Pages: Home, Floor plan, Plot, 3D model (+ exports), Sun, Energy, Budget,
Gallery. Three.js is loaded only on `/model` and `/sun` (checked by `scripts/check-bundles.mjs`). Phones get the
lite GLB, lower pixel ratio and render-on-demand. Tailwind is used for the preflight only; the design system lives in
`src/styles/tokens.css` (graphite, ivory, mint; Geist; no serif, no orange).

## 6. Quality gates

`npm run typecheck && npm run lint && npm test && npm run build && npm run check:bundles && npm run privacy`.
Playwright (`e2e/`): desktop 1440, iPhone 15 and iPhone SE (WebKit), Pixel 7. CI in `.github/workflows/ci.yml`
also verifies that the committed GLB/media manifests match the hash of `model/*.json`.
Tests assert invariants of the model (areas add up, openings lie on walls, rooms reachable, panels inside roof planes)
and compare derived numbers with an independent oracle; they never hard-code magic numbers of the house.

## 7. Privacy and IP rules

* The project must contain nothing about any real building, plot, person or place. The only place is the fictional
  region "South Moravia" with coordinates rounded to 0.1°.
* No data, image, model or text may be copied from anywhere except: our own code and tools, CC0 assets listed in
  `ASSETS.md`. Photos and plans of catalogue houses used as inspiration are **never** copied.
* `scripts/privacy/scan.mjs` scans staged files, the tree, history, the build output and media metadata for forbidden
  strings kept in the git-ignored `.privacy/denylist.local.json`. It prints categories, paths and positions, never values.
* Commit identity is the GitHub noreply address.

## 8. Rules for parallel work (agents)

1. Edit only the files your task owns. Shared files (`package.json`, `src/app/layout.tsx`, `tokens.css`, the i18n index)
   belong to the orchestrator; ask by listing what you need in your report.
2. Do not run `npm install`, `next build`, `next dev`, `git commit` or `git push`. You may run `npx tsc --noEmit`,
   `npx vitest run <path>`, `npx eslint <path>`, `node`, `tsx`, Blender, `rsvg-convert`, `magick`, `ffmpeg`.
3. Never write source-project names, paths or identifiers into the repo. Adapting code from the earlier project is fine;
   copying its data, images, models or house-specific constants is forbidden.
4. Write files in small steps (output token limits).
