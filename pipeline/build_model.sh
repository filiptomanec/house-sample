#!/usr/bin/env bash
# Builds the procedural 3D model of the house and everything that belongs to it:
#   public/models/house.glb, house-lite.glb, house.usdz          (pipeline/blender/build_house.py)
#   public/models/furniture.glb, furniture-lite.glb, furniture-footprints.json   (pipeline/furniture/build.py)
#   public/models/tree.glb, tree-lite.glb                         (pipeline/blender/vegetation_bake.py, from the CC0 asset)
#   public/models/manifest.json
# from generated/derived.json + model/house.json + model/style.json, then verifies the GLBs.
#
#   pipeline/build_model.sh [--lite-only] [--no-usdz] [--no-furniture] [--no-trees]
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
FURNITURE=1
TREES=1
for a in "$@"; do
  case "$a" in
    --lite-only) LITE_ONLY=1 ;;
    --no-usdz) USDZ=0 ;;
    --no-furniture) FURNITURE=0 ;;
    --no-trees) TREES=0 ;;
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

# Blender's USD exporter is not byte-reproducible (the token table of the .usdc is ordered by pointer hash), the GLBs are. So
# house.usdz is rebuilt only when an input changed (derived data without its model hash, house, style, the builder code, the
# list of texture files); the key of the last build is kept in pipeline/out (git-ignored). Delete the key to force a rebuild.
USDZ_KEY_FILE="$ROOT/pipeline/out/house.usdz.key"
usdz_key() {
  {
    echo "$OUT"                                   # a build into another directory never reuses this one's key
    sed '/"inputHash"/d' "$DERIVED"
    cat "$HOUSE"
    [ -f "$STYLE" ] && cat "$STYLE"
    cat "$ROOT/pipeline/blender/build_house.py" "$ROOT"/pipeline/blender/hb/*.py
    if [ -d "$ROOT/assets" ]; then (cd "$ROOT/assets" && find . -type f -exec ls -l {} + | awk '{print $5, $NF}' | sort -k2); fi
  } | shasum -a 256 | cut -d' ' -f1
}

if [ "$LITE_ONLY" = 0 ]; then build high; fi
build lite
if [ "$LITE_ONLY" = 0 ] && [ "$USDZ" = 1 ]; then
  key="$(usdz_key)"
  if [ -f "$OUT/house.usdz" ] && [ -f "$USDZ_KEY_FILE" ] && [ "$(cat "$USDZ_KEY_FILE")" = "$key" ]; then
    echo "== house.usdz: inputs unchanged, file kept"
  else
    build lite --usdz
    echo "$key" > "$USDZ_KEY_FILE"
  fi
fi

# furniture (desktop writes the footprints; the lite build only its GLB)
if [ "$LITE_ONLY" = 0 ] && [ "$FURNITURE" = 1 ]; then
  for detail in high lite; do
    log="$ROOT/pipeline/out/build-furniture-$detail.log"
    echo "== Blender: furniture $detail"
    if ! "$BLENDER" -b --factory-startup --python-exit-code 1 --python "$ROOT/pipeline/furniture/build.py" -- \
        --detail "$detail" --house "$HOUSE" --derived "$DERIVED" --out "$OUT/furniture$([ "$detail" = lite ] && echo -lite).glb" \
        $([ "$detail" = high ] && echo --footprints "$OUT/furniture-footprints.json") >"$log" 2>&1; then
      tail -40 "$log" >&2
      echo "Blender failed (log: $log)" >&2
      exit 1
    fi
    grep -E "WARN|ERROR|exported" "$log" || true
  done
fi

# web trees, baked from the CC0 tree asset when it is present (git-ignored assets/); rebuilt only when the asset, the style
# (foliage and bark colours) or the bake script changed (the key of the last bake is kept in pipeline/out)
TREE_ASSET="$ROOT/assets/models/tree_small_02/tree_small_02_1k.gltf"
TREE_KEY_FILE="$ROOT/pipeline/out/tree.key"
if [ "$LITE_ONLY" = 0 ] && [ "$TREES" = 1 ]; then
  if [ -f "$TREE_ASSET" ]; then
    tkey="$( { echo "$OUT"; cat "$ROOT/pipeline/blender/vegetation_bake.py"; [ -f "$STYLE" ] && cat "$STYLE"; (cd "$(dirname "$TREE_ASSET")" && find . -type f -exec ls -l {} + | awk '{print $5, $NF}' | sort -k2); } | shasum -a 256 | cut -d' ' -f1)"
    if [ -f "$OUT/tree.glb" ] && [ -f "$OUT/tree-lite.glb" ] && [ -f "$TREE_KEY_FILE" ] && [ "$(cat "$TREE_KEY_FILE")" = "$tkey" ]; then
      echo "== tree.glb: asset and bake unchanged, files kept"
    else
      echo "== Blender: trees"
      if ! "$BLENDER" -b --factory-startup --python-exit-code 1 --python "$ROOT/pipeline/blender/vegetation_bake.py" -- \
          --asset "$TREE_ASSET" --out "$OUT" ${STYLE_ARGS[@]+"${STYLE_ARGS[@]}"} >"$ROOT/pipeline/out/build-trees.log" 2>&1; then
        tail -40 "$ROOT/pipeline/out/build-trees.log" >&2
        echo "Blender failed (log: $ROOT/pipeline/out/build-trees.log)" >&2
        exit 1
      fi
      grep -E "^\[tree\]" "$ROOT/pipeline/out/build-trees.log" || true
      echo "$tkey" > "$TREE_KEY_FILE"
    fi
  else
    echo "== trees skipped: $TREE_ASSET not found (see ASSETS.md); the committed tree.glb files are kept"
  fi
fi

cd "$ROOT"
status=0
if [ "$LITE_ONLY" = 0 ]; then npx tsx scripts/verify-glb.ts "$OUT/house.glb" --derived "$DERIVED" || status=1; fi
npx tsx scripts/verify-glb.ts "$OUT/house-lite.glb" --lite --derived "$DERIVED" || status=1
if [ "$USDZ" = 1 ] && [ -f "$OUT/house.usdz" ]; then
  size=$(stat -f%z "$OUT/house.usdz" 2>/dev/null || stat -c%s "$OUT/house.usdz")
  echo "house.usdz: $size B"
  [ "$size" -le 6000000 ] || { echo "ERROR: house.usdz exceeds 6 MB" >&2; status=1; }
fi
if [ "$LITE_ONLY" = 0 ] && [ "$FURNITURE" = 1 ]; then
  npx tsx scripts/verify-furniture.ts --dir "$OUT" --house "$HOUSE" --derived "$DERIVED" || status=1
fi
npx tsx scripts/build-models-manifest.ts --dir "$OUT" --derived "$DERIVED" || status=1
exit $status
