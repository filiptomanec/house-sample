# Documentation

House Sample is a portfolio project: a **fictional** house whose one data model (`model/*.json`) drives the floor plan, the 3D model,
the calculations and the renders. The project overview, screenshots and the run instructions are in the [README](../README.md);
this folder holds the contracts and the reference. Start with the architecture, then pick what you need.

## Start here

| Document | What it is | Read it when |
|---|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Conventions (units, frames, ids), the data flow, the GLB and media contracts, quality gates, privacy rules, repository layout and commands | you are new to the project, or you change a contract between the model, the web app and the pipeline |

## Data model

| Document | What it is | Read it when |
|---|---|---|
| [HOUSE-FORMAT.md](HOUSE-FORMAT.md) | The format `house/1`: every key of `model/house.json`, how geometry is derived, `generated/derived.json`, the validation codes, the content hash | you edit the house or the format |
| [SITE.md](SITE.md) | The invented plot (`model/site.json`): frame, terrain, set-backs, shading solids, algorithms and limits | you work on the Plot page, the sun analysis or the terrain |
| [ENERGY-DATA.md](ENERGY-DATA.md) | PVGIS climate and PV data: what is requested, the file format `pvgis/1`, how to regenerate it | you touch the climate data or the energy balance |
| [ENERGY-ASSUMPTIONS.md](ENERGY-ASSUMPTIONS.md) | Each number of `model/assumptions.json` with its source, the method of `computeEnergy`, where it departs from the API contract | you change an assumption or want to know what the Energy page calculates |

## Code APIs

| Document | What it is | Read it when |
|---|---|---|
| [KERNEL-API.md](KERNEL-API.md) | `src/lib/model`: getting the model, `derive`, metrics, validation, and runnable recipes for each page | you write a page or a script that needs the house |
| [CALC-API.md](CALC-API.md) | `src/lib/calc`: sun, roof layout and PV choice, U-values, energy, budget, printable STL, storage keys; units, time, determinism and test strategy | you use or change a calculation |
| [THREE-API.md](THREE-API.md) | `src/lib/three` and `Stage`: the viewer, the GLB contract as loaded, terrain, plants, blinds, PV, walk mode, the ray-cast sun analysis, budgets | you work on the Model or Sun page |
| [DESIGN.md](DESIGN.md) | The design system: tokens, colour and contrast, type, breakpoints, components, **the contract for adding a page** (section 7), i18n | you write UI |

## Pipeline (Blender)

| Document | What it is | Read it when |
|---|---|---|
| [PIPELINE.md](PIPELINE.md) | The procedural house builder: inputs, code layout, the GLB contract as implemented, levels of detail, verification, limits | you rebuild or change `house.glb`, `house-lite.glb`, `house.usdz` |
| [PIPELINE-FURNITURE.md](PIPELINE-FURNITURE.md) | Furniture and decor: layout, footprints, validation, detail levels | you change the furniture |
| [RENDER-INPUTS.md](RENDER-INPUTS.md) | `generated/render-inputs.json` and `model/render.json`: what the render scripts read, shots, lights, checks | you change a camera, a time of day or the look of a render |
| [MEDIA.md](MEDIA.md) | From renders to `public/media`: the manifest `media/1`, the video, safety of the build, `check-media` | you rebuild the gallery or the hero sequences |

## Quality and privacy

| Document | What it is | Read it when |
|---|---|---|
| [PRIVACY.md](PRIVACY.md) | The privacy scanner: what it detects, local files, hooks, what to do with a finding | a commit or a push is refused, or you change the scanner |

## Reading paths

* **Recruiter or reviewer:** the [README](../README.md), then [ARCHITECTURE.md](ARCHITECTURE.md), then the tests described at the end of [CALC-API.md](CALC-API.md) (section 11) and [KERNEL-API.md](KERNEL-API.md) (section 9).
* **Add a page:** [DESIGN.md](DESIGN.md) section 7, [KERNEL-API.md](KERNEL-API.md) for the data, [CALC-API.md](CALC-API.md) for numbers, then `node_modules/next/dist/docs/` (this Next.js version has breaking changes).
* **Change the house:** [HOUSE-FORMAT.md](HOUSE-FORMAT.md) section 10, then `npm run model:build`, `npm run models` and the media build ([MEDIA.md](MEDIA.md)).
* **Rebuild the assets:** [PIPELINE.md](PIPELINE.md), [PIPELINE-FURNITURE.md](PIPELINE-FURNITURE.md), [RENDER-INPUTS.md](RENDER-INPUTS.md), [MEDIA.md](MEDIA.md); the CC0 inputs are listed in [ASSETS.md](../ASSETS.md).

## Screenshots

`docs/img/` holds the README screenshots (desktop and iPhone, light and dark). `npm run readme:shots` rebuilds them from a running copy of the
site (`scripts/readme-shots.mjs`; optimised JPEG, at most 120 KB each, no metadata). Run it again after the renders or a page change.
