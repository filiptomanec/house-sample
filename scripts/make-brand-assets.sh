#!/usr/bin/env bash
# Regenerates the icons from the master icon (src/app/icon.svg). Icons only: the share images
# (src/app/opengraph-image.jpg, twitter-image.jpg) are renders composited by the media pipeline (docs/MEDIA.md), and
# this script never touches them. The icons carry no text; the house name lives in model/house.json only (the web
# manifest reads it from there through src/lib/site-config.ts), and is read here just to label the output.
# Needs rsvg-convert, ImageMagick (magick) and node.
# Output: src/app/apple-icon.png, src/app/favicon.ico, public/icons/{icon-192,icon-512,maskable-512}.png
set -euo pipefail
cd "$(dirname "$0")/.."

HOUSE="$(node -e 'const n = require("./model/house.json").name; process.stdout.write(Object.values(n).join(" / "))')"

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
ART="src/app/icon.svg"

# the master without its media query and rounded corners: full-bleed square, light scheme
sed -e 's/ rx="112"//' "$ART" | sed -e '/@media/d' > "$TMP/square.svg"
# a maskable icon keeps its art inside the central 80 %: scale the art, keep the background full-bleed
python3 - "$TMP/square.svg" "$TMP/maskable.svg" <<'PY'
import re, sys
s = open(sys.argv[1]).read()
bg = re.search(r'<rect class="bg"[^>]*/>', s).group(0)
art = s.replace(bg, '')
head, rest = art.split('</style>')
body = rest.replace('</svg>', '')
open(sys.argv[2], 'w').write(head + '</style>\n' + bg + '\n<g transform="translate(256 256) scale(0.74) translate(-256 -256)">' + body + '</g></svg>\n')
PY

mkdir -p public/icons
rsvg-convert -w 180 -h 180 "$TMP/square.svg" -o src/app/apple-icon.png
rsvg-convert -w 192 -h 192 "$ART" -o public/icons/icon-192.png
rsvg-convert -w 512 -h 512 "$ART" -o public/icons/icon-512.png
rsvg-convert -w 512 -h 512 "$TMP/maskable.svg" -o public/icons/maskable-512.png
for s in 16 32 48; do rsvg-convert -w $s -h $s "$ART" -o "$TMP/f$s.png"; done
magick "$TMP/f16.png" "$TMP/f32.png" "$TMP/f48.png" src/app/favicon.ico

echo "icons written for $HOUSE"
