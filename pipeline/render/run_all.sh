#!/usr/bin/env bash
# The render driver: every picture of the site in the run order of the plan (docs/PIPELINE-RENDER.md, section 5), resumable
# (existing frames are skipped, a crashed Blender is started again), and it stops cleanly when the disk runs low.
#
#   pipeline/render/run_all.sh [draft|final] [steps]
#   caffeinate -i pipeline/render/run_all.sh final            # keeps the Mac awake (caffeinate is the caller's job)
#
# steps (default: all, in this order):
#   stills    the stills (render-inputs `stills`)
#   compare   the before/after pair
#   og        the Open Graph picture
#   day       the day sequence, landscape
#   dayp      the day sequence, portrait (its own camera)
#   scroll    the orbit scroll frames, landscape (every scrollStep-th frame: what the page needs first)
#   orbitp    the orbit scroll frames, portrait
#   rest      the remaining orbit frames, landscape (the video)
#   aliases:  orbit = scroll rest, portrait = orbitp
# Environment: BLENDER (path of the Blender binary), RENDER_DEVICE (auto|gpu|cpu), RENDER_SAMPLES (override), CHUNK (orbit frames
# per Blender process, default 60), RETRIES (restarts per chunk, default 4), OUT (output folder; default pipeline/out for final,
# pipeline/out/draft for draft), MIN_FREE_GB (default: config.json qa.minFreeDiskGB).
# Output: <out>/{stills,compare,og,day,orbit}/...; logs in pipeline/out/logs. Exit codes: 0 all done, 1 something is incomplete,
# 2 setup problem, 3 stopped because the disk is low.
set -u
cd "$(dirname "$0")/../.."
ROOT="$(pwd)"
QUALITY="${1:-draft}"
case "$QUALITY" in draft|final) shift || true ;; *) QUALITY=draft ;; esac
STEPS="${*:-stills compare og day dayp scroll orbitp rest}"
STEPS="$(echo " $STEPS " | sed -e 's/ orbit / scroll rest /g' -e 's/ portrait / orbitp /g')"
CHUNK="${CHUNK:-60}"
RETRIES="${RETRIES:-4}"
if [ "$QUALITY" = final ]; then OUT="${OUT:-$ROOT/pipeline/out}"; else OUT="${OUT:-$ROOT/pipeline/out/draft}"; fi
MIN_FREE_GB="${MIN_FREE_GB:-$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["qa"]["minFreeDiskGB"])' \
  "$ROOT/pipeline/render/config.json" 2>/dev/null || echo 8)}"

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
mkdir -p "$LOGDIR" "$OUT"
LOG="$LOGDIR/run_all-$QUALITY.log"
log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" | tee -a "$LOG"; }

# free space on the output volume in GB (integer); the driver stops below MIN_FREE_GB
free_gb() { df -Pk "$OUT" | awk 'NR==2 { printf "%d", $4 / 1048576 }'; }
check_disk() {
  local f; f="$(free_gb)"
  if [ "$f" -lt "$MIN_FREE_GB" ]; then
    log "STOP: only $f GB free on the output volume (minimum $MIN_FREE_GB GB); free some space and run again (it resumes)"
    exit 3
  fi
}

# the inputs must match model/*.json (rebuilt here: deterministic and fast)
if command -v npx >/dev/null 2>&1 && [ -f scripts/build-render-inputs.ts ]; then
  if ! npx --no-install tsx scripts/build-render-inputs.ts --check >/dev/null 2>&1; then
    log "render inputs are stale: rebuilding"
    npx --no-install tsx scripts/build-render-inputs.ts >>"$LOG" 2>&1 || log "WARNING: could not rebuild generated/render-inputs.json (photo.py refuses stale inputs)"
  fi
fi

photo() { "$BLENDER_BIN" -b --factory-startup --python "$ROOT/pipeline/render/photo.py" -- "$@"; }

# count <photo args>: the number of shots of a list (no scene is built)
count() { photo "$@" --list 2>/dev/null | grep -c -E '^(stills|compare|og|day|orbit)/' ; }

# render_until_done <label> <photo args>: runs Blender until nothing is missing (at most RETRIES restarts)
render_until_done() {
  local label="$1"; shift
  local n=0
  while :; do
    if photo "$@" --out "$OUT" --missing >/dev/null 2>&1; then log "$label: complete"; return 0; fi
    if [ "$n" -gt "$RETRIES" ]; then log "$label: still incomplete after $RETRIES restarts"; return 1; fi
    check_disk
    n=$((n + 1))
    log "$label: rendering (attempt $n, $(free_gb) GB free)"
    photo "$@" --out "$OUT" --skip-existing 2>&1 | grep -v "DracoDecoder\|INFO:" >>"$LOGDIR/blender-$QUALITY.log"
  done
}

# chunked <label> <photo args>: the same in chunks of CHUNK shots (positions in the list), one Blender process per chunk
chunked() {
  local label="$1"; shift
  local total a b rc=0
  total="$(count "$@")"
  [ "$total" -gt 0 ] || { log "$label: nothing to render"; return 0; }
  a=0
  while [ "$a" -lt "$total" ]; do
    b=$((a + CHUNK))
    render_until_done "$label $a:$b of $total" "$@" --range "$a:$b" || rc=1
    a=$b
  done
  return $rc
}

T0=$(date +%s)
log "run_all $QUALITY: steps:$STEPS-> $OUT (Blender: $BLENDER_BIN, stop below $MIN_FREE_GB GB free)"
check_disk
FAIL=0
Q="--quality $QUALITY"
for step in $STEPS; do
  case "$step" in
    stills)  render_until_done "stills" --mode stills $Q --subset stills || FAIL=1 ;;
    compare) render_until_done "compare" --mode stills $Q --subset compare || FAIL=1 ;;
    og)      render_until_done "og" --mode stills $Q --subset og || FAIL=1 ;;
    day)     render_until_done "day landscape" --mode day $Q --variant landscape || FAIL=1 ;;
    dayp)    render_until_done "day portrait" --mode day $Q --variant portrait || FAIL=1 ;;
    scroll)  chunked "orbit scroll landscape" --mode orbit $Q --variant landscape --subset scroll || FAIL=1 ;;
    orbitp)  chunked "orbit portrait" --mode orbit $Q --variant portrait || FAIL=1 ;;
    rest)    chunked "orbit rest landscape" --mode orbit $Q --variant landscape --subset rest || FAIL=1 ;;
    *) log "unknown step $step"; FAIL=1 ;;
  esac
done
log "run_all $QUALITY finished in $(( $(date +%s) - T0 )) s, failures: $FAIL"
[ "$FAIL" -eq 0 ] && log "ALL DONE"
exit "$FAIL"
