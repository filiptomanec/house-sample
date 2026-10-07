#!/usr/bin/env bash
# Builds the procedural 3D model of the house and everything that belongs to it:
#   public/models/house.glb, house-lite.glb, house.usdz, manifest.json
# from generated/derived.json + model/house.json + model/style.json, then verifies the GLBs.
#
#   pipeline/build_model.sh [--lite-only] [--no-usdz]
#
# Environment: BLENDER (default: the macOS app), DERIVED / HOUSE / STYLE (input paths), MODELS_OUT (output directory).
# Blender 5.1 is expected (glTF exporter with Draco and WebP). Textures are cached in pipeline/out/tex.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BLENDER="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
DERIVED="${DERIVED:-$ROOT/generated/derived.json}"
HOUSE="${HOUSE:-$ROOT/model/house.json}"
STYLE="${STYLE:-$ROOT/model/style.json}"
OUT="${MODELS_OUT:-$ROOT/public/models}"
LITE_ONLY=0
USDZ=1
for a in "$@"; do
  case "$a" in
    --lite-only) LITE_ONLY=1 ;;
    --no-usdz) USDZ=0 ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done

[ -x "$BLENDER" ] || { echo "Blender not found at $BLENDER (set BLENDER)" >&2; exit 2; }
for f in "$DERIVED" "$HOUSE"; do [ -f "$f" ] || { echo "missing input: $f" >&2; exit 2; }; done
STYLE_ARGS=()
[ -f "$STYLE" ] && STYLE_ARGS=(--style "$STYLE")
mkdir -p "$OUT" "$ROOT/pipeline/out"

build() { # build <lod> [extra args]
  local lod="$1"; shift
  local log="$ROOT/pipeline/out/build-$lod${1:+-usdz}.log"
  echo "== Blender: $lod $*"
  if ! "$BLENDER" -b --factory-startup --python-exit-code 1 --python "$ROOT/pipeline/blender/build_house.py" -- \
      --derived "$DERIVED" --house "$HOUSE" ${STYLE_ARGS[@]+"${STYLE_ARGS[@]}"} --out "$OUT" --lod "$lod" "$@" >"$log" 2>&1; then
    tail -40 "$log" >&2
    echo "Blender failed (log: $log)" >&2
    exit 1
  fi
  grep -E "^\[house\]" "$log" || true
}

if [ "$LITE_ONLY" = 0 ]; then build high; fi
build lite
if [ "$LITE_ONLY" = 0 ] && [ "$USDZ" = 1 ]; then build lite --usdz; fi

cd "$ROOT"
status=0
if [ "$LITE_ONLY" = 0 ]; then npx tsx scripts/verify-glb.ts "$OUT/house.glb" --derived "$DERIVED" || status=1; fi
npx tsx scripts/verify-glb.ts "$OUT/house-lite.glb" --lite --derived "$DERIVED" || status=1
if [ "$USDZ" = 1 ] && [ -f "$OUT/house.usdz" ]; then
  size=$(stat -f%z "$OUT/house.usdz" 2>/dev/null || stat -c%s "$OUT/house.usdz")
  echo "house.usdz: $size B"
  [ "$size" -le 6000000 ] || { echo "ERROR: house.usdz exceeds 6 MB" >&2; status=1; }
fi
npx tsx scripts/build-models-manifest.ts --dir "$OUT" --derived "$DERIVED" || status=1
exit $status
