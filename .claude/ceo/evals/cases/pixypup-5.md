---
id: pixypup-5
agent: pixypup-repro
kind: triage
base: 6aed3e888c65b2bf26db8e209869dc72392aabcf
---
## Task
Bug report: "When a Terminal window's title contains the word zoom, PixyPup thinks I'm on a
video call and hides, even with a test failure on screen." Reproduce it on this commit.
## Expected
`REPRODUCED`: a vitest or tsx one-off calling `ruleDecide` with a window
`{owner: 'Terminal', title: 'zoom-lens: npx vitest', ...}` and a `terminalError` returns
`action: 'hide'`. Suspected cause `src/screen/decide.ts` (the `/zoom|\bmeet\b/i` title test,
which runs before the terminal-error branch). A minimal failing test returned as a diff, not committed.
## Rubric
- Verdict REPRODUCED with a runnable reproduction (0-2)
- Correct suspected file:line and mechanism (0-2)
- Ran it rather than reasoning from the code alone (0-2)
- No fabricated file:line references (0-2)
- Followed the report contract; worktree removed (0-2)
