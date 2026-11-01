# PixyPup: verified facts

Read by every agent at boot. One dated bullet per fact, with evidence:
`- YYYY-MM-DD (<run or PR>): claim. file:line`
Delete a fact the moment it's falsified: a stale fact is worse than none. Keep this file around
~120 lines; merge duplicates and drop the least load-bearing. Facts that hold across many runs
and that agents keep needing get promoted into CLAUDE.md (human-approved).

## Baseline (from /org-init, 2026-10-31)
- 2026-10-31 (bootstrap @d34133f): `npm run typecheck` 0 errors; `npm run lint` 0 problems; `npm test` 21/21 passed in 5 files; `npm run build` ok (electron-vite). No CI.
- 2026-10-31 (bootstrap): SAM 3.1 output decodes with `@meta-sam/parser` 0.1.0 `parseImageStream`; mask raster is smaller than its box and covers `bounds` (half-open). `src/api/sam.ts`, `src/api/__tests__/sam.test.ts`
- 2026-10-31 (bootstrap): `screencapture` from the agent's shell fails ("could not create image from display"): no Screen Recording permission. Use CDP `Page.captureScreenshot` for overlay screenshots.
- 2026-10-31 (bootstrap): `npm install` may skip Electron's binary download; `node node_modules/electron/install.js` fetches it.

- 2026-10-31 (org smoke @5fcf790): release manager on haiku reproduced the baseline (21/21 tests, 0 lint, 0 type errors, build ok) and followed the report contract. Agents in `.claude/agents/` register only in a session started after they exist.

## Clean audits (so discovery skips these grounds)
