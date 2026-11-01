# Shared lessons (every agent)

## Active
- Resolve every `.claude/...` path against the repo root in your brief, never against your home directory.
- Never `git stash`, `checkout`, `switch`, `reset` or `rebase`: other agents share this tree.
- Every finding needs a failure scenario (input/state → wrong outcome) with file:line.
- Tests never call the real Meta API: inject `fetchImpl` into `MetaClient`. A live check needs `MODEL_API_KEY` and is reported with call count and timing only.
- Prove overlay and main-process changes in a real launch over CDP (`/pixypup-verify`); `screencapture` doesn't work from agent shells.
- Contracts change in pairs: `contracts/*.schema.json` and `contracts/types.ts` in the same commit.
- Match window titles with anchored, product-specific patterns, never bare keywords: titles carry user paths and filenames (B1, `src/screen/decide.ts`).
- Validating a policy file: a dropped invalid key is a failure, not a no-op. Never decide "missing" with `existsSync` (false on EACCES); read and treat only ENOENT as missing (B2/B3, `src/main/settings.ts`).
- Fail-closed tests need an fs mock that can throw ENOENT and EACCES, or they only prove what the mock can express (B2/B3).
- Image work is verified by looking at the real output (render the frames at true scale), not by tests alone: F3's tests passed while live frames showed clipping and a wrong-eared pose.
- Muse Image draws past its canvas edge and drifts on identity: prompts must ask for margins and pin ears/face; reject edge-touching output and retry (F3).
- Import shared validators from a leaf module; importing from `pose-pipeline.ts` pulled sharp into the Electron main bundle (F4).
- Every pointer path (up, cancel, lostpointercapture) restores click-through; test the invariants as pure functions, not formula re-statements (F4).
- Before a verify run, check who owns the debug and renderer ports (the maintainer may be running the app); use a different `--remoteDebuggingPort` and never kill processes you didn't start.
- When separate image calls copy a reference, ask for one sprite sheet and slice locally; save real model output as a test fixture, because synthetic fixtures are too clean (F13: Muse sheet frames nearly touch).
- Async user flows that outlive their window are owned by main with a run token; the window rebuilds from main-held state (F5a `src/main/run-state.ts`).
- Reviewers stay read-only: never `git checkout`/`switch` in the shared tree, even detached (F5a reviewer slip).
- A multi-phase sequence that owns the pet gates every input (menu, pointer) on a pure busy(phase) predicate and queues the last command (F5b `src/overlay/handoff.ts`).
- Reduced motion: never `animation-duration:1ms` on infinite animations without `animation-iteration-count:1` (strobe); WAAPI loops need their own check.
- Muse Spark: use `strict: true` schemas (strict:false garbled keys live); with web_search on, extract the last JSON object from narrated text; JSON output carries no url_citation annotations, so ground sources against web_search_call results (F18).
- Side tasks that must not outlive a pipeline share one AbortController aborted in a catch around the main stage; bound how long the main result waits for them (F18).
- Prefs that mirror OS settings (login item) write to the OS only on the explicit user action, never from a general sync (F16).
- The admin file is a whitelist of privacy restrictions (`ADMIN_KEYS`); every new setting is user-owned unless deliberately added (F16).
- WAAPI: an `easing` in the options applies to the whole animation; overshoot easings make later keyframes arrive early. Put pop easing on the first keyframe (F17).
- Live end-to-end runs with the real model find what unit tests can't (lost first word, name not boosted): every Meta-integrated feature gets one real-key run through the app path, not just the client (F8).
- Reset per-session handles at the top of start(); attach abort listeners before awaiting a handshake (F8).

## Archive
