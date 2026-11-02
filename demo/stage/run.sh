#!/bin/bash
# Runs inside the "PixyPup Demo" Terminal window: fail shows the bug, fix shows the one-line fix going green.
cd "$(dirname "$0")/../.." || exit 1
printf '\e[3;340;56t'  # same spot every take: centred, clear of the pet's floor
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
npx vitest run --config demo/vitest.config.ts
PS1="${dim}~/pakkun-treats${off} \$ " exec bash --norc
