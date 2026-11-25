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

render() { # css-width css-height ratio
  OUT="public/launch/launch-$(($1 * $3))x$(($2 * $3)).png"
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --no-first-run \
    --force-device-scale-factor="$3" --window-size="$1,$2" \
    --virtual-time-budget=4000 --screenshot="$OUT" "$SRC?w=$1&h=$2" >/dev/null 2>&1
  echo "$OUT $(sips -g pixelWidth -g pixelHeight "$OUT" | awk '/pixel/ {printf "%s ", $2}')"
}

# width height ratio orientations: p (portrait) for iPhones, pl (both) for iPads
while read -r W H R O; do
  [ -z "$W" ] && continue
  render "$W" "$H" "$R"
  case "$O" in *l*) render "$H" "$W" "$R" ;; esac
done <<SCREENS
440 956 3 p
420 912 3 p
402 874 3 p
430 932 3 p
393 852 3 p
428 926 3 p
390 844 3 p
375 812 3 p
414 896 3 p
414 896 2 p
414 736 3 p
375 667 2 p
320 568 2 p
1032 1376 2 pl
1024 1366 2 pl
834 1210 2 pl
834 1194 2 pl
820 1180 2 pl
834 1112 2 pl
810 1080 2 pl
744 1133 2 pl
768 1024 2 pl
SCREENS
