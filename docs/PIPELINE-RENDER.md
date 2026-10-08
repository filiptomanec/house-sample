# Render pipeline (photoreal images)

Blender 5.1 / Cycles turns the data model into the pictures of the site: the stills (with the compare pair and the Open Graph
shot), the day sequence of the terrace and the orbit around the house. The renderer is **data driven**: it never computes geometry,
terrain or the position of the sun. It reads `generated/render-inputs.json` (`docs/RENDER-INPUTS.md`), builds the house with the
builder of `pipeline/blender` (`build_scene`, the same code as the web GLB, high detail, render variant) and imports the furniture
GLB. Everything that only a picture needs (terrain, plants, neighbours, PV, blinds, lamps, sky) is added by this pipeline.

```
model/*.json ─► scripts/build-render-inputs.ts ─► generated/render-inputs.json ─┐
generated/derived.json, model/house.json, style.json ─► pipeline/blender (build_scene) ─┤
public/models/furniture.glb ────────────────────────────────────────────────────────────┤
assets/ (Poly Haven CC0, see ASSETS.md) ────────────────────────────────────────────────┤
                                                                                         ▼
                              pipeline/render/photo.py ─► pipeline/out/{stills,compare,og,day,orbit}/**.jpg
```

## 1. Commands

```bash
pipeline/render/run_all.sh draft              # everything at low quality (960 x 540, 12 samples): about 35 minutes
caffeinate -i pipeline/render/run_all.sh final   # the real run, unattended, resumable (see section 5 for the time)
pipeline/render/run_all.sh final day          # only some steps: stills | day | orbit | portrait

# one render process (any mode), the same options everywhere
BLENDER -b --factory-startup --python pipeline/render/photo.py -- --mode stills|day|orbit [--quality draft|final] \
   [--variant landscape|portrait] [--only id,id] [--range a:b] [--skip-existing] [--out DIR] [--device auto|gpu|cpu] \
   [--list] [--missing] [--blend FILE] [--no-verify]
```

* `--only`: shot ids (`street-sunset`, day `0800`, orbit frame `35` or `0035`); `--range a:b`: positions in the list of the mode
  (orbit: frame numbers); `--skip-existing`: skip frames that already exist (also the default of `run_all.sh`); frames are written as
  `*.part` and renamed when complete, so an interrupted frame never counts as done.
* `--list` prints the shots, `--missing` prints what does not exist yet and exits with 1 when something is missing (used by
  `run_all.sh`), `--blend` saves the built scene for inspection.
* Output: `<out>/<file>.jpg`, `file` as in the inputs (`stills/street-sunset`, `compare/day-night-before`, `og/og`, `day/0800`,
  `orbit/landscape/0035`, `orbit/portrait/0105`). The default `<out>` is `pipeline/out` for `final` and `pipeline/out/draft` for
  `draft`. JPEG without any metadata. Logs: `pipeline/out/logs/render-<mode>-<quality>.log` (one line per frame with the seconds),
  `run_all-<quality>.log`, `blender-<quality>.log`.
* Environment: `BLENDER` (binary, default: the standard places), `RENDER_DEVICE` (`auto|gpu|cpu`), `RENDER_SAMPLES` (overrides the
  samples of the preset), `CHUNK` (orbit frames per Blender process, default 100), `RETRIES` (restarts per chunk, default 4),
  `RENDER_SKIP=lawn,trees,far,furniture` (leave parts out: profiling), `RENDER_SKY`, `RENDER_EXPOSURE`, `RENDER_TREE_COPIES`.

`run_all.sh` rebuilds `generated/render-inputs.json` when it is stale. `photo.py` refuses to run when `modelHash` differs from the
hash of `model/*.json` or the content hash does not match (both are re-computed in Python, `rn/inputs.py`). The furniture lamps
(pendants, floor and table lamps) are in the inputs only when `pipeline/out/furniture-report.json` was built from the current
`generated/derived.json`: rebuild the furniture first (`docs/PIPELINE-FURNITURE.md`), then the inputs, then render.

`python3 pipeline/render/selftest.py` (no Blender, standard library) checks the hashes, the shot counts and the presets.

## 2. Modes

| mode | shots | size (final) | what |
|---|---|---|---|
| `stills` | 9 stills + the compare pair (2) + `og` | 1920 x 1080 (og 1200 x 630) | `render-inputs.stills`, `compare.before/after`, `og` |
| `day` | 30 frames | 1920 x 1080 | one static camera on the terrace, 8:00 to 21:30; the portrait crop is made by the media step |
| `orbit` landscape | 300 frames | 1600 x 900 | closed loop, 24 fps, the camera path of `orbit.variants[landscape]` |
| `orbit` portrait | 60 frames (every 5th) | 720 x 1080 | the scroll frames of `orbit.variants[portrait]` (own radius and lens) |

All frames are real renders (fixed seed, OIDN denoising with albedo and normal guides, no interpolation). The seeds are in
`config.json` (`seed`).

## 3. What the scene contains

| part | module | notes |
|---|---|---|
| house | `rn/assemble.py` | `build_house.build_scene(Config.load(..., lod="high", for_render=True))`; the glass role is replaced by clear glass (Fresnel mix of a transparent and a glossy shader: no refraction, little noise, sun patches on the floor) |
| furniture | `rn/assemble.py`, `rn/materials.py` | `furniture.glb` as it is; woven bump and sheen on the fabrics, translucent lamp shades (they do not cast shadows, so a lamp inside lights the room), clear coat on the cars |
| sky, sun | `rn/sky.py` | Sky Texture (multiple scattering) with `sun_elevation`/`sun_rotation` from `shot.sun.blender`. Below the horizon the glow is held at 0.5 degrees and dimmed; the dusk exposure boost is a smooth step of the sun elevation (`look.dusk`). Checked: the sun disc sits on `shot.sun.direction` |
| lamps | `rn/lights.py` | one Blender light per `lights.items[]` (spot or point, colour from the black body, mixed 60 % towards white); only the power changes per shot |
| terrain | `rn/terrain.py` | one mesh from `terrain.grid` (two triangles per cell), zones (lawn, verge, field, meadow) as material slots; the ground inside the house footprint is sunk below the plinth (the floors are at z = 0, the same as the plateau). A far-ground frame (watertight at the grid edge) falls away to the horizon (curvature 3 m at 1.8 km) |
| surfaces | `rn/surfaces.py`, `rn/fences.py` | paths, aprons, gravel and mulch beds draped on the terrain (ray cast); the asphalt of the street with kerbs; fences from `site.fences` (boards that follow the ground) |
| lawn | `rn/lawn.py` | bermuda blades in 0.35 m patches scattered with Geometry Nodes; the density is a face attribute of the terrain (0 under paving, full within 16 m of the house, fading to 0 at 42 m) |
| trees | `rn/vegetation.py`, `rn/plants.py`, `rn/tree_lod.py` | the scanned tree in four leaf tones, rotated copies on one trunk for a full crown, crowns near the house turned away from it; the leaves are thinned (section 6) |
| shrubs, hedges | `rn/leafy.py` | procedural leafy volumes (noise-displaced meshes with a Voronoi leaf shader): hedges swept along `site.hedges`, balls for topiary, hydrangea and lavender; miscanthus from the grass model |
| neighbours | `rn/neighbours.py` | `neighbours[]` as volumes with a hip or gable roof, windows and a door |
| PV | `rn/pv.py` | `pv.panels` held `standoff` above the roof: aluminium frame, dark glass with a cell grid |
| blinds | `rn/blinds.py` | headrail boxes and guide rails fixed, slats rebuilt per shot from `shot.blinds` (drop, slat angle); a mesh is rebuilt only when the state changes |

## 4. Look and exposure (`config.json`)

AgX with "Base Contrast", Sky strength 0.3 (calibrated: a sunlit white wall stays below clipping), OIDN. Exteriors are exposed by
the sky alone plus the dusk boost. **Rooms** (`category` interior or compare) are exposed automatically: a 320 px linear preview
(`Scene.measure_ev`) gives the median luminance, the exposure puts it on `look.autoExposure.target` (clamped to -1.5 .. +2.3 EV), so
a dim room and a bright bedroom both look airy while the windows may burn out softly. A soft bloom (Glare node, Blender 5
compositor API) makes lamps and windows glow.

## 5. Quality presets and time

`config.json` / `quality`: `scale` of the size in the inputs, `samples`, adaptive `threshold`, JPEG quality, `motionBlur`
(orbit, shutter in frames, centred: the camera path is animated with linear keys, so the foreground does not strobe).

Measured on the development machine (Apple M1, 8 GPU cores, Metal), steady state, one process per mode:

| step | frames | final preset | seconds per frame | total |
|---|---|---|---|---|
| stills | 12 | 1920 x 1080, 160 samples | 110 to 210 s (rooms a bit more: the exposure preview) | about 36 min |
| day | 30 | 1920 x 1080, 56 samples | 60 to 75 s (+ 5 s when the blinds change) | about 35 min |
| orbit landscape | 300 | 1600 x 900, 24 samples | 21 to 31 s (foliage in the foreground costs most) | about 2 h 05 min |
| orbit portrait | 60 | 720 x 1080, 24 samples | 10 to 13 s | about 11 min |

**The whole final run takes about 3.6 hours** (the sum above, 3 h 27 min, plus about 2 minutes of scene building for each of the
6 Blender processes). The draft run (960 x 540, 12 samples) takes about 35 minutes: stills 3 min, day 5 min, orbit 25 min, portrait 3.5 min.
To shorten the final run, lower `quality.final.orbit.samples` (each sample costs about 1 s per orbit frame, so 6 samples fewer
save 30 minutes) or render the orbit at 1280 x 720 (`portraitScale` and `scale` of the orbit preset); to improve the stills raise
them to 256 samples (+25 min). The first frame of every process also compiles the shaders and builds the acceleration structures
(15 to 40 s more).

## 6. Performance notes (what mattered)

* Changing the **camera, the sky, the exposure or the power of a lamp** costs nothing between frames. Anything that touches an
  object (visibility of a lamp, a mesh, a material) makes Cycles on Metal update the whole scene: 10 to 30 s with the heavy tree
  mesh. Therefore lamps are switched by power, never hidden, and the blinds are rebuilt only when their state changes (20 of the 30
  day frames change it; with the thinned tree about 5 s each).
* The scanned tree has 2 million triangles (1.9 million of them leaves, about 100 000 separate pieces). `tree_lod.py` finds the leaf
  pieces once (cached in `assets/cache`), keeps a seeded share (`trees.keep`: stills 0.6, day 0.45, orbit 0.3) and scales the kept
  pieces up so that the leaf area stays the same. The leaf shader has no alpha test (the leaves are modelled shapes). All trees share
  one mesh and one material per leaf tone (a Cycles geometry is (mesh, materials)): a material per species would have copied the
  mesh. This made a frame about 3 times faster.
* The sky model is not the cost; the foliage is (trees, then the lawn blades). `trees.copies` and the lawn density are per mode.
* Sun position and lamp levels are data (`render-inputs.json`); the code has no almanac.

## 7. Known limits

* The day camera (data in `model/render.json`) stands on the terrace and looks west-south-west; the yew hedge of the west boundary,
  about 5 m away and 2 m high, fills most of the picture. Move the camera or the hedge in the data to show the garden.
* Orbit cameras pass over the crowns of the walnut and the pine (12 and 10 m high, inside the circle): for a few frames a tree is
  in the foreground. Also data (camera elevation and radius).
* Conifers are the scanned broadleaf tree in a dark blue-green tone and a narrower crown; there is no pine model.
* The grass is a lawn of blades; it looks patchy from the orbit height at low density (the base colour under the blades is darker green).
* Blinds are drawn as slat stacks (no cord, no bottom rail); neighbour houses are simple volumes.
