#!/bin/bash
# The fix for the video: same test, now green, in the same front Terminal window slot.
cd "$(dirname "$0")/.." && clear && DEMO_FIXED=1 npx vitest run --config demo/vitest.config.ts
