#!/usr/bin/env bash
# Web media from the Blender renders: pipeline/out -> public/media (+ manifest.json); the result is checked by check-media.
#   bash scripts/build-media.sh                  everything
#   bash scripts/build-media.sh --only stills    some sections (day, orbit, stills, og, video), more options: docs/MEDIA.md
# Tools: ImageMagick (`magick`) and ffmpeg are looked up in PATH and in the standard places; MAGICK=/path and FFMPEG=/path override.
set -euo pipefail
cd "$(dirname "$0")/.."
npx tsx scripts/build-media.ts "$@"
