---
name: oysterun-scheduler
description: Use for Oysterun scheduler commands through the P86 CLI, including schedules, runs, run logs, test-run, and confirm/dry-run protected disable/delete.
metadata:
  short-description: Manage Oysterun schedules
---

# Oysterun Scheduler

Canonical product skill source lives at `skills/oysterun-scheduler/`. The repo-local Codex mirror at `.codex/skills/oysterun-scheduler/` and the Host packaged asset at `host-service/assets/product-skills/oysterun-scheduler/` are generated mirrors. Run `node tool_scripts/sync_product_skills_to_codex.mjs` after changing this skill and `node tool_scripts/check_product_skill_mirrors.mjs` before review.

Use this module skill for normal product scheduler operations. It wraps the P86 product CLI contract:

```text
oysterun scheduler <action> [options]
```

The helper delegates to the same CLI surface:

```bash
node .codex/skills/oysterun-scheduler/scripts/oysterun_scheduler.mjs list --host http://localhost:2322
```

When Host injects this skill into a live session, the helper path is:

```bash
node .claude/skills/oysterun-scheduler/scripts/oysterun_scheduler.mjs list
```

## Commands

- `list`
- `create`
- `get`
- `update`
- `enable`
- `disable --confirm` or `disable --dry-run`
- `delete --confirm` or `delete --dry-run`
- `test-run`
- `runs`
- `run-log`

## Guardrails

- Do not call `/scheduler/*` endpoints directly from this skill.
- Use `--dry-run` before disabling or deleting schedules unless the route explicitly authorizes mutation.
- Do not print tokens, cookies, passwords, auth headers, schedule secrets, or raw profile files.
- Use the P86 CLI output envelope for JSON output and redaction.
