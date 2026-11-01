# Test gap

## Method
1. **Test the invariant, not the current behaviour.** A test that mirrors whatever the code does
   today is not a guard. Write what *should* be true, from the docs, the contract, or the item.
2. **Prove each test has teeth**: break the code on purpose (in your worktree only), watch the test
   fail, then restore it. A test that can't fail is decoration.
3. **Behaviour over shape.** A test against a stub that doesn't execute the behaviour (ordering,
   filtering, auth, caching) proves a call was made, not that it's right. Prefer real fixtures.
4. **Fast and deterministic**: no network, no wall-clock sleeps, no order dependence.
5. Wire the new tests into the gate that CI runs, or they don't exist.

## In this project
- vitest 5, config in `vitest.config.ts` (protected gate file), includes `src/**/*.test.ts` with `passWithNoTests`. Tests are colocated or under `__tests__/`.
- Electron imports are mocked with `vi.mock('electron', ...)` (see the settings test); prefer extracting pure functions over mocking.
- No network in tests: pass a fake `fetchImpl` to `MetaClient`.
- There is no CI workflow yet (P1); wiring one is a protected path, so it needs the human.
