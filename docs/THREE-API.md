# 3D engine API (`src/lib/three`, `src/components/three`)

The 3D engine turns the data model into the interactive scene of the **Model** and **Sun** pages: the house from the GLB, the
plot, plants, movable shading, photovoltaics, a walk mode and a ray-cast sun analysis. It is data driven like everything else
(`docs/ARCHITECTURE.md`): no number of the house and no id appears in the engine; geometry that is not in the GLB is generated from
`derive()` and `model/site.json`.

**Status.** Everything below is implemented and tested (`src/lib/three/*.test.ts`, about 180 tests: pure geometry, invariants of the
model, independent oracles; no GL context needed) and checked on the Model and Sun pages in Chromium and WebKit (desktop 1440, iPhone 15 and SE,
light and dark scheme; the Playwright suite in `e2e/` covers the stage states).

| module | content |
|---|---|
| `frame.ts`, `views.ts`, `style.ts`, `context.ts` | frames and sun direction, camera presets and orbit limits, materials and looks, the `HouseContext` |
| `tier.ts`, `webgl.ts`, `theme.ts`, `orbit.ts` | tiers and their settings, the WebGL probe, design tokens and colour scheme, keyboard orbit and easing: **no three.js** |
| `glb.ts` | manifest, URLs, node contract, loaders with the shared Draco decoder, contract check, progress groups |
| `viewer.ts`, `sky.ts` | renderer, camera, lights, the procedural sky and the render-on-demand loop |
| `interior.ts` | the interior light of the rooms (shader patch) |
| `house.ts`, `roomTags.ts`, `furniture.ts` | the house scene, room tags (CSS2D), preparing the furniture GLB |
| `terrain.ts`, `surroundings.ts`, `vegetation.ts`, `meshBuilder.ts` | ground, neighbours and fences, plants, a small mesh builder |
| `blinds.ts`, `extBlinds.ts`, `pv.ts` | slat screens, exterior blinds, PV and battery |
| `walkCollision.ts`, `walk.ts` | colliders (pure), the walk controller |
| `sunAnalysis.ts` | the ray-cast sun analysis (section 10) |
| `dispose.ts` | freeing scene graphs |
| `src/components/three/Stage.tsx`, `src/styles/components/stage.css` | the React shell and its styles |
| `index.ts`, `n8ao.d.ts` | type-only barrel, types for the AO package |
| `public/draco/` | Draco decoder (glTF build of three r169: `draco_wasm_wrapper.js`, `draco_decoder.wasm`, `draco_decoder.js`) |

## 1. Principles

1. **One source of truth.** The scene is built from a `HouseContext` and nothing else. No literal of the house (sizes, positions,
   counts, room or opening ids) appears in engine code. Ids are used only as join keys between data and GLB nodes
   (`userData.id`, `userData.roomId`), never in a condition. Branch on `type`, `kind`, `role`, `side`, `toggle`.
2. **The scene is the house frame.** The world frame is the house frame mapped to glTF Y-up: house `(x, y, z)` is scene
   `(x, z, -y)` (`toScene`, `fromScene`). There is no rotating "plan group": the GLB, the terrain, the plot and all add-ons are in
   one frame. True orientation enters only through `ctx.bearingDeg` (`derived.houseAxisBearingDeg`), for the sun direction and
   the compass.
3. **No hidden global state.** Nothing mutable lives at module level except the shared Draco decoder (released after
   `idleDecoderMs`). Parsed GLB scenes are not cached across viewers: one `HouseScene` owns what it loaded and disposes it
   (geometries, materials, textures, BVH). The HTTP cache serves the bytes (URLs carry the content hash).
4. **No user-visible text.** Strings come in as options (`StageLabels`, `formatTag`, `WalkLabels.joystick`, canvas `ariaLabel`).
   Pages take them from their own i18n namespace; numbers are formatted by the page.
5. **No colour literals except data.** Colours come from `model/style.json` (materials, looks, optional `generated`) and from
   the design tokens (`readToken("--stage-bg")` ...). Dark mode: the viewer re-reads the tokens when the scheme changes
   (`onSchemeChange`, `viewer.refreshTheme()`).
6. **Phones are first class.** Tier "low": lite GLBs, one 2048 px shadow map, MSAA instead of post-processing, pixel ratio at most
   1.5, half-resolution terrain, 40 % of the foliage, no furniture shadows, render on demand, no work off screen.
7. **Failures are values.** Every load failure is a `GlbError` (kind `network | parse | contract | aborted`); a missing WebGL is
   `WebGlUnavailableError`; the UI turns them into a message with a retry button. No unhandled rejection, no blank canvas.
8. **Accessible.** The canvas is `role="img"` with a name, the container takes focus and understands the keyboard (arrows orbit,
   `+`/`-` zoom, Home resets the view), status changes are announced (`role="status"`), controls are real buttons of 44 px on coarse
   pointers, `prefers-reduced-motion` turns off transitions and damping.
9. **three.js only on `/model` and `/sun`.** Import runtime code only from those routes' components; types come from
   `@/lib/three` (type-only barrel). Import addons by path (`three/addons/...`). `Stage` loads the engine with `import()` in its
   effect, so the page shell paints before three.js arrives.

## 2. Data in: `HouseContext`

```ts
import { getHouseContext } from "@/lib/three/context";       // the project's house, built once, read-only
const ctx = getHouseContext();
// { house, derived, site, layout, style, bearingDeg }
```

| field | meaning |
|---|---|
| `house`, `derived` | kernel data (`@/lib/model/instance`), docs/KERNEL-API.md |
| `site` | `createSite(model/site.json, bearing)`: plot ring, terrain (`groundAt`, `grid`), zones, hedges, validation (docs/SITE.md) |
| `layout` | `site.withHouse(house.outdoor)`: driveway and walkway to the street, fences with gate openings, analytic `occluders()` |
| `style` | `model/style.json` (`StyleModel`): materials, looks, optional `generated` |
| `bearingDeg` | true azimuth of the house +y axis |

`createHouseContext({ house, derived, site, style })` builds one from explicit parts (tests with a changed model).
`sceneExtent(ctx, "plot" | "house")` is the sphere the camera may look at; the viewer derives orbit limits and the shadow range
from it (`orbitLimitsFor`, `shadowRangeFor`).

### 2.1 Frames and the sun (`frame.ts`)

| function | use |
|---|---|
| `toScene([x,y,z])`, `fromScene(...)` | house frame <-> scene frame |
| `sunDirectionHouse(azTrue, alt, bearing)`, `sunDirectionScene(...)` | unit vector towards the sun (same formula as docs/KERNEL-API.md 4.4) |
| `headingTrue(dirScene, bearing)` | compass heading of a viewing direction |
| `houseAzimuth`, `trueAzimuth`, `mod360`, `outwardNormalHouse(az)`, `dot3` | helpers |

`calc/sun.ts` (`sunDirection`) and `frame.ts` (`sunDirectionHouse`) are the same formula; one should delegate to the other
(`frame.ts` is the tested one) and a test should compare them.

### 2.2 Cameras (`views.ts`)

`house.cameras` with `use: "web"` are the presets of the viewer (`webViews(house.cameras)`). Each becomes a `ResolvedView`
(`id`, bilingual `name`, scene-frame `position` and `target`, `fov`). An **orthographic** camera is rendered as a long lens
(`ORTHO_APPROX_FOV` = 6 degrees) at the distance that shows `orthoHeight` at the target; the viewer has one perspective camera.
Page chips iterate over the views and label them with `pick(view.name, locale)`; the id is only a key.

## 3. The GLB contract (`glb.ts`, docs/ARCHITECTURE.md section 3)

Files in `public/models/` are described by `manifest.json`, which is **bundled** with the code (`MODEL_MANIFEST`), so the URL of a
file and the file always belong together. `modelUrl("house.glb")` is `/models/house.glb?v=<first 12 hex of the file's sha256>`;
serve `/models/*` with `Cache-Control: public, max-age=31536000, immutable`. `manifest.files[...].bbox` is in the **house frame**.

Tests (`glb.test.ts`) read the committed GLBs and check the contract: glTF 2 with Draco, no transform nodes, every mesh has
`extras.role` equal to its material name (one material per role, no `.001` suffix), known roles, only known toggles, roof parts carry
`toggle: "roof"`, lite and full files have the same nodes, furniture has one root `furniture` and `toggle: "furniture"` + `roomId` on every mesh,
sizes and hashes match the manifest, budgets (house <= 7 MB, lite <= 2.5 MB and <= 70 k triangles, furniture lite <= 0.6 MB).

### 3.1 Nodes

three.js copies glTF `extras` to `object.userData`:

| file | `userData` | meaning |
|---|---|---|
| house | `role` | material role (`HOUSE_ROLES`); equals the material name |
| house | `toggle?: "roof"` | hidden by the Roof switch (`roof_tile`, `ridge_cap`, `fascia`, `gutter`, `soffit`, `ceiling`) |
| house | `id?` | id of the room, opening, outdoor area or cladding strip (join key into `derived`; `screen_slats` meshes carry the screen id) |
| furniture | `role`, `toggle: "furniture"`, `roomId` | material `f_*` (interior) or `t_*` (terrace); `roomId` is the room id with `.`/`-` normalised to `_`, or `terrace` |

Role helpers: `isGroundRole(role)` (floors, paving, path, gravel, slab: where a person can stand), `isOccluderRole(role)` (everything
except glass and the slat screens, which the engine replaces by movable slats).

`checkHouseContract(root)` verifies the same on a loaded scene (warns in production, throws in development and tests).

### 3.2 Loading

`loadGltf(file, { onProgress, signal })` fetches and parses with one shared `DRACOLoader` (`DRACO_PATH`, workers per tier, released
after `idleDecoderMs`). Progress is bytes loaded over the **manifest** size (servers may not report a length for compressed
responses); `createProgressGroup(files, onChange)` weights several files into one fraction. `loadHouseGltf(tier)`,
`loadFurnitureGltf(tier)`, `loadFootprints()` (`furniture-footprints.json`, collision boxes). `EXT_texture_webp` is required of the browser.

### 3.3 Materials and looks (`style.ts`)

* Materials are created from `style.materials[role]`: `color`, `roughness`, `metallic`, `alpha` (< 1 makes glass transparent: one
  shared physical material, `depthWrite: false`, meshes with glass cast no shadow). The glTF material is replaced, so the scene always
  matches the style used for renders; the GLB's textures (neutral) are kept and tinted by `color`.
* **Looks**: `style.looks` has groups (facade, wood, roof). `resolveLook(style, selection)` returns the colours per role and the role
  `substitutions` (the "no timber" option draws `wood_cladding` and `screen_slats` with the material of another role). A selection is
  `Record<group, optionId>`; unknown ids and groups fall back to the default of the group. Persisting the selection is the page's job
  (`STORAGE_KEYS.look` in `calc/storageKeys.ts`).
* **Generated parts** (blind slats and rails, PV cells and frames, battery, bark, foliage, asphalt, field, kerb) use
  `style.generated[role]` when present, else a derived colour from a named style role (`generatedMaterial(style, role, fallbackRole)`).
  Requested additions are listed in section 14.

### 3.4 What is generated in JS (not in the GLB)

Terrain and painted ground, plot boundary, neighbours, fences, trees, shrubs, hedges, exterior blinds, the movable slat screens, PV
modules and battery, room tags. The Blender builder may add some of them for renders only, never for the web GLB.

## 4. The viewer (`viewer.ts`)

```ts
const viewer = createViewer(container, { bearingDeg: ctx.bearingDeg, extent: sceneExtent(ctx), initialView, backdrop: "stage", labels: true, ariaLabel, onContextLost });
```

`createViewer` throws `WebGlUnavailableError` without WebGL2. One viewer per container. The canvas has class `gl`, the label layer `gl-labels`.

| topic | rule |
|---|---|
| tiers | `detectTier()` (iOS, coarse pointer with a small screen, `deviceMemory` < 4 give "low"; the server gives "low"). Values in `TIER_SETTINGS` |
| render on demand | a frame is drawn only after `requestRender()`, a controls change, a resize, a sun change or a context restore. Frame callbacks (`onFrame`, walk, LOD) do not run while the container is off screen (IntersectionObserver, margin 100 px) or the document is hidden |
| shadows | `shadowMap.autoUpdate = false`; the map is redrawn on `requestRender()` without `{ shadows: false }` and on `setSun`. Camera movement passes `{ shadows: false }`. Sun shadow: `PCFSoftShadowMap`, orthographic frustum of half-width `shadowRange` (default `shadowRangeFor(extent)`), `bias` -0.0003, `normalBias` 0.04 |
| tone mapping | **Khronos PBR Neutral** (not AgX: it keeps base colours and the stage colour exact in both tiers, where AgX greyed the backdrop in the composer), exposure 1, sRGB output, `localClippingEnabled` for the section cut |
| high tier | `EffectComposer` (its modules and n8ao are `import()`ed on the high tier only, the first frames are drawn without them): **N8AOPass** (renders the scene itself; no RenderPass before it; `gammaCorrection: false`) then **SMAAPass** then `OutputPass`. AO radius and intensity ease (4 per second) between the outdoor and the indoor setting when the camera enters the interior region (`interior.contains(camera)`) |
| low tier | no composer; `antialias: true` on the context (MSAA); alpha-tested foliage uses `alphaToCoverage` only here |
| sky and light | No HDRI file. The environment is a procedural gradient dome (tokens `--sky-top`, `--sky-bottom`, a warm ground bounce derived from the `lawn` material, `ViewerOptions.groundColor`) times `SKY_GAIN` (1.7), baked with `PMREMGenerator.fromScene` once (in the task after the first frame), on a scheme change and after a context restore. A dark theme has dark tokens, but daylight stays daylight: a dome darker than `MIN_DOME_LUMINANCE` is lifted towards white. `backdrop: "stage"` is a flat `--stage-bg`, `"sky"` a vertical gradient between the sky tokens; fog has the backdrop colour (`setFog(near, far)`; the house scene starts it at 0.8 and ends it at 2.0 times the distance to the far corner of the ground) |
| sun | `setSun(azTrue, altitude)`: `DirectionalLight` at 150 m along `sunDirectionScene`; intensity `5.2 * smoothstep(alt, -1, 6)`, colour `(1, 0.72 + 0.25 k, 0.5 + 0.42 k)` with `k = clamp(alt / 14, 0, 1)`, hemisphere `0.05 + 0.12 d`, environment `0.12 + 0.43 d`, background `0.25 + 0.75 d` with `d = smoothstep(alt, -8, 20)` |
| camera | one `PerspectiveCamera`; `OrbitControls` with damping 0.08 (off with reduced motion), `screenSpacePanning = false` (pan over the ground like a map), limits from `orbitLimitsFor(extent)`, the target is pulled back into the target box together with the camera |
| gestures | `setPanMode(false)`: left drag / one finger rotates, right drag / two fingers pan (two fingers also pinch-zoom). `true` swaps them. Both gestures stay available in both modes |
| views | `setView(view, { animate })` eases position, target and fov over `transitionMs` (600), cancelled by the next call or by user input; no animation with reduced motion |
| keyboard | container `tabindex="0"`; arrows orbit 5 degrees, `+`/`-` zoom 10 %, Home returns to the initial view; only while the container itself has focus (a button inside keeps its own keys). Off while walking (the walk owns the keys). The arithmetic is `orbit.ts` |
| compass | `heading()` and `onHeading(cb, 0.5)`: true heading of the camera. The page rotates its compass by `-heading` (the heading callback fires only past the threshold, so React is not re-rendered 60 times a second) |
| context loss | `webglcontextlost` is `preventDefault`ed (else the browser would not restore it), `contextLost` is set, drawing stops, `onContextLost(true)`; on `webglcontextrestored` the environment is baked again (render targets lose their content), the shadow map and the frame are marked dirty and `onContextLost(false)` is called. The Stage offers "restore" (rebuild) because textures and geometries may be gone |
| dispose | stops the loop, removes ResizeObserver, IntersectionObserver, scheme listener, key and pointer listeners, controls, composer and its passes, PMREM, renderer and **`forceContextLoss()`** (iOS has few contexts; repeated navigation between the two 3D pages must not leak), removes canvas and label layer. Idempotent |
| snapshot | `snapshot()` draws and reads the canvas in the same task (no `preserveDrawingBuffer`) |

## 5. Interior light (`interior.ts`)

The sky environment has no occlusion, so rooms out of the sun would be dim and blue. `InteriorFill` (one per viewer, `viewer.interior`)
adds the light that bounces off walls and floors, keeps part of the sky IBL indoors, lets glossy surfaces reflect the room, and gives
a warm bounce under covered outdoor areas, all through an `onBeforeCompile` patch of standard materials.

* Region: `interiorRegionOf(ctx)`: the outline ring `derived.outline.polygons[0].pts`, `inset = derived.wall.ext / 2` (mid-wall),
  from the underside of the slab (`-house.slab`) to the ceiling (`house.clearHeight`). Set **before** the first `patch()`; may be changed later.
* The ring is a **fixed-size uniform array** (`INTERIOR_MAX_VERTS` = 64) plus a count, so changing the outline never recompiles or throws.
* No plan matrix: the scene is the house frame, plan `(x, y)` is world `(x, -z)`.
* `shadeBoxesOf(ctx)`: one box per covered outdoor area (`derived.outdoor[].covered`), at most `INTERIOR_MAX_SHADE`; it reaches from the slab level
  to the lowest roof surface over the area (`roofSurfaceAt` at the corners and the middle) less the thickness of the roof assembly.
* `setDaylight(altitude, sunHorizontal)` (called by `viewer.setSun`): `fill = 0.34 + 0.5 d`; side light `(1, 0.86 + 0.08 d, 0.70 + 0.16 d) * fill * 1.14`,
  from above `* 1.02`, from below `(1, 0.82 + 0.06 d, 0.64 + 0.10 d) * fill * 0.75`; faces turned to the sun get up to 24 % more; 45 % of the diffuse
  IBL stays, 90 % of the specular is replaced by the room; 20 % darker towards the floor (smoothstep over 1.4 m). Mirrors (`userData.mirror`) show a bright room.
  The constants are tuned against the renders.
* `patch(material)` is idempotent, keeps an existing `onBeforeCompile`, sets `customProgramCacheKey`, and ignores transparent materials (glass would turn milky).
* `contains(pointScene)` is the point-in-polygon test of the ring (without the inset) with the height range (AO radius, tests).

## 6. The house scene (`house.ts`)

```ts
const house = await buildHouse(viewer, ctx, { look, labels, formatTag, onProgress, signal });
```

`buildHouse` loads `house(-lite).glb` for the viewer's tier, checks the contract, replaces materials from the style (glass shared),
sets the interior region and patches the materials, builds the BVH (`three-mesh-bvh`, `acceleratedRaycast` set once, per geometry `computeBoundsTree`),
builds terrain, surroundings and boundary, applies the look and the switches, and after `furnitureDelayMs` (200) starts loading the furniture.
It rejects with a `GlbError`; on `signal` abort nothing stays in the scene.

| member | behaviour |
|---|---|
| `root`, `building` | `root` is a child of `viewer.scene` (no transform); `building` is the GLB content |
| `setLook(partial)` | recolours the role materials; for substitutions the meshes of the substituted role get the other role's material (restored when the option changes). Requests a render with shadows |
| `setRoof(on)` | `visible` of every node with `userData.toggle === "roof"` (by node, not by material); PV modules follow through the page |
| `setFurniture(on)`, `loadFurniture()` | furniture GLB loaded once (retry by calling again), added to `root`, nodes with `toggle: "furniture"` follow the switch; pieces lower than `furnitureShadowMinHeight` and glass, chrome, mirror, screen parts cast no shadow, none at all on "low"; furniture is cut by the section plane, gets the interior fill, never blocks the sun and is not ground; on "low" the meshes of one material are merged (194 draw calls become 46; `TierSettings.mergeFurniture`). `furnitureState`: `idle`, `loading`, `ready`, `error` |
| `setCut(h)` | one horizontal plane (`Plane((0,-1,0), h)`); everything of the house, furniture and add-ons above `h` disappears **including its shadow** (`clipShadows`), so the sun lights the cut rooms. Terrain, plants and surroundings are not cut. `null`, or a height at or above the ridge (`normalizeCut`), is no cut. About 1.2 m gives a plan in 3D |
| `setLabels(on)`, `relabel(fn)` | CSS2D tags `<div class="room-tag"><b>title</b><span>detail</span></div>` at 1.1 m above the floor, positioned at `room.label`, ordered by area. While the camera moves, a tag is shown only if it does not overlap one already shown (big rooms win; the tag size is measured after its first display, until then 72 x 34 px). Text comes from `formatTag(room)` |
| `setBoundary(on)` | dashed polyline along the plot ring, on the ground |
| `setVegetation(on)` | built on the first `true` (asynchronously, does not block the first frame); `vegetationState` |
| `setDayOfYear(n)` | leaf state of deciduous trees |
| `adopt(object)` | parents an add-on to `root`, gives all its materials `clippingPlanes` + `clipShadows` and the interior fill. **Everything built from `ctx` that is added later goes through `adopt`**; there is no watcher of children |
| `occluders`, `ground` | for ray casting (sun analysis, planting); fixed at build time |
| `subscribe(listener)` | `furniture`, `vegetation` and `look` events (hints in the UI) |
| `dispose()` | removes and frees everything built; idempotent |

React StrictMode mounts twice: the page's effect must `dispose()` what a cancelled build produced (the `signal` does that).

## 7. Ground, surroundings, plants

### 7.1 `terrain.ts`

One ground for the web, the print model and the walk: the kernel `ctx.site.terrain` (`groundAt`, `grid`, `gridToMesh`, docs/SITE.md section 3).

* `terrainGeometry(ctx, step)` (pure, tested): a lattice over `site.bounds` of at most `step` metres (the cell is adjusted so the lattice ends exactly on the
  bounds; the kernel `grid()` would stop short), heights `groundAt - TERRAIN_DROP * plateauWeight`, normals from central differences, converted to the scene frame,
  so the GLB floors, paving and plinth (at the plateau level) win the depth test; outside the plateau the mesh is the analytic ground. Texture coordinates are 0..1
  over the bounds (u east, v north).
* `groundLayers(ctx)` (pure, tested): the shapes painted into **one** canvas texture (`groundTexture` px; lawn over the domain, field, neighbour plots, street verge
  and carriageway with centre line, beds by kind, `site.paved` by `surface`, driveway and walkway aprons, the plot edge). Colours: `style.materials` / `style.generated`
  through `GROUND_ROLE_FALLBACK`. One draw call, no z-fighting, repainted on a scheme change.
* `paintGround(ctx, canvas, bounds)` paints the layers (with a fine speckle over the lawn); `TerrainScene.repaint()` repeats it.
* `TerrainScene.groundAt(x, y)` is the kernel function; nothing ray-casts the terrain mesh for heights.

### 7.2 `surroundings.ts`

Neighbour houses from `site.neighbours[].house` (box walls on the local ground, roof `hip | gable | flat` with pitch and overhang), fences from `ctx.layout.fences`
(segments after the gate openings, by `kind`). Cheap flat-shaded meshes; they receive and cast shadows on "high".

### 7.3 `vegetation.ts`

Trees, shrubs and hedges from the site, procedural and instanced (one draw call per kind: foliage blobs, leaf cards, bark, hedges), standing on the analytic ground
(no ray casting). Low-poly style: a crown is a handful of ellipsoids (`treeBlobs`, flat-shaded icosahedra) covered with alpha-tested leaf cards; the crown shape follows
the data (`crownShape(evergreen, height, crown)`: rounded, conical, columnar above `COLUMNAR_RATIO`), never the species name; a trunk and a branch to every blob stay
visible when the tree is bare. Invariant (tested): every blob lies inside the crown cylinder given by crown diameter, crown base and height. Hedges are boxes cut into
pieces of 1.5 m along `site.hedges[].path`, with cards over the top and sides. Colours: `style.generated.foliage_tree / foliage_shrub / bark`, else the lawn colour
darkened. Variation per plant is seeded by its position (`seedAt`), so the same plant looks the same wherever it sits in the list.

`setDayOfYear(n)` scales the foliage of deciduous plants with `leafFactor` of the sun analysis (a bare tree shows trunk and branches; a hedge keeps `cbrt(leafOff / leafOn)`
of its size). Cards use alpha test with the mip-level alpha boost (so distant canopies do not thin out), `alphaToCoverage` only with MSAA ("low"); their texture goes to the
GPU as raw data whose transparent texels carry the leaf colour (a canvas texture gives dark fringes). "low" draws `vegetationDensity` (40 %) of the cards and no
card shadows. Optional `tree.glb` / `shrub.glb` in the manifest are not used yet.

## 8. Movable shading and photovoltaics

All three are built with `(viewer, house)`, add themselves with `house.adopt`, request renders on every change and report **occluders** for the sun analysis.

### 8.1 Slat screens (`blinds.ts`)

`buildSlatScreens(viewer, house)`: the free-standing slat screens (`derived.screens`, `shading.slats`). The static GLB meshes (`role: "screen_slats"`, `userData.id` = screen id)
are hidden and replaced by instanced movable slats whose vertical extent is taken from the bounding box of the static mesh with the same id. `setAngle(0..90)` turns
every slat about its vertical axis (0: the broad face, the larger of `width` and `depth`, towards the viewer, the most cover; 90: edge-on, the thinnest side), `setSlide(0..1)` slides the slats towards the `to` end of the screen (0 spread, 1 stacked).

### 8.2 Exterior blinds (`extBlinds.ts`)

One section per opening with `blind: true`, split into equal parts above `EXT_BLIND_SPEC.maxSectionWidth`; `blindSections(ctx)` (pure, tested) derives origin, direction and normal from the
opening and the thickness of its wall; `origin` lies on the **outer face** of the wall (on the outline of the building). The curtain, the rails and the head box are drawn in the reveal,
`EXT_BLIND_SPEC.reveal` (0.051 m) **behind** that face, so the blind never stands in front of the facade at any tilt (and stays in front of the glazing frame, which the pipeline sets back
0.1 m; both are tests, one reads `pipeline/blender/hb/params.py`). The head box (`house.shading.blinds.boxHeight` high) sits in the wall above the opening and is hidden; with the blind raised only the
guide rails show. `setDrop(0..1)`, `setTilt(0..90)` (0 horizontal and open, 90 closed; the outer edge goes down). One `InstancedMesh` of slats; beyond `lodDistanceFactor` times the building diagonal
from its centre a flat curtain with an alpha-map stripe pattern replaces the slats (the engine registers `lod` with the viewer's frame loop). Occluders: slats and packs while lowered.

### 8.3 PV and battery (`pv.ts`)

`PvConfig = { panels: PvPanel[]; batteryKWh }`. `buildPv(viewer, house, config)`: one instanced box per module, corners from the kernel panel, lifted along the roof face
normal, cell texture painted in a canvas. Battery: `batteryModules(ctx, kWh)` modules of `batteryModuleKWh(ctx)` (the smallest real battery option) stacked on the stretch of
a wall of the room with `role: "plant"` returned by `batteryMount(ctx)`, inverter above, conduits. `readPvConfig(ctx)` composes `calc/roofLayout` and `calc/storageKeys` (recipe in the file);
`defaultPvConfig(ctx)` is the model's own layout and default battery. `setPanelsVisible` follows the roof switch, the battery stays.

## 9. Walk (`walkCollision.ts`, `walk.ts`)

* **Colliders** (pure, `buildWalkColliders(ctx, footprints)`): wall bodies (`wallBody`) split at the openings whose `kind` is in `PASSABLE_KINDS` (door, entry, slider), windows and garage
  doors solid; furniture boxes from `furniture-footprints.json`. A test floods the plan on a 3 cm grid and requires that every room and the terrace are reachable with and without furniture,
  that no step crosses a wall at 5 fps while running, and that every furniture box is solid.
* **Controller** `startWalk(viewer, house, container, { labels, onExit })`: WASD / arrows (Shift runs), drag to look (one pointer, tracked by id), joystick for `(any-pointer: coarse)`,
  normalised diagonal speed, eye height and speeds in `WALK`, floor 0 inside the outline else `groundAt`. Keys only while the container has focus and no form field has. Start:
  `walkStart(ctx)`: the room with `role: "entry"`, at its label point, looking into the house. Esc or `stop()` restores camera, target and fov.
* `slide` and `move` are the circle-vs-segment sliding with sub-steps of at most `WALK.maxStep`; `collidersAt` takes the callback form `move(p, d, (q) => collidersAt(...))`.
* The camera looks along house azimuth `yaw` (rotation `-yaw` about +Y); dragging right turns the view right. The joystick is `div.joy` with `role="application"`; `.stage[data-walking]` is set while walking.

## 10. Sun analysis (`sunAnalysis.ts`)

`makeSunAnalyzer(viewer, house, opts?)` returns a `SunAnalyzer`: hours of direct sun per room, per terrace and covered outdoor area, and a time series, all from
`derived` (windows: `glazingArea > 0` and `room`; areas: `derived.outdoor`). The calc side (astronomy, the analytic oracle) is in `docs/CALC-API.md`, section 4.1.

| member | meaning |
|---|---|
| `day(date, step = 10, shades = [])` | a `SunDayResult` for one calendar day (months 0-based): the sampled instants above the horizon (`times`, `altitude`, `azimuthTrue`) and a `SunSeries {hours, fraction[]}` per room (`rooms`), per area with the movable shading as set (`outdoors`) and without it (`outdoorsOpen`, memoised per day because it does not depend on the shades). Synchronous, some tens of milliseconds. `shades` are the movable occluders in their current state (`SlatScreens.occluders()`, `ExtBlinds.occluders()`) |
| `dayAsync(date, step, shades, {signal, sliceMs = 8})` | the same result computed in slices of a few milliseconds that yield to the event loop, so sliders and scrolling stay smooth on phones; resolves `null` when the `AbortSignal` fires (abort before changing the shades). No web worker: the scene, its BVHs and the instance matrices of the blinds live on the main thread, and copying them would cost more memory and start-up time than slicing costs in latency |
| `windows`, `areas` | what is sampled (`SampledWindow`: opening id, room id, outward normal and sample points in the scene frame; `SampledArea`: area id and points), for tests and debugging |
| `terrainHorizon(azimuthTrue)` | elevation in degrees of the terrain horizon seen from the house in a true azimuth (negative: the ground falls away). The analytic ground is marched once per direction and the sun below it lights nothing |
| `blockers(origin, direction)` | debugging: every static house mesh a ray meets (its nearest hit), nearest first, with `role`, `id` and `name` |

Options (`SunAnalyzerOptions`): `sunPosition` (a function `(date, minuteOfDay) -> {azimuth, altitude}`; the default is `calc/sun` for `placeOf(house)`, tests inject their own), `surroundings`
(neighbours, trees, hedges and fences count, default true), `terrain` (the terrain is a horizon, default true) and `cull` (test only the surrounding solids that can touch the bundle of rays of one
instant; the result is the same, just faster).

Samples: a 3 x 6 grid per window in the glass plane (`GLASS_DEPTH` behind the outer face, where the Blender builder puts the glass; a window's value is the sunlit share of its glass, so a low
strip lit under a deep overhang counts in proportion instead of rounding to zero), 5 x 3 per area at 0.45 m above its floor; the ray starts 3 cm along the normal. **An opening counts only
while the sun is in front of its wall** (`dot(sun, outward normal) > 0`, the same test as the analytic oracle `calc/sun.sunHoursOnSurface`; at grazing angles the reveal and the wall shade the
sample anyway). Occluders: `house.occluders`, the `shades` passed in, and the surroundings as analytic solids with leaf-dependent transmittance (kernel `rayTransmittance`); each sample's value
is its transmittance (0 to 1). The static house is cast with the BVH of `three-mesh-bvh`; the movable slats (hundreds of instances) go through a small AABB index built once per call. A day is about
70 sunlit instants times 100 rays. `sunHoursOnSurface` is the upper bound used as the test oracle (a window with nothing in front gets exactly that; with the roof overhang at most that).

## 11. React: `Stage` (`src/components/three/Stage.tsx`)

```tsx
<Stage labels={stageLabels(t)} extent="plot" backdrop="stage" initialView={…}
       build={{ look, formatTag, labels: false }}
       onReady={(h) => { handle.current = h; … }} onDispose={() => { handle.current = null; }}>
  {/* overlay controls: view mode, walk button, hints */}
</Stage>
```

* Owns: the container (`.stage`, sized by CSS, `height: min(74svh, 780px)`-style rules live in the page CSS), `ResizeObserver` (inside the viewer), tier detection, the build, cleanup.
  States (`data-status`): `loading` (message with progress via `labels.progress(percent)`), `ready`, `error` (message + **retry** rebuilds, no page reload), `lost` (message + **restore** rebuilds),
  `unsupported` (no WebGL; the page may show a render instead). Messages are `role="status"` + `aria-live="polite"`.
* Calls `onReady(handle)` after the first frame and again after a rebuild; `onDispose(handle)` before the viewer goes away. The handle `{ ctx, viewer, house }` is the only way for the page
  to reach the engine; pages keep it in a ref and apply their React state in effects keyed on a "ready" flag.
* Texts: `StageLabels` (`loading`, `progress(percent)`, `error`, `retry`, `lost`, `restore`, `unsupported`, `canvas`, `compass(heading)`, `north`) come from the page's namespace (`<ns>.stage.*`).
* DOM hooks for CSS and Playwright: `.stage[data-status]`, `canvas.gl`, `.gl-labels`, `.room-tag`, `.stage-msg`, `.compass`, `.joy`, `.stage[data-walking]`.
* StrictMode: the effect creates the viewer and the build with an `AbortController`; cleanup aborts and disposes whatever a late build produced.
* CSS: `src/styles/components/stage.css`, imported by `Stage.tsx` (so it only reaches the Model and Sun routes): the canvas, `.room-tag`, `.compass`, `.stage-msg`, `.joy`, tokens only, `svh` default height
  (`:where(.stage)`, so the page overrides it), 44 px buttons (the shared `.btn`), `env(safe-area-inset-*)` for the compass and the joystick (the joystick lifts above the page's hint line), `touch-action: none` on the canvas,
  `prefers-reduced-motion` honoured.
* The WebGL probe (`webgl.ts`) runs before the 3D chunk is loaded; an unsupported browser never fetches three.js. In development `window.__stage` holds the current handle (for manual checks and e2e).

### 11.1 Recipe: Model page

1. `const ctx = getHouseContext()`; chips from `webViews(ctx.house.cameras)`.
2. `<Stage …>`; `onReady` stores the handle and applies the stored switches (`STORAGE_KEYS.model`) and look (`STORAGE_KEYS.look`) after mount.
3. Switches call `house.setRoof/…`; sun time calls `viewer.setSun(az, alt)` with `calc/sun` for the date and `placeOf(house)`.
4. Equipment: `buildExtBlinds(viewer, house)`, `buildPv(viewer, house, readPvConfig(ctx))`, `buildSlatScreens(viewer, house)` after `onReady`; dispose them in `onDispose`.
5. Walk: `startWalk(viewer, house, containerElement, { labels, onExit })`.

### 11.2 Recipe: Sun page

Same stage with `extent="house"`, `backdrop="sky"`, no furniture switch; `makeSunAnalyzer`, `viewer.setSun` per slider, `house.setDayOfYear`.

## 12. Tests (vitest, node; three.js objects are created without a GL context)

| file | what |
|---|---|
| `frame`, `views`, `style`, `context`, `glb`, `pv`, `walkCollision` `.test.ts` | frames and sun direction, views and orbit limits, looks, contract of the committed GLBs and manifest, PV helpers, circle sliding |
| `terrain.test.ts` | the lattice covers the bounds; heights equal `groundAt` outside the plateau and `level - drop` inside; normals against a finite-difference oracle; counter-clockwise triangles; texture coordinates; layer order, beds and paved areas from the data, a colour for every role |
| `meshBuilder.test.ts`, `surroundings.test.ts` | closed solids with outward faces (signed volume), neighbour roofs (eave, ridge, kind), plot containment, fence pieces |
| `extBlinds.test.ts` | sections exist for exactly the blinded openings, tile the width, lie on the outer face and on the outline, face away from the building; the curtain stays 1 cm behind the facade at every tilt and in front of the frame set-back (reads the pipeline parameter) |
| `blinds.test.ts`, `orbit.test.ts` | slat positions (spread, stacked), spherical arithmetic, heading under orbiting, clamps, easing |
| `interior.test.ts` | region and shade boxes from the data, `contains` against brute-force point-in-polygon, idempotent patch that keeps an existing hook, transparent and non-standard materials untouched, daylight, capacity |
| `vegetation.test.ts` | seeded random numbers, crown shapes from the data, blobs inside the crown cylinder for every tree of the plot |
| `pv.test.ts` | module frames against the roof face normals (independent), size and containment of every module, battery mount (inside the plant room, free of openings and furniture) |
| `walkColliders.test.ts` | gaps at every passable opening, windows and garage doors solid, no tunnelling at 5 fps while running, every room and the terrace reachable by flood fill with and without furniture, furniture solid, start pose |
| `contract.test.ts` | `checkHouseContract` on scenes built from the real GLB JSON and on each violation, progress groups, loading failures are `GlbError`s |
| `imports.test.ts` | three.js is imported only by the engine, its shell and the Model and Sun components; the pure modules import no three.js |
| `sunAnalysis.test.ts` | sample grids from the data (glass plane, 3 x 6 per window, 5 x 3 per area); the open scene against `calc/sun.sunHoursOnSurface`; overhang strips counted in proportion; obstacles, shades, surroundings and terrain never add sun; `blockers`; the box prefilter and the culling give exactly the result of plain ray casting; `dayAsync` equals `day` and can be aborted; days with 23 and 25 hours |
| e2e (Playwright, `e2e/`) | `.stage[data-status="ready"]`, `canvas.gl` non-blank, context-loss overlay, 3D navigation Model <-> Sun without heap growth (checked by hand: the heap stays flat over repeated navigation, the old context is lost), walk and joystick |

Visual checks need WebGL: use the browser screenshot script (`scripts/shot.mjs`) against the dev server; check desktop 1440, iPhone 15 and SE, dark mode.

## 13. Performance and robustness budgets

* First paint of the page shell does not wait for three.js (dynamic import); the model appears progressively (progress shown).
* "low": at most about 150 draw calls (furniture lite is merged per material, instanced plants and blinds), no composer, one 2048 shadow map, textures 512 px.
* Resize: `ResizeObserver` on the container only; pixel ratio capped; composer and AO resized with it.
* Memory: dispose everything on unmount; release Draco workers after idle; no module-level caches of scenes; textures created from canvases are disposed.
* Hidden or off-screen stages do no work. The walk and LOD pause with them.
* A GLB that violates the contract fails loudly in development and tests and degrades with a console warning in production.

## 14. Integration with shared files

1. `model/style.json` may have an **optional** section `generated` (roles `pv_cell`, `pv_frame`, `blind_slat`, `blind_rail`, `battery_case`, `battery_trim`, `battery_led`, `bark`, `foliage_tree`, `foliage_shrub`, `asphalt`, `field`, `kerb`, `fence_wood`, `fence_plinth`, `fence_mesh`, `neighbour_wall`, `neighbour_roof`), same shape as `materials`, no orange. It is not part of `materials`, so `style.test.ts` is unaffected. The shipped file has none: `generatedMaterial` derives each colour from a named style role, and the engine works without the section.
2. `next.config.ts` serves `/models/*.glb|json` with `Cache-Control: public, max-age=31536000, immutable` (URLs carry the content hash), `/draco/*` for one day and `*.usdz` for one hour with the USDZ media type.
3. `ASSETS.md` has the entry for the Draco decoder (Google Draco, Apache-2.0, copied from three.js r169 `examples/jsm/libs/draco/gltf`).
4. `scripts/check-bundles.mjs` finds three.js by its renderer signature and fails when a page other than Model and Sun loads a chunk that carries it (three-mesh-bvh and n8ao are bundled with it); `Stage.tsx` imported by another page would break it, and `imports.test.ts` guards the source.
5. `calc/sun.ts` `sunDirection` and `frame.ts` `sunDirectionHouse` are the same formula; a test compares them.
6. Cameras are data (`house.cameras`, `use: "web"`), never engine code.

## 15. Changes since the first design (all backward compatible)

* `Viewer.setFog(near, far)`, `Viewer.extent`, `ViewerOptions.groundColor` (the lawn colour of the style, for the light bounced from the ground).
* `LoadOptions.tier` (sets the number of Draco workers when the decoder is created); `loadHouseGltf` / `loadFurnitureGltf` pass it. `extrasOf(node)` (extras of a mesh or its parent group).
* `TierSettings.mergeFurniture`; `Tier`, `TIER_SETTINGS`, `detectTier` now live in `tier.ts` (re-exported by `viewer.ts`) so the asset layer and tests need no three.js. `isWebGlAvailable` lives in `webgl.ts` (re-exported).
* `TerrainGeometryData.uvs` are 0..1 over the bounds; `bounds` equal the site bounds exactly. `paintGround`, `neighbourMeshes`, `treeBlobs`, `crownShape`, `moduleFrame`, `slatPositions`, `slatHeights`, `BATTERY_SPEC`, `PV_SPEC`, `EXT_BLIND_SPEC.reveal` are exported for tests.
* Tone mapping is Neutral instead of AgX (section 4). The exterior blind sits in the reveal behind the facade (section 8.2). Slat screen angle 0 is the broad face (section 8.1).
* `Stage` sets `window.__stage` outside production. `stub.ts` is gone.
