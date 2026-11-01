# Shared lessons (every agent)

## Active
- Resolve every `.claude/...` path against the repo root in your brief, never against your home directory.
- Never `git stash`, `checkout`, `switch`, `reset` or `rebase`: other agents share this tree.
- Every finding needs a failure scenario (input/state → wrong outcome) with file:line.
- Tests never call the real Meta API: inject `fetchImpl` into `MetaClient`. A live check needs `MODEL_API_KEY` and is reported with call count and timing only.
- Prove overlay and main-process changes in a real launch over CDP (`/pixypup-verify`); `screencapture` doesn't work from agent shells.
- Contracts change in pairs: `contracts/*.schema.json` and `contracts/types.ts` in the same commit.

## Archive
