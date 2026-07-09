---
name: oysterun-website
description: Use for Oysterun website status, URL, validate, init, access, and password commands through the P86 CLI while preserving the phone-first OysterAgents webdesign guide.
metadata:
  short-description: Manage Oysterun websites
---

# Oysterun Website

Canonical product skill source lives at `skills/oysterun-website/`. The repo-local Codex mirror at `.codex/skills/oysterun-website/` and the Host packaged asset at `host-service/assets/product-skills/oysterun-website/` are generated mirrors. Run `node tool_scripts/sync_product_skills_to_codex.mjs` after changing this skill and `node tool_scripts/check_product_skill_mirrors.mjs` before review.

Use this module skill for normal product website operations. It wraps the P86 product CLI contract:

```text
oysterun website <action> [options]
```

The helper delegates to the same CLI surface:

```bash
node .codex/skills/oysterun-website/scripts/oysterun_website.mjs validate --agent-id <agent_id> --agent-folder /absolute/agent
```

When Host injects this skill into a live session, the helper path is:

```bash
node .claude/skills/oysterun-website/scripts/oysterun_website.mjs status --agent-id <agent_id>
```

## Commands

- `status`
- `url`
- `validate`
- `init`
- `access get`
- `access set --confirm` or `access set --dry-run`
- `password set --confirm` or `password set --dry-run`

## P183/P307 Runtime Authority

P183/P307 runtime authority alignment makes all installed product skill commands
usable from a live Host session through Host-injected product runtime
environment:
`OYSTERUN_HOST_ORIGIN`, `OYSTERUN_CAPABILITY_TOKEN`, `OYSTERUN_SESSION_ID`,
`OYSTERUN_AGENT_ID`, and `OYSTERUN_CLI_BIN`. Inside a live Host session,
helper scripts and direct command examples must execute the injected CLI from
`OYSTERUN_CLI_BIN`; do not call bare `oysterun`, because it may resolve to a
globally installed package with older command behavior. That authority is
Host-wide for installed Oysterun product skills. Website commands still use
typed CLI fields such as `--agent-id` and `--agent-folder`; they must not bypass
website validation or raw Host APIs. Do not ask an in-session agent to run
dashboard login for these commands. Explicit `--token` is the operator override;
external operator shells may still use dashboard CLI auth.

## Site Contract

- Shared agent config: `.oysterun/config.json`
- Local private overrides: `.oysterun/local.json`
- Default website root: `.oysterun/site`
- Shared website config keys: `web.root` and `web.access`
- Supported `web.access` values: `owner_only`, `password`, `public`
- Canonical browser route: `/sites/<agent_id>/...`
- Required entry page: `.oysterun/site/index.html`
- The website belongs to the `agent_id`, not one session, and remains available while the agent folder and site files exist.

Use `owner_only` unless a route explicitly asks for public or password-protected access.

## Authoring Workflow

1. Confirm the target agent folder and agent id from the active route or Host metadata.
2. Inspect `.oysterun/config.json` if it exists.
3. If `web.root` is absent, use `.oysterun/site`; if `web.access` is absent, use `owner_only`.
4. Write browser-facing files under the resolved site root:
   - `index.html` is mandatory.
   - CSS, JS, images, and fonts should live under `assets/`.
   - Normal pages should live under `pages/` or clear route-owned subfolders.
   - Report pages should live under `reports/` and be linked from `index.html`.
5. Use relative links and relative asset paths inside the site.
6. Keep source file preview paths separate from browser routes. `.oysterun/site/index.html` is a source path; `/sites/<agent_id>/` is the browser route.
7. Validate with `oysterun website validate` before reporting completion.

## Phone-First Requirements

- Design for a 375px-wide phone viewport first, then enhance desktop.
- Every HTML page should include:

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
```

- Keep controls tap-friendly, generally at least `44x44` CSS pixels.
- Do not depend on hover-only interactions.
- Avoid fixed-width layouts that cause horizontal overflow.
- Put wide tables, charts, code blocks, and dense content inside explicit scrollable regions.
- Include mobile-friendly metadata such as `theme-color` when useful.
- Do not claim offline support, installability, or service-worker behavior unless implemented.

## Guardrails

- Do not require `vite`, `python -m http.server`, `npx serve`, Django, or any localhost server for the final Oysterun user flow.
- Do not tell users to open `file://` URLs or fixed-IP report URLs.
- Do not call website Host endpoints directly from this skill.
- Use `--dry-run` before access or password changes unless the route explicitly authorizes mutation.
- Do not print tokens, cookies, passwords, auth headers, raw profile files, or raw website passwords.
