#!/bin/bash
# Opens the styled demo Terminal on the failing test (no Automation prompt: Terminal opens its own settings file).
root="$(cd "$(dirname "$0")/.." && pwd)"
bash "$root/demo/stage/build.sh" >/dev/null
open "$root/demo/bin/PixyPup Fail.terminal"
