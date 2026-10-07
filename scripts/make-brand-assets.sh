#!/usr/bin/env bash
# Regenerates the icons and the share-image placeholder from the master icon (src/app/icon.svg).
# Needs rsvg-convert and ImageMagick (magick). The Geist TTFs come from node_modules/geist.
# Output: src/app/apple-icon.png, src/app/favicon.ico, public/icons/{icon-192,icon-512,maskable-512}.png,
#         src/app/{opengraph-image,twitter-image}.jpg
set -euo pipefail
cd "$(dirname "$0")/.."

BG="#f4f1e8"; INK="#1b1e21"; MINT="#5fd6ae"
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

# share image placeholder, 1200 x 630: wordmark left, the house mark right (the final render replaces it).
# The graphics come from librsvg, the text is set by ImageMagick directly from the Geist TTFs (librsvg cannot load them).
FONTS="$PWD/node_modules/geist/dist/fonts"
art_body="$(sed -n '/<rect class="ink" x="64"/,/<path class="ridge"/p' "$TMP/square.svg")"
cat > "$TMP/og.svg" <<SVG
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <style>.ink { fill: #eeeadf } .cut { fill: #14171a } .mint { fill: $MINT } .ridge { stroke: $MINT }</style>
  <defs><radialGradient id="g" cx="0.8" cy="0.45" r="0.55"><stop offset="0" stop-color="#1f3a31" stop-opacity="0.9"/><stop offset="1" stop-color="#14171a" stop-opacity="0"/></radialGradient></defs>
  <rect width="1200" height="630" fill="#14171a"/>
  <rect width="1200" height="630" fill="url(#g)"/>
  <g transform="translate(756 130) scale(0.88)">$art_body</g>
</svg>
SVG
rsvg-convert "$TMP/og.svg" -o "$TMP/og.png"
magick "$TMP/og.png" \
  -font "$FONTS/geist-sans/Geist-SemiBold.ttf" -kerning -3 -pointsize 94 -fill "#eeeadf" -annotate +78+326 "House Sample" \
  -font "$FONTS/geist-sans/Geist-Regular.ttf" -kerning 0 -pointsize 38 -fill "$MINT" -annotate +82+394 "Dům Dlouhá střecha" \
  -font "$FONTS/geist-sans/Geist-Regular.ttf" -pointsize 38 -fill "#bcb8ad" -annotate +82+444 "Long Roof House" \
  -font "$FONTS/geist-mono/GeistMono-Regular.ttf" -kerning 1 -pointsize 22 -fill "#9a9a93" -annotate +82+548 "FIKTIVNÍ DŮM · A FICTIONAL HOUSE" \
  -strip -quality 90 -sampling-factor 4:2:0 src/app/opengraph-image.jpg
cp src/app/opengraph-image.jpg src/app/twitter-image.jpg
echo "brand assets written"
