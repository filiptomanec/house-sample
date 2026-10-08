# 3D engine API (`src/lib/three`, `src/components/three`)

The 3D engine turns the data model into the interactive scene of the **Model** and **Sun** pages: the house from the GLB, the
plot with its fence, gates and pool, plants, movable shading, the garage door, photovoltaics, the sun path, a walk mode and a
ray-cast sun analysis. It is data driven like everything else (`docs/ARCHITECTURE.md`): no number of the house and no id appears in
the engine; geometry that is not in the GLB is generated from `derive()` and `model/site.json`.

**Status (R2).** Everything below is implemented and tested (`src/lib/three/*.test.ts`, about 255 tests: pure geometry, invariants of
the model, independent oracles; no GL context needed) and checked on the Model and Sun pages in Chromium and WebKit (desktop 1440,
iPhone 15, light and dark scheme) with the screenshot and pixel probes described in section 12.

| module | content |
|---|---|
| `frame.ts`, `views.ts`, `style.ts`, `context.ts` | frames and sun direction, camera presets, aspect-aware fitting, orbit limits and shadow range, materials and looks, the `HouseContext` |
| `tier.ts`, `webgl.ts`, `theme.ts`, `orbit.ts` | tiers and their settings, the WebGL probe, design tokens and colour scheme, keyboard orbit and easing: **no three.js** |
| `glb.ts` | manifest, URLs, node contract, loaders with the shared Draco decoder, contract check, progress groups |
| `viewer.ts`, `sky.ts` | renderer, camera, lights, the sun-driven sky dome (AgX), the render-on-demand loop |
| `interior.ts` | the interior light of the rooms (shader patch) |
| `house.ts`, `outdoor.ts`, `merge.ts`, `roomTags.ts`, `furniture.ts` | the house scene, outdoor slabs and the pool where the GLB lacks them, merging static meshes, room tags (CSS2D), preparing the furniture GLB |
| `terrain.ts`, `surroundings.ts`, `vegetation.ts`, `meshBuilder.ts` | ground and horizon, neighbours, fence, gates, pillar, bins and kerb, plants, a small mesh builder |
| `blinds.ts`, `extBlinds.ts`, `garageDoor.ts`, `pv.ts` | the louvre wall (rotation only), exterior blinds, the garage door, PV and battery |
| `sunPath.ts` | the sun path in the scene (Sun page) |
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
4. **No user-visible text.** Strings come in as options (`StageLabels`, `formatTag`, `WalkLabels.joystick`, canvas `ariaLabel`,
   `SunPathOptions.formatHour`). Pages take them from their own i18n namespace; numbers are formatted by the page.
5. **No colour literals except data.** Colours come from `model/style.json` (materials, looks, `generated`) and from the design
   tokens (`readToken("--sky-day-top")` ...). **The sky does not depend on the colour scheme**: its tokens are written once in
   `tokens.css` (`--sky-*`, the same in light and dark mode), so a dark page shows the same daylight as a light one.
6. **Phones are first class.** Tier "low": lite GLBs, one 2048 px shadow map, context MSAA instead of post-processing, pixel ratio
   at most 1.5, half-resolution terrain, 40 % of the foliage cards, merged static meshes, no furniture shadows, render on demand,
   no work off screen. Budget: at most 150 draw calls on /model (106 measured with the furniture, iPhone 15).
7. **Failures are values.** Every load failure is a `GlbError` (kind `network | parse | contract | aborted`); a missing WebGL is
   `WebGlUnavailableError`; the UI turns them into a message with a retry button. No unhandled rejection, no blank canvas.
8. **Accessible.** The canvas is `role="img"` with a name, the container takes focus and understands the keyboard (arrows orbit,
   `+`/`-` zoom, Home resets the view), status changes are announced (`role="status"`), controls are real buttons of 44 px on coarse
   pointers, `prefers-reduced-motion` turns off transitions, damping and the garage-door easing. The sun disc is decorative; the
   page's time slider stays the accessible control.
9. **three.js only on `/model` and `/sun`.** Import runtime code only from those routes' components; types come from
   `@/lib/three` (type-only barrel). Import addons by path (`three/addons/...`). `Stage` loads the engine with `import()` in its
   effect, so the page shell paints before three.js arrives; `sunPath.ts`, `garageDoor.ts` and `tree.glb` load inside those chunks.

## 2. Data in: `HouseContext`

```ts
import { getHouseContext } from "@/lib/three/context";       // the project's house, built once, read-only
const ctx = getHouseContext();
// { house, derived, site, layout, style, bearingDeg }
```

| field | meaning |
|---|---|
| `house`, `derived` | kernel data (`@/lib/model/instance`), docs/KERNEL-API.md |
| `site` | `createSite(model/site.json, bearing, house.outdoor)`: plot ring, **graded** terrain (`groundAt` follows the drive and path ramps and stays below every slab), zones (field, neighbours, street with `pavement` and `green`), validation (docs/SITE.md) |
| `layout` | `site.withHouse(house.outdoor)`: access (aprons, dropped kerbs `driveKerb`, `walkKerb`), resolved `fences` (parts, posts, slat spec, gaps), `gates` (posts, leaf, park span or swing arc), `pillars`, analytic `occluders()` |
| `style` | `model/style.json` (`StyleModel`): materials, looks, `generated` (colours of what code builds), `lawnColors` (render grass) |
| `bearingDeg` | true azimuth of the house +y axis |

`createHouseContext({ house, derived, site, style })` builds one from explicit parts (tests with a changed model).
`sceneExtent(ctx, "plot" | "house")` is the sphere the camera may look at; orbit limits come from it (`orbitLimitsFor`).

### 2.1 Frames and the sun (`frame.ts`)

| function | use |
|---|---|
| `toScene([x,y,z])`, `fromScene(...)` | house frame <-> scene frame |
| `sunDirectionHouse(azTrue, alt, bearing)`, `sunDirectionScene(...)` | unit vector towards the sun (same formula as docs/KERNEL-API.md 4.4) |
| `headingTrue(dirScene, bearing)` | compass heading of a viewing direction |
| `houseAzimuth`, `trueAzimuth`, `mod360`, `outwardNormalHouse(az)`, `dot3` | helpers |

### 2.2 Cameras, fitting, limits (`views.ts`, pure)

Both 3D pages share one recipe:

| function | use |
|---|---|
| `pageViews(ctx, "model" \| "sun")` | the presets of a page in model order: `derived.cameras` (z resolved from `aboveGround`) with `use` "web" (Model) or "sun" (Sun); the orthographic top view refitted to `TOP_VIEW_FOV` (20°, `refitLens`) |
| `defaultView(views, narrow)` | the camera marked `defaultFor: ["narrow"]` on phones, else the one with `default`, else the first. Read after mount (SSR renders the default) |
| `pageExtent(ctx, page)`, `pageLimits(ctx, page)` | the page's extent (plot / house) and its orbit limits, widened so every preset fitted at every supported aspect (`FIT_ASPECTS` 0.75, 1, 1.45) is reachable |
| `fitView(view, aspect, fitContextOf(ctx))` | aspect-aware fit (below) |
| `shadowRangeFor(extent, ctx)` | half-width of the sun's shadow frustum: the extent × `SHADOW_MARGIN`, and at least the farthest site occluder (tree crown edge, neighbour corner, fence) + `SHADOW_OCCLUDER_MARGIN` (2 m), so what the analysis counts also casts its shadow |
| `resolveView`, `camerasFor`, `refitLens`, `orbitLimitsFor`, `limitsForViews` | the parts; `webViews(house.cameras)` remains for old callers (stored z, no refit) |

**Fitting.** A preset was composed for a 16:10 stage (`DESIGN_ASPECT`). On a narrower stage `fitView` keeps the design's horizontal
coverage: it **widens the vertical field of view first** (up to `FOV_MAX` = 78°; the orthographic stand-in never widens), then moves
the camera back along its line of sight by whatever is still missing, **only where that is safe**: an elevated view (at least
`ELEVATED_MIN` = 4 m above the ground, or the top view) may move freely; an eye-level view only while it stays on its own side of
the plot boundary, out of the building and inside the domain (largest free part of the way by bisection). Without a fit context
nothing moves. Tested: every view that shows the whole house at 16:10 still shows it at 0.75, 1 and 1.45 (or its lens is at
`FOV_MAX` and the way back is blocked); every fitted preset is within `pageLimits`.

## 3. The GLB contract (`glb.ts`, docs/ARCHITECTURE.md section 3)

Files in `public/models/` are described by `manifest.json`, which is **bundled** with the code (`MODEL_MANIFEST`), so the URL of a
file and the file always belong together. `modelUrl("house.glb")` is `/models/house.glb?v=<first 12 hex of the file's sha256>`;
serve `/models/*` with `Cache-Control: public, max-age=31536000, immutable`. `manifest.files[...].bbox` is in the **house frame**.
Optional: `tree.glb` (the baked CC0 tree, section 7.3).

Tests (`glb.test.ts`) read the committed GLBs and check the contract: glTF 2 with Draco, no transform nodes, every mesh has
`extras.role` equal to its material name (one material per role, no `.001` suffix), known roles, only known toggles, roof parts carry
`toggle: "roof"`, lite and full files have the same nodes, furniture has one root `furniture` and `toggle: "furniture"` + `roomId` on every mesh,
sizes and hashes match the manifest, budgets (house <= 7 MB, lite <= 2.5 MB and <= 70 k triangles, furniture lite <= 0.6 MB).

### 3.1 Nodes

three.js copies glTF `extras` to `object.userData`:

| file | `userData` | meaning |
|---|---|---|
| house | `role` | material role (`HOUSE_ROLES`, contract C2: since R2 also `deck`, `pool_coping`, `pool_liner`, `water`, `garage_door`, `screen_rail`, `equipment`); equals the material name |
| house | `toggle?: "roof"` | hidden by the Roof switch (`roof_tile`, `ridge_cap`, `fascia`, `gutter`, `soffit`, `ceiling`) |
| house | `id?` | id of the room, opening, outdoor area, screen or cladding strip (join key into `derived`: `screen_slats` / `screen_rail` carry the screen id, `garage_door` the opening id) |
| furniture | `role`, `toggle: "furniture"`, `roomId` | material `f_*` (interior) or `t_*` (terrace); `roomId` is the room id with `.`/`-` normalised to `_`, or `terrace` |

Role helpers: `isGroundRole(role)` (floors, paving, path, gravel, slab, deck, pool coping: where a person can stand),
`isOccluderRole(role)` (everything except glass, water and the louvre blades, which `blinds.ts` replaces by movable ones).
`checkHouseContract(root)` verifies the contract on a loaded scene (warns in production, throws in development and tests).

### 3.2 Loading

`loadGltf(file, { onProgress, signal, tier })` fetches and parses with one shared `DRACOLoader` (`DRACO_PATH`, workers per tier,
released after `idleDecoderMs`). Progress is bytes loaded over the **manifest** size; `createProgressGroup(files, onChange)` weights
several files into one fraction. `loadHouseGltf(tier)`, `loadFurnitureGltf(tier)`, `loadFootprints()` (`furniture-footprints.json`).

### 3.3 Materials and looks (`style.ts`)

* Materials are created from `style.materials[role]`: `color`, `roughness`, `metallic`, `alpha`. The glTF material is replaced, so
  the scene always matches the style used for renders; the GLB's textures (neutral) are kept and tinted by `color`.
* **Looks**: `resolveLook(style, selection)` returns the colours per role and the role `substitutions`. The fence and gate boards
  follow the timber of the house (`fence_wood` when a look takes the timber away); posts stay graphite in every look.
* **Generated parts** use `style.generated[role]` (shipped since R2: `field`, `neighbour`, `verge`, `pavement`, `carriageway`, `kerb`,
  `foliage_tree`, `foliage_shrub`, `bark`, `neighbour_wall`, `neighbour_roof`, `fence_wood`, `fence_post`, `fence_plinth`), else a colour
  derived from a named style role (`generatedMaterial(style, role, fallbackRole)`).

### 3.4 What is generated in JS (not in the GLB)

Terrain and painted ground (with the pool hole), horizon and tree line, plot boundary, neighbours, the slat fence, gates, pillar,
bins and kerb, trees and shrubs, exterior blinds, the movable louvre blades, PV modules and battery, room tags, the sun path, and
(while the GLB is older than the model) the outdoor slabs and the pool (`outdoor.ts`). The Blender builder may add some of them for
renders only, never for the web GLB.

## 4. The viewer (`viewer.ts`, `sky.ts`)

```ts
const viewer = createViewer(container, { bearingDeg: ctx.bearingDeg, extent: pageExtent(ctx, page), initialView, labels: true, ariaLabel, onContextLost });
await viewer.fit(defaultView(views, narrow)!);         // fitted to the canvas aspect; refitted on resize while untouched
```

`createViewer` throws `WebGlUnavailableError` without WebGL2. One viewer per container. The canvas has class `gl`, the label layer `gl-labels`.

| topic | rule |
|---|---|
| tiers | `detectTier()` (iOS, coarse pointer with a small screen, `deviceMemory` < 4 give "low"; the server gives "low"). Values in `TIER_SETTINGS` |
| render on demand | a frame is drawn only after `requestRender()`, a controls change, a resize, a sun change or a context restore. Frame callbacks (`onFrame`, walk, LOD, garage door) do not run while the container is off screen (IntersectionObserver, margin 100 px) or the document is hidden |
| shadows | `shadowMap.autoUpdate = false`; redrawn on `requestRender()` without `{ shadows: false }` and on `setSun`. Sun shadow: `PCFSoftShadowMap`, orthographic frustum of half-width `shadowRange` (the house scene sets `shadowRangeFor(extent, ctx)`), `bias` -0.0003, `normalBias` 0.04 |
| tone mapping | **AgX** (as the Cycles renders), `EXPOSURE` 1.15 (sunlit ivory plaster about L* 88-92, no clipping at a low winter sun), sRGB output, `localClippingEnabled` for the section cut. Switched only after the interior and shade fills were neutralised (section 5) |
| high tier | `EffectComposer` (modules and n8ao `import()`ed on the high tier only; the first frames are drawn without them): **N8AOPass** renders the scene into its beauty target, which is **multisampled** (`MSAA_SAMPLES` 4): thin roof seams, slats and fence boards stay continuous (no SMAA); then `OutputPass` (tone mapping). AO radius and intensity ease between outdoors and the rooms |
| low tier | no composer; `antialias: true` on the context (MSAA); alpha-tested foliage uses `alphaToCoverage` only here |
| sky | **One sky function** drives the backdrop and the image-based light (`sky.ts`). `skyAt(altitude, palette)` blends the scheme-independent tokens night (< -12°) → dusk (-6°) → low sun (2°) → day (14°) and adds a warm-white glow (`--sky-glow`, never orange) around a low sun (fades out between 5° and 25°). The **backdrop** is a dome (`createSkyDome`) drawn at infinity behind everything, in radiance: `inverseAgx` (Newton on a JS copy of three's AgX, `agx`) gives the radiance that AgX at `EXPOSURE` turns into the token, so the screen shows the token on both tiers (the dome material includes the tone-mapping and colour-space chunks: it tone-maps itself on the low tier and is linear into the composer on the high tier). Gradient: log-space blend horizon → zenith over `sin(elevation)^SKY_GRADIENT` (0.8). Intensity `backdropIntensity(alt) = 0.3 + 0.7 smoothstep(alt, -6, 3)`: never dimmed while the sun is up. The **lighting dome** (`skyLight`: the token colours, the ground half = lawn reflectance × the irradiance of sun and sky on the ground) is baked into a PMREM environment, **re-baked only when the sun moved ≥ 2° in altitude or ≥ 5° in azimuth** (`needsRebake`), on a context restore, never per frame of "play the day". `backdrop: "stage"` is a deprecated alias of `"sky"` |
| fog | linear, in the colour of the dome's horizon (radiance before the output pass on the high tier, the display colour on the low tier, where three mixes fog after the tone-mapping chunk); the house scene starts it short of the distant tree line and completes it at 0.85 of the horizon ring |
| sun | `setSun(azTrue, altitude)`: `DirectionalLight` at 150 m along `sunDirectionScene`; intensity `SUN_LIGHT.intensity` (6.3) × `smoothstep(alt, -1, 6)`, colour `(1, 0.8 + 0.17 k, 0.62 + 0.3 k)` with `k = clamp(alt / 14, 0, 1)` (warm, not orange, at a low sun), hemisphere `0.08 + 0.04 d` with the hue of the sky and the ground, environment `ENV_GAIN` (0.35) × backdrop intensity, `d = smoothstep(alt, -8, 20)`; also the interior daylight |
| camera | one `PerspectiveCamera`; `OrbitControls` with damping 0.08 (off with reduced motion), `screenSpacePanning = false`, limits from `orbitLimitsFor(extent)` (pages pass `pageLimits`), the target is pulled back into the target box together with the camera |
| fit | `fit(view, aspect?, { animate })`: `fitView` with the viewer's fit context (`setFitContext`, set by the house scene), widens `maxDistance` when needed; while the camera stays on that preset a resize fits it again. `fitted(view, aspect?)` returns the fitted view without moving. `setView` moves exactly as given |
| interior view | every frame the fill of the rooms follows the camera: `interior.setView(1)` inside the building, `INTERIOR_VIEW_OUTSIDE` (0.3) outside, eased over `INTERIOR_VIEW_EASE` (0.3 s) |
| gestures | `setPanMode(false)`: left drag / one finger rotates, right drag / two fingers pan (two fingers also pinch-zoom). `true` swaps them |
| views | `setView(view, { animate })` eases position, target and fov over `transitionMs` (600), cancelled by the next call or by user input; no animation with reduced motion |
| keyboard | container `tabindex="0"`; arrows orbit 5 degrees, `+`/`-` zoom 10 %, Home fits the initial view again; only while the container itself has focus. Off while walking |
| compass | `heading()` and `onHeading(cb, 0.5)`: true heading of the camera, the callback fires only past the threshold |
| context loss | `webglcontextlost` is `preventDefault`ed, `contextLost` is set, drawing stops, `onContextLost(true)`; on restore the environment is baked again, the shadow map and the frame are marked dirty, `onContextLost(false)` |
| stats | `stats()`: draw calls and triangles of the last frame (all passes) |
| dispose | stops the loop, removes ResizeObserver, IntersectionObserver, scheme listener, key and pointer listeners, controls (**including OrbitControls' Control-key listeners on the document**, removed from the root node remembered at creation: React runs effect cleanups after detaching the container, and the leftover listener kept the whole viewer alive, about 3 MB per visit), composer and its passes, sky domes, PMREM, renderer and **`forceContextLoss()`**, removes canvas and label layer. Idempotent. Heap growth per round trip plan ↔ 3D page: below 1 MB after the first visit |
| snapshot | `snapshot()` draws and reads the canvas in the same task (no `preserveDrawingBuffer`) |

## 5. Interior light (`interior.ts`)

The sky environment has no occlusion, so rooms out of the sun would be dim and blue. `InteriorFill` (one per viewer, `viewer.interior`)
adds the light that bounces off walls and floors, keeps part of the sky IBL indoors, lets glossy surfaces reflect the room, and gives
a bounce under covered outdoor areas, all through an `onBeforeCompile` patch of standard materials.

* Region: `interiorRegionOf(ctx)`: the outline ring, mid-wall inset, from the underside of the slab to the ceiling. A **fixed-size uniform
  array** (`INTERIOR_MAX_VERTS` = 64) plus a count, so changing the outline never recompiles. `shadeBoxesOf(ctx)`: one box per covered
  outdoor area, up to the lowest roof surface over it.
* `setDaylight(altitude, sunHorizontal)`: `fill = INTERIOR_FILL.base + INTERIOR_FILL.day × smoothstep(alt, -8, 20)` (0.3 + 0.46 d), the tint
  `INTERIOR_FILL.tint` (1, 0.995, 0.99): **nearly neutral by day**, so white plaster and ceilings stay white under AgX (living preset at
  noon: ceiling HSL saturation about 5.7 %, at most 6 % by the plan); towards the night it warms by `warmNight` (lamps). Side light × 1.14,
  from above × 1.02, from below × 0.75; faces turned to the sun get up to 24 % more; 45 % of the diffuse IBL stays, 90 % of the specular is
  replaced by the room; 20 % darker towards the floor. Shade fill under covered areas `tint × 0.22 d`.
* `setView(t)` / `view`: the **interiorView** uniform scales only the light the fill adds (the viewer drives it from `contains(camera)`):
  from outside a room behind glass reads several times darker than the sunlit facade (garden view at 13:00 in June: glazing about 0.67 of
  the plaster beside it, at most 0.7 by the plan).
* `patch(material)` is idempotent, keeps an existing `onBeforeCompile`, sets `customProgramCacheKey`, ignores transparent materials.
  `contains(pointScene)` is the point-in-polygon test with the height range.

## 6. The house scene (`house.ts`, `outdoor.ts`, `merge.ts`)

```ts
const house = await buildHouse(viewer, ctx, { look, labels, formatTag, onProgress, signal });
```

`buildHouse` loads `house(-lite).glb` for the viewer's tier, checks the contract, replaces materials from the style, sets the interior
region and patches the materials, builds the outdoor fallback, merges static meshes on the low tier, builds the BVH, terrain,
surroundings and boundary, sets the viewer's fit context and shadow range (`shadowRangeFor(extent, ctx)`) and the fog, applies the
look and the switches, and after `furnitureDelayMs` (200) starts loading the furniture. It rejects with a `GlbError`; on `signal` abort
nothing stays in the scene.

* **Glass**: one shared transparent physical material with a **Fresnel** response (`patchFresnel`: opaque as its style alpha at normal
  incidence, a mirror at grazing angles; the reflection is not attenuated by the opacity), single pass (`forceSinglePass`), environment
  reflections at `HOUSE_SCENE.reflection` of the displayed sky.
* **Water** (role `water`, or the fallback): on the high tier a transparent physical surface with Fresnel and a static ripple normal map
  (metre texture coordinates, `rippleTile`); on phones an opaque, darker mint reflective surface (no transparency sorting). The terrain has
  a hole under every pool (`derived.groundVoids`, section 7.1); walk mode has a collider on the water (section 9).
* **Outdoor fallback** (`outdoor.ts`, pure planning + builder): areas whose id the GLB lacks are built from `derived.outdoor[]` (rect minus
  `holes`, tops on `grade.plane`, so the drive and path are ramps), and a pool missing from the GLB gets its coping ring, liner and water
  from `outdoor[].pool`. With a current GLB it builds nothing (`outdoorFallback`, `rectMinusRects`, `buildOutdoorFallback`).
* **Merging** (`merge.ts`, `TierSettings.mergeHouse`, low tier): the static meshes of one role, material and toggle become one mesh
  (`userData.ids` keeps the members' ids); meshes an add-on moves or hides by id stay apart (`HOUSE_KEEP_APART`: `screen_slats`,
  `garage_door`, `water`). The house GLB goes from 53 to about 22 draw calls on a phone.

| member | behaviour |
|---|---|
| `root`, `building` | `root` is a child of `viewer.scene` (no transform); `building` is the GLB content |
| `setLook(partial)` | recolours the role materials; substitutions swap materials; the fence boards follow the timber |
| `setRoof(on)` | `visible` of every node with `userData.toggle === "roof"` |
| `setFurniture(on)`, `loadFurniture()` | furniture GLB loaded once, merged per material on "low", cut by the section plane, interior fill, never an occluder, not ground. `furnitureState` |
| `setCut(h)` | one horizontal clipping plane with `clipShadows`; `null` or at/above the ridge is no cut. Terrain, plants and surroundings are not cut |
| `setLabels(on)`, `relabel(fn)` | CSS2D room tags from `formatTag(room)`, de-cluttered while the camera moves |
| `setBoundary(on)` | dashed polyline along the plot ring |
| `setVegetation(on)`, `setDayOfYear(n)` | plants built on the first `true` (asynchronously; the tree model may load), leaf state of deciduous plants |
| `adopt(object)` | parents an add-on to `root`, gives its materials the section plane and the interior fill |
| `occluders`, `ground` | for ray casting (sun analysis, planting); fixed at build time (a moved mesh, e.g. the garage door, is cast where it is) |
| `subscribe(listener)` | `furniture`, `vegetation` and `look` events |
| `dispose()` | removes and frees everything built; idempotent |

## 7. Ground, surroundings, plants

### 7.1 `terrain.ts`

* `terrainGeometry(ctx, step)` (pure): a lattice over `site.bounds` whose lines include the edges of every ground void (`latticeLines`),
  heights `groundAt - TERRAIN_DROP × plateauWeight` (the graded ground), normals from central differences; **the cells inside a void are
  left out**, so the pool basin is open and the hole matches the coping.
* `groundLayers(ctx)` (pure): the shapes painted into **one** canvas texture: lawn, field with stubble rows (`fieldRows`), neighbour plots,
  street (green verge, **pavement**, asphalt carriageway, kerb line, centre line), beds, `site.paved` by surface, the **outdoor slabs** of the
  house under their GLB slabs (`derived.outdoor[].role`, not the pool), the drive and walk aprons, and the plot edge **only where no fence
  covers it** (`uncoveredBoundary`: with the fence on every edge, nothing). Shapes wholly outside the domain are dropped.
* Detail (`patchGroundMaterial`, own shader code, no assets): world-space value noise (7 m and 1.6 m patches, a 0.13 m grain that fades with
  distance), soft **mowing stripes** (1.2 m bands along the house x axis) on the mown lawn of the plot, a canopy factor (`GROUND_DETAIL.canopy`)
  and, after the lighting, a saturation boost of **sunlit** grass only (`GROUND_DETAIL.saturation`, faded in between radiance `litFrom` and
  `litTo`): AgX desaturates bright mid greens, while grass in shade or at dusk keeps its own colour. Masks in a second small canvas
  (`paintGroundMasks`: red = mown lawn, green = natural ground). Sunlit lawn in the whole-plot view at 16:00: about `#7b9653`
  (plan: `#7c9459` ± 6 %).
* Horizon (`horizonGeometry`, `treeLine`, `HORIZON`): a ring of ground continues the domain to 900 m (the texture's edge colours smear
  outward; the first ring lies just under the terrain border), and a distant tree line (instanced blobs 150-250 m out, open where the street
  runs out); the fog dissolves both into the sky's horizon.
* `TerrainScene.groundAt(x, y)` is the kernel function; `repaint()` repaints texture and masks.

### 7.2 `surroundings.ts`

From `ctx.layout` (resolved by the kernel) and `ctx.site`, on the graded ground; about ten draw calls; shadows on "high" only.

* **Slat fence** (`kind: "slat_fence"`): posts as one `InstancedMesh` (the kernel's `posts`), a precast plinth and horizontal boards per span
  between posts (`fenceSpans`, `boardRows`: from the plinth up to the fence height, one slat pitch apart) whose edges follow the ground at
  each post (merged meshes). Vertical slats are supported. Legacy kinds (plinth, wood, mesh fence) still draw.
* **Gates**, closed (`gateLeaf`): a steel frame with the fence's boards; the sliding leaf runs on the plot side of the fence with its
  counterbalance tail, the swing leaf stands in the fence line; gate posts. Tested: the boundary is covered by fence parts except openings a
  gate or the pillar stands in; each closed leaf spans its opening post to post.
* **Pillar** beside the walk gate with its items on the street face (`PILLAR_LAYOUT`: meter box, mailbox, intercom, a backlit house-number
  plate without a number, a light; the plate and the light glow).
* **Bins** on the bin pad (`binsOnPads`: `site.paved` of kind `bins`, up to three wheelie bins along its longest edge).
* **Kerb** along the carriageway: full height (`street.kerbHeight`), **dropped** to `DROPPED_KERB_REVEAL` where the drive and the walk cross
  (`kerbPieces`).
* **Neighbour houses**: walls with a painted window pattern and a plinth band (texture coordinates in storeys and window pitches), hip,
  gable or flat roof, a chimney.

### 7.3 `vegetation.ts`

Trees and shrubs from the site, instanced (one draw call per kind), standing on the analytic ground.

* Procedural crowns read as one soft volume: smooth blobs (merged icosahedra with smooth normals), their normals bent towards the
  direction from the crown centre, darker inside and towards the bottom (`patchCrown`, per-instance `aCrown`), a darker, more saturated
  green than the paint colour (`PLANT.foliageSaturation`, `foliageCanopy`), and alpha-tested leaf cards with the mip-level alpha boost.
  A large rounded crown gets more blobs spread over a broad dome whose outer ring hangs low: the walnut reads big and broad (tested:
  its blobs span more than 80 % of the crown diameter). Invariant: every blob lies inside the crown cylinder of the data.
* **Baked tree** (`TREE_MODEL_FILE` = `tree.glb`, pipeline/blender/vegetation_bake.py): when the manifest lists it, the high tier draws every
  tree with a rounded crown as an instance of it (two draw calls for all of them): `treeModelOf(scene)` reads the meshes with role `bark`
  and `foliage` (nodes `tree_bark`, `tree_foliage`, docs/PIPELINE.md section 9); the pipeline's file is normalised (scene extra
  `sourceHeight` present: height 1, crown 1, `crownBase` a share of the height), other files give `height`, `crown`, `crownBase`, else the
  bounding boxes do; `crownCentre` moves the geometry so the **crown** (not the trunk) stands on the site position, where the sun analysis
  has it; `treeInstanceMatrix` scales it to each tree's height and crown and turns it by a seeded angle; the leaves are tinted to the style's foliage per tree (the texture's mean colour divided out) and shrink towards the crown
  centre with the season. Conical and columnar crowns, the low tier and a failed load use the procedural trees.
* `setDayOfYear(n)` scales deciduous foliage with `leafFactor` (the same function the sun analysis uses). "low" draws 40 % of the cards.

## 8. Movable parts and photovoltaics

All are built with `(viewer, house)`, request renders on every change and, where they shade, report **occluders** for the sun analysis.

### 8.1 Louvre wall (`blinds.ts`): rotation only

`buildSlatScreens(viewer, house)`: the static GLB blades (`role: "screen_slats"`, `userData.id` = screen id) are hidden and replaced by
instanced blades at `derived.screens[].blades.positions` (the pipeline's even spacing: `n = floor(length / pitch)` on the pitch
`length / n`, the first half a pitch from the start; `slatPositions` for a screen without positions), chord and thickness from `blades`,
between the rails (`bladeHeights`, `SCREEN_RAIL` = the pipeline's `rail_h`, `rail_d`, 4 mm of air). **The rails stay visible**: the GLB
holds them as `screen_rail`; an older GLB without them gets rails drawn here.

* `setAngle(deg)` turns every blade about its own vertical axis: 0 = in the wall plane, 90 = square to the wall (open); clamped to
  `range = { min: closedDeg, max: 90, rest }` (`derived.screens[].closedDeg` = `ceil5(asin(thickness / pitch))`, the stop where neighbours
  touch; `closedAngle` computes it). Starts at `restDeg`.
* `setSlide(t)` and `slide` are **deprecated no-ops** (always 0): the old slide is gone; pages still calling it keep working until WP8
  removes the call.
* `occluders()`: the blade meshes.

### 8.2 Exterior blinds (`extBlinds.ts`)

On every opening with `blind: true` (the kernel gives a blind to every glazed opening of a heated room; 11 on this model). The product is the
model's one blind, `house.shading.blinds.product` (`blindProduct(ctx)`: slat width, pitch, thickness, rails, box, widest section; the renders
read the same), `EXT_BLIND_SPEC` holds the defaults and drawing details. Sections per opening (`blindSections`, pure), split into equal
parts above `maxSectionWidth`; drawn in the reveal behind the facade. `setDrop(0..1)`, `setTilt(0..90)` (outer edge down); far away a
painted curtain replaces the slats (`lod`). Occluders: slats and packs while lowered.

### 8.3 Garage door (`garageDoor.ts`, contract C5)

`buildGarageDoor(viewer, house)` finds the GLB meshes with role `garage_door` and joins them by `userData.id` to the openings of kind
`garage`. `setOpen(t, { animate })` (0 closed .. 1 open) moves each leaf like an overhead door: the bottom edge runs up the opening, the
top edge into the garage along the head, so it ends level under the ceiling, inside (`doorMotion(t, height)`, pure: the leaf keeps its
length); eased over `GARAGE_DOOR_TRAVEL` (1.6 s) in the frame loop, immediate with `animate: false` or reduced motion. `available` is false
for a GLB without a door leaf (built before R2): the page hides its switch. `dispose()` closes the door.

### 8.4 PV and battery (`pv.ts`)

`buildPv(viewer, house, config)`: one instanced box per module (`cellBox`: two face groups, frame and cells, so two draw calls for all
modules), corners from the kernel panel, lifted along the roof normal. Battery modules, inverter and conduits on a wall of the plant
room, merged per material (four draw calls). `setPanelsVisible` follows the roof switch; `occluders()` the modules while shown.

### 8.5 Sun path (`sunPath.ts`, contract C5, Sun page)

```ts
const path = addSunPath(viewer, { ctx, date, minute, formatHour: (h) => f.clock(h) });
const off = path.onDrag((minute) => setMinute(minute));   // the same path as the slider
path.setDay(date); path.setMinute(minute); path.setVisible(false); path.dispose();
```

The day's arc: `sunPathSamples(date, sunAt)` every 10 minutes while the sun is up, ends refined to sunrise and sunset; points at
`radius` (`SUN_PATH.radiusShare` × the viewer's extent radius) around the extent centre in the direction of the light (`arcPoint`). One
`InstancedMesh` of dots, larger at full hours (with optional CSS2D labels `.sun-tick` when the viewer has a label layer and `formatHour`
is given), the travelled part in mint (`--mint`), the rest white; a white sun disc (`--sun-disc`) with a mint halo at the current minute,
hidden while the sun is down. Unlit, not tone-mapped, no shadows, not an occluder, not cut. Dragging the disc (capture-phase pointer
listener on the container, so it wins over the orbit controls, which are paused meanwhile) moves it to the arc sample nearest to the
pointer on screen and calls `onDrag(minute)`.

## 9. Walk (`walkCollision.ts`, `walk.ts`)

* **Colliders** (pure, `buildWalkColliders(ctx, footprints)`): wall bodies split at the passable openings (door, entry, slider), windows and
  garage doors solid, **the water of every pool solid** (its rectangle), furniture boxes from `furniture-footprints.json`.
* **Start** (`walkStart(ctx)`, pure): in the main living room (role `main-living`, else the largest day-zone room, else the entry room),
  looking out of its largest glazed exterior opening (the yaw is the opening's outward azimuth: towards the terrace and the garden),
  standing `WALK_START.depthShare` (0.65) of the room's depth behind it on the first point of that line that is clear of the furniture
  (`derived.furniture[].rect`) and the walls. Tested: inside the room, clear of furniture, a free sight line of several metres to the glass.
* **Controller** `startWalk(viewer, house, container, { labels, onExit })`: WASD / arrows (Shift runs), drag to look, joystick for coarse
  pointers, eye height and speeds in `WALK`, floor 0 inside the outline else `groundAt`. Esc or `stop()` restores the camera.

## 10. Sun analysis (`sunAnalysis.ts`)

`makeSunAnalyzer(viewer, house, opts?)` returns a `SunAnalyzer`: direct sun per room, per sampled outdoor area, and a time series, all from
`derived`. The calc side (astronomy, the analytic oracle) is in `docs/CALC-API.md`, section 4.1.

| member | meaning |
|---|---|
| `day(date, step = 10, shades = [])` | a `SunDayResult` (months 0-based): the sampled instants above the horizon (`times`, `altitude`, `azimuthTrue`); per room the **glass-weighted** series (`rooms`: the sunlit share of the best window's glass, "Osluněné sklo (ekv. hodiny)") and the **"sun on the window"** series (`windowSun`: 1 when any sample of any glazed window of the room is in sun, transmittance ≥ `WINDOW_SUN.minTransmittance`, while the sun is ≥ `WINDOW_SUN.minAltitude` = 5° high: the reading of ČSN 73 4301; call it for 1 March for the norm card); per area with the movable shading as set (`outdoors`) and without it (`outdoorsOpen`, memoised per day) |
| `dayAsync(date, step, shades, {signal, sliceMs = 8})` | the same in slices that yield to the event loop; resolves `null` when aborted |
| `windows`, `areas` | what is sampled, in the scene frame |
| `terrainHorizon(azimuthTrue)` | elevation of the terrain horizon seen from the house |
| `blockers(origin, direction)` | debugging: every static house mesh a ray meets |

Samples: 3 × 6 per window in the glass plane (`GLASS_DEPTH` behind the outer face). **Areas**: every `derived.outdoor[]` whose type is in
`SUN_SAMPLED_OUTDOOR` (terraces and the **pool**) and every covered area (`isSampledArea`), 5 × 3 points: 0.45 m above the slab top (its
grade plane) of a terrace, just above the water inside the water rectangle of a pool. An opening counts only while the sun is in front of
its wall. Occluders: `house.occluders`, the `shades` passed in, the surroundings as analytic solids with leaf-dependent transmittance, the
terrain as a horizon.

## 11. React: `Stage` (`src/components/three/Stage.tsx`, owned by the pages' package)

```tsx
<Stage labels={stageLabels(t)} extent="plot" initialView={…} build={{ look, formatTag, labels: false }}
       onReady={(h) => { handle.current = h; … }} onDispose={() => { handle.current = null; }}>
  {/* overlay controls */}
</Stage>
```

* Owns the container (`.stage`), tier detection, the build, cleanup; states (`data-status`): `loading`, `ready`, `error` (retry), `lost`
  (restore), `unsupported`. Calls `onReady(handle)` after the first frame; `onDispose(handle)` before the viewer goes away. The handle
  `{ ctx, viewer, house }` is the only way for the page to reach the engine.
* C5 props `poster` and `expandable` belong to WP8 (Stage, stage.css).
* In development `window.__stage` holds the current handle (manual checks, e2e, the probes of section 12).

### 11.1 Recipe: Model page

1. `const views = pageViews(ctx, "model")`; chips from `views` (`short` names); `viewer.setLimits(pageLimits(ctx, "model"))` in `onReady`.
2. Open on `defaultView(views)`, after mount on `defaultView(views, narrow)`; chips call `viewer.fit(view, undefined, { animate: true })`.
3. Switches call `house.setRoof/…`; sun time calls `viewer.setSun(az, alt)` with `calc/sun` for the date and `placeOf(house)`.
4. Equipment after `onReady`: `buildExtBlinds`, `buildPv(viewer, house, readPvConfig(ctx))`, `buildSlatScreens` (one angle control,
   `screens.range.min` labelled "zavřeno"), `buildGarageDoor` (switch shown when `available`); dispose them in `onDispose`.
5. Walk: `startWalk(viewer, house, containerElement, { labels, onExit })`.

### 11.2 Recipe: Sun page

Same stage with `extent="house"`; `pageViews(ctx, "sun")` (aerial default), `pageLimits(ctx, "sun")`; `makeSunAnalyzer`,
`viewer.setSun` per slider, `house.setDayOfYear`; `buildPv` (shown); `addSunPath(viewer, { ctx, date, minute, formatHour })` with
`onDrag` → the page's minute, hidden in the top view (`setVisible(false)`).

## 12. Tests and visual checks

| file | what |
|---|---|
| `frame`, `style`, `context`, `glb`, `pv`, `walkCollision` `.test.ts` | frames and sun direction, looks, contract of the committed GLBs and manifest, PV helpers, circle sliding |
| `views.test.ts` | presets from `derived.cameras` by use, default views, every fitted preset within the page limits, fitting keeps the horizontal coverage, eye-level views stay on their side of the boundary and out of the building, **the house stays in the frustum at 0.75 / 1 / 1.45**, the shadow range reaches every site occluder |
| `sky.test.ts` | `agx` uses three's constants, `inverseAgx` round trip for every sky colour, the sky reads only scheme-independent tokens (each `--sky-*` written once in `tokens.css`), blends and intensity, **plan lightness: 21 Jun 13:00 zenith ≥ L* 76 and horizon ≥ 90, 21 Dec 15:30 horizon ≥ 80**, glow not orange, bake threshold, the dome is tone-mapped and depth-free |
| `terrain.test.ts` | lattice, heights, normals, triangles, texture coordinates; layers from the data (pavement, outdoor slabs, not the pool); the plot edge only where no fence covers it; **no triangle inside a ground void**, lattice lines on the void edges; field rows; horizon ring and tree line |
| `surroundings.test.ts` | neighbour houses; **the boundary is closed except openings a gate or the pillar stands in**; leaves span their openings; posts at most `postSpacing` apart; boards from the plinth to the height; pillar items fit; dropped kerbs exactly at the crossings; bins on their pad |
| `outdoor.test.ts`, `merge.test.ts` | fallback slabs (cut-outs, grade planes, pool ring, nothing with a current GLB); merging keeps places and ids, keeps apart what must; the PV box has two groups |
| `blinds.test.ts` | positions equal the kernel's (and the pipeline's spacing), closed stop, blades between the rails (reads `params.py`), angle clamped to [closedDeg, 90], slide is a no-op, rails kept or drawn, blades turn about their own axis |
| `extBlinds.test.ts`, `garageDoor.test.ts`, `sunPath.test.ts` | blind sections and reveal; door motion keeps the length, opens level and inside, closes exactly, unavailable without a leaf; sun path samples equal calc/sun, ends at sunrise and sunset, points on the arc in the light's direction, disc on the arc and hidden at night, travelled colours, cleanup |
| `interior.test.ts`, `vegetation.test.ts`, `pv.test.ts` | interior region and patch; crowns inside their cylinders, the big tree broad, the tree model read and scaled; PV frames and battery mount |
| `walkColliders.test.ts` | gaps at passable openings, no tunnelling, every room reachable, furniture solid, **start in the living room looking out through its largest glazing, clear of furniture**, **pool water solid** |
| `sunAnalysis.test.ts` | samples (pool areas over the water), the open scene against `calc/sun.sunHoursOnSurface`, **"sun on the window" against an independent oracle**, obstacles, shades, surroundings, terrain, culling, scheduling |
| `imports.test.ts` | three.js is imported only by the engine, its shell and the Model and Sun components |

Visual checks need WebGL: `node scripts/shot.mjs <url> <out> [--device iphone15] [--dark] [--wait 15000]` against the dev server. The
WP7 probes (outside the repo, in the review folder) set a camera of `derived.cameras` and the sun through `window.__stage`, project
house-frame points to pixels, and measure sky lightness (light and dark scheme: identical pixels), sunlit lawn, ceiling saturation and
glazing against plaster; a leak script counts the heap after forced GC over round trips (CDP).

## 13. Performance and robustness budgets

* First paint of the page shell does not wait for three.js (dynamic import); the model appears progressively.
* "low": at most 150 draw calls on /model (measured 106 with the furniture on iPhone 15; /slunce 44): merged house and furniture, instanced
  plants, blinds and fence posts, single-pass glass, two-group PV modules, merged battery.
* High tier: multisampled beauty target (4 samples) for N8AO, no SMAA.
* Resize: `ResizeObserver` on the container only; pixel ratio capped; composer and AO resized with it; a preset is refitted.
* Memory: dispose everything on unmount (section 4, dispose); no module-level caches of scenes; textures created from canvases are disposed;
  heap growth per round trip below 1 MB after the first visit (plan: ≤ 1.5 MB).
* Hidden or off-screen stages do no work. A GLB that violates the contract fails loudly in development and tests.

## 14. Integration with shared files

1. `model/style.json` `generated` ships the colours of the generated parts (section 3.3); `lawnColors` is the render grass.
2. `tokens.css`: the sky tokens `--sky-day-top`, `--sky-day-horizon`, `--sky-low-horizon`, `--sky-dusk-top`, `--sky-dusk-horizon`,
   `--sky-night-top`, `--sky-night-horizon`, `--sky-glow` (scheme independent). The engine no longer reads the deprecated `--sky-top` /
   `--sky-bottom`; the 2D sun chart may still (owned by the Sun page).
3. `next.config.ts` serves `/models/*.glb|json` immutable (URLs carry the content hash), `/draco/*` for one day, `*.usdz` for one hour.
4. `ASSETS.md` has the Draco decoder entry and the tree asset (the web use of `tree.glb` needs its row there).
5. `scripts/check-bundles.mjs` fails when a page other than Model and Sun loads three.js; `imports.test.ts` guards the source.
6. Cameras are data (`house.cameras`, `use`, `default`, `defaultFor`, `short`, `aboveGround`), never engine code.

## 15. Changes

### R2 (additive unless marked)

* **Sky**: tone-mapped sun-driven dome with glow (`sky.ts`: `skyAt`, `skyRadiance`, `skyLight`, `createSkyDome`, `agx`, `inverseAgx`,
  `needsRebake`, `backdropIntensity`, `SKY_TOKENS`), PMREM re-bake on threshold, scheme-independent tokens. Removed:
  `inverseNeutralToneMapping`, `NEUTRAL_INVERSE_LIMIT` and the `framed()` compensation (BREAK for anyone importing them; nothing outside
  the engine did). `backdrop: "stage"` is a deprecated alias of `"sky"`.
* **Tone mapping** AgX at `EXPOSURE` 1.15 after neutralising the fills (`INTERIOR_FILL`); `interiorView` (`InteriorFill.setView/view`,
  `INTERIOR_VIEW_OUTSIDE`, `INTERIOR_VIEW_EASE`); glass Fresnel (`patchFresnel`); MSAA beauty target (`MSAA_SAMPLES`).
* **Viewer**: `fit`, `fitted`, `setFitContext`, `stats`, `sky`, `exposure`, `ViewerOptions.fitContext`; the Control-key listener leak fixed.
* **Views**: `pageViews`, `pageLimits`, `pageExtent`, `defaultView`, `fitView`, `fitContextOf`, `isElevated`, `heightAboveGround`,
  `DESIGN_ASPECT`, `FOV_MAX`, `ELEVATED_MIN`, `FIT_ASPECTS`, `TOP_VIEW_FOV`, `refitLens`, `limitsForViews` (moved here from the Model
  page), `shadowRangeFor(extent, ctx)`, `SHADOW_OCCLUDER_MARGIN`; `ResolvedView.short/default/defaultFor`.
* **Ground**: void holes, `latticeLines`, masks, noise, stripes, sunlit saturation, horizon (`horizonGeometry`, `treeLine`, `HORIZON`),
  `fieldRows`, `uncoveredBoundary`, pavement and outdoor slabs painted.
* **Surroundings**: slat fence, gates (`gateLeaf`), pillar (`PILLAR_LAYOUT`), bins (`binsOnPads`), kerb with dropped crossings
  (`kerbPieces`), neighbour windows; `SurroundingsScene.setWood`.
* **House**: water per tier, outdoor fallback (`outdoor.ts`), merging on the low tier (`merge.ts`, `TierSettings.mergeHouse`,
  `HOUSE_KEEP_APART`), the shadow range and fit context set from `ctx`.
* **Louvres**: rotation only, `range`, `closedAngle`, `bladeHeights`, `SCREEN_RAIL`; `setSlide`/`slide` deprecated no-ops (BREAK of
  behaviour, not of types). `slatPositions(from, to, pitch)` returns numbers (BREAK: the `spread/stacked` pairs are gone).
* **Blinds**: `blindProduct(ctx)` reads `house.shading.blinds.product`.
* **New**: `garageDoor.ts` (`buildGarageDoor`, `doorMotion`), `sunPath.ts` (`addSunPath`, `sunPathSamples`, `arcPoint`, `SUN_PATH`),
  tree model (`TREE_MODEL_FILE`, `treeModelOf`, `treeInstanceMatrix`, `usesTreeModel`), `cellBox`.
* **Walk**: pool collider; `walkStart` in the living room looking out (`WALK_START`).
* **Sun analysis**: pool areas (`isSampledArea`), `SunDayResult.windowSun`, `WINDOW_SUN`.

### Earlier

* `Viewer.setFog(near, far)`, `Viewer.extent`, `ViewerOptions.groundColor`; `LoadOptions.tier`; `extrasOf(node)`; `TierSettings.mergeFurniture`;
  `Tier`, `TIER_SETTINGS`, `detectTier` in `tier.ts`; `isWebGlAvailable` in `webgl.ts`; `TerrainGeometryData.uvs` 0..1 over the bounds;
  `Stage` sets `window.__stage` outside production.
