# Scorecard

Every org PR's fate. This is how autonomy is earned: success = PRs that land clean and stay clean,
not activity. The CEO updates earlier rows' outcomes in preflight. Promotion criteria live in
`.claude/ceo/AUTONOMY.md`.

Level: **L1** (target L1) since 2026-10-31.

## Weekly
| week | PRs landed clean | landed edited | reverted | escaped defects | landed-clean % | cost per landed PR |
|---|---|---|---|---|---|---|

## Per PR
| date | run | PR | outcome | human edits? | board CONFIRMED | escaped? | cost |
|---|---|---|---|---|---|---|---|
| 2026-10-31 | B1 | #1 | landed-clean | no | 0 | no | 1 sonnet editor run |
| 2026-10-31 | B2+B3 | #2 | landed-clean | no | 1 (security) | no | 2 sonnet editor runs, sonnet security, haiku release |
| 2026-10-31 | F3 | #3 | landed-clean | no | 7 (security 2, correctness 5) | no | sonnet plan, 2 sonnet editor runs, 2 sonnet lenses, 2 live runs (~$0.15) |
| 2026-10-31 | F4 | #4 | landed-clean | no | 14 (security 3, correctness 11) | no | 3 sonnet editor runs, 2 sonnet lenses |
| 2026-10-31 | F13 | #6 | landed-clean | yes (CEO one-line import) | 4 (live render 3, perf 1) | no | 4 sonnet editor runs, 1 sonnet lens, 3 live runs (~$0.25) |
| 2026-10-31 | F15 | #8 | landed-clean | no | 0 | no | 1 sonnet editor run; CEO inline review |
| 2026-10-31 | F5a | #9 | landed-clean | yes (CEO dev-hook one-liner) | 3 CONFIRMED + 9 lower | no | 2 sonnet editor runs, 2 sonnet lenses, 1 real run (~$0.08) |
| 2026-11-01 | F5b | #10 | landed-clean | no | 2 PLAUSIBLE + 4 lower | no | 2 sonnet editor runs, 1 sonnet combined lens |
| 2026-11-01 | F18 | #11 | landed-clean | no | 4 CONFIRMED + 4 lower | no | 4 sonnet editor runs (2 roles), 1 sonnet lens, 4 live probes (~$0.15) |
| 2026-11-01 | F16 | #12 | landed-clean | no | 2 CONFIRMED + 6 lower | no | 2 sonnet editor runs, 1 sonnet lens |
| 2026-11-01 | P2 | #13 | landed-edited | yes (CEO: offline default) | 0 | no | 1 sonnet editor run |
| 2026-11-01 | F6a | #14 | landed-clean | no | 1 PLAUSIBLE | no | 1 sonnet editor run; CEO inline review |
| 2026-11-01 | F6b | #15 | landed-clean | no | 5 PLAUSIBLE + 3 minor | no | 4 sonnet editor runs, 1 sonnet lens |
| 2026-11-01 | F7 | #16 | landed-clean | no | 4 CONFIRMED + 5 lower | no | 4 sonnet editor runs (2 roles), 1 sonnet lens, 1 live Spark probe |
| 2026-11-01 | F17 | #17 | landed-edited | yes (CEO README line) | 1 CONFIRMED (bubble easing, found by editor) | no | 1 sonnet editor run; CEO inline review |
| 2026-11-01 | F12 | #18 | landed-clean | no | 0 | no | 1 sonnet editor run; CEO inline review |
| 2026-11-01 | F8 | (this PR) | open | yes (CEO keyword one-liner) | 4 CONFIRMED + 8 lower | no | 6 sonnet editor runs (2 roles), 1 sonnet lens, 4 real-key runs |
