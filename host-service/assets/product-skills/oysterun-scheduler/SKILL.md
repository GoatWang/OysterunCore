---
name: oysterun-scheduler
description: Use for Oysterun scheduler commands through the P86 CLI, including schedules, runs, run logs, test-run, and confirm/dry-run protected disable/delete.
metadata:
  short-description: Manage Oysterun schedules
---

# Oysterun Scheduler

Canonical product skill source lives at `skills/oysterun-scheduler/`. The repo-local Codex mirror at `.codex/skills/Oysterun/modules/oysterun-scheduler/` and Host packaged assets at `host-service/assets/product-skills/oysterun-scheduler/` and `host-service/assets/product-skills/Oysterun/modules/oysterun-scheduler/` are generated mirrors. Run `node tool_scripts/sync_product_skills_to_codex.mjs` after changing this skill and `node tool_scripts/check_product_skill_mirrors.mjs` before review.

Use this module skill for normal product scheduler operations. It wraps the P86 product CLI contract:

```text
oysterun scheduler <action> [options]
```

The helper delegates to the same CLI surface:

```bash
node .codex/skills/Oysterun/modules/oysterun-scheduler/scripts/oysterun_scheduler.mjs list --host http://localhost:2322
```

When Host injects this skill into a live session, the helper path is:

```bash
node .claude/skills/Oysterun/modules/oysterun-scheduler/scripts/oysterun_scheduler.mjs list
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

## Scheduler Setup Snapshot Contract

When creating or updating a Host scheduler, prefer an existing session config:

```bash
node .claude/skills/Oysterun/modules/oysterun-scheduler/scripts/oysterun_scheduler.mjs create --prompt "..." --frequency daily --time 09:00
node .claude/skills/Oysterun/modules/oysterun-scheduler/scripts/oysterun_scheduler.mjs create --session-ref "My Agent Session" --prompt "..." --frequency daily --time 09:00
```

Do not import Host scheduler internals, call `/scheduler/*` endpoints directly,
write SQLite rows, or use a local fake dispatcher as evidence that the real
product scheduler provider path works. Product scheduler evidence must come
from the P86 CLI/product skill path and the Host scheduler run/log APIs.

If a scheduler task creates an Oysterun Mail report, it must write a durable
`.html` deliverable first and then call the Mail product CLI, preferably through
the injected binary:

```bash
$OYSTERUN_CLI_BIN mail send --title "Report ready" --html-file data/latest_report.html
```

Do not send markdown, auto-format, stdin, `--text`, `--body`, or raw HTML held
only in an environment variable. Do not call Host `/mail/*` endpoints directly.
The `.html` file extension is the Mail deliverable contract.

If a route explicitly requires an explicit setup snapshot instead of a current
or saved session, the snapshot must include the full provider runtime proof:

```text
provider
model
agent_folder
cwd
approval_policy, for Codex
permission_mode, for Claude
allowed_paths / workspace permission fields, when the session uses them
prompt or command text
schedule rule
```

Missing `model`, missing provider permission mode, or mismatched provider/model
proof can cause the Host scheduler to reject the schedule or fail the run before
provider spawn. A pre-spawn failure should be inspected with `runs` and
`run-log`; do not treat a separate local no-mail dispatcher run as proof that
the persisted scheduler target is valid.

## Scheduler Mail

Scheduler jobs that need to send Oysterun Mail should use the normal product
Mail CLI, not a separate scheduler-only Mail stack. Inside a Host-injected
scheduler/runtime environment, prefer:

```bash
$OYSTERUN_CLI_BIN mail send --title "Digest ready" --text "Daily tracker finished"
```

The Host injects a scheduler-run scoped `mail:create` capability for Mail send
only. The CLI preserves `OYSTERUN_SCHEDULE_ID`,
`OYSTERUN_SCHEDULE_RUN_ID`, and `OYSTERUN_AGENT_ID` as Mail attribution. Do
not call `/mail/*` endpoints directly, do not print capability tokens, and use
the legacy `send_mail.mjs` helper only for old generated scripts that already
depend on it.

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
