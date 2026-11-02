#!/bin/bash
# Runs inside the "PixyPup Demo" Terminal window: fail shows the bug, fix shows the one-line fix going green.
cd "$(dirname "$0")/../.." || exit 1
# Same spot every take: (320, 40) on the built-in display, where the pet lives, clear of its floor.
# Terminal moving its own window raises no Automation prompt. Setting and reading bounds disagree when
# another display sits above the built-in one, so set once, measure the offset, and set again.
osascript - "$(tty)" >/dev/null 2>&1 <<'AS' || printf '\e[3;320;40t'
on run argv
  tell application "Terminal"
    repeat with w in windows
      if tty of selected tab of w is item 1 of argv then
        set bounds of w to {320, 40, 1120, 760}
        set g to bounds of w
        set dx to 320 - (item 1 of g)
        set dy to 40 - (item 2 of g)
        if dx is not 0 or dy is not 0 then set bounds of w to {320 + dx, 40 + dy, 1120 + dx, 760 + dy}
      end if
    end repeat
  end tell
end run
AS
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
