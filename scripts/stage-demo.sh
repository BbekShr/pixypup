#!/usr/bin/env bash
# Stage one screen reaction for the video. Usage: stage-demo.sh fail|fix|badge|call|reset
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
case "${1:-}" in
  fail) open "$root/demo/fail.command" ;;
  fix) open "$root/demo/pass.command" ;;
  badge)
    [ -d "$root/demo/bin/Badge Demo.app" ] || bash "$root/demo/badge/build.sh"
    open "$root/demo/bin/Badge Demo.app" ;;
  call) open -a "Google Chrome" "$root/demo/meet.html" ;;
  reset)
    pkill -x "Badge Demo" || true
    echo "Close by hand: the Meet tab in Chrome and the Terminal windows from 'fail' and 'fix'." ;;
  *) echo "usage: $0 fail|fix|badge|call|reset" >&2; exit 2 ;;
esac
