# Bug fix

## Method
1. **Reproduce first** on your branch's base with `/pixypup-verify`. No repro, no fix: report
   CAN'T REPRODUCE with what you tried.
2. **Write the failing test** that captures the bug, and watch it fail for the reported reason.
3. **Find the root cause**, not the symptom: why was the wrong value possible at all? Check every
   caller of the function you're about to change.
4. **Smallest fix** that makes the test pass. No drive-by refactors.
5. **Look for siblings**: the same mistake elsewhere (grep the pattern). Fix them in scope, or list
   them as `FACT:` lines for new backlog items.
6. Re-run the repro: it must now behave correctly, with evidence.

## In this project
- Regression tests go next to the code: `src/<area>/*.test.ts` or `__tests__/`, run with `npm test`. Extract the buggy logic into a pure function first if it lives inside Electron or DOM code, so vitest can exercise it.
- Fixtures are inline strings (see the SAM wire-format fixture in `src/api/__tests__/sam.test.ts`). Never record a live API response containing image data or a key.
- Reproduce UI and main-process bugs in a real launch over CDP (`/pixypup-verify`); a vitest pass alone doesn't prove the overlay behaves.
- Trap: anything touching pointer events must leave click-through restored on every exit path (pointerup off the sprite, drag cancelled, window blur).
