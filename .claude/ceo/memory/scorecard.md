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
| 2026-11-01 | F8 | #19 | landed-edited | yes (CEO keyword one-liner) | 4 CONFIRMED + 8 lower | no | 6 sonnet editor runs (2 roles), 1 sonnet lens, 4 real-key runs |
| 2026-11-01 | F10 | #20 | landed-clean | no | 1 CONFIRMED (asar bloat, found by editor) | no | 1 sonnet editor run; CEO review of art + evidence |
| 2026-11-01 | F11 | #21 | landed-clean | no | 0 | no | 2 sonnet editor runs (2 roles); CEO review |
| 2026-11-01 | F21 | #27 | landed-clean | no | 3 CONFIRMED (CEO review: mirror-pivot jump, no ceiling, walk target from release x) + 1 runtime (dangle clamp); all fixed | no | 3 sonnet editor runs (1 role), 2 haiku release runs |
| 2026-11-01 | F22 | #28 | landed-clean | no | 1 CONFIRMED (CEO: double-signed mirror) fixed by CEO one-liner; 1 PLAUSIBLE runtime (interrupted look snaps) → F23 | no | 1 sonnet editor run, 1 haiku release run |
| 2026-11-01 | F31 | #32 | landed-clean | no | security: 1 HIGH (crisis via history) + 1 MEDIUM (voice→talk consent) CONFIRMED, fixed; 2 LOW fixed; RM: 1 timing CONFIRMED fixed (trot), 1 LOW fixed (crisis preempts talk); CEO: crisis barked, fixed | no | Plan at fable; 4 sonnet editor runs (2 roles); 3 haiku release runs; 1 sonnet security run; 1 real-key call |
| 2026-11-01 | F30 | #34 | landed-clean | no | 2 CEO-found (overload dead branch, reveal fail-closed); fixed | no | CEO wrote it (design-heavy copy); no editor dispatch |
| 2026-11-01 | F29 | #33 | landed-clean | no | 1 CONFIRMED (bake throw broke pack load) + species false positives + serial encode; all fixed; 2 CEO live findings (leg slivers, skating paws, far-leg fragments) fixed | no | fable plan, 4 sonnet editor runs, 1 haiku release run, 1 sonnet review |
| 2026-11-01 | deep | (pending) | open | — | security diff: 2 CONFIRMED (redactor gaps, crisis Unicode) fixed; code review: 1 CONFIRMED (TimeoutError) + 5 PLAUSIBLE (3 fixed, Meet narrowing reverted, 2 accepted); RM: 1 CONFIRMED runtime (talk command held during turn) fixed, re-verify GO | no | 3 assess reads (1 sonnet security, 2 haiku Explore), 2 sonnet editor runs (worktrees), 1 sonnet security diff, 1 sonnet code review, 2 haiku release runs; CEO fixes inline |
| 2026-11-01 | docs-latest | #37 | open | — | round 2 after #38/#39: drawn-walk site re-verified (frames advance with distance), 5 models, redaction copy; CEO: browser-verified site (0 console errors, blob walk frames, chat replies, no horizontal scroll at 375 px); lint-disable banner on the generated bundle justified and escalated | no | 1 sonnet editor run (3 follow-ups); CEO ran gates + browser check; release v0.1.0 published on approval |
| 2026-11-01 | site-pet-picker | (pending) | open | — | CEO: browser-verified picker (Kuma/Mochi switch, Mochi walk-to-terminal on drawn frames, 'click her'), mixed strip, new pack-sheet/pack-trio viewed | no | 1 sonnet editor run; merge authorised by maintainer in chat |
| 2026-11-01 | walk-quality | (pending) | open | — | stride cap dropped (skating), tail spike stopped (rump jelly); RM: gates green, runtime blocked by screen lock (reg count consistent) | no | fable plan, 1 sonnet editor run, 1 haiku release run |
| 2026-11-02 | deep | (pending) | open | — | security: clean (2 LOW: secrets write not atomic, obCheckKey offline → B19); code review: 2 CONFIRMED (zoom bark stuck, voice 'trick' false positive) fixed, F33 review 1 CONFIRMED (#how copy) + 3 PLAUSIBLE fixed; RM: GO on behaviour, NO-GO on layout → 3 visual fix rounds, CEO reviewed screenshots; voice E2E offline + 2 live calls | no | fable ×2 plans, 3 haiku/sonnet assess reads, 9 sonnet editor runs, 5 haiku release runs, 3 sonnet reviews |
