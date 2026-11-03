# Upstream outbox

Template findings: problems this org hit that would happen in **any** org built from the same
agent-org templates (a template defect, a doctor false positive, an ambiguous CEO instruction, a
guard rule that blocked the wrong thing). The CEO appends one entry per finding at the micro-retro.
Project-specific findings do not go here: they get fixed in this project's own org files.

This file is local. Nothing in it leaves the machine unless feedback is enabled in `org.json`
(`"feedback": {"enabled": true}`) and you run `/org-feedback` and approve the drafts.

Entry format:

```
## <YYYY-MM-DD> <short title>
- status: new | sent <url> | fixed-upstream (<why>) | wontfix (<why>)
- agent-org version: <org.json agent_org_version>
- template: <agent-org path, e.g. skills/org-init/templates/ceo/SKILL.md>
- what happened: <the mechanism>
- evidence: <command output, test, eval score>
- proposed change: <what the template should say or do instead>
- local workaround: <what this project did meanwhile, if anything>
```

## Entries

## 2026-10-31 release-manager verdict list omits NO-GO-WITH-GAP
- status: new
- agent-org version: 0.1.0
- template: skills/org-init/templates/agents/release-manager.md
- what happened: the "feature-specific check" paragraph says a missing check "is a NO-GO-WITH-GAP, not a pass", but the Verdict section lists only GO, GO-WITH-GAP and NO-GO. A haiku release manager returned NO-GO-WITH-GAP on an org-only smoke run; a case author reading the Verdict section expects GO-WITH-GAP.
- evidence: smoke run on org/bootstrap-2026-10-31 @13fd86a, gates 1-4 green, verdict NO-GO-WITH-GAP.
- proposed change: add NO-GO-WITH-GAP to the Verdict list (or change the paragraph to GO-WITH-GAP) so the two sections agree.
- local workaround: eval case pixypup-4 expects NO-GO-WITH-GAP.

## 2026-11-02 verify skill and release-manager checks have no visual/overflow step for UI projects
- status: new
- agent-org version: 0.1.0
- template: skills/org-init/templates/skills/verify/SKILL.md and templates/agents/release-manager.md
- what happened: for a desktop app the generated verify skill drives state over CDP and screenshots only for animation, so the release manager returned GO while three windows were visibly clipped (onboarding card, generation step, a chat input truncating its value). The maintainer found each one from screenshots.
- evidence: PixyPup deep 2026-11-02: RM GO at 9fff607; the maintainer's screenshots then showed clipping; the probe measured scrollHeight 483 > clientHeight 464 and a bottom of 585 > innerHeight 560.
- proposed change: for any org whose kind has a UI, generate a "Window/UI changes" step: screenshot every touched view in each state for the CEO to open, plus an overflow probe (visible elements outside the viewport, overflow:auto containers with scrollHeight > clientHeight, truncated inputs, spare ≥ 12 px).
- local workaround: added that step to .claude/skills/pixypup-verify/SKILL.md.

## 2026-11-02 "one logical change per commit" collides with editors that cannot stage hunks
- status: new
- agent-org version: 0.1.0
- template: skills/org-init/templates/skills/ceo/SKILL.md (Decide: "one logical change per commit"; Build step)
- what happened: a deep run batched six items to one editor. Several items shared a file (main.ts, overlay.ts), and the editor has no interactive `git add -p`, so it fell back to one commit per file group and reported the deviation.
- evidence: PixyPup deep-stable 2026-11-02, commits c19983b and 240fdee each carry 2-3 items.
- proposed change: the Build step's brief template says "items sharing a file may share a commit; name every item in the message", or tells the CEO to dispatch shared-file items sequentially.
- local workaround: line added to this skill's Build step.

## 2026-11-03 backlog reconciliation verdicts trust UI side effects over state
- status: new
- agent-org version: 0.1.0
- template: skills/org-init/templates/skills/ceo/SKILL.md (0b. Backlog reconciliation brief)
- what happened: the haiku reconciler marked a stuck-state bug RESOLVED because the handler now called `ui('idle')`; the state variable stayed 'listening', so the bug was live. A parallel Explore read caught it.
- evidence: PixyPup deep-stable-2 2026-11-03, B28, `src/main/voice-session.ts:75`, fixed in 7669283 with a test.
- proposed change: the reconciliation brief says "for a stuck-state or state-machine item, trace the state variable to its next transition; a UI/log call is not evidence of RESOLVED; prefer CAN'T TELL over RESOLVED without a test".
- local workaround: lesson added to learnings/_shared.md.
