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
| `painted_plaster_wall` | facade plaster (`plaster`) | resized to 1024 / 512 px, recoloured to a neutral mean, contrast 0.45 |
| `japanese_cedar_planks` | timber cladding and screen slats (`wood_cladding`, `screen_slats`) | resized, recoloured to a neutral mean, saturation 0.45 (the style colour tints it) |
| `concrete_floor_02` | plinth and garage floor (`slab`, `floor_concrete`) | resized, neutral mean, contrast 0.7 |
| `concrete_pavers_02` | terrace, driveway and path paving (`terrace_paving`, `drive_paving`, `path`) | resized, neutral mean, contrast 0.55, scaled up to large-format slabs |
| `gravel_floor_02` | gravel border (`gravel`) | resized, neutral mean |

The textures in the GLB are *neutral* (their mean colour is a light grey); the colour of a role comes from `model/style.json`
and is applied as the glTF `baseColorFactor`, so the web can recolour a role (the "looks") without new textures. For the
USDZ the tint is baked into the image because USD readers drop the factor.

## Procedural textures (own code, no third-party content)

`pipeline/blender/hb/floor_textures.py` draws the floor textures from scratch with numpy (seamless periodic noise, joints on
the texture period): oak planks (`floor_oak`), 60 x 60 cm tiles (`floor_tile`), stone-grey tiles (`floor_stone`). They are
generated at build time and cached in `pipeline/out/tex`.

## Fonts, icons, other media

Not part of this file (see the web app and `docs/DESIGN.md`).

## Draco decoder

`public/draco/{draco_decoder.js,draco_decoder.wasm,draco_wasm_wrapper.js}`: Google Draco geometry decoder, Apache-2.0,
copied unmodified from the `three` package (`examples/jsm/libs/draco/gltf`, r169). Used to decode the Draco-compressed GLB files.
