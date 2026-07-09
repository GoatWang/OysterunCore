# Route C Provider Contract

Status: Phase 181 provider skill install/update and trusted-folder contract.

This document defines the minimum provider capability contract for Oysterun Host
sessions, the copy-only product skill installation controller, and the
provider-owned trusted-folder mechanism.

## Provider Identity

Each runtime provider has:

- provider id, such as `claude` or `codex`
- display name
- executable or app-server command
- auth detection/status surface
- model and reasoning/approval options
- provider skill folder target

The first supported provider skill folder targets are:

| Provider | Skill root |
| --- | --- |
| Claude | `.claude/skills` |
| Codex | `.codex/skills` |

## Capability Levels

Provider capabilities use one of these levels:

- `supported`
- `supported_with_adapter`
- `unsupported_with_product_fallback`
- `unsupported_blocking`

The provider catalog should represent gaps explicitly instead of silently falling
back to a different provider.

## P191 Provider Model Catalog Refresh

Provider model catalogs are Host-owned status data. The Host refreshes the
Claude and Codex catalogs in the background by default on a fixed 24h
provider-level window. `OYSTERUN_PROVIDER_MODEL_REFRESH_BACKGROUND_ENABLE=false`
disables only that background timer for proof or served-host readiness; manual
refresh remains available.

Refresh scheduling is based on provider `refreshed_at` / last-attempt status in
`params.json`. `params.refresh.next_refresh_at` may be emitted as a diagnostic,
but it is not scheduling authority.

The Session Setup model selector exposes a manual refresh control that refreshes
only the currently selected product provider. A Host with only one provider
configured must skip the missing/unavailable provider before spawning any child
runtime. `/providers` remains the catalog read source and `config.json` saved
defaults are not silently changed by model refresh.

## Session Operations

Providers must declare support or gaps for:

- session start/resume/branch
- chat send, stream, and read
- tool/status/reasoning metadata
- permission, sandbox, and approval policy
- file/path/link handling
- scheduler
- mail
- notifications
- website
- telegram

Provider-auth failures during a live Route C chat keep the
`provider_session_authentication_failed` classification and
`provider_authentication` scope. The visible recovery copy is a Markdown
`session_lifecycle` row:

```text
Provider login is required before this session can continue.

1. Use machine terminal to login the agent provider
2. If remote terminal is unavailable, [Open Terminal](/app/terminal)

and run the provider login command:

- codex /login for Codex or
- claude /login for Claude.

then use Restart session to resume this chat.
```

This recovery path must not broaden provider runtime authority, hand a dashboard
bearer token to the provider, or special-case Claude `/login` inside
`/session/send`.

Critical Host/admin operations remain dashboard/admin APIs. Runtime capability
guardrails continue to prohibit provider skill install/update/remove as general
session capabilities. P88/P181 expose only the bounded local Session Setup,
Session Profile, and slash-command controller described below.

## P183/P307 Runtime Authority Alignment

P183/P307 runtime authority alignment keeps provider-installed product skills on
the live-session product runtime capability path while preserving
dashboard-owned setup.

Installed provider skills are allowed to call their P86 product operation
commands through the Host-injected live-session capability environment. That
runtime authority is Host-wide for installed Oysterun product skill commands:
the token source must be a currently live session, but current-session env values
are defaults for omitted parameters, not cross-session restrictions. This does
not replace dashboard auth for provider setup, dashboard diagnostics, provider
auth, credentials, raw config editing, provider skill install/update, or
admin-only Host operations.

Provider runtime must not receive a broad dashboard bearer token to make
Oysterun product commands work. The product skill helpers use the packaged
runtime source, preserve redacted CLI output, keep `--dry-run` / `--confirm`
guardrails, and use typed product CLI surfaces for website, Telegram,
find-context, session profile, scheduler, mail, notifications, and chat
operations.

## Oysterun Skill Set Install

The Host installs one aggregate skill set:

```text
<provider_skill_root>/Oysterun/SKILL.md
<provider_skill_root>/Oysterun/modules/<p87-module-name>/SKILL.md
```

The aggregate root `SKILL.md` must contain:

```text
<!-- oysterun-skill-set: true -->
```

Install behavior is copy-only:

- missing `Oysterun` folder: install is allowed
- existing `Oysterun/SKILL.md` with the ownership marker: overwrite is allowed
- existing `Oysterun` folder without the marker: overwrite is refused
- production install never uses symlinks
- no install metadata file is required

The Host source of truth for packaged skill content is
`host-service/assets/product-skills/Oysterun/`. Canonical module source remains
the P87 module skills under `skills/oysterun-*`.

Installed npm runtime status and install must validate the packaged aggregate
source under `host-service/assets/product-skills/Oysterun/` and must not require
the development-only `skills/` or `.codex/skills/` source trees to exist at
runtime. Repository mirror parity remains a build/static review check, not a
runtime precondition for installed Host use.

## UI And Slash Commands

Session Setup owns the launch-time install checkbox. Session Profile owns an
explicit Install/Update Oysterun Skills action for the selected live session's
folder and provider. Session Profile must confirm before overwriting an existing
marker-owned Oysterun skill set. Host Preferences do not expose provider skill
install controls.

The local slash command `/install_oysterun_skill` is intercepted by Host before
provider send. It installs a missing aggregate set and overwrites an existing
marker-owned set only when the command includes `--overwrite`, `overwrite`,
`--update`, or `update`. Helper slash commands insert relative module paths only
and do not auto-send or mutate provider skill folders:

- `/oysterun_sessions_skill`
- `/oysterun_session_chat_skill`
- `/oysterun_find_context_skill`
- `/oysterun_scheduler_skill`
- `/oysterun_mail_skill`
- `/oysterun_notification_skill`
- `/oysterun_notifications_skill`
- `/oysterun_website_skill`
- `/oysterun_telegram_skill`

Example inserted references:

```text
@.codex/skills/Oysterun/modules/oysterun-notifications/SKILL.md
@.claude/skills/Oysterun/modules/oysterun-notifications/SKILL.md
```

## Product Skill Authorization Boundary

Provider-installed Oysterun skills are instruction wrappers around the P86
product CLI. They do not own authorization and must not add their own
cross-session ban.

When a provider invokes an Oysterun skill, the packaged helper or CLI resolves
Host auth from explicit command options, dashboard-token env/profile state, or
Host-injected runtime env. If that resolved auth can operate on another
session, agent, schedule, website, mail item, or notification target, the skill
must allow the command to proceed. If the resolved Host auth cannot operate on
the requested target, the Host API fails closed and the skill reports that
error.

Current-session env such as `OYSTERUN_SESSION_ID` and `OYSTERUN_AGENT_ID` are
defaults for omitted parameters, not product restrictions. Skills may expose
commands that target other sessions when the user/route provides the target and
the resolved Host auth permits it.

Provider skills must still avoid:

- direct Host endpoint calls outside the P86 CLI/helper surface
- direct Matrix facade calls
- printing auth tokens or raw profile files
- injecting broad dashboard tokens into provider runtime as a shortcut

## Trusted Folder Contract

Providers that enforce workspace trust must expose a provider-owned
trusted-folder mechanism for the exact selected agent root realpath.

The first supported providers are:

| Provider | Config target | Trusted entry |
| --- | --- | --- |
| Claude | provider HOME `/.claude.json` | `projects[agent_root_realpath].hasTrustDialogAccepted = true` |
| Codex | `CODEX_HOME/config.toml` or provider HOME `/.codex/config.toml` | `[projects."<agent_root_realpath>"] trust_level = "trusted"` |

The Session Setup trust preview is read-only. It may report `trusted`,
`needs_trust_write`, or `trust_write_failed`, but it must not mutate real
provider config files. The actual write attempt happens only when the user
starts or resumes a session, before provider adapter startup.

Trust writes must be:

- exact to the selected agent root realpath
- idempotent when the exact entry already exists
- backup-protected before modifying existing provider config
- minimal and provider-format aware
- written atomically through a temp file and rename
- protected by a short-lived lock

Trust writes must not:

- trust parent folders, `$HOME`, the broad Oysterun agents root, or unrelated
  paths
- create an Oysterun-only parallel trust file
- hide malformed provider config by guessing repairs or rewriting unrelated
  structure
- expose provider tokens, credentials, or raw secret material in diagnostics

If a trust write fails, Host records a sanitized diagnostic and starts the
provider anyway. The dashboard surfaces a warning, and provider-emitted startup
warnings remain visible.

## P192 Startup Preflight And Durable Diagnostics

Session Setup provider startup runs a bounded Host preflight before
`sessionManager.start()`, history persistence, or live-session creation. Fatal
preflight failures return a visible Session Setup error instead of creating an
empty session shell. Codex preflight verifies `codex app-server --listen
stdio://` through JSON-RPC `initialize`; Claude preflight records command/auth
diagnostics. Auth-required alone remains an in-chat recovery condition, not a
generic startup failure.

Host writes redacted `[provider-startup]` diagnostics to the Host log for
preflight, session start response, ready, before-ready runtime errors,
before-ready exits, and short grace-window exits after ready. User-facing support
copy points to:

```text
grep '\[provider-startup\]' ~/.oysterun/logs/oysterun-host.log | tail -n 80
```

The detailed contract lives in `docs/routec/dev/provider_startup_diagnostics.md`.

## P310 Start Binding And Claude Readiness

Session Setup must not return a successful `/session/start` response until Host
has materialized the Route C Matrix binding for the started session. Successful
responses expose `routec_matrix_binding_ready`,
`routec_matrix_binding_materialized_before_session_start_response`,
`chat_shell_ready`, and `provider_ready`.

`chat_shell_ready` is true when the Host shell is ready to open. `provider_ready`
is true only after the provider runtime readiness signal. Claude may expose the
chat shell before ACP `session.ready` so `/login` remains reachable, but that
shell fallback must not be reported as provider readiness.

Claude startup readiness includes managed ACP runner availability and structured
auth status parsing. Nonzero `claude auth status` output that contains valid
JSON is parsed as the authoritative auth state. Missing ACP runner
materialization is a startup readiness failure, not a successful start with a
hidden provider failure.

## P194 First-Run Demo Agent Boundary

The Explorer demo agent copy flow is provider-neutral. It creates a local
project folder from the packaged `host-service/templates/demo-agents` source and
hands that folder to Explorer/Session Setup as a normal local path. Provider
startup, provider auth, trust previews, and session history creation remain
unchanged until the user explicitly starts a session from that copied folder.

The demo template must not contain provider credentials, provider auth files,
remote tokens, or Owner-local paths. Providers must treat the copied folder the
same way they treat any other user-selected project root.

## P196 Explorer Folder Access Boundary

macOS Explorer folder access guidance is Host/dashboard-owned and provider
neutral. Providers do not receive a new permission mode or sandbox bypass when
Explorer cannot read a local folder. The Host normalizes macOS worker
`EPERM`/`EACCES` into folder access denied guidance and macOS folder browse
timeouts into timeout guidance, then the dashboard asks the user to allow Node.js to access this folder and retry.

Both denied and timeout card modes include the same recovery fallback once: If
no prompt appears, open System Settings > Privacy & Security > Full Disk Access
and allow Node.js / the terminal app running Oysterun. Provider startup,
provider auth, provider-native permission prompts, and workspace allowed-path
policy remain separate from this Explorer-only recovery surface.

## Certification Checklist

- provider skill root is resolved from provider id
- aggregate `Oysterun/SKILL.md` marker is present before overwrite
- install copies files and refuses symlinks
- helper commands insert paths only
- `/install_oysterun_skill` is not sent to provider
- Session Profile update confirms before overwriting owned Oysterun skills
- installed npm runtime status does not require repo-only skill source roots
- P87 skill mirror/source parity remains intact
- P86 CLI/spec wrappers remain the product operation surface
- P85 prohibited-operation guardrails remain intact
- Session Setup trust preview is read-only
- Start/resume attempts the exact selected agent-root trust before adapter start
- trust write failure warns and continues without replacing provider warnings
- Codex trust respects `CODEX_HOME` and uses the exact project block
- Claude trust preserves existing JSON keys and sets only the exact project flag
- provider startup preflight failures are visible before history/live-session
  creation
- provider startup diagnostics are redacted and queryable with the documented
  `[provider-startup]` grep command
