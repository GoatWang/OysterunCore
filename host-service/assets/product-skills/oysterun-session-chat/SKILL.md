---
name: oysterun-session-chat
description: Use for Oysterun chat and in-session loop operations through the P86 CLI, including send, recent, messages, search, and loop CRUD with confirm/dry-run protection.
metadata:
  short-description: Chat and loop session operations
---

# Oysterun Session Chat

Canonical product skill source lives at `skills/oysterun-session-chat/`. The repo-local Codex mirror at `.codex/skills/Oysterun/modules/oysterun-session-chat/` and Host packaged assets at `host-service/assets/product-skills/oysterun-session-chat/` and `host-service/assets/product-skills/Oysterun/modules/oysterun-session-chat/` are generated mirrors. Run `node tool_scripts/sync_product_skills_to_codex.mjs` after changing this skill and `node tool_scripts/check_product_skill_mirrors.mjs` before review.

Use this module skill for messages and current-session loop automation. It wraps the P86 product CLI contract:

```text
oysterun chat <action> [options]
```

The helper delegates to the same CLI surface:

```bash
node .codex/skills/Oysterun/modules/oysterun-session-chat/scripts/oysterun_session_chat.mjs recent --session-id <session_id>
```

When Host injects this skill into a live session, the helper path is:

```bash
node .claude/skills/Oysterun/modules/oysterun-session-chat/scripts/oysterun_session_chat.mjs recent
```

Inside a live Host session, current-session commands should omit the session
target unless the user explicitly asks for another session. The CLI will use
Host-injected runtime environment before saved dashboard profiles. If the user
provides a visible session display name, pass it with `--session-ref` or
`--session`, not `--session-id`. `--session-id` is exact Host session UUID only.
For another live session, `send`, `messages`, `messages-around`, `search`, and
loop commands may target `--session-ref`; the CLI resolves the target session
and target agent through Host-owned session status.

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

- Do not call `/session/send`, `/session/history`, `/session/messages`, `/session/transcript/search`, or `/session/loops` directly from this skill.
- Use `--dry-run` before destructive loop operations unless the route explicitly authorizes mutation.
- Do not print dashboard tokens, cookies, passwords, auth headers, raw profile files, or message content marked secret.
- In live sessions, use the injected current-session defaults unless the user provides an explicit target. Use `--session-id` only for an exact Host session UUID; use `--session-ref` or `--session` for a visible session display name.
- `search` is a bounded product CLI scan of one target session timeline. It is not a global Matrix index or broad history mining command.
