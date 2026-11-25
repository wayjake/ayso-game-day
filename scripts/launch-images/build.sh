#!/bin/sh
# Builds the iPhone launch images in public/launch/ from launch.html, one per
# screen (CSS width x height at its pixel ratio), with headless Chrome.
# app/utils/launch-images.ts lists the same screens for the <link> tags; keep them in step.
# Needs Google Chrome (CHROME=/path to override) and a network connection for the font.
# Run from the project root: sh scripts/launch-images/build.sh
set -e
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
SRC="file://$(pwd)/scripts/launch-images/launch.html"
mkdir -p public/launch

# width height ratio
while read -r W H R; do
  [ -z "$W" ] && continue
  OUT="public/launch/launch-$((W * R))x$((H * R)).png"
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --no-first-run \
    --force-device-scale-factor="$R" --window-size="$W,$H" \
    --virtual-time-budget=4000 --screenshot="$OUT" "$SRC?w=$W&h=$H" >/dev/null 2>&1
  echo "$OUT $(sips -g pixelWidth -g pixelHeight "$OUT" | awk '/pixel/ {printf "%s ", $2}')"
done <<SCREENS
440 956 3
420 912 3
402 874 3
430 932 3
393 852 3
428 926 3
390 844 3
375 812 3
414 896 3
414 896 2
414 736 3
375 667 2
320 568 2
SCREENS
