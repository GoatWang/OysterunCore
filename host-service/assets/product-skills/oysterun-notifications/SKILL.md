---
name: oysterun-notifications
description: Use for Oysterun notification status and dry-run/send commands through the P86 CLI without calling cloud push scripts directly.
metadata:
  short-description: Manage Oysterun notifications
---

# Oysterun Notifications

Canonical product skill source lives at `skills/oysterun-notifications/`. The repo-local Codex mirror at `.codex/skills/Oysterun/modules/oysterun-notifications/` and Host packaged assets at `host-service/assets/product-skills/oysterun-notifications/` and `host-service/assets/product-skills/Oysterun/modules/oysterun-notifications/` are generated mirrors. Run `node tool_scripts/sync_product_skills_to_codex.mjs` after changing this skill and `node tool_scripts/check_product_skill_mirrors.mjs` before review.

Use this module skill for normal product notification operations. It wraps the P86 product CLI contract:

```text
oysterun notifications <action> [options]
```

The helper delegates to the same CLI surface:

```bash
node .codex/skills/Oysterun/modules/oysterun-notifications/scripts/oysterun_notifications.mjs status
```

When Host injects this skill into a live session, the helper path is:

```bash
node .claude/skills/Oysterun/modules/oysterun-notifications/scripts/oysterun_notifications.mjs send --dry-run --text "Preview"
```

## Commands

- `status`
- `send`

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

- Do not call debug APNs scripts, direct push providers, or notification endpoints directly from this skill.
- Use `--dry-run` unless the route explicitly authorizes a real notification send.
- Do not print tokens, cookies, passwords, auth headers, APNs credentials, or raw profile files.
- Preserve the P86 CLI redaction envelope for JSON output.
