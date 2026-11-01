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
