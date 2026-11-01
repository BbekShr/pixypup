# PixyPup: verified facts

Read by every agent at boot. One dated bullet per fact, with evidence:
`- YYYY-MM-DD (<run or PR>): claim. file:line`
Delete a fact the moment it's falsified: a stale fact is worse than none. Keep this file around
~120 lines; merge duplicates and drop the least load-bearing. Facts that hold across many runs
and that agents keep needing get promoted into CLAUDE.md (human-approved).

## Baseline (from /org-init, 2026-10-31)
- 2026-10-31 (bootstrap @6aed3e8): `npm run typecheck` 0 errors; `npm run lint` 0 problems; `npm test` 21/21 passed in 5 files; `npm run build` ok (electron-vite). No CI.
- 2026-10-31 (bootstrap): SAM 3.1 output decodes with `@meta-sam/parser` 0.1.0 `parseImageStream`; mask raster is smaller than its box and covers `bounds` (half-open). `src/api/sam.ts`, `src/api/__tests__/sam.test.ts`
- 2026-10-31 (bootstrap): `screencapture` from the agent's shell fails ("could not create image from display"): no Screen Recording permission. Use CDP `Page.captureScreenshot` for overlay screenshots.
- 2026-10-31 (bootstrap): `npm install` may skip Electron's binary download; `node node_modules/electron/install.js` fetches it.

- 2026-10-31 (org smoke @13fd86a): release manager on haiku reproduced the baseline (21/21 tests, 0 lint, 0 type errors, build ok) and followed the report contract. Agents in `.claude/agents/` register only in a session started after they exist.

- 2026-10-31 (pose test): SAM 3.1 returns 0 matches for "red text"/"error text"/"text" on a terminal screenshot; a local red-pixel row scan finds each red line. Muse Image edits return WebP; ~10-22 s per pose. `docs/POSE-TEST.md`

- 2026-10-31 (B2/B3): test baseline 35 tests in 5 files. `loadSettings` fails closed (screenAware/voice off, offline on) when admin.json is unreadable, corrupt, non-object, or has a mistyped known key. `src/main/settings.ts`
- 2026-10-31 (B2/B3): `loadSettings()` result is unused until F1/F9 wire feature gates. `src/main/main.ts:53`

- 2026-10-31 (F3): `src/api/pose-pipeline.ts` `generateSpritePack` is the photo→pack entry; events cutout/pose(+fallback)/pose-failed/done; frames share one canvas (~212x288), footY ≈ 0.993. Live: 44 s clean, 66 s with one edge retry. Tests 75 in 9 files.
- 2026-10-31 (F3): `MetaClient.postJson/postStream` accept an optional AbortSignal. `src/api/meta-client.ts`

- 2026-10-31 (F4): overlay loads the pack via `pixy:get-pack` (data URLs, ≤64 frames, ≤2 MB each); `PIXY_PACK_DIR` dev-only; `npm run dev:pakkun` uses out/pack/Pakkun. Display height 140 px, stride 0.22×width, max 90 px/s, gravity 2000 px/s². Tests 105 in 10 files. `src/overlay/*`, `src/main/pack.ts`
- 2026-10-31 (F4): dev-only `window.__pixyDebug` {state,x,dir,facing,walked,stay,menuCalls,command()} for CDP; Runtime.evaluate on promises needs awaitPromise. `src/overlay/overlay.ts`

- 2026-10-31 (F13): pipeline = SAM cutout → idle → parallel [walk sheet, sit, sleep, bark, roll, blink edit]; 7 Muse Image requests + 1 SAM per run; live 52 s; manifest poses idle, blink, walk(4 frames, fps 8), sit, sleep, bark, roll. Tests 134 in 12 files. `src/api/pose-pipeline.ts`, `src/api/manifest.ts`

- 2026-10-31 (F15): pack order PIXY_PACK_DIR (dev) → userData/pets/<petName> → built-in assets/pets/Pakkun → placeholder; settings (petName) are read once at startup, so creating a pet must re-resolve the pack. `--user-data-dir=<dir>` after `--` isolates userData in dev. Tests 138 in 12 files. `src/main/main.ts`

## Clean audits (so discovery skips these grounds)
