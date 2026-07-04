---
name: oysterun-session-chat
description: Use for Oysterun chat and in-session loop operations through the P86 CLI, including send, recent, messages, search, and loop CRUD with confirm/dry-run protection.
metadata:
  short-description: Chat and loop session operations
---

# Oysterun Session Chat

Canonical product skill source lives at `skills/oysterun-session-chat/`. The repo-local Codex mirror at `.codex/skills/oysterun-session-chat/` and the Host packaged asset at `host-service/assets/product-skills/oysterun-session-chat/` are generated mirrors. Run `node tool_scripts/sync_product_skills_to_codex.mjs` after changing this skill and `node tool_scripts/check_product_skill_mirrors.mjs` before review.

Use this module skill for messages and current-session loop automation. It wraps the P86 product CLI contract:

```text
oysterun chat <action> [options]
```

The helper delegates to the same CLI surface:

```bash
node .codex/skills/oysterun-session-chat/scripts/oysterun_session_chat.mjs recent --session-id <session_id>
```

When Host injects this skill into a live session, the helper path is:

```bash
node .claude/skills/oysterun-session-chat/scripts/oysterun_session_chat.mjs recent --session-id <session_id>
```

## Commands

- `send`
- `recent`
- `messages`
- `messages-around`
- `search`
- `loop list`
- `loop create`
- `loop update`
- `loop enable`
- `loop disable`
- `loop delete --confirm` or `loop delete --dry-run`

## Guardrails

- Do not call `/session/send`, `/session/history`, `/session/messages`, `/session/transcript/search`, or `/session/loops` directly from this skill.
- Use `--dry-run` before destructive loop operations unless the route explicitly authorizes mutation.
- Do not print dashboard tokens, cookies, passwords, auth headers, raw profile files, or message content marked secret.
- Cross-session search remains outside this first-slice module unless the product Matrix search/index contract is upgraded.
