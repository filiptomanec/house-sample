#!/usr/bin/env bash
# Renders everything: stills (with the compare pair and the Open Graph shot), the day sequence, the orbit (300 landscape frames,
# then the 60 portrait scroll frames). Resumable: existing frames are skipped, a crashed Blender is started again.
#
#   pipeline/render/run_all.sh [draft|final] [steps]
#   caffeinate -i pipeline/render/run_all.sh final            # keeps the Mac awake (caffeinate is the caller's job)
#
# steps (default: all), any of: stills day orbit portrait        e.g.  run_all.sh final day orbit
# Environment: BLENDER (path of the Blender binary), RENDER_DEVICE (auto|gpu|cpu), RENDER_SAMPLES (override), CHUNK (orbit frames
# per Blender process, default 100), RETRIES (restarts per chunk, default 4).
# Output: pipeline/out/{stills,compare,og,day,orbit}/... (final) or pipeline/out/draft/... (draft); logs in pipeline/out/logs.
set -u
cd "$(dirname "$0")/../.."
ROOT="$(pwd)"
QUALITY="${1:-draft}"
case "$QUALITY" in draft|final) shift || true ;; *) QUALITY=draft ;; esac
STEPS="${*:-stills day orbit portrait}"
CHUNK="${CHUNK:-100}"
RETRIES="${RETRIES:-4}"

find_blender() {
  if [ -n "${BLENDER:-}" ]; then echo "$BLENDER"; return; fi
  local c
  for c in "/Applications/Blender.app/Contents/MacOS/Blender" "$(command -v blender 2>/dev/null)" "/usr/bin/blender" "/opt/blender/blender"; do
    if [ -n "$c" ] && [ -x "$c" ]; then echo "$c"; return; fi
  done
  echo ""
}
BLENDER_BIN="$(find_blender)"
[ -n "$BLENDER_BIN" ] || { echo "Blender not found: set BLENDER=/path/to/Blender" >&2; exit 2; }

LOGDIR="$ROOT/pipeline/out/logs"
mkdir -p "$LOGDIR"
LOG="$LOGDIR/run_all-$QUALITY.log"
log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" | tee -a "$LOG"; }

# the inputs must match model/*.json (rebuilt here: deterministic and fast)
if command -v npx >/dev/null 2>&1 && [ -f scripts/build-render-inputs.ts ]; then
  if ! npx --no-install tsx scripts/build-render-inputs.ts --check >/dev/null 2>&1; then
    log "render inputs are stale: rebuilding"
    npx --no-install tsx scripts/build-render-inputs.ts >>"$LOG" 2>&1 || log "WARNING: could not rebuild generated/render-inputs.json (photo.py refuses stale inputs)"
  fi
fi

photo() { "$BLENDER_BIN" -b --factory-startup --python "$ROOT/pipeline/render/photo.py" -- "$@"; }

# render_range <mode> <extra args...>  : runs Blender until nothing is missing (at most RETRIES restarts)
render_until_done() {
  local label="$1"; shift
  local n=0
  while :; do
    if photo "$@" --missing >/dev/null 2>&1; then log "$label: complete"; return 0; fi
    if [ "$n" -gt "$RETRIES" ]; then log "$label: still incomplete after $RETRIES restarts"; return 1; fi
    n=$((n + 1))
    log "$label: rendering (attempt $n)"
    photo "$@" --skip-existing 2>&1 | grep -v "DracoDecoder\|INFO:" >>"$LOGDIR/blender-$QUALITY.log"
  done
}

T0=$(date +%s)
log "run_all $QUALITY: steps: $STEPS (Blender: $BLENDER_BIN)"
FAIL=0
for step in $STEPS; do
  case "$step" in
    stills)   render_until_done "stills" --mode stills --quality "$QUALITY" --skip-existing || FAIL=1 ;;
    day)      render_until_done "day" --mode day --quality "$QUALITY" --skip-existing || FAIL=1 ;;
    orbit)    a=0
              while [ "$a" -lt 300 ]; do
                b=$((a + CHUNK))
                render_until_done "orbit $a:$b" --mode orbit --variant landscape --quality "$QUALITY" --range "$a:$b" --skip-existing || FAIL=1
                a=$b
              done ;;
    portrait) render_until_done "orbit portrait" --mode orbit --variant portrait --quality "$QUALITY" --skip-existing || FAIL=1 ;;
    *) log "unknown step $step"; FAIL=1 ;;
  esac
done
log "run_all $QUALITY finished in $(( $(date +%s) - T0 )) s, failures: $FAIL"
exit "$FAIL"
