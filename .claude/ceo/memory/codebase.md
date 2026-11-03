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

- 2026-10-31 (F5a): onboarding = `src/main/onboarding.ts` + `src/onboarding/*`; dev hooks: `PIXY_FAKE_PIPELINE=1 [PIXY_FAKE_FAST=1]` rehearsal, `PIXY_DEV_PHOTO=<abs path>` + `window.__ob.devPhoto()`, `kill -USR2 <main pid>` opens the window; real CDP driver at out/_drive.mjs. Tests 171 in 17 files.

- 2026-11-01 (F18): `src/api/muse-spark.ts` (sparkJson, extractJson, citedUrls), `src/api/personality.ts` (meetPet, breedFacts); manifest.personality optional; overlay chatter `src/overlay/chatter.ts` every 3-6 min, idle/sit only; `PIXY_CHATTY=1` dev. Tests 223 in 20 files.

- 2026-11-01 (F16): main owns prefs (`run()` → saveSettings → loadSettings → `sync()` → `pixy:prefs`); `src/main/prefs.ts` pure; dev hook `__pixyDebug.pref('size:large'|'snooze:1h'|'wake'…)`; port 9229 may be taken by an unrelated workerd. Tests 257 in 21 files.

- 2026-11-01 (P2): `openClient(purpose, loadSettings(), key)` in `src/api/gate.ts` is the only MetaClient path; scripts use `clientForScripts()`; `offline` defaults false (admin restriction). Tests 265 in 22 files. `src/api/__tests__/network-gate.test.ts`

- 2026-11-01 (F6a): `native/bin/pixyhelper windows|badges|capture <id>`; under the Claude-hosted shells `windows` returns unredacted titles but `capture` fails (SCStream -3811) and `badges` returns permission. `helperPath()` in `src/main/helper-path.ts`. Tests 267 in 23 files.

- 2026-11-01 (F6b): `src/screen/reader.ts` `createScreenReader({run, osa, decodePng?}).tick()` is F7's entry; terminal osascript output = rows\ncols\ntabs\nid\nleft\ntop\nright\nbottom\ncontents; first live osascript triggers the Automation prompt, so wire it only when screen-aware is on. Tests 320 in 24 files.

- 2026-11-01 (F7): `src/main/screen-loop.ts` + `src/screen/decide.ts` createDecider + `src/api/sniff-bubble.ts`; overlay `pixy:behavior` (`src/overlay/behavior.ts`); consent window `src/onboarding/screen.html`; dev `PIXY_FAKE_SCREEN=1`, `__pixyDebug.behave`. Spark bubble live 1-2 s. Tests 351 in 28 files.

- 2026-11-01 (F8): voice = `src/api/voice.ts` (openVoice gated, async) + `src/main/voice-session.ts` + `src/main/mic.ts` + `src/voice/{listen,commands,pcm}.ts`; dev `PIXY_FAKE_MIC=<wav>` (parses the data chunk), `pref('voice:listen')`, `pref('voice:fake:<text>')`; real driver out/_voicedrive.mjs. Tests 413 in 34 files.

- 2026-11-01 (F10): `npm run dist` → release/PixyPup-0.1.0-arm64.dmg (~125 MB); afterPack `scripts/ad-hoc-sign.mjs`; art via `npm run make-art`; electron-builder output must stay `release/` (dist/ is in build.files). Tests 414.

- 2026-11-01 (E2E): out/_e2e.mjs drives a full real-key run (13/13, docs/E2E.md). Pet display name = manifest `pet` via `displayName()` in main; settings.petName is the folder slug.

- 2026-11-01 (F21): overlay physics = `airStep` (ballistic, floor e=0.35, walls/ceiling e=0.5, slide 1200 px/s²), `releaseVelocity` (80 ms window), `dangle` (pendulum, soft limit past 14°, 2 substeps), `pivotShift`, `landSquash` in `src/overlay/motion.ts`; a 300 px drop bounces twice (~34 px, ~3 px) and rests in ~1.0-1.3 s; dangle peaks ~21° on a fast drag. Second overlay instance for verify: `npx electron-vite dev --remoteDebuggingPort 9333 -- --user-data-dir=<dir>` (vite falls back to 5174). Tests 453.

- 2026-11-01 (F22): walk speed is integrated state `walkV` via `walkStep` (accel 350, decel 300 px/s², both × vMax/MAX_SPEED; reset by `stopWalk()` on walk start, turn, drag, landing); turns use `turnScale` over TURN_MS 380 (floor 0.12, sign in `flip`, magnitude in sx); cruise = MAX_SPEED × pet energy (Pakkun playful 1.4 → 126 px/s) × size. Tests 459.

- 2026-11-01 (deep @708ec4c): screen text is redacted (`src/api/redact.ts` `redactSecrets`) before `<>` strip and slice in `sniff-bubble.ts` and `fix-hint.ts`. `ELECTRON_RENDERER_URL` is read only via `src/main/dev-url.ts` (ignored when packaged); all other `PIXY_*` env hooks are `!app.isPackaged`-gated (PIXY_FAKE_FAST only matters when the gated fake is on). Talk (`purpose 'talk'`) is allowed by default settings, blocked only by `offline` (`src/api/gate.ts:19-22`). `npm audit --omit=dev` clean.
- 2026-11-01 (deep): talk act has no timeout (`until: 0`); it ends on arrival, on any user command (`actAfterCommand`, before the turn-queue check), or when state leaves `walk` (frame check). A sleepy 1309 px talk walk takes ~12.6 s. A failed terminal read returns the previous key with `terminalError: null` (`src/screen/terminal.ts:258`). `window.pixy` is frozen by contextBridge: CDP cannot wrap `setClickThrough`. Debug `behave` drops a repeated `seq` silently (`overlay.ts:~893`). Tests 657 (+2 skipped: native helper guard `src/main/helper.test.ts:9`).

## Clean audits (so discovery skips these grounds)
- 2026-11-01 (deep @c153195, security): network choke point (`openClient` + architecture test), key handling (header/WS first frame only; UI gets codes only), IPC sender checks and slug/path validation, preload surfaces, packaging `build.files`, subprocesses (execFile arg arrays) — all clean.
- 2026-11-02 (deep-stable): pet-window crash → `load(false)` reload, max 3 per rolling 60 s, `clean-exit` ignored (`src/main/main.ts:96-101`); recovers in 114-272 ms on the SAME CDP target id. Aux windows (talk, key, screen-explainer, onboarding) destroy themselves on `render-process-gone` like `mic.ts:52`; their IPC guards reject a stale sender.
- 2026-11-02 (deep-stable): `process.on('unhandledRejection')` in `src/main/main.ts` logs the error name only; no `uncaughtException` handler exists.
- 2026-11-02 (deep-stable): `__pixyDebug.behave({action:'talk',mood:'listen'})` drives talk → stay (sit) with no target; `__pixyDebug.command(cmd)` is the same `command()` the menu IPC reaches (`src/overlay/overlay.ts`). Zoomies end = `act === null`, not a state.
- 2026-11-02 (deep-stable): Spark never picks behaviours at runtime: rules in `src/screen/decide.ts` pick the action, Spark only writes bubbles/hints (doc drift vs RULES.md wording).
- 2026-11-02 (deep-stable): `src/screen/reader.ts` is the only Dock-badge baseline owner; an empty map never replaces a non-empty baseline.

## Dated facts
- 2026-11-03 (F-menu-cursor): pet menu nests Tricks/Pets/Settings submenus (src/main/menu.ts:36-66); main's toNative recurses (src/main/main.ts:157). Menu emoji live in shared helpers SNOOZE/talkItem/overloadItem so the tray stays in sync. Overlay talk is driven via `__pixyDebug.pref('talk')` (overlay pref -> devCommand -> main run()), not `command('talk')`.
- 2026-11-03 (F-call-mode): call = title rule OR camera in use OR a call-app bundle capturing mic (`src/screen/decide.ts` CALL_APPS/isCallApp; prefix match at a `.` boundary, so numeric-suffix IDs like com.microsoft.teams2 are listed explicitly). Helper `pixyhelper media` → `{camera, micApps}` via property reads only (no TCC); parsed at `src/screen/media.ts`. Hide act carries `mode` ('hide' fully off-screen, 'corner' sleeps in nearer bottom corner) from `settings.callMode`. Latency: title→hide ~4-5 s, call end→back ~6-12 s.
