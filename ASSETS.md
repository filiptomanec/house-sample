# Assets and licences

Everything in this repository is either our own work (code, model data, procedurally generated geometry and textures) or a
CC0 asset listed here. Nothing else may be added without an entry in this file (see `docs/ARCHITECTURE.md`, section 7).

The assets themselves are **not committed**: they live in the git-ignored folder `assets/` (a local cache) and are only
needed to rebuild the models and renders. The committed results (`public/models/*.glb`, `*.usdz`, `public/media/*`) contain
resized, recoloured copies.

## CC0 textures (Poly Haven)

Source: [Poly Haven](https://polyhaven.com), licence **CC0 1.0** (public domain dedication; no attribution required, given
here as a courtesy). Each asset page is `https://polyhaven.com/a/<id>`. Used maps: diffuse (`*_diff_2k.jpg`) and OpenGL
normal (`*_nor_gl_2k.jpg`), 2k JPG. To restore the cache, download these two maps of every asset below from its page into
`assets/textures/<id>/` (file names `<id>_diff_2k.jpg`, `<id>_nor_gl_2k.jpg`).

| id | used for (GLB role) | processing in `pipeline/blender/hb/textures.py` |
|---|---|---|
| `painted_plaster_wall` | facade plaster (`plaster`); the neighbour walls in the renders (`pipeline/render`) | resized to 1024 / 512 px, recoloured to a neutral mean, contrast 0.45 |
| `japanese_cedar_planks` | timber cladding, screen slats, the garage door and the slatted screen of the heat-pump unit (`wood_cladding`, `screen_slats`, `garage_door`) | resized, recoloured to a neutral mean, saturation 0.45 (the style colour tints it) |
| `wood_floor_deck` | timber decks of the terrace and the pool deck (`deck`) | resized to 1024 / 512 px, recoloured to a neutral mean (contrast 0.75, saturation 0.2); one board of the texture per 145 mm deck board (the role colour of `style.json` tints it) |
| `concrete_floor_02` | plinth, garage floor and the pool coping (`slab`, `floor_concrete`, `pool_coping`) | resized, neutral mean, contrast 0.7 (coping 0.35) |
| `concrete_pavers_02` | terrace, driveway and path paving (`terrace_paving`, `drive_paving`, `path`); the street pavement in the renders | resized, neutral mean, contrast 0.55, scaled up to large-format slabs |
| `gravel_floor_02` | gravel border (`gravel`) | resized, neutral mean |
| `asphalt_02` | street surface in the renders (`pipeline/render`, not in the GLB) | diffuse, roughness, normal; desaturated and tinted to the style `carriageway` colour in the shader |
| `farm_soil` | mulch beds in the renders (`pipeline/render`, not in the GLB) | diffuse, roughness, normal, tinted brown in the shader |
| `grass_ground` | the ground under the lawn blades in the renders (`pipeline/render`, not in the GLB) | desaturated and tinted to the root colour of `style.json` `lawnColors`, darkened |
| `leafy_grass` | the neighbour gardens and the meadow around the plot in the renders (`pipeline/render`, not in the GLB) | desaturated and tinted to the style colours `neighbour` and `verge` |

The textures in the GLB are *neutral* (their mean colour is a light grey); the colour of a role comes from `model/style.json`
and is applied as the glTF `baseColorFactor`, so the web can recolour a role (the "looks") without new textures. For the
USDZ the tint is baked into the image because USD readers drop the factor.

## CC0 models (Poly Haven)

Source: [Poly Haven](https://polyhaven.com), licence **CC0 1.0**, 1k glTF with textures. Copied to `assets/models/<id>/` (the
whole glTF folder, as downloaded, with the separate `*_alpha_*.png` cut-out maps of the foliage atlases). They are not committed.
Only `tree_small_02` reaches the web (as the baked `public/models/tree.glb`); everything else is used by `pipeline/render` only.

| id | used for | processing |
|---|---|---|
| `tree_small_02` | renders: all trees (plot trees, neighbour gardens, hedgerows, woodlots, the village edge) in four leaf tones, and the bark texture of the trunks and limbs that `pipeline/render` builds for the big trees; web: `public/models/tree.glb` / `tree-lite.glb` | renders: imported at render time, the leaves thinned (a seeded share of the leaf pieces is kept and scaled up, `pipeline/render/rn/tree_lod.py`), tinted, instanced with rotation and scale; leaves-only copies fill the crowns. Web: baked by `pipeline/blender/vegetation_bake.py`: trunk and branches decimated (about 1 600 / 500 triangles), the leaves replaced by about 2 000 / 650 leaf cards with a 2 x 2 atlas of leaf clusters rendered from the asset (512 / 256 px WebP, stored neutral grey), normalised to height 1 and crown diameter 1 |
| `shrub_01`, `shrub_03`, `shrub_04`, `periwinkle_plant`, `celandine_01`, `grass_medium_01` | renders: the planting mix scattered over the mulch beds (perennials, ground cover, grasses) | rows of plants split into single plants, tinted to the style `foliage_shrub` colour, cut out with the atlas alpha (or its luminance), scattered with Geometry Nodes |
| `shrub_02` | renders: the field shrubs of the hedgerows around the plot | scaled to 2.2-3.4 m, tinted, cut out with its alpha map |

Everything else in the render is procedural geometry written for this project: the lawn blades, the lavender, the hydrangeas and
the ornamental grass (`pipeline/render/rn/lawn.py`, `herbs.py`), hedges, topiary, the trunks and limbs of the big trees, the
neighbour houses and the village edge, the fence, gates and pillar, the pool water, PV modules, blinds, louvres and lamps.

## CC0 HDRI (Poly Haven), renders only

| id | used for | processing |
|---|---|---|
| `kloofendal_38d_partly_cloudy_puresky` (4k EXR, `assets/hdri/`) | the clouds of the render sky (`pipeline/render/rn/sky.py`), seen by camera and glossy rays only | not used as a picture or as light: its cloud layer is extracted once (a mask and a relative brightness, cached in `assets/cache`) and drawn over the physical Sky Texture of Blender, which still lights the scene; the clouds take the colour of the physical sky of the shot |

`qwantani_late_afternoon_puresky` (CC0, same source) is in the cache too but is not used.

## Procedural textures (own code, no third-party content)

`pipeline/blender/hb/floor_textures.py` draws the floor textures from scratch with numpy (seamless periodic noise, joints on
the texture period): oak planks (`floor_oak`), 60 x 60 cm tiles (`floor_tile`), stone-grey tiles (`floor_stone`). They are
generated at build time and cached in `pipeline/out/tex`.

## Fonts

Defined once in `src/fonts/index.ts` (`docs/DESIGN.md`, section 3). Nothing is committed: the files come from npm or are
downloaded at build time, and the browser loads every face from the site's own origin.

| font | source | licence | how it is loaded |
|---|---|---|---|
| Geist Sans, Geist Mono (variable, 100-900) | [vercel/geist-font](https://github.com/vercel/geist-font), the `geist` npm package | SIL OFL 1.1 | self-hosted from `node_modules/geist` by `geist/font` (no network at build time) |
| Instrument Serif Italic (400, italic only; latin + latin-ext) | [Instrument/instrument-serif](https://github.com/Instrument/instrument-serif), served by Google Fonts | SIL OFL 1.1 | `next/font/google` downloads it at build time and self-hosts it (no request to Google from the browser); `next build` needs network access to Google Fonts once |

## Icons

Our own work: the master icon `src/app/icon.svg` and the files `scripts/make-brand-assets.sh` derives from it (`docs/DESIGN.md`,
section 10).

## Draco decoder

`public/draco/{draco_decoder.js,draco_decoder.wasm,draco_wasm_wrapper.js}`: Google Draco geometry decoder, Apache-2.0,
copied unmodified from the `three` package (`examples/jsm/libs/draco/gltf`, r169). Used to decode the Draco-compressed GLB files.
