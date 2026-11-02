#!/bin/bash
# The fix for the video: a one-line change in demo/treats.ts, then the same test, now green.
root="$(cd "$(dirname "$0")/.." && pwd)"
bash "$root/demo/stage/build.sh" >/dev/null
open "$root/demo/bin/PixyPup Fix.terminal"
