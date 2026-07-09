---
name: oysterun-mail
description: Use for Oysterun Mail commands through the P86 CLI, including send, unread-count, list, get, read/unread, archive/unarchive, update, and confirm/dry-run protected delete.
metadata:
  short-description: Manage Oysterun Mail
---

# Oysterun Mail

Canonical product skill source lives at `skills/oysterun-mail/`. The repo-local Codex mirror at `.codex/skills/oysterun-mail/` and the Host packaged asset at `host-service/assets/product-skills/oysterun-mail/` are generated mirrors. Run `node tool_scripts/sync_product_skills_to_codex.mjs` after changing this skill and `node tool_scripts/check_product_skill_mirrors.mjs` before review.

Use this module skill for normal product Mail operations. It wraps the P86 product CLI contract:

```text
oysterun mail <action> [options]
```

The helper delegates to the same CLI surface:

```bash
node .codex/skills/oysterun-mail/scripts/oysterun_mail.mjs send \
  --title "Digest ready" \
  --text "Daily tracker finished" \
  --source-ref route-owned-mail
```

When Host injects this skill into a live session, the helper path is:

```bash
node .claude/skills/oysterun-mail/scripts/oysterun_mail.mjs list
```

## Commands

- `send`
- `unread-count`
- `list`
- `get`
- `read`
- `unread`
- `archive`
- `unarchive`
- `update`
- `delete --confirm` or `delete --dry-run`

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

- Do not call `/mail/send` or `/mail/items/*` directly from this skill.
- `mail send` defaults to the Host owner recipient. Dashboard auth claims stay actor/audit identity only.
- Explicit recipient overrides must fail closed when the Host app user is unavailable.
- Do not print tokens, cookies, passwords, auth headers, raw profile files, or raw Mail capability tokens.
- Use `--dry-run` before deleting Mail unless the route explicitly authorizes mutation.

## Scheduler/Agent Runtime Compatibility

The legacy capability helper remains available for scheduler or agent runtime paths that receive `OYSTERUN_MAIL_WRITE_TOKEN` or `OYSTERUN_CAPABILITY_TOKEN` from Host:

```bash
node .claude/skills/oysterun-mail/scripts/send_mail.mjs --title "Digest ready" --body "Daily tracker finished"
```

External operator shells should prefer `oysterun_mail.mjs` with dashboard CLI
auth; live Host sessions must rely on Host-injected product runtime env instead
of dashboard tokens.
