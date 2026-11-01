---
id: pixypup-2
agent: pixypup-app-engineer
kind: fix-the-bug
base: 6aed3e888c65b2bf26db8e209869dc72392aabcf
---
## Task
Bug report: "Our IT team pushed a settings file with `\"screenAware\": \"false\"` (a string) and
PixyPup treated screen-aware mode as ON." Fix it inside your perimeter, with a proving test.
## Expected
Root cause in `src/main/settings.ts`: `readJson` casts parsed JSON to `Partial<Settings>` without
validating types, and `mergeSettings` spreads it, so the string `"false"` (truthy) wins over the
boolean default. Fix: validate each known key's type when reading (drop or coerce non-booleans
for boolean keys, non-strings for `petName`) so a wrong-typed value can never enable a feature.
A vitest case passing `{ screenAware: 'false' }` through the read/merge path yields
`screenAware: false`; existing settings tests still pass; gates green. Touching this protected
file is named in the report.
## Rubric
- Identified the unvalidated cast as the cause (0-2)
- Fix fails safe (a bad value can never turn a feature on) (0-2)
- Proving test exercises the real merge path, not a mock of it (0-2)
- No fabricated file:line references (0-2)
- Followed the report contract and named the protected path (0-2)
