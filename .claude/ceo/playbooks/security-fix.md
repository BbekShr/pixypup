# Security fix

## Method
1. **Write the exploit as a test first**: the failing input (injection string, cross-user id,
   hostile file) that demonstrates the hole. It must fail before the fix.
2. **Fix at the boundary**, using the project's canonical helper (validator, sanitizer, auth
   check). Never invent a new one, and never fix only the one call site you were shown: grep for
   every path that reaches the same sink.
3. **Fail closed** unless `CLAUDE.md`/`RULES.md` documents a deliberate fail-open.
4. **No secrets in the test, the commit, or the report.** Use obvious fakes.
5. The security engineer re-reviews the diff before it ships, whatever the gates say.

## In this project
- Canonical helpers: `assertStandardTier` (`src/api/meta-client.ts`), `mergeSettings` with the admin override (`src/main/settings.ts`), `getApiKey`/`setApiKey` via `safeStorage` (`src/main/secrets.ts`).
- Sinks to grep: `fetch(`, `new WebSocket(`, `net.request`, `writeFile`, `toFile(`, `console.log` near image buffers or keys, `exec(` with template strings, `contextBridge.exposeInMainWorld`, `contributor`.
- No documented fail-open exceptions. The one deliberate weakness is `sandbox: false` in `src/main/main.ts` (ESM preload), tracked as P4.
