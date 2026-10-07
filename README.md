# House Sample

A **fictional** single-storey house ("Long Roof House") on a fictional plot, built as a data-driven portfolio project.
One data model in [`model/`](model) drives everything: the floor plan, the procedurally generated 3D model, the sun,
energy and budget calculations, and the renders.

```
model/*.json ─► TypeScript kernel (validate, derive) ─► web app (plan, sun, energy, budget, 3D)
                         └─► generated/derived.json ─► Blender pipeline ─► GLB / USDZ / renders ─► web
```

> Work in progress: the first full version is being assembled. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
> for the design, and [`docs/HOUSE-FORMAT.md`](docs/HOUSE-FORMAT.md) for the data model.

The house, the plot and the location (South Moravia, coordinates rounded to 0.1°) are invented. Calculations are indicative.

## Run it

```bash
npm install
npm run dev        # http://localhost:3400
npm run verify     # typecheck, lint, tests, build, bundle check
npm run privacy    # local privacy scan (generic detectors without the private denylist)
```

Node 22 or newer. The Blender pipeline (`pipeline/`) needs Blender 5.x and is only used to rebuild the committed models
and renders (`npm run models`).

## Licence

Code: MIT (see [LICENSE](LICENSE)). Third-party assets and data: see [ASSETS.md](ASSETS.md).
Author: Filip Tomanec.
