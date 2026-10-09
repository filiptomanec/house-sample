# Render pipeline (photoreal images)

Blender 5.1 / Cycles turns the data model into the pictures of the site: the stills (with the compare pair and the Open Graph
shot), the day sequence (landscape and portrait) and the orbit around the house. The renderer is **data driven**: it never
computes geometry, terrain or the position of the sun. It reads `generated/render-inputs.json` (contract C3,
`docs/RENDER-INPUTS.md`; the shot list is its section 8), builds the house with the builder of `pipeline/blender`
(`build_scene`, the same code as the web GLB, high detail, render variant) and imports the furniture GLB. Everything that only a
picture needs (terrain, lawn, plants, the boundary, the pool water, neighbours, PV, blinds, louvres, lamps, sky) is added by this
pipeline.

```
model/*.json ─► scripts/build-render-inputs.ts ─► generated/render-inputs.json ─┐
generated/derived.json, model/house.json, style.json ─► pipeline/blender (build_scene) ─┤
public/models/furniture.glb ────────────────────────────────────────────────────────────┤
assets/ (Poly Haven CC0, see ASSETS.md) ────────────────────────────────────────────────┤
                                                                                         ▼
                 pipeline/render/photo.py ─► pipeline/out/{stills,compare,og,day,day/portrait,orbit/<variant>}/**.jpg
```

## 1. Commands

```bash
pipeline/render/run_all.sh draft                 # everything at the draft preset (see section 5)
caffeinate -i pipeline/render/run_all.sh final   # the real run, unattended, resumable
pipeline/render/run_all.sh final day dayp        # only some steps (section 2)

# one render process (any mode), the same options everywhere
BLENDER -b --factory-startup --python pipeline/render/photo.py -- --mode stills|day|orbit [--quality draft|final] \
   [--variant landscape|portrait] [--subset stills|compare|og|scroll|rest|all] [--only id,id] [--range a:b] [--skip-existing] \
   [--out DIR] [--inputs FILE] [--device auto|gpu|cpu] [--list] [--missing] [--blend FILE] [--no-verify] [--qa]
```

* `--subset`: in the stills mode `stills`, `compare` or `og`; in the orbit mode `scroll` (every `scrollStep`-th frame, what the
  page loads first) or `rest` (the frames only the video needs). `--only`: shot ids (`garden-walnut`, day `0800`, orbit frame `35`
  or `0035`); `--range a:b`: positions in the list after the subset. Frames are written as `*.part` and renamed when complete, so an
  interrupted frame never counts as done.
* `--list` prints the shots, `--missing` prints what does not exist yet and exits with 1 when something is missing (used by
  `run_all.sh`), `--blend` saves the built scene for inspection, `--qa` measures every frame (section 8).
* Output: `<out>/<file>.jpg` with `file` as in the inputs (`stills/garden-walnut`, `compare/pool-terrace-before`, `og/og`,
  `day/1920`, `day/portrait/1920`, `orbit/landscape/0036`, `orbit/portrait/0036`). The default `<out>` is `pipeline/out` for
  `final` and `pipeline/out/draft` for `draft`. JPEG without any metadata. Logs: `pipeline/out/logs/render-<mode>-<quality>.log`
  (one line per frame with the seconds), `run_all-<quality>.log`, `blender-<quality>.log`.
* Environment: `BLENDER` (binary, default: the standard places), `RENDER_DEVICE` (`auto|gpu|cpu`), `RENDER_SAMPLES` (overrides the
  samples of the preset), `RENDER_SKIP=lawn,trees,far,furniture` (leave parts out: profiling), `RENDER_SKY`, `RENDER_EXPOSURE`,
  `RENDER_TREE_COPIES`, `RENDER_LOOK` (a JSON object merged into `look`, for calibration, e.g. `{"bounceSaturation": 0.3}`),
  `RENDER_QA_KEEP=1` (keeps the key image of `--qa` next to the frame). Driver: `CHUNK` (orbit frames per Blender process,
  default 60), `RETRIES` (restarts per chunk, default 4), `OUT`, `MIN_FREE_GB`.

`run_all.sh` rebuilds `generated/render-inputs.json` when it is stale, and the model GLBs (`pipeline/build_model.sh --no-trees --no-usdz`, about 15 s) when `pipeline/out/furniture-report.json` no longer matches the model hash (the decor lamps would be missing). `photo.py` refuses to run when `modelHash` differs from the
hash of `model/*.json` or the content hash does not match (both are re-computed in Python, `rn/inputs.py`); `--no-verify` skips
that for look development. The furniture lamps (pendants, floor and table lamps) are in the inputs only when
`pipeline/out/furniture-report.json` was built from the current `generated/derived.json`: rebuild the furniture first
(`docs/PIPELINE-FURNITURE.md`), then the inputs, then render.

## 2. The driver and the run order

`run_all.sh [draft|final] [steps]` renders in the order of the plan's budget, so the pictures the site needs most exist first and
an interrupted night still leaves a usable set:

| step | what | frames (final size) |
|---|---|---|
| `stills` | `render-inputs.stills` | 9 (2560 x 1440) |
| `compare` | `compare.before`, `compare.after` | 2 (2560 x 1440) |
| `og` | `og` | 1 (1600 x 840) |
| `day` | the day sequence, landscape | 32 (2560 x 1440) |
| `dayp` | the day sequence, portrait (own camera, `day.portrait`) | 32 (1080 x 1620) |
| `scroll` | orbit landscape, the scroll frames | 60 (1600 x 900) |
| `orbitp` | orbit portrait (scroll frames only) | 60 (960 x 1440) |
| `rest` | orbit landscape, the remaining frames of the video | 180 (1600 x 900) |

`orbit` is an alias of `scroll rest`, `portrait` of `orbitp`. Every step runs Blender until nothing is missing (at most `RETRIES`
restarts; the orbit steps in chunks of `CHUNK` frames, one process each). Before each process the driver checks the free space on
the output volume and stops (exit code 3) below `qa.minFreeDiskGB` (8 GB); started again it resumes where it stopped. It prints
`ALL DONE` when every step is complete. Exit codes: 0 done, 1 incomplete, 2 setup problem, 3 low disk.

## 3. What the scene contains

| part | module | notes |
|---|---|---|
| house | `rn/assemble.py` | `build_house.build_scene(Config.load(..., lod="high", for_render=True))`; the glass role is replaced by clear glass (Fresnel mix of a transparent and a glossy shader: no refraction, little noise, sun patches on the floor; the same Fresnel on both sides, the IOR is swapped on a back face) and the reversed copy of every pane that the builder adds for the web (glTF culls back faces) is removed: two coincident faces drew dark triangles in the panes |
| furniture | `rn/assemble.py`, `rn/materials.py` | `furniture.glb` as it is; woven bump and sheen on the fabrics, translucent lamp shades, clear coat on the cars |
| sky, sun, clouds | `rn/sky.py` | Sky Texture (multiple scattering, the parameters of `render-inputs.sky`) with `sun_elevation`/`sun_rotation` from `shot.sun.blender`; below the horizon the glow is held at `belowHorizonHoldDeg` and dimmed by `belowHorizonFalloff`. Clouds (section 4) for camera and glossy rays only |
| lamps | `rn/lights.py` | one Blender light per `lights.items[]` (spot or point, black-body colour mixed `colorMix` from white); only the power changes per shot (section 4). Garden lights (C3 kinds `pool`, `garden` with `space` `tree_uplight` / `deck_step`, `pillar`) come from the inputs; a group the inputs lack is derived from the data (`fallbackLights`) |
| terrain | `rn/terrain.py` | one mesh from `terrain.grid` (two triangles per cell); zones `lawn`, `verge`, `street`, `neighbour`, `field`, `meadow` as material slots; the face attribute `grass` (0 on the street, faded far from the house); sunk inside the house footprint and the pool basins (`groundVoids`); a far-ground frame falls away to the horizon |
| surfaces, street | `rn/surfaces.py`, `rn/street.py` | paths, aprons, gravel and mulch beds draped on the terrain (ray cast), graphite steel edging around beds and draped paths; the asphalt, a kerb along both edges with dropped kerbs at the drive and walk crossings, the pavement raised to the kerb top and ramped down to the crossings, an edge stone towards the green strip |
| boundary | `rn/fences.py` | from `site.fences/gates/pillars`: one slat fence (graphite precast plinth, graphite steel posts, light timber slats from one shared slat builder), the cantilever sliding drive gate (opens per shot by `gates.driveway` towards its park span), the walk gate (swings by `gates.walkway` along its arc), the pillar (meter box, mailbox, intercom, backlit house number; its light is a lamp). Real geometry everywhere |
| pool | `rn/pool.py` | the basin and coping come from the house build (roles `pool_liner`, `pool_coping`); the render adds a closed water volume (transmission, IOR 1.333, ripple bump, shadow rays pass, absorption volume in the style `water` colour), mosaic tiles and a caustic pattern on the liner below the water line; underwater spots are lamps |
| lawn | `rn/lawn.py` | procedural patches of fine mown blades (`ground.blade`, a share of dry blades), Poisson scattered with Geometry Nodes at `grassDensityPerM2` per mode, masked by point proximity to every non-lawn polygon (exact edges), colours from `style.json` `lawnColors` |
| trees | `rn/vegetation.py`, `rn/plants.py`, `rn/tree_lod.py` | the scanned tree in four leaf tones, rotated copies on one trunk and leaves-only clusters for a dense crown (`trees.forms`), crowns near the house turned away from it; big trees get a bark-textured trunk with a root flare and scaffold limbs (the walnut: a broad crown on a thick short bole) |
| shrubs, beds | `rn/herbs.py`, `rn/vegetation.py`, `rn/leafy.py` | procedural lavender (needle dome and flower spikes), panicle hydrangeas (arching stems, opposite leaves, cream panicles) and miscanthus (arching leaves and plumes); topiary balls; a planting mix of Poly Haven perennials and ground cover scattered over the mulch beds |
| landscape | `rn/vegetation.py` | seeded, never on the plot, the street or a neighbour house: hedgerows along invented field roads (trees with field shrubs between them), woodlots, a far village edge, a few trees in the neighbour gardens (`landscape`) |
| neighbours | `rn/neighbours.py` | `neighbours[]` with a plinth band, walls (plaster texture in the style colour), a graphite roof with fascia and gutters, windows in proud anthracite frames with sills and opaque dark glazing; a seeded share of the windows glows faintly (invisible by day, lived-in at dusk) |
| PV | `rn/pv.py` | `pv.panels` held `standoff` above the roof: all-black modules (black frame, black cells with a barely visible grid, anti-reflective glass) |
| blinds | `rn/blinds.py` | external venetian blinds on every item of `blinds.items` (every glazed opening of a heated room): sections from the inputs (at most `maxSectionWidth`), guide rails in the reveal, the head box hidden in the wall (only a dark slot shows), C-profile slats at `slatPitch`, tilted with the outer edge down; slats rebuilt only when the state of an item changes |
| louvres, garage door | `rn/equipment.py` | the louvre blades of the house GLB are hidden and rebuilt at the shot's `screens.angleDeg` (clamped to `[closedDeg, openDeg]`); the garage door leaf follows the track of a sectional door by `garageDoor` (up in the opening, then horizontal under the ceiling) |

## 4. Look and exposure (`config.json` `look`, `lamps`)

* **View transform** AgX with the look "Base Contrast"; OIDN denoising.
* **Exposure.** `skyStrength` 0.08 (calibrated: the 13:00 hero has a mean grey of 0.45 and a sunlit white wall stays below
  clipping). Exteriors are exposed by the sky alone plus the dusk boost: `dusk` is a smooth step of the sun elevation from
  `fromElevationDeg` (6) to `toElevationDeg` (-4.5) and adds up to `ev` (+2.3 EV). An exterior camera under a roof (inside an
  eave rectangle, outside the footprint: the covered terrace) gets `coveredEv` more. Rooms (`autoExposure.categories`: interior)
  are exposed automatically: a small linear preview gives the `percentile` (60) luminance, the exposure puts it on `target` (0.18),
  clamped to `minEv`..`maxEv` (-3..+4.5).
* **Clouds** (`look.clouds`, overridden by `render-inputs.sky.clouds`: `hdri`, `rotationDeg`, `strength`, `visibleTo`). The cloud
  layer of the CC0 "puresky" HDRI is extracted once (cached in `assets/cache`) and drawn as its relative brightness times the
  luminance of the physical sky in the same direction: white with a little of the sky blue (`skyTint`) by day, tinted towards the
  glow colour below `glowBelowDeg` (golden hour), in the colour of the sky behind them in the blue hour (`duskDarken`,
  `duskCoverage`). Camera and glossy rays only: the glazing and the pool reflect them, the scene is lit by the physical sky, so
  the light never turns grey. Without the asset the sky is the plain physical sky.
* **Sky for the camera** (`skyCamera`): the sky that camera and glossy rays see has its own gain (0.8) and saturation (1.2), like
  a polariser; it keeps the sky blue under AgX (13:00 hero: sky blue/red 1.4).
* **White balance** per category (`whiteBalance`: exterior, aerial, interior, dusk; Blender's neutral is 6500 K, tint 10;
  a higher tint is more magenta, a lower temperature cooler), blended towards `dusk` in the twilight for the exteriors.
* **Bounce light** (`bounceSaturation`): the vegetation and the ground show their true colour to camera and glossy rays and a
  desaturated one to diffuse rays (`rn/shading.py`), so the green of the lawn does not tint the shaded white walls (shaded plaster
  within 3 % of neutral).
* **Lamps** (`lamps`): energy = `watts` x `scale` x level x (1 + `duskBoost` x dusk) for the room lamps (1.5) and
  (1 + `exteriorDuskBoost` x dusk) for the facade and garden lights (0): the lit rooms glow against the blue hour (lit glass about
  1.6 EV above the facade) while the facade is not floodlit. Colour: black body of `kelvin` (2700-3000 K) mixed `colorMix` (0.85)
  from white. Ceiling spots in a room whose decor lamps are on run at `spotsWithDecor` (30 %, 3000 K). Room lamps do not light the
  terrain (light linking): their light through the glazing would tint the facade green at dusk.
* **Glare**: a soft bloom in the compositor (Blender 5 node group) makes lamps and windows glow.

## 5. Quality presets and time

`config.json` `quality.<draft|final>.<mode>`: `scale` of the size in the inputs, `samples`, adaptive `threshold`, JPEG `quality`,
`portraitScale` (day and orbit portrait), `motionBlur` (orbit, shutter in frames, centred: the camera path is animated with linear
keys, so the foreground lawn does not strobe), plus `grassDensity` and `farTrees` factors per quality. Final: stills, compare, OG
and day landscape at scale 1.333 (2560 x 1440, OG 1600 x 840), day portrait 1.0 (1080 x 1620), orbit landscape 0.833
(1600 x 900) and portrait 0.889 (960 x 1440), motion blur 0.15. Draft: half size, 12-16 samples.

Measured on the development machine (Apple M1, 8 GPU cores, Metal; proof pass of 9 October): a draft frame takes 10-17 s (orbit 6-9 s), a scene build 35-50 s; final frames: day landscape 2560 x 1440 at 64 samples about 245 s, orbit landscape 1600 x 900 at 32 samples about 40 s, a still at 160 samples 600-1160 s. The final run therefore takes about 9 hours (up to 10.5 when the stills are slow): stills, compare and OG 2-3.5 h, day landscape 2.3 h, day portrait 1 h, orbit scroll landscape 0.7 h, orbit portrait 0.6 h, orbit rest 2 h. Everything the page needs first is done after about 7 hours; the `rest` step (the video frames) comes last and can be postponed. If the run must be shorter: stills at 96 samples (about -1 h), day at 48 samples (-0.8 h). The output needs well under 1 GB; the driver stops cleanly below `qa.minFreeDiskGB` (8 GB) free and resumes on the next start. The first frame of every process also compiles the shaders and builds the acceleration structures (15 to 40 s more).

## 6. Performance notes (what mattered)

* Changing the **camera, the sky, the exposure or the power of a lamp** costs nothing between frames. Anything that touches an
  object (visibility, a mesh, a material) makes Cycles on Metal update the scene. Therefore lamps are switched by power, never
  hidden, and the blinds, louvres, gates and the garage door change only when their state changes.
* The scanned tree has 2 million triangles (1.9 million of them leaves, about 100 000 separate pieces). `tree_lod.py` finds the
  leaf pieces once (cached in `assets/cache`), keeps a seeded share (`trees.keep`: stills 0.6, day 0.45, orbit 0.3) and scales the
  kept pieces up so that the leaf area stays the same. All trees share one mesh and one material per leaf tone.
* The lawn is a few patch meshes instanced about 18 000 times (memory of a few ten thousand triangles); its cost is in the
  samples, like the foliage.
* Sun position and lamp levels are data (`render-inputs.json`); the code has no almanac.

## 7. Contract C3 (what the renderer reads)

`rn/c3.py` reads the C3 fields of `render-inputs.json` with safe defaults and falls back to `generated/derived.json` (named and
hashed by the inputs) for a field an older inputs file lacks: `site.fences` (posts, slat spec, plinth), `site.gates` (posts, leaf
polygon, park span or swing arc), `site.pillars`, `site.zones.street` (pavement, green, kerb), `site.access` (dropped kerbs and
their reveal), `site.pools` (water, coping, deck polygons), `terrain.voids`, `screens[]` (blades, `closedDeg`, `openDeg`,
`restDeg`; both the derived and the inputs shape), `blinds.product`/`details`, `blinds.items[].sections`, `vegetation.trees[].uplight`,
`sky.clouds`. Per-shot states default to closed gates, a closed garage door and the louvres at rest; an optional per-shot `ev` is
added to the exposure. Camera orientation comes from `forward`/`up`/`roll` (never from `target`), the vertical shift from `shift`.

## 8. Checks

* `python3 pipeline/render/selftest.py` (no Blender, standard library): the inputs are current (content and model hash), unique
  file names, sizes, the shot counts, the presets of `config.json` and no unknown keys; **missing blinds** (every opening with
  `derived.openings[].blind` has a blind item and every shot a state for it); **slabs below terrain** (the terrain never rises
  above an outdoor slab); **house share** (the house covers at least `qa.minHouseShare`, 45 %, of the width of every exterior
  shot).
* `BLENDER -b --factory-startup --python pipeline/render/selftest.py [-- --no-verify]` adds the scene checks: the scene builds; the
  pool water, the fence and the gates exist; **no grass on paving** (no lawn patch centre inside a paved, bed, street, house or pool
  polygon); **bare lawn** (an eye-level view of open lawn shows at most `qa.maxBareLawn`, 3 %, of the ground under the blades).
* `photo.py --qa` measures every frame it writes (`rn/qa.py`, results in `<out>/qa.json`): a second, cheap render with flat key
  colours (plaster red, glazing green, sky blue) masks the frame, and the numbers are taken on the JPEG as the viewer sees it:
  `meanGrey`, `skyBR` (blue over red of the sky), `plasterChroma` (largest channel deviation of the shaded white surfaces),
  `glassEv` (glazing over plaster, in stops). Acceptance of the draft proof: the 13:00 hero has a mean grey of 0.42-0.50 and a
  sky blue/red of at least 1.3, shaded plaster within 3 % of neutral; at dusk (21:20) the lit glass is at least 1.5 EV above the
  facade and the sky blue/red at least 1.3. Measured on the draft proof of 2026-10-08: 13:00 grey 0.45, sky 1.41, plaster 2.2 %;
  21:20 glass +1.6 EV, sky 1.54.

## 9. Known limits

* Conifers would be the scanned broadleaf tree in a dark tone; the model has none.
* Neighbour houses are simple volumes with details; the village edge is plain boxes with roofs (seen from 400 m and more).
* The interior furniture and the cars are the furniture GLB as built (`docs/PIPELINE-FURNITURE.md`); their look is that of the
  web model with the render tweaks of `rn/materials.py`.
