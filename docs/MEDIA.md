# Media

`scripts/build-media.ts` turns the Blender renders (`pipeline/out`, git-ignored) into the files the site serves
(`public/media`) and writes `public/media/manifest.json`, the one file the web reads (`src/lib/data/media.ts`, contract in
`docs/ARCHITECTURE.md` section 4). `scripts/check-media.ts` verifies that the folder is what the manifest says; CI runs it.
Nothing here needs the network.

```
pipeline/out/{stills,compare,og,day,orbit}/*.png|jpg      model/render.json (shots, texts, times)
                         │                                         │
                         └──────────── scripts/build-media.ts ─────┘     ImageMagick (every picture), ffmpeg (the video)
                                              │
              public/media/{day,orbit,stills}/…  og.<hash>.jpg  twitter.<hash>.jpg  manifest.json
                                              │
                         scripts/check-media.ts (CI)  ──  src/lib/data/media.ts (web)
```

```bash
bash scripts/build-media.sh                       # everything, then it checks the result      (npx tsx scripts/build-media.ts)
npx tsx scripts/build-media.ts --only stills,og   # some sections: day, orbit, stills, og, video
npx tsx scripts/build-media.ts --partial          # build the sections whose renders are complete, keep the others as they are
npx tsx scripts/check-media.ts                    # freshness check (no ImageMagick, no ffmpeg needed)
npx vitest run scripts/__tests__/media.test.ts    # tests on synthetic renders (skipped parts when a tool is missing)
```

Options of `build-media.ts`: `--in <dir>` (renders, default `pipeline/out`), `--out <dir>` (media folder, default `public/media`),
`--no-video`, `--no-prune`, `--no-check`, `--force` (encode the video again), `--jobs <n>` (parallel conversions, default CPU count up
to 8), `--video-mb <lo-hi>` (default `10-14`), `--cache <file>` (video cache, default `pipeline/out/media-cache.json`),
`--render <file>`, `--model-dir <dir>`, `--render-inputs <file>`, `--quiet`. Exit code 0 = ok, 1 = renders missing or a step failed,
2 = bad usage.

**Tools.** `magick` (ImageMagick 7) and `ffmpeg` with libx264 are looked up through the environment variables `MAGICK` and `FFMPEG`
(a path), then in `PATH`, then in the usual install folders (`/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`, `/opt/local/bin`) and, for
ffmpeg, in `node_modules/ffmpeg-static`. Without ffmpeg the build stops before it writes anything, unless `--no-video` (or `--partial`, which
skips only the video) is given. `check-media` needs neither tool.

## 1. Inputs

Which renders exist is **data**: `model/render.json` (read with `scripts/lib/render-schema.ts`; the same shot list as
`docs/RENDER-INPUTS.md`). A render is `<in>/<base>.png` (or `.jpg` / `.jpeg`, PNG first); `<base>` is the logical `file` name of the shot.

| section | renders | size of the render |
|---|---|---|
| `day` | `day/0800` … `day/2130`: one per time of the day ranges (30) | `day.size`, 1920 x 1080 |
| `orbit` | `orbit/landscape/0000, 0005 … 0295` (every `scrollStep`th of the 300 frames), `orbit/portrait/0000, 0005 … 0295` (own renders of the portrait variant) | 1920 x 1080 and 1080 x 1620 |
| `stills` | `stills/<id>` (9) and `compare/<id>-before`, `compare/<id>-after` (2, the compare pair) | 1920 x 1080 |
| `og` | `og/og` | 1200 x 630 |
| `video` | all 300 landscape frames `orbit/landscape/0000 … 0299`, one folder, one extension | 1920 x 1080 |

Sizes may differ from these (a draft render at a smaller size works): crop boxes scale with the render, a picture with another aspect ratio
than its target is scaled to cover it and cropped in the middle (with a warning). Missing renders are listed by section and base name; **without
`--partial` nothing is written when any selected render is missing.**

## 2. Outputs

| files | size | JPEG quality | made from |
|---|---|---|---|
| `day/l/<HHMM>.<hash>.jpg` (30) | 1920 x 1080 | 80 | the day render |
| `day/p/<HHMM>.<hash>.jpg` (30) | 800 x 1200 | 78 | the portrait crop box of the day render (`day.portrait` of `model/render.json`: 2:3, centred on `centerX`; 720 x 1080 at x = 600 for the 1920 x 1080 render), scaled to 800 x 1200 |
| `orbit/l/<NNN>.<hash>.jpg` (60) | 1600 x 900 | 80 | every 5th landscape frame (0, 5, … 295) |
| `orbit/p/<NNN>.<hash>.jpg` (60) | 600 x 900 | 78 | the portrait renders (no crop: the portrait variant has its own camera) |
| `stills/<id>.<hash>.jpg` (11) | 1920 x 1080 | 84 | the stills and the two compare shots |
| `orbit/orbit.<hash>.mp4` | 1600 x 900, 24 fps, 12.5 s | CRF 12 to 34 | all 300 landscape frames, section 4 |
| `orbit/poster.<hash>.jpg` | 1600 x 900 | 80 | the first frame of the video |
| `og.<hash>.jpg` | 1200 x 630 | 86 | the Open Graph render |
| `twitter.<hash>.jpg` | 1200 x 600 | 86 | the same render, cropped in the middle (2:1 for large Twitter cards) |
| `manifest.json` | | | section 3 |

All JPEGs are progressive, 4:2:0, sRGB without a profile, resized with Lanczos, and **carry no metadata**: `magick ... -strip` removes Exif, XMP,
ICC, comments and every thumbnail (only the JFIF header stays); `check-media` fails on any other application segment or comment. Sizes and qualities
are the table `SPEC` in `scripts/lib/media-plan.ts`.

**Names and hashes.** Every file name carries a content hash (`.<10 hex>.`) so the files can be cached as immutable. A single file's hash is the
first 10 characters of the SHA-256 of its bytes. The frames of a sequence share one hash (the `{hash}` token of the manifest): the SHA-256 of the
bytes of all frames, landscape in order, then portrait in order, shortened to 10 characters. A changed frame therefore renames the whole sequence;
the files of earlier builds are removed after the new manifest is written (only generated, hash-named files; nothing else is deleted).

## 3. `manifest.json` (`media/1`)

Validated by `mediaManifestSchema` in `scripts/lib/media-plan.ts`, which accepts the same manifests as the schema of `src/lib/data/media.ts`
(the test checks both) plus two fields the web may ignore. Paths are relative to `public/` and start with `media/`; patterns contain `{i}` (the
frame number, 3 digits, zero based), `{time}` (`HHMM`) and `{hash}` (the hash of the sequence).

```jsonc
{
  "schema": "media/1",
  "inputHash": "<64 hex>",        // hashModelFiles of model/*.json the renders were made from (docs/HOUSE-FORMAT.md section 8); null when unknown
  "day": {
    "date": "2026-06-21", "times": ["08:00", ... , "21:30"], "stillTime": "13:00", "hash": "<10 hex>",
    "landscape": { "pattern": "media/day/l/{time}.{hash}.jpg", "width": 1920, "height": 1080 },
    "portrait":  { "pattern": "media/day/p/{time}.{hash}.jpg", "width": 800,  "height": 1200 }
  },
  "orbit": {
    "frames": 60, "degPerFrame": 6, "hash": "<10 hex>",       // 60 scroll positions, 360 * scrollStep / frameCount degrees each
    "landscape": { "pattern": "media/orbit/l/{i}.{hash}.jpg", "width": 1600, "height": 900 },
    "portrait":  { "pattern": "media/orbit/p/{i}.{hash}.jpg", "width": 600,  "height": 900 },
    "video": { "file": "media/orbit/orbit.<hash>.mp4", "poster": "media/orbit/poster.<hash>.jpg", "width": 1600, "height": 900, "fps": 24, "durationS": 12.5 }
  },
  "stills": [ { "id", "file": "media/stills/<id>.<hash>.jpg", "width": 1920, "height": 1080, "date", "time", "category", "title": {cs,en}, "alt": {cs,en} } ],
  "compare": { "a": "day-night-before", "b": "day-night-after" },   // ids in `stills`
  "og": { "file": "media/og.<hash>.jpg", "width": 1200, "height": 630,
          "twitter": { "file": "media/twitter.<hash>.jpg", "width": 1200, "height": 600 } }   // twitter: extra field (optional)
}
```

* `day.times`, `stillTime`, `date` come from the day ranges of `model/render.json`; `orbit.frames` is `ceil(frameCount / scrollStep)`.
* `stills` has the 9 gallery stills in the order of `model/render.json` and, **last, the two shots of the compare pair** (ids `<compare.id>-before`
  and `-after`, `compare` names them). The gallery may hide the two ids named in `compare`. `title` is the `label`, `alt` the `alt` of the
  render config; the compare shots use their `label` as the title and "label. pair description" as the alt text (both languages).
* `category`: the render categories `exterior`, `interior`, `aerial` pass through, `evening` becomes `exterior` (the time of day is in `time`),
  the compare shots are `interior`. `detail` is allowed by the schema but no render config shot maps to it.
* `orbit.video` is absent only when the video was never built. The web should use the 60 scroll frames for scrolling and the video for playback.
* `inputHash` lets CI see that the renders are older than the model: `check-media` fails when it differs from the current `model/*.json` (when
  `generated/render-inputs.json` exists and was made from other model files, the build warns and records the hash of those files, so the media
  are flagged stale until they are rendered again).

## 4. The video

300 frames at 24 fps, 1:1, no interpolation: `-framerate 24 ... -frames:v 300`. Because the last orbit frame is one angular step before the first,
the video loops without a jump (the build compares the distance last-to-first with the typical distance between neighbours and warns when it
is more than 2.5 times larger).

* H.264 High (`libx264 -preset slow -profile:v high -g 48`), `yuv420p`, 1600 x 900 (Lanczos), `-movflags +faststart`, no audio.
* **Colour**: the renders are sRGB pictures; the video is converted with the BT.709 matrix to limited range and tagged BT.709
  (`-colorspace/-color_primaries/-color_trc bt709 -color_range tv`), so a browser shows the colours of the stills. Tested: a lossless round
  trip differs from the source by less than 0.4 percent, while an untagged video shifts colours by 3 to 5 levels.
* **No metadata**: `-map_metadata -1 -fflags +bitexact -flags:v +bitexact`, the SEI NAL units (the x264 version and settings) are removed with the
  `filter_units` bitstream filter, and the build blanks the "compressor name" field of the sample entry. `check-media` reads the MP4 boxes
  itself and fails on a metadata box, a creation time, an encoder name or an audio track.
* **Size**: the CRF is searched until the file is **10 to 14 MB** (`--video-mb`): start at 18, jump by `6 * log2(size / 12 MB)` CRF steps (the size
  doubles every 6 steps), bisect once a too big and a too small CRF are known, search range 12 to 34, at most 8 encodes. If no CRF fits, the CRF
  whose size is closest to the middle of the range wins and the build warns.
* **Cache**: the result (CRF, file) is remembered in `pipeline/out/media-cache.json` under a key made of the bytes of all 300 frames, the ffmpeg
  version and the encode settings; unchanged frames reuse the file in `public/media` (a rebuild of the pictures costs seconds, not minutes).
  `--force` ignores the cache.
* A finished file is probed (`scripts/lib/media-probe.ts`: codec, profile 100, 4:2:0 8-bit, 1600 x 900, 24 fps, 300 samples, index before the
  data, one video track) before it is used; a failing file stops the build.

## 5. Safety of the build

1. Every conversion writes into a staging folder `public/media/.build-<pid>`; every output must be larger than 1 KB and the video must pass the
   probe. Only when all selected sections succeeded are the files moved into place, then `manifest.json` is replaced atomically (written
   to a temporary file, renamed), then old hash-named files are removed. A crash or a failed run leaves the previous media and manifest untouched
   (a crashed run may leave a hidden `.build-*` folder, removed by the next successful run after an hour).
2. The manifest is validated before anything is moved, and every file it names must exist (in the new files or in the folder).
3. Missing renders: exit 1 and a list; nothing is written. `--partial` builds the complete sections, takes the others from the existing
   manifest (which must have them) and still exits 1 while renders are missing.
4. The same renders give byte-identical pictures, the same names and the same manifest: a second run changes no file. (The video is
   deterministic for one ffmpeg build and thread count; another machine may give another, equally valid file and a new hash.)
5. After the build `check-media` runs on the folder (`--no-check` skips it).

## 6. `check-media`

`npx tsx scripts/check-media.ts [--dir public/media] [--no-model-check] [--allow-extra] [--quiet]`; exit 1 on any error. It checks, with no
external tool: the manifest schema; that every named file exists, is not empty and not truncated; the pixel size of every JPEG against the
manifest; that no JPEG carries metadata and all are 4:2:0 (warning); the hash in every file name against its bytes and the sequence hashes
against the frames; the video (H.264 High, 8-bit 4:2:0, size, fps, frame count = `durationS * fps`, duration, fast start, no audio, no
metadata boxes, size below 20 MB, a warning outside 10 to 14 MB); that no generated file is left over that the manifest does not name
(`--allow-extra` skips this); and, unless `--no-model-check`, that `inputHash` equals the hash of the current `model/*.json` and that
days, times, orbit numbers, still ids, dates, times, categories and texts equal `model/render.json`.

## 7. Time (Apple silicon, 8 cores)

Measured on synthetic full size renders (1920 x 1080 JPEG frames): the pictures (30 + 30 day, 60 + 60 orbit, 11 stills, og, twitter, poster)
take 10 to 15 s; the encode of 300 frames at 1600 x 900 with preset slow takes 20 to 30 s per try, typically 2 to 5 tries (140 s with five
tries), so a complete run takes **about 2 to 4 minutes**, and 15 to 30 s when the video is reused from the cache. PNG renders add a little
decoding time. Real, noisier renders may need more tries or longer encodes; the last line of the log lists every try.
