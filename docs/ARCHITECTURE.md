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

Where to read next: `docs/README.md` is the index of all documents. This one defines the conventions and the contracts between
the data model, the web app and the Blender pipeline; the API documents (`KERNEL-API.md`, `CALC-API.md`, `THREE-API.md`) describe
the code a page is written against; `DESIGN.md` is the contract for UI code.

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
* Months are 0-based in code (like `Date`); no function reads the clock or a random number, so server and client agree.

## 2. Data model

* `model/house.json`, schema `house/1` (`docs/HOUSE-FORMAT.md`). Axis-based: rooms are rectangles between wall axes;
  walls, net areas, openings' walls and facings are *derived*.
* `model/site.json`: plot polygon, neighbours, analytic terrain, trees, access, setback rules (`docs/SITE.md`).
* `model/style.json`: materials, looks (facade/wood/roof variants) and the palette used by web and renders.
* `model/pricebook.json`, `model/assumptions.json`: unit prices and energy/tariff assumptions (region: Czechia, 2026), both
  `status: "reviewed"` (`docs/CALC-API.md`, `docs/ENERGY-ASSUMPTIONS.md`).
* `model/render.json`: what to shoot (cameras, times, frame counts) for the renders (`docs/RENDER-INPUTS.md`).
* The zod schema in `src/lib/model/schema.ts` is the single definition; `model/house.schema.json` is exported from it.
* `src/lib/model/derive.ts` is the only place that derives geometry (net room polygons, walls, openings with facing,
  roof planes with eave/ridge/hip edges, footprint, set-backs, metrics). Web code and `scripts/build-derived.ts` use it.
  The Python/Blender side never re-derives geometry; it reads `generated/derived.json`.
* **Content hash.** `hashModelFiles` (SHA-256 over every `model/*.json` except the generated schemas) is stored in
  `generated/derived.json` (`inputHash`), in `public/models/manifest.json` and in `public/media/manifest.json`. CI recomputes it
  (`npm run check:model`, `npm run models:check`) so a committed artefact can never silently disagree with the model. The hash covers
  prices and assumptions too: one rule without exceptions (see `docs/CALC-API.md`, section 12).
* `generated/render-inputs.json` (git-ignored, built by `scripts/build-render-inputs.ts`) is everything the render scripts need,
  so they never compute geometry, terrain or the sun themselves (`docs/RENDER-INPUTS.md`).

## 3. GLB contract (web ⇄ Blender)

Files in `public/models/`: `house.glb` (desktop), `house-lite.glb` (phones), `furniture.glb`, `furniture-lite.glb`,
`furniture-footprints.json` (collision boxes), `house.usdz` (AR), `manifest.json` (content hash, bounding box,
triangle counts, file sizes; the web uses the hash as `?v=` cache-buster).

* Built procedurally in Blender from `generated/derived.json` + `model/*.json` (`docs/PIPELINE.md`); lite variants are built with a
  lower detail parameter (not by decimation). Budgets: `house.glb` ≤ 7 MB, `house-lite.glb` ≤ 2.5 MB and ≤ 70 k triangles,
  `furniture-lite.glb` ≤ 0.6 MB, `house.usdz` ≤ 6 MB. Draco geometry, WebP textures (1k desktop / 512 phone).
* The builds are deterministic: the same inputs give byte-identical GLB files (the USDZ differs only in the order of its objects).
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
  Style rules: light Scandinavian (`pipeline/furniture/STYLE.md`, `docs/PIPELINE-FURNITURE.md`).
* Verified by `scripts/verify-glb.ts` and `scripts/verify-furniture.ts` (called by `pipeline/build_model.sh`) and by the unit
  tests `src/lib/three/glb.test.ts` and `scripts/__tests__/glb.test.ts`, which read the committed files.

## 4. Media contract (renders ⇄ web)

`public/media/manifest.json` is written by `scripts/build-media.ts` (`docs/MEDIA.md`) and read by `src/lib/data/media.ts`; no media
path is hard-coded elsewhere. It lists: the day sequence (date, times, landscape/portrait frame patterns, sizes, still time),
the orbit sequence (frame count for scrolling, patterns, the MP4 and its poster), stills (id, file, size, time of day,
category, bilingual alt text), the before/after pair, and the Open Graph image. File names carry a content hash.
Frames are Cycles renders (fixed seed, OIDN denoising); the video is those frames at 24 fps, no interpolation.
`scripts/make-placeholder-media.ts` writes flat-shaded stand-ins in the same format, so the pages work before the renders exist.

## 5. Web app

Next.js 16 (App Router), React 19, TypeScript, three.js. Read `node_modules/next/dist/docs/` before writing Next code
(this version has breaking changes, for example `proxy.ts` instead of `middleware.ts`). Czech is served at root URLs (rewrite in
`src/proxy.ts`), English under `/en`; route slugs are localised (`src/lib/routes.ts`). Pages (`src/app/[locale]/<key>/page.tsx`):
Home, Floor plan, Plot, 3D model (+ exports), Sun, Energy, Budget, Gallery. Three.js is loaded only on `/model` and `/sun`
(checked by `scripts/check-bundles.mjs` after a build). Phones get the lite GLB, lower pixel ratio and render-on-demand.
Tailwind is used for the preflight only; the design system lives in `src/styles/tokens.css` (graphite, ivory, mint; Geist; no
serif, no orange; `docs/DESIGN.md`).

Reliability on phones is a design rule, not a polish step: pages render complete HTML on the server, client state is read after
mount (`src/lib/calc/storageKeys.ts`), every 3D failure is a value that turns into a message with a retry button, and a device
without WebGL gets the page without the canvas (`docs/THREE-API.md`, section 1).

## 6. Quality gates

`npm run typecheck && npm run lint && npm test && npm run check:model && npm run models:check && npm run build &&
npm run check:bundles && npm run privacy` (`npm run verify` runs typecheck, lint, tests, build and the bundle check; CI in `.github/workflows/ci.yml` runs the whole list and then the e2e suite).
Playwright (`e2e/`): desktop Chromium 1440, iPhone 15 and iPhone SE (WebKit), Pixel 7 (Chromium), against a production build.
Tests assert invariants of the model (areas add up, openings lie on walls, rooms reachable, panels inside roof planes)
and compare derived numbers with an independent oracle; they never hard-code magic numbers of the house.

## 7. Privacy and IP rules

* The project must contain nothing about any real building, plot, person or place. The only place is the fictional
  region "South Moravia" with coordinates rounded to 0.1°.
* No data, image, model or text may be copied from anywhere except: our own code and tools, and the CC0 assets listed in
  `ASSETS.md`. Plans and photos of real houses are never used.
* `scripts/privacy/scan.mjs` scans staged files, the tree, history, the build output and media metadata for forbidden
  strings kept in the git-ignored `.privacy/denylist.local.json`, and for generic patterns that need no denylist (contact data, absolute home paths, parcel numbers, coordinates, tokens, personal
  metadata in images, models and videos). It prints categories, paths and positions, never values (`docs/PRIVACY.md`).
* Commit identity is the GitHub noreply address.

## 8. Rules for parallel work (agents and contributors)

1. Edit only the files your task owns. Shared files (`package.json`, `src/app/layout.tsx`, `tokens.css`, the i18n index)
   belong to the integrator; ask for changes by listing what you need.
2. Do not run `npm install`, `next build`, `git commit` or `git push` from a task. You may run `npx tsc --noEmit`,
   `npx vitest run <path>`, `npx eslint <path>`, `node`, `tsx`, Blender, `rsvg-convert`, `magick`, `ffmpeg`.
3. Never write absolute paths, personal names or place names into the repository. Do not copy data, images or models from
   anywhere; third-party assets need an entry in `ASSETS.md` first.
4. Write files in small steps; keep the documents in step with the code in the same change.

## 9. Repository layout

| path | content |
|---|---|
| `model/` | the data model: `house.json`, `site.json`, `style.json`, `pricebook.json`, `assumptions.json`, `render.json` and the exported `house.schema.json` |
| `generated/` | `derived.json` (derived geometry, committed), `render-inputs.json` (git-ignored) |
| `src/lib/model/` | the kernel: schema, validation, `derive`, metrics, roofs and PV layout, `site/` (plot, terrain, shading) |
| `src/lib/calc/` | sun, roof layout, U-values, energy, budget, printable mesh, storage keys |
| `src/lib/three/` | the 3D engine (viewer, GLB loading, scene parts, walk, sun analysis) |
| `src/lib/i18n/`, `src/lib/data/`, `src/lib/plan/` | dictionaries and formatting, media and climate data, floor-plan geometry |
| `src/components/`, `src/app/` | page components per page, shared UI, the routes under `src/app/[locale]/` |
| `src/styles/` | tokens, base, layout, component and page CSS |
| `pipeline/` | Blender and Python: `blender/` (house builder), `furniture/`, `render/`, `build_model.sh`, `data/pvgis/` (raw API answers) |
| `public/` | the built models (`models/`), media (`media/`), the Draco decoder (`draco/`), icons |
| `scripts/` | build and check scripts (derived data, manifests, media, PVGIS, bundles), `privacy/` scanner, `shot.mjs`, `readme-shots.mjs` |
| `e2e/` | Playwright tests and helpers |
| `docs/` | these documents; `docs/img/` holds the README screenshots |
| `assets/`, `pipeline/out/`, `.privacy/` | local only (git-ignored): CC0 asset cache, heavy render output, privacy denylist |

## 10. Commands

| command | what |
|---|---|
| `npm run dev` / `npm run build` / `npm start` | the site on port 3400 (dev) or 3401 (production start) |
| `npm run typecheck`, `npm run lint`, `npm test` | TypeScript, ESLint, Vitest (unit tests of the kernel, calc, engine, pages, scripts, privacy scanner) |
| `npm run e2e` | Playwright against a production build |
| `npm run check:bundles` | after a build: three.js only on Model and Sun, no external hosts, size per page |
| `npm run model:validate`, `npm run model:build`, `npm run check:model` | validate the model, write `generated/derived.json` and `model/house.schema.json`, check that they are fresh |
| `npm run models`, `npm run models:check`, `npm run verify:glb`, `npm run verify:furniture` | Blender: build the GLB/USDZ files and the manifest; check the manifest; verify the files |
| `npx tsx scripts/build-render-inputs.ts`, Blender with `pipeline/render/photo.py`, `bash scripts/build-media.sh` | render inputs, renders, web media (`docs/RENDER-INPUTS.md`, `docs/MEDIA.md`) |
| `npm run pvgis:fetch`, `npm run pvgis:build` | PVGIS climate data: fetch raw answers, assemble `src/lib/data/pvgis.json` (`docs/ENERGY-DATA.md`) |
| `npm run privacy`, `npm run privacy:staged` | the privacy scan of the tree, history and build output / of the staged files |
| `npm run readme:shots` | the README screenshots into `docs/img/` (needs the site running and ImageMagick) |
