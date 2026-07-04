---
name: oysterun-find-context
description: Use for current-session Oysterun context lookup around a known Matrix/chat event through the P86 CLI without direct Host API calls or cross-session search.
metadata:
  short-description: Current-session chat context lookup
---

# Oysterun Find Context

Canonical product skill source lives at `skills/oysterun-find-context/`. The
repo-local Codex mirror at `.codex/skills/oysterun-find-context/` and the Host
packaged asset at `host-service/assets/product-skills/oysterun-find-context/`
are generated mirrors. Run `node tool_scripts/sync_product_skills_to_codex.mjs`
after changing this skill and `node tool_scripts/check_product_skill_mirrors.mjs`
before review.

Use this module skill when a live Oysterun session needs a bounded
current-session context window around a known chat/Matrix event id. It wraps the
P86 product CLI contract:

```text
oysterun chat messages-around --session-id <session_id> --agent-id <agent_id> --event-id <matrix_event_id>
```

The helper delegates to the same CLI surface:

```bash
node .codex/skills/oysterun-find-context/scripts/oysterun_find_context.mjs \
  --session-id <session_id> \
  --agent-id <agent_id> \
  --event-id <matrix_event_id> \
  --before 5 \
  --after 5
```

When Host injects this skill into a live session, the helper path is:

```bash
node .claude/skills/oysterun-find-context/scripts/oysterun_find_context.mjs \
  --session-id <session_id> \
  --agent-id <agent_id> \
  --event-id <matrix_event_id>
```

## Commands

- `messages-around`

## Guardrails

- Use this skill only for current-session context around an explicit event id.
- Do not use it for cross-session search, global Matrix indexing, or broad
  history mining.
- Do not call `/session/messages`, `/session/transcript/search`,
  `/sessions/search`, Matrix facade routes, or Host APIs directly from this
  skill. The helper must go through `oysterun chat messages-around`.
- Do not print dashboard tokens, cookies, passwords, auth headers, raw profile
  files, raw local Codex session JSONL, or message content marked secret.
- If the task requires local worker investigation across `~/.codex/sessions`,
  use `.codex/prompts/find_context.md` or `.codex/prompts/find_session_history.md`
  outside product runtime instead of this provider-injected product skill.
