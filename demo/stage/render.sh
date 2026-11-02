#!/usr/bin/env bash
# Renders the demo wallpapers (light and dark, built-in display and 4K) into demo/bin/ with headless Chrome.
set -euo pipefail
demo="$(cd "$(dirname "$0")/.." && pwd)"
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
mkdir -p "$demo/bin"; tmp="$(mktemp -d)"
for theme in light dark; do
  for size in 1440,900 1920,1080; do
    "$chrome" --headless=new --hide-scrollbars --force-device-scale-factor=2 --user-data-dir="$tmp" --virtual-time-budget=4000 \
      --window-size="$size" --screenshot="$demo/bin/wallpaper-$theme-${size%,*}.png" "file://$demo/stage/wallpaper.html?theme=$theme" 2>/dev/null
  done
done
ls "$demo/bin"/wallpaper-*.png
