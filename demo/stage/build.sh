#!/usr/bin/env bash
# Builds the demo props into demo/bin (gitignored): the two styled Terminal windows and Pack Chat.
set -euo pipefail
demo="$(cd "$(dirname "$0")/.." && pwd)"
bin="$demo/bin"; mkdir -p "$bin"
tp="$bin/terminal-profile"
[ "$tp" -nt "$demo/stage/terminal-profile.swift" ] || swiftc -O "$demo/stage/terminal-profile.swift" -o "$tp"
"$tp" "$bin/PixyPup Fail.terminal" "pakkun-treats — npm test" "bash '$demo/stage/run.sh' fail"
"$tp" "$bin/PixyPup Fix.terminal" "pakkun-treats — npm test" "bash '$demo/stage/run.sh' fix"
[ -d "$bin/Pack Chat.app" ] || bash "$demo/badge/build.sh"
echo "built demo props in $bin"
