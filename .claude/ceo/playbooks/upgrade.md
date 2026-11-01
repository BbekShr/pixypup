# Upgrade

## Method
1. **Read the upstream changelog and migration guide** for every version you cross, and list the
   breaking changes that touch this repo (grep for each API).
2. **One dependency (or one coupled group) per PR.** Never batch unrelated upgrades.
3. **Upgrade, then fix what broke**, applying the migration guide literally. No opportunistic
   rewrites.
4. **Full bar plus a real run** with `/pixypup-verify`. Tooling and runtime upgrades break things
   no unit test covers.
5. Lockfile committed. Note the rollback (the previous version) in the PR body.

## In this project
- npm with `package-lock.json`; Node 22 (`.nvmrc`). Electron 45, electron-vite 6, Vite 8, TypeScript 6, vitest 5, ESLint 10.
- Known traps: Electron's binary download can be skipped by `npm install` (run `node node_modules/electron/install.js`); `@meta-sam/parser` is 0.1.0 and ESM-only (Node ^20.17 or >=22.9), so read its `dist/*.d.ts` after any bump; `sharp` ships native binaries per platform.
- No CI yet (P1), so local gates are the whole bar: run all four.
