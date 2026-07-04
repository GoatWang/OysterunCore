---
name: oysterun-notifications
description: Use for Oysterun notification status and dry-run/send commands through the P86 CLI without calling cloud push scripts directly.
metadata:
  short-description: Manage Oysterun notifications
---

# Oysterun Notifications

Canonical product skill source lives at `skills/oysterun-notifications/`. The repo-local Codex mirror at `.codex/skills/oysterun-notifications/` and the Host packaged asset at `host-service/assets/product-skills/oysterun-notifications/` are generated mirrors. Run `node tool_scripts/sync_product_skills_to_codex.mjs` after changing this skill and `node tool_scripts/check_product_skill_mirrors.mjs` before review.

Use this module skill for normal product notification operations. It wraps the P86 product CLI contract:

```text
oysterun notifications <action> [options]
```

The helper delegates to the same CLI surface:

```bash
node .codex/skills/oysterun-notifications/scripts/oysterun_notifications.mjs status
```

When Host injects this skill into a live session, the helper path is:

```bash
node .claude/skills/oysterun-notifications/scripts/oysterun_notifications.mjs send --dry-run --text "Preview"
```

## Commands

- `status`
- `send`

## Guardrails

- Do not call debug APNs scripts, direct push providers, or notification endpoints directly from this skill.
- Use `--dry-run` unless the route explicitly authorizes a real notification send.
- Do not print tokens, cookies, passwords, auth headers, APNs credentials, or raw profile files.
- Preserve the P86 CLI redaction envelope for JSON output.
