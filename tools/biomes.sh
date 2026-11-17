#!/bin/bash
# Screenshot all six biomes and montage them: tools/biomes.sh <name> "<extra query>"
S=/tmp/claude-0/-home-user/eeb31400-27d9-5a2f-991f-00d7ea95281f/scratchpad/shots
for w in sylvan aurora mirage coral caverns ember; do
  node tools/shot.mjs $S/b_$w.png "autodrive&warp=4&world=$w&$2" 3500 960 540 >/dev/null 2>&1 &
done
wait
montage $S/b_sylvan.png $S/b_aurora.png $S/b_mirage.png $S/b_coral.png $S/b_caverns.png $S/b_ember.png -tile 2x3 -geometry 960x540+2+2 $S/$1.png
echo done
