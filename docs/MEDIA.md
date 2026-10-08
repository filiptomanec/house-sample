# Media

`scripts/build-media.ts` turns the Blender renders (`pipeline/out`, git-ignored) into the files the site serves
(`public/media`), writes `public/media/manifest.json` (the one file the web reads, through `src/lib/data/media.ts`; contract in
`docs/ARCHITECTURE.md` section 4 and C4 of the work plan) and copies the share images into `src/app`. `scripts/check-media.ts`
verifies that the folder is what the manifest says; CI runs it. Nothing here needs the network.

```
pipeline/out/{stills,compare,og,day,day/portrait,orbit,posters}/*.png|jpg      model/render.json (shots, texts, times)
                         │                                                          │
                         └──────────────── scripts/build-media.ts ──────────────────┘   ImageMagick (pictures), ffmpeg (video)
                                              │
     public/media/{day,orbit,stills,posters}/…  og.<hash>.jpg  twitter.<hash>.jpg  manifest.json   src/app/{opengraph,twitter}-image.*
                                              │
                         scripts/check-media.ts (CI)  ──  src/lib/data/media.ts (web)
```

```bash
bash scripts/build-media.sh                       # everything, then it checks the result      (npx tsx scripts/build-media.ts)
npx tsx scripts/build-media.ts --only stills,og   # some sections: day, orbit, stills, og, video, posters
npx tsx scripts/build-media.ts --partial          # build the sections whose renders are complete, keep the others as they are
npx tsx scripts/build-media.ts --stand-ins --stand-in-map <file.json>   # a proof build on older renders (section 6)
npx tsx scripts/check-media.ts                    # freshness check (no ImageMagick, no ffmpeg needed); --final is the release gate
node scripts/posters.mjs --base <url>             # captures of the 3D pages for the posters section (section 7)
npx vitest run scripts/__tests__/media.test.ts    # tests on synthetic renders (skipped parts when a tool is missing)
```

Options of `build-media.ts`: `--in <dir>` (renders, default `pipeline/out`), `--out <dir>` (media folder, default `public/media`),
`--no-video`, `--no-prune`, `--no-check`, `--force` (encode the video again), `--jobs <n>` (parallel conversions, default CPU count up
to 8), `--video-mb <max>` or `<lo-hi>` (size ceiling, or a range, of the widest rendition; default: the SPEC ceiling, no floor),
`--cache <file>` (video cache, default `<renders>/media-cache.json`), `--render <file>`, `--model-dir <dir>`, `--render-inputs <file>`,
`--derived <file>`, `--app-dir <dir>` / `--no-app` (where the share images are copied; default `src/app` when `--out` is not given),
`--built-at <YYYY-MM-DD>`, `--stand-ins`, `--stand-in-map <file>`, `--quiet`. Exit code 0 = ok, 1 = renders missing or a step failed,
2 = bad usage.

**Tools.** `magick` (ImageMagick 7 with the WebP and HEIC/AVIF coders: `magick -list format | grep -i -E 'avif|webp'`) and `ffmpeg`
with libx264 are looked up through the environment variables `MAGICK` and `FFMPEG` (a path), then in `PATH`, then in the usual install
folders (`/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`, `/opt/local/bin`) and, for ffmpeg, in `node_modules/ffmpeg-static`. Without
ffmpeg the build stops before it writes anything, unless `--no-video` (or `--partial`, which skips only the video) is given. The share
images need the Geist TrueType files of the `geist` package (`node_modules/geist/dist/fonts`). `check-media` needs no tool.

## 1. Inputs

Which renders exist is **data**: `model/render.json` (read with `scripts/lib/render-schema.ts`; the shot list of
`docs/RENDER-INPUTS.md`). A render is `<in>/<base>.png` (or `.jpg` / `.jpeg`, PNG first); `<base>` is the logical `file` name the
render inputs give the shot (the test checks that both name the same files).

| section | renders | size of the render |
|---|---|---|
| `day` | `day/<HHMM>` (one per time of the day ranges) and `day/portrait/<HHMM>` (the phone camera, its own render) | `day.size`, `day.portrait.size` |
| `orbit` | `orbit/landscape/<NNNN>` for every `scrollStep`-th frame, and `orbit/portrait/<NNNN>` for every `portraitStride`-th of those | orbit variant sizes |
| `stills` | `stills/<id>` (render.json order) and `compare/<id>-before`, `compare/<id>-after` (the pair) | still sizes |
| `og` | `og/<id>` | `og.size` |
| `video` | all `frameCount` landscape frames `orbit/landscape/0000 …` (any folder and type: they are linked into one series) | the landscape size |
| `posters` | `posters/<page>-<device>.png` for page `model`, `sun` and device `desktop`, `phone` (optional, section 7) | any |

Sizes may differ from these (a draft render at a smaller size works): a picture with another aspect ratio than its target is scaled to
cover it and cropped in the middle (with a warning). Missing renders are listed by section and base name; **without `--partial` nothing
is written when any selected render is missing.** The posters are optional: they are built for a page when both its captures exist, and
never count as missing.

## 2. Outputs

All sizes, formats and qualities are the table `SPEC` in `scripts/lib/media-plan.ts`.

| files | size | format, quality | made from |
|---|---|---|---|
| `day/l/<HHMM>.<hash>.webp` | 1920 x 1080 | WebP 72 | the day render |
| `day/l960/<HHMM>.<hash>.webp` | 960 x 540 | WebP 72 | the same (the `small` copy for small canvases) |
| `day/p/<HHMM>.<hash>.webp` | 1080 x 1620 | WebP 72 | the portrait render of the phone camera (never a crop of the landscape frame) |
| `orbit/l/<NNN>.<hash>.webp` | 1600 x 900 | WebP 72 | every scroll frame |
| `orbit/l960/<NNN>.<hash>.webp` | 960 x 540 | WebP 72 | the same |
| `orbit/p/<NNN>.<hash>.webp` | 900 x 1350 | WebP 72 | the portrait renders of every second scroll frame (`stride` 2: phones load half the frames) |
| `stills/<id>-<w>.<hash>.{avif,webp,jpg}` | 640, 1280, 1920 (and 2560 from a render that wide) x 16:9 | AVIF 50, WebP 76, JPEG 80 | the stills and the compare pair; the 1920 JPEG is the still's `file` |
| `orbit/orbit-1600.<hash>.mp4`, `orbit/orbit-960.<hash>.mp4` | 1600 x 900, 960 x 540, 24 fps | H.264 CRF 21 / 24 | all landscape frames, section 4 |
| `orbit/poster-<w>.<hash>.{avif,webp,jpg}` | 640, 1280, 1600 | as the stills | the first video frame; the 1600 JPEG is `video.poster` |
| `og.<hash>.jpg` | 1200 x 630 | JPEG 86 | the og render with the house name composited (section 5) |
| `twitter.<hash>.jpg` | 1200 x 600 | JPEG 86 | the same layout at 2:1 (large Twitter cards) |
| `posters/<page>-<device>.<hash>.webp` | the capture, at most 1600 (desktop) / 1080 (phone) wide | WebP 76 | the captures of scripts/posters.mjs |
| `manifest.json` | | | section 3 |
| `src/app/opengraph-image.jpg`, `twitter-image.jpg` | | | byte copies of the og and twitter files (Next's file convention) |
| `src/app/opengraph-image.alt.txt`, `twitter-image.alt.txt` | | | the og alt text of `model/render.json`, Czech (the x-default language), typeset with `nb()` |

Sequences are WebP, not AVIF: the home page decodes frames while the visitor scrolls, and AVIF decodes several times slower on phones.
Stills are AVIF first (about 40 % smaller than WebP), with WebP and JPEG fallbacks in `<picture>`.

**No metadata in any file.** Every picture is converted with `magick … -strip`: no Exif, XMP, ICC profile, comment or thumbnail. JPEGs
keep only the JFIF header; WebP files are plain `VP8 ` (no `EXIF`/`XMP `/`ICCP` chunk, no alpha); AVIF files carry their colour in the
AV1 sequence header (BT.709 primaries, sRGB transfer) and have no `Exif` or `mime` item and no ICC `colr` box. `check-media` reads every
file itself (`scripts/lib/media-probe.ts`) and fails on any of them; the privacy scanner checks the same.

**Names and hashes.** Every file name carries a content hash (`.<10 hex>.`) so the files can be cached as immutable (`next.config.ts`
serves `/media/**` with `max-age=31536000, immutable`). A single file's hash is the first 10 characters of the SHA-256 of its bytes. The
frames of a sequence share one hash (the `{hash}` token of the manifest): the SHA-256 of the bytes of all its frames in manifest order
(landscape, its `small` copy, portrait), shortened to 10 characters. A changed frame therefore renames the whole sequence; the files of
earlier builds are removed after the new manifest is written (only generated, hash-named files; nothing else is deleted).

## 3. `manifest.json` (`media/1`, contract C4)

Validated by `mediaManifestSchema` in `scripts/lib/media-plan.ts`, which accepts and rejects the same manifests as the schema of
`src/lib/data/media.ts` (the test checks both) plus `inputHash`. Every field added for C4 is optional, so a reader written against the
first version keeps working. Paths are relative to `public/` and start with `media/`; patterns contain `{i}` (the frame number, 3 digits,
zero based), `{time}` (`HHMM`) and `{hash}` (the hash of the sequence). The manifest is written in the key order of the schema.

```jsonc
{
  "schema": "media/1",
  "inputHash": "<64 hex>",        // hashModelFiles of model/*.json the renders were made from (docs/HOUSE-FORMAT.md section 8)
  "builtAt": "2026-10-08",        // the day the media changed (kept when a rebuild changes nothing); the sitemap's lastmod
  "standIns": 314,                // only in a proof build: how many renders were stand-ins (section 6)
  "day": {
    "date": "2026-06-21", "times": ["08:00", …], "stillTime": "19:20", "hash": "<10 hex>",
    "landscape": { "pattern": "media/day/l/{time}.{hash}.webp", "width": 1920, "height": 1080, "format": "webp",
                   "small": { "pattern": "media/day/l960/{time}.{hash}.webp", "width": 960, "height": 540 } },
    "portrait":  { "pattern": "media/day/p/{time}.{hash}.webp", "width": 1080, "height": 1620, "format": "webp" }
  },
  "orbit": {
    "frames": 60, "degPerFrame": 6, "hash": "<10 hex>",       // scroll positions, 360 * scrollStep / frameCount degrees each
    "startAzimuthDeg": 225, "direction": "counterclockwise",  // camera azimuth of frame 0 and the sense of the loop
    "captionHalfWindowDeg": 30, "captions": [{ "feature": "terrace", "azimuthDeg": 241.1 }, …],   // from render-inputs.json
    "landscape": { "pattern": "media/orbit/l/{i}.{hash}.webp", "width": 1600, "height": 900, "format": "webp", "small": { … 960 x 540 } },
    "portrait":  { "pattern": "media/orbit/p/{i}.{hash}.webp", "width": 900, "height": 1350, "format": "webp", "stride": 2 },
    "video": { "file": "media/orbit/orbit-1600.<hash>.mp4", "poster": "media/orbit/poster-1600.<hash>.jpg", "width": 1600, "height": 900,
               "fps": 24, "durationS": 10,
               "variants": [{ "w": 1600, "h": 900, "file": … }, { "w": 960, "h": 540, "file": … }],
               "posterVariants": [{ "w": 640, "h": 360, "avif": …, "webp": …, "jpg": … }, …] }
  },
  "stills": [ { "id", "file": "media/stills/<id>-1920.<hash>.jpg", "width": 1920, "height": 1080, "date", "time", "category",
                "title": {cs,en}, "alt": {cs,en}, "variants": [{ "w", "h", "avif", "webp", "jpg" }, …], "gallery": true } ],
  "compare": { "a": "<id>-before", "b": "<id>-after", "alt": {cs,en},
               "before": { "label", "title", "alt" }, "after": { "label", "title", "alt" } },   // each {cs,en}
  "og": { "file": "media/og.<hash>.jpg", "width": 1200, "height": 630, "alt": {cs,en},
          "twitter": { "file": "media/twitter.<hash>.jpg", "width": 1200, "height": 600 } },
  "posters": { "model": { "desktop": { "file", "width", "height" }, "phone": { … } }, "sun": { … } }   // when captured
}
```

* `day.times`, `stillTime`, `date` come from the day ranges of `model/render.json`; `orbit.frames` is `ceil(frameCount / scrollStep)`.
* A variant with `stride` has a file for every `stride`-th frame only; frame `i` is shown by the file of frame `i - i % stride`.
  `orbitFrames()` (web) still returns one URL per frame in every variant, so a frame index means the same camera angle everywhere (the
  orbit captions depend on that); the repeated URL is served from the browser cache.
* `stills` holds the stills in the order of `model/render.json` and, last, the two shots of the compare pair (ids `<compare.id>-before` and
  `-after`). `title` and `alt` are the still's `label` and `alt`; a compare shot uses its side's `title` and `alt`, and `gallery: false`
  when its side says so (the "before" half lives only in the slider). `compare.before/after.label` is the chip on the slider.
* `category`: the render categories `exterior`, `interior`, `aerial` pass through, `evening` becomes `exterior` (the light is in the
  caption). The compare shots are `interior` when the compare camera stands inside the house outline (`generated/derived.json`
  `outer.pts`), else `exterior`. `detail` is allowed by the schema but no shot maps to it.
* `orbit.captions` are copied from `generated/render-inputs.json` (the caption windows the render pipeline keeps free of trees); without
  that file the manifest has none and the home page computes the same rule from the model.
* Texts are stored as written in `model/render.json`. The web reads every manifest text through `localized(text, locale)`, which applies
  `nb()` (Czech non-breaking spaces), like every dictionary string.
* `inputHash` lets CI see that the renders are older than the model: `check-media` fails when it differs from the current `model/*.json`
  (when `generated/render-inputs.json` exists and was made from other model files, the build warns and records the hash of those files, so
  the media are flagged stale until they are rendered again; a proof build records the current model, see section 6).

### Reading it on the web (`src/lib/data/media.ts`)

`media` (parsed once), `localized()`, `dayFrames()` / `orbitFrames()` (URLs per variant with the `small` copy), `stillPicture()` /
`pictureOf()` (`<picture>` data: AVIF and WebP `<source>` sets, the JPEG `srcset` on the `<img>`), `stills({ gallery: true })`,
`inGallery()`, `compareStills()`, `videoRenditions()` (widest first), `videoPoster()`, `ogAlt(locale)`, `posterOf(page)`,
`allMediaPaths()` (every file once: the file test, the e2e media test and the privacy scan).

## 4. The video

All landscape frames at 24 fps, 1:1, no interpolation: `-framerate 24 ... -frames:v <frameCount>`. The frames are linked into one numbered
series in the staging folder first, so they may come from anywhere. Because the last orbit frame is one angular step before the first,
the video loops without a jump (the build compares the distance last-to-first with the typical distance between neighbours and warns when
it is more than 2.5 times larger).

* Two renditions: **1600 x 900 at CRF 21** (desktop) and **960 x 540 at CRF 24** (phones and Save-Data; the gallery's `<source media>`).
  The quality is constant; a size **ceiling** per rendition (14 MB and 5 MB) makes the build encode again with a higher CRF when the
  file is bigger (a warning names it). There is no size floor. `check-media` warns above the ceiling and fails above 20 MB.
* H.264 High (`libx264 -preset slow -profile:v high -g 48`), `yuv420p`, Lanczos scaling, `-movflags +faststart`, no audio.
* **Colour**: the renders are sRGB pictures; the video is converted with the BT.709 matrix to limited range and tagged BT.709
  (`-colorspace/-color_primaries/-color_trc bt709 -color_range tv`), so a browser shows the colours of the stills.
* **No metadata**: `-map_metadata -1 -fflags +bitexact -flags:v +bitexact`, the SEI NAL units (the x264 version and settings) are removed
  with the `filter_units` bitstream filter, and the build blanks the "compressor name" field of the sample entry. `check-media` reads the
  MP4 boxes itself and fails on a metadata box, a creation time, an encoder name or an audio track.
* **Cache**: each rendition (CRF, file) is remembered in `<renders>/media-cache.json` under a key made of the bytes of all frames, the
  ffmpeg version and the encode settings; unchanged frames reuse the files in `public/media`. `--force` ignores the cache.
* A finished file is probed (`scripts/lib/media-probe.ts`: codec, profile 100, 4:2:0 8-bit, size, 24 fps, frame count, index before the
  data, one video track) before it is used; a failing file stops the build.
* The poster is the first frame as a responsive picture (`posterVariants`); the gallery shows it over the video, so the page paints a
  70 kB AVIF instead of waiting for the video, and the video itself loads only on play (`preload="none"`).

## 5. The share images

`scripts/lib/media-og.ts` composites onto the og render (cover-cropped to 1200 x 630 and 1200 x 600): a soft dark radial scrim from the
top left corner, the mint dot (`model/style.json` `palette.mint`), the mono label (the hero kicker `home.hero.kicker`, in capitals, Geist
Mono Medium) and the house name (`model/house.json` `name.cs`, split into two lines like the start page title, Geist SemiBold). Every size
is relative to the frame, so the Twitter card is laid out, not cropped. The render's shot list keeps sky top left for the type
(docs/RENDER-INPUTS.md). The build copies both files into `src/app` and writes the alt text next to them; the page metadata reads
`og.alt[locale]` from the manifest (`src/lib/i18n/metadata.ts`). `make-brand-assets.sh` makes the icons only and never touches the share
images. `check-media` fails when the app copies are not the manifest's files or the alt text differs.

## 6. Stand-ins: a proof build on older renders

Before the final renders exist, `--stand-ins` builds the complete media from whatever renders are in the folder, so the pages can be
built against the current shot list and manifest format. A missing render is replaced by: an explicit pair of `--stand-in-map <file.json>`
(`{ "<planned base>": "<existing base>" }`); for a day frame the nearest time (a missing portrait frame takes the landscape frame of its
time, cropped to cover); for an orbit frame the frame at the nearest position of the loop (an orbit folder that holds a loop of another
length is always re-mapped this way, since its file names show other angles); else the next unused render of the same folder in name order.
The posters never get stand-ins. The manifest counts the replaced renders in `standIns` and records the current model (the texts follow the
current `model/render.json`), `check-media` warns about it, and **`check-media --final` fails** on it: the release gate (WP16) must run with
`--final`. The pictures of a proof build do not show what their texts say. The final build (P3) runs without `--stand-ins`.

## 7. Posters of the 3D pages

`node scripts/posters.mjs --base <url>` opens `/model` and `/sun` of a running site (the production build in P3) in Chromium (SwiftShader
WebGL), waits for `.stage[data-status="ready"]`, hides everything drawn over the canvas and captures the canvas: desktop 1440 x 900 at
DPR 2 and phone 393 x 852 at DPR 3. The captures go to `pipeline/out/posters/<page>-<device>.png`; `npx tsx scripts/build-media.ts --only
posters` encodes them (WebP, fitted, not cropped) and adds `posters` to the manifest; `posterOf(page)` gives them to the Stage.

## 8. Safety of the build

1. Every conversion writes into a staging folder `public/media/.build-<pid>`; every output must be larger than 256 bytes and the video must
   pass the probe. Only when all selected sections succeeded are the files moved into place, then `manifest.json` is replaced atomically
   (written to a temporary file, renamed), then the share images are copied (only when they changed), then old hash-named files are
   removed. A crash or a failed run leaves the previous media and manifest untouched (a crashed run may leave a hidden `.build-*` folder,
   removed by the next successful run after an hour).
2. The manifest is validated before anything is moved, and every file it names must exist (in the new files or in the folder).
3. Missing renders: exit 1 and a list; nothing is written. `--partial` builds the complete sections, takes the others from the existing
   manifest (which must have them) and still exits 1 while renders are missing.
4. The same renders give byte-identical pictures, the same names and the same manifest (including `builtAt`): a second run changes no file.
   (The video is deterministic for one ffmpeg build and thread count; another machine may give another, equally valid file and a new hash.)
5. After the build `check-media` runs on the folder (`--no-check` skips it).

## 9. `check-media`

`npx tsx scripts/check-media.ts [--dir public/media] [--no-model-check] [--allow-extra] [--final] [--quiet]`; exit 1 on any error. It checks,
with no external tool: the manifest schema; that every named file exists, is not empty and not truncated; the pixel size of every JPEG,
WebP and AVIF against the manifest; that no picture carries metadata (JPEG application segments and comments, WebP `EXIF`/`XMP `/`ICCP`
chunks and alpha, AVIF `Exif`/XMP items and ICC profiles) and that JPEGs are 4:2:0 (warning); the hash in every file name against its
bytes and the sequence hashes against the frames; every video rendition (H.264 High, 8-bit 4:2:0, size, fps, frame count = `durationS * fps`,
duration, fast start, no audio, no metadata boxes; above its ceiling a warning, above 20 MB an error); that no generated file is left over
that the manifest does not name (`--allow-extra` skips this); a proof build (`standIns`: a warning, an error with `--final`); for the
default folder, that `src/app/opengraph-image.jpg` and `twitter-image.jpg` are the manifest's og files and their `.alt.txt` the og alt
text; and, unless `--no-model-check`, that `inputHash` equals the hash of the current `model/*.json` and that days, times, the portrait
variants, orbit numbers, start and direction, still ids, dates, times, categories, texts, gallery flags, the compare texts and the og alt
equal `model/render.json`.

## 10. Time (Apple silicon, 8 cores)

Measured on the current renders (32 + 32 day frames, 60 + 30 orbit frames, 11 stills, og): the pictures take about 30 s (the stills in
three formats and widths are the largest part, about 9 s), the two video renditions of 240 frames 20 to 45 s (one or two tries each), so a
complete run takes **about 1 to 2 minutes**, and about 30 s when the video is reused from the cache. PNG renders add decoding time.
