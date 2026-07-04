---
name: oysterun-telegram
description: Use for Oysterun Telegram status and per-session Telegram setup commands through the P86 CLI without depending on a global Telegram product flag.
metadata:
  short-description: Manage Oysterun Telegram setup
---

# Oysterun Telegram

Canonical product skill source lives at `skills/oysterun-telegram/`. The repo-local Codex mirror at `.codex/skills/oysterun-telegram/` and the Host packaged asset at `host-service/assets/product-skills/oysterun-telegram/` are generated mirrors. Run `node tool_scripts/sync_product_skills_to_codex.mjs` after changing this skill and `node tool_scripts/check_product_skill_mirrors.mjs` before review.

Use this module skill for normal product Telegram status and per-session setup. It wraps the P86 product CLI contract:

```text
oysterun telegram <action> [options]
oysterun sessions telegram <action> [options]
```

The module helper is current-session aware. In a live Host session with
`OYSTERUN_HOST_ORIGIN`, `OYSTERUN_CAPABILITY_TOKEN`, and `OYSTERUN_SESSION_ID`,
`status` resolves the current session's Telegram state through scoped runtime
capability auth; it must not ask the in-session agent to run dashboard login:

```bash
node .codex/skills/oysterun-telegram/scripts/oysterun_telegram.mjs status
```

For per-session setup, use the product CLI directly. Inside a live Host session,
omit `--session-id` so the Host-injected current-session env is used. External
operator shells may pass `--session-id` and dashboard auth:

```bash
oysterun sessions telegram get
oysterun sessions telegram enable
oysterun sessions telegram disable
oysterun sessions telegram update --telegram-enabled true
oysterun sessions telegram get --session-id <session_id>
oysterun sessions telegram enable --session-id <session_id>
oysterun sessions telegram disable --session-id <session_id>
oysterun sessions telegram update --session-id <session_id> --telegram-enabled true
```

## Commands

- `telegram status`
- `sessions telegram get`
- `sessions telegram enable`
- `sessions telegram disable`
- `sessions telegram update`

## Guardrails

- Telegram setup is per-session and `telegram.enabled` defaults off.
- Normal product behavior must not depend on a global Telegram product flag.
- Live Host sessions use Host-injected scoped runtime capability env for
  current-session Telegram status/setup; do not ask the agent to perform
  `oysterun auth login` for those in-session checks.
- External operator shells may still use dashboard CLI auth, saved profiles, or
  explicit `--token` for dashboard/global status.
- Do not expose `telegram feature enable`, `telegram feature disable`, or `telegram send` as normal product commands.
- Do not call Telegram Host endpoints directly from this skill.
- Do not print bot tokens, allowed-user secrets, dashboard tokens, cookies, passwords, auth headers, or raw profile files.
