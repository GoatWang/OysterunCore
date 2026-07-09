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
- `create --session-ref <display-name> --prompt <text> --frequency daily --time HH:mm`
- `get`
- `update`
- `enable`
- `disable --confirm` or `disable --dry-run`
- `delete --confirm` or `delete --dry-run`
- `test-run`
- `runs`
- `run-log`

For Host scheduler rows, `create` targets a portable outside-scheduler setup
snapshot. In a live Host session, omit the target to use the current session's
saved setup, or pass `--session-ref <display-name>` for another session. Use
rule fields such as `--frequency daily --time HH:mm`, `--frequency weekly
--weekdays monday,wednesday --time HH:mm`, or `--frequency once --run-at
<ISO time>`. Do not use `--interval` for Host scheduler rows; use `chat loop
create --interval ...` for in-session loops.

## P183/P307 Runtime Authority

P183/P307 runtime authority alignment means every command in this skill is
callable from a live Host session through Host-injected product runtime
environment:
`OYSTERUN_HOST_ORIGIN`, `OYSTERUN_CAPABILITY_TOKEN`, `OYSTERUN_SESSION_ID`,
`OYSTERUN_AGENT_ID`, and `OYSTERUN_CLI_BIN`. Inside a live Host session,
helper scripts and direct command examples must execute the injected CLI from
`OYSTERUN_CLI_BIN`; do not call bare `oysterun`, because it may resolve to a
globally installed package with older command behavior. That authority is
Host-wide for installed Oysterun product skills. Do not ask an in-session agent
to run dashboard login for these commands. Explicit `--token` is the operator
override; external operator shells may still use dashboard CLI auth.

## Guardrails

- Do not call `/scheduler/*` endpoints directly from this skill.
- Use `--dry-run` before disabling or deleting schedules unless the route explicitly authorizes mutation.
- Do not print tokens, cookies, passwords, auth headers, schedule secrets, or raw profile files.
- Use the P86 CLI output envelope for JSON output and redaction.
