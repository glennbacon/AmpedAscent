#!/bin/bash
# Screenshot all six biomes and montage them (needs the dev server on :5173 and ImageMagick).
#   tools/biomes.sh <out-dir> [extra-query]
S=${1:-/tmp/aa-shots}; mkdir -p "$S"
for w in sylvan aurora mirage coral caverns ember; do
  node tools/shot.mjs "$S/b_$w.png" "autodrive&warp=4&charge&mute&world=$w&$2" 3500 960 540 >/dev/null 2>&1
done
montage "$S"/b_sylvan.png "$S"/b_aurora.png "$S"/b_mirage.png "$S"/b_coral.png "$S"/b_caverns.png "$S"/b_ember.png -tile 2x3 -geometry 960x540+2+2 "$S/biomes.png"
echo "$S/biomes.png"
