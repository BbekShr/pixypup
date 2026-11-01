#!/bin/bash
# Opened with `open`, this runs in Terminal with no Automation prompt.
cd "$(dirname "$0")/.." && clear && npx vitest run --config demo/vitest.config.ts
