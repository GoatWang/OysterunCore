---
name: oysterun-find-context
description: Use for Oysterun context lookup around a known Matrix/chat event in the current or explicit target session through the P86 CLI without direct Host API calls or global search.
metadata:
  short-description: Target-session chat context lookup
---

# Oysterun Find Context

Canonical product skill source lives at `skills/oysterun-find-context/`. The
repo-local Codex mirror at `.codex/skills/Oysterun/modules/oysterun-find-context/` and Host packaged assets at `host-service/assets/product-skills/oysterun-find-context/` and `host-service/assets/product-skills/Oysterun/modules/oysterun-find-context/` are generated mirrors. Run `node tool_scripts/sync_product_skills_to_codex.mjs`
after changing this skill and `node tool_scripts/check_product_skill_mirrors.mjs`
before review.

Use this module skill when a live Oysterun session needs a bounded context
window around a known chat/Matrix event id in the current session or an explicit
target session. It wraps the P86 product CLI contract:

```text
oysterun chat messages-around --event-id <matrix_event_id> [--session-ref <display_name>]
```

The helper delegates to the same CLI surface:

```bash
node .codex/skills/Oysterun/modules/oysterun-find-context/scripts/oysterun_find_context.mjs \
  --session-id <session_id> \
  --agent-id <agent_id> \
  --event-id <matrix_event_id> \
  --before 5 \
  --after 5
```

When Host injects this skill into a live session, the helper path is:

```bash
node .claude/skills/Oysterun/modules/oysterun-find-context/scripts/oysterun_find_context.mjs \
  --event-id <matrix_event_id>
```

When the user names another visible live session, pass it with `--session-ref`
or `--session`, not `--session-id`. `--session-id` is exact Host session UUID
only.

## Commands

- `messages-around`

## P183/P307 Runtime Authority

P183/P307 runtime authority alignment preserves this skill's bounded context
lookup path while making installed product skill commands usable from a live
Host session through Host-injected product runtime environment:
`OYSTERUN_HOST_ORIGIN`, `OYSTERUN_CAPABILITY_TOKEN`, `OYSTERUN_SESSION_ID`,
`OYSTERUN_AGENT_ID`, and `OYSTERUN_CLI_BIN`. Inside a live Host session,
helper scripts and direct command examples must execute the injected CLI from
`OYSTERUN_CLI_BIN`; do not call bare `oysterun`, because it may resolve to a
globally installed package with older command behavior. That authority is
Host-wide for installed Oysterun product skills, so one live session may read
bounded context from another live session by `--session-ref` when the user asks.
Do not ask an in-session agent to run dashboard login for this command. Explicit
`--token` is the operator override; external operator shells may still use
dashboard CLI auth.

## Guardrails

- Use this skill only for bounded context around an explicit event id.
- Do not use it for global Matrix indexing, broad history mining, or raw local
  session JSONL scans.
- Do not call `/session/messages`, `/session/transcript/search`,
  `/sessions/search`, Matrix facade routes, or Host APIs directly from this
  skill. The helper must go through `oysterun chat messages-around`.
- Do not print dashboard tokens, cookies, passwords, auth headers, raw profile
  files, raw local Codex session JSONL, or message content marked secret.
- If the task requires local worker investigation across `~/.codex/sessions`,
  use `.codex/prompts/find_context.md` or `.codex/prompts/find_session_history.md`
  outside product runtime instead of this provider-injected product skill.
