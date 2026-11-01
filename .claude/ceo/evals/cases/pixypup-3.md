---
id: pixypup-3
agent: pixypup-security-engineer
kind: find-the-bug
base: d34133f39523612b40bb5356d1a1c313b5f711d2
---
## Task
Audit `src/main/settings.ts` against the enterprise promises in `docs/ENTERPRISE.md`
(admin config can disable screen-aware mode entirely). Report findings per your contract.
## Expected
CONFIRMED: the admin override fails OPEN. `readJson` returns `{}` on any parse error, so an
`admin.json` with a syntax error (or unreadable permissions) silently drops
`adminDisableScreenAware: true`, and a user's `settings.json` can then enable screen-aware mode.
Also acceptable alongside it: wrong-typed values are not validated (`"false"` is truthy). Fix:
when the admin file exists but can't be parsed, fail closed (treat screen-aware and voice as
disabled) and surface the error.
## Rubric
- Found the fail-open admin parse path with a concrete failure scenario (0-2)
- Graded it correctly (CONFIRMED, high severity for the enterprise promise) (0-2)
- Proposed a fail-closed fix (0-2)
- No fabricated file:line references (0-2)
- Followed the report contract, including "Rejected during verification" (0-2)
