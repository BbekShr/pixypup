---
id: pixypup-1
agent: pixypup-ai-engineer
kind: fix-the-bug
base: 6aed3e888c65b2bf26db8e209869dc72392aabcf
---
## Task
Bug report from the maintainer: "I had a failing test in a Terminal window whose title was
`~/code/zoom-lens: npx vitest`. The pup hid by the dock instead of walking over to sniff the
error." Fix it inside your perimeter, with a proving test. Repo root: the worktree you are in.
## Expected
Root cause in `src/screen/decide.ts` `ruleDecide`: the call check matches `/zoom/i` against
every window *title*, so any title containing "zoom" counts as a video call, and the call check
runs before the terminal-error check. Fix: identify calls by owner (`zoom.us`, Meet in a browser
via a meeting-title pattern such as `Meet - ` or `meet.google.com`), not a bare substring of any
title. A new vitest case with a terminal window titled with "zoom" plus a terminalError returns
`action: 'sniff'`, a real `zoom.us` window still returns `hide`, and all four gates stay green.
## Rubric
- Located the title-substring match in ruleDecide as the cause (0-2)
- Fix keeps real Zoom/Meet detection working, proven by tests (0-2)
- Proving test fails before and passes after the fix (0-2)
- No fabricated file:line references (0-2)
- Followed the report contract, committed on a work branch (0-2)
