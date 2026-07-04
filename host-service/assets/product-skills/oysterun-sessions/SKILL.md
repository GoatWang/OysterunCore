---
name: oysterun-sessions
description: Use for Oysterun product session commands through the P86 CLI, including listing, starting, status, URL, rename, stop, interrupt, restart, resume, and branch-resume without calling Host APIs directly.
metadata:
  short-description: Manage Oysterun sessions
---

# Oysterun Sessions

Canonical product skill source lives at `skills/oysterun-sessions/`. The repo-local Codex mirror at `.codex/skills/oysterun-sessions/` and the Host packaged asset at `host-service/assets/product-skills/oysterun-sessions/` are generated mirrors. Run `node tool_scripts/sync_product_skills_to_codex.mjs` after changing this skill and `node tool_scripts/check_product_skill_mirrors.mjs` before review.

Use this module skill for normal product session operations. It wraps the P86 product CLI contract:

```text
oysterun sessions <action> [options]
```

The helper delegates to the same CLI surface:

```bash
node .codex/skills/oysterun-sessions/scripts/oysterun_sessions.mjs list --host http://localhost:2322
```

When Host injects this skill into a live session, the helper path is:

```bash
node .claude/skills/oysterun-sessions/scripts/oysterun_sessions.mjs list
```

## Commands

- `list`
- `start`
- `status`
- `url`
- `rename`
- `stop --confirm` or `stop --dry-run`
- `interrupt --confirm` or `interrupt --dry-run`
- `restart --confirm` or `restart --dry-run`
- `resume`
- `branch-resume`

## Guardrails

- Use `--dry-run` for dangerous commands until the route explicitly authorizes mutation.
- Do not call `/session/start`, `/session/stop`, `/session/restart`, or other Host endpoints directly from this skill.
- Do not print tokens, cookies, passwords, auth headers, raw profile files, or dashboard credentials.
- External operator shells use `OYSTERUN_DASHBOARD_TOKEN` or `OYSTERUN_CLI_PROFILE_PATH`; live Host sessions use Host-injected scoped capability env for current-session commands.
- `sessions url` is a formatting command and must not start a provider session.
