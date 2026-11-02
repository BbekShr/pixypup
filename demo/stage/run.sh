#!/bin/bash
# Runs inside the "PixyPup Demo" Terminal window: fail shows the bug, fix shows the one-line fix going green.
cd "$(dirname "$0")/../.." || exit 1
# Same spot every take: centred on the built-in display (where the pet lives), clear of its floor.
# Terminal moving its own window raises no Automation prompt; the escape is the fallback.
TTY="$(tty)" osascript -l JavaScript -e '
  ObjC.import("AppKit");
  const s = $.NSScreen.screens, main = s.objectAtIndex(0).frame;  // AppleScript y counts from the top of the whole desktop
  let top = 0; for (let i = 0; i < s.count; i++) { const f = s.objectAtIndex(i).frame; top = Math.max(top, f.origin.y + f.size.height); }
  const me = $.NSProcessInfo.processInfo.environment.objectForKey("TTY").js;  // this window, not whichever is in front
  const w = Application("Terminal").windows().find((x) => x.tabs().some((t) => t.tty() === me));
  w.bounds = { x: 320, y: top - main.size.height + 40, width: 800, height: 720 };' >/dev/null 2>&1 || printf '\e[3;320;40t'
clear
dim=$'\e[2m'; off=$'\e[0m'
prompt="${dim}~/pakkun-treats${off} \$ "
type_out() { for ((i = 0; i < ${#1}; i++)); do printf '%s' "${1:i:1}"; sleep 0.04; done; echo; }
if [ "$1" = fix ]; then
  sed -i '' 's/Math.min(walks \* 2, 5)/Math.min(walks * 2, 6)/' demo/treats.ts
  printf '%s' "$prompt"; type_out "git diff"
  git --no-pager diff --color -U0 demo/treats.ts
  echo
fi
printf '%s' "$prompt"; type_out "npm test"
# the RUN banner prints the checkout path (and your username): keep it off camera
FORCE_COLOR=1 npx vitest run --config demo/vitest.config.ts 2>&1 | grep -v "$PWD"
BASH_SILENCE_DEPRECATION_WARNING=1 PS1="${dim}~/pakkun-treats${off} \$ " exec bash --norc
