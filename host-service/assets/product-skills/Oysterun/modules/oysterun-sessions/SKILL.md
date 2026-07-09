---
name: oysterun-sessions
description: Use for Oysterun product session commands through the P86 CLI, including listing, starting, status, URL, profile get/update, rename, stop, interrupt, restart, resume, and branch-resume without calling Host APIs directly.
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

Inside a live Host session, current-session commands should omit the session
target unless the user explicitly asks for another session. The CLI will use
Host-injected runtime environment before saved dashboard profiles. If the user
provides a visible session display name, pass it with `--session-ref` or
`--session`, not `--session-id`. `--session-id` is exact Host session UUID only.
For live targets, `--session-ref` resolves through session status. For
`resume`/`branch-resume`, exact history session id or display name can be used;
ambiguous history display names fail closed.

## Commands

- `list`
- `start`
- `status`
- `url`
- `profile get`
- `profile update`
- `rename`
- `stop --confirm` or `stop --dry-run`
- `interrupt --confirm` or `interrupt --dry-run`
- `restart --confirm` or `restart --dry-run`
- `resume`
- `branch-resume`

## P183/P307 Runtime Authority

P183/P307 runtime authority alignment means every command in this skill is
callable from a live Host session through Host-injected product runtime
environment:
`OYSTERUN_HOST_ORIGIN`, `OYSTERUN_CAPABILITY_TOKEN`, `OYSTERUN_SESSION_ID`,
`OYSTERUN_AGENT_ID`, and `OYSTERUN_CLI_BIN`. Inside a live Host session,
helper scripts and direct command examples must execute the injected CLI from
`OYSTERUN_CLI_BIN`; do not call bare `oysterun`, because it may resolve to a
globally installed package with older command behavior. That authority is
Host-wide for installed Oysterun product skills, so one live session may target
another live session by `--session-ref` when the user asks. Do not ask an
in-session agent to run dashboard login for these commands. Explicit `--token`
is the operator override; external operator shells may still use dashboard CLI
auth.

## Guardrails

- Use `--dry-run` for dangerous commands until the route explicitly authorizes mutation.
- Do not call `/session/start`, `/session/stop`, `/session/restart`, or other Host endpoints directly from this skill.
- Do not expose raw config editing, provider auth, credential, provider skill install/update/remove, or runtime capability toggle endpoints through this skill.
- Do not print tokens, cookies, passwords, auth headers, raw profile files, or dashboard credentials.
- External operator shells use `OYSTERUN_DASHBOARD_TOKEN` or `OYSTERUN_CLI_PROFILE_PATH`; live Host sessions use Host-injected product runtime env for product commands.
- In live sessions, use the injected current-session defaults unless the user provides an explicit target. Use `--session-id` only for an exact Host session UUID; use `--session-ref` or `--session` for a visible session display name.
- `sessions url` is a formatting command and must not start a provider session.
