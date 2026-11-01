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
