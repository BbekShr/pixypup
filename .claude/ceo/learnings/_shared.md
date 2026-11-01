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

## Archive
