#!/usr/bin/env bash
# Stage one screen reaction for the video. Usage: stage-demo.sh props|fail|fix|badge|call|reset
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
case "${1:-}" in
  props) bash "$root/demo/stage/build.sh" && bash "$root/demo/stage/render.sh" ;;
  fail|fix)  # opening a Terminal settings file runs it in a styled window, with no Automation prompt
    bash "$root/demo/stage/build.sh" >/dev/null
    [ "$1" = fail ] && open "$root/demo/bin/PixyPup Fail.terminal" || open "$root/demo/bin/PixyPup Fix.terminal" ;;
  badge)
    [ -d "$root/demo/bin/Pack Chat.app" ] || bash "$root/demo/badge/build.sh"
    open -g "$root/demo/bin/Pack Chat.app" ;;  # -g: stays behind, the badge climbs while you work
  call)  # its own Chrome profile: opens on the built-in display even when Chrome is open elsewhere, and reset can close it
    "$chrome" --user-data-dir="$root/demo/bin/meet-profile" --no-first-run --no-default-browser-check \
      --app="file://$root/demo/meet.html" --window-size=960,620 --window-position=240,70 >/dev/null 2>&1 & ;;
  reset)
    pkill -x "Pack Chat" || true
    pkill -f "user-data-dir=$root/demo/bin/meet-profile" || true
    sed -i '' 's/Math.min(walks \* 2, 6)/Math.min(walks * 2, 5)/' "$root/demo/treats.ts"
    echo "Bug restored in demo/treats.ts, call and Pack Chat closed. Close the demo Terminal windows by hand." ;;
  *) echo "usage: $0 props|fail|fix|badge|call|reset" >&2; exit 2 ;;
esac
