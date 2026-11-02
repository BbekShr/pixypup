#!/usr/bin/env bash
# Stage one screen reaction for the video. Usage: stage-demo.sh props|fail|fix|badge|call|reset
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
case "${1:-}" in
  props) bash "$root/demo/stage/build.sh" && bash "$root/demo/stage/render.sh" ;;
  fail) open "$root/demo/fail.command" ;;
  fix) open "$root/demo/pass.command" ;;
  badge)
    [ -d "$root/demo/bin/Pack Chat.app" ] || bash "$root/demo/badge/build.sh"
    open -g "$root/demo/bin/Pack Chat.app" ;;  # -g: stays behind, the badge climbs while you work
  call) "$chrome" --app="file://$root/demo/meet.html" --window-size=1100,720 --window-position=170,60 >/dev/null 2>&1 & ;;
  reset)
    pkill -x "Pack Chat" || true
    sed -i '' 's/Math.min(walks \* 2, 6)/Math.min(walks * 2, 5)/' "$root/demo/treats.ts"
    echo "Bug restored in demo/treats.ts. Close by hand: the call window and the demo Terminal windows." ;;
  *) echo "usage: $0 props|fail|fix|badge|call|reset" >&2; exit 2 ;;
esac
