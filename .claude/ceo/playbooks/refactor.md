# Refactor

## Method
1. **No behaviour change, provably.** Before touching code, make sure tests pin the current
   behaviour of everything you'll move. If they don't, write those tests first, as their own
   commit.
2. **Small, mechanical steps**, each one green. Rename, move, extract, inline. Never rewrite.
3. **No new features, no bug fixes** in the same diff. Found a bug? Write it down as a `FACT:`
   line and leave it.
4. **The diff should shrink or hold steady.** A refactor that adds net lines needs a reason.
5. Gates green after every step, and the same public behaviour (outputs, API, UI) at the end.

## In this project
- Target structure: pure logic in plain TS modules with tests, Electron/DOM glue thin around it.
- Boundaries: renderers (`src/overlay`, `src/onboarding`, `src/voice/mic-renderer.ts`) never import `src/api/**` or Node modules; they talk to main through the preload `pixy` API. All network goes through `src/api/meta-client.ts`.
- Duplicated contracts that must change together: `contracts/*.schema.json` ↔ `contracts/types.ts`; IPC channel names in `src/main/ipc.ts` ↔ `src/main/preload.ts`.
