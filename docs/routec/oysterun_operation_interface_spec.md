# Oysterun Operation Interface Spec

Status: Phase 86 product CLI source contract.

This document defines the stable Host operation surface consumed by the product
CLI. The CLI command form is:

```text
oysterun <module> <action> [options]
```

Existing setup, `show-qr`, and `service:*` commands remain supported and are not
rewritten by Phase 86.

## P193 Service Node Runtime

Service command usage remains stable:

```text
oysterun service:start
oysterun service:restart
oysterun service:restart --restore-sessions
oysterun service:install
oysterun service:uninstall
oysterun uninstall [--confirm DELETE]
```

Service scripts require Node.js >=20 and resolve a concrete executable through
`OYSTERUN_NODE_BIN`, shell command lookup, then common install locations. macOS
LaunchAgents persist `OYSTERUN_NODE_BIN` because launchd does not source shell
rc files. Host Preferences update/restart jobs use absolute Node and absolute
`bin/oysterun.mjs` paths rather than relying on `oysterun` from `PATH`. Full
details are in `docs/routec/dev/node_runtime_startup.md`.

`oysterun uninstall` is the top-level cleanup surface. It delegates managed
service removal to the service scripts, preserves Host config unless the exact
`--confirm DELETE` token is supplied, never deletes the Default Browse Root or
agent folders, and prints `npm uninstall -g oysterun` as the separate global
package removal step. macOS removes launchd state; Linux reports that no launchd
service exists while still clearing managed pid/origin runtime state.

## Principles

- The CLI calls Host APIs. It does not mutate Host DB files, agent config files,
  runtime JSON files, or dashboard local state directly.
- Human-readable output is the default. `--json` returns a stable envelope with
  `ok`, `command`, `contract`, `result`, and `error`.
- Secret-like fields are redacted in output. Redaction covers token, password,
  secret, cookie, authorization, auth header, and bot token fields.
- Dangerous mutations require `--confirm`; `--dry-run` reports the planned
  request without mutating.
- Telegram setup is per-session and defaults off.
- Critical Host/admin operations remain dashboard/admin APIs and are not exposed
  through session runtime capabilities.

## P191 Provider Model Catalog Refresh

Provider model catalog refresh is a Host/dashboard operation, not a product CLI
or provider runtime capability.

Read catalog:

- `GET /providers`

Manual Session Setup refresh:

- `POST /providers/model-refresh` with `provider`.

The manual endpoint requires dashboard auth and refreshes only the requested
current product provider (`claude` or `codex`). It returns redacted refresh
status and an updated provider catalog. Missing or unavailable providers are
reported as skipped before provider child runtime spawn. The endpoint must not
mutate Host saved defaults in `config.json`.

Background refresh:

- Enabled by default.
- Disabled only by explicit
  `OYSTERUN_PROVIDER_MODEL_REFRESH_BACKGROUND_ENABLE=false`.
- Uses fixed 24h provider-level eligibility from provider refresh status.

## P192 Provider Startup Diagnostics

Provider startup preflight and durable startup diagnostics are Host/dashboard
behavior, not product CLI commands. Session Setup start failures caused by fatal
provider preflight errors return a visible error before history/live-session
creation and include the support command:

```text
grep '\[provider-startup\]' ~/.oysterun/logs/oysterun-host.log | tail -n 80
```

Provider startup diagnostics must be redacted and must not expose dashboard
tokens, provider credentials, API keys, passwords, cookies, authorization
headers, or raw environment dumps. The full contract is
`docs/routec/dev/provider_startup_diagnostics.md`.

## P310 Route C Start Binding Readiness

`POST /session/start` returns success only after the Host has created or reused
the Route C Matrix binding for the new live session. Successful responses include
`chat_shell_ready`, `provider_ready`, `routec_matrix_binding_ready`,
`routec_matrix_binding_materialized_before_session_start_response`, and
`routec_matrix_binding_materialization`.

The dashboard treats `chat_shell_ready` as the signal that chat can open.
`provider_ready` remains separate and turns true only when the provider runtime
emits readiness. Claude-specific login recovery may open a chat shell before ACP
`session.ready`; that state is not provider readiness.

Claude startup preflight verifies managed ACP runner availability and parses
structured `claude auth status` JSON from stdout even when the command exits
nonzero. Missing ACP runner materialization fails before the session start
success response.

## P195 Provider Login Recovery And Restart UI

Provider-auth failures during live chat are visible recovery guidance, not a
product CLI command. The chat copy first tells the user to log in from the
machine terminal, then points to `/app/terminal` if remote terminal is available,
tells Codex users to run `codex /login`, tells Claude users to run
`claude /login`, and directs the user to Restart session. The copy must not ask
the provider runtime to fetch dashboard credentials, mutate Oysterun config
files, or rely on a Claude-only `/session/send` `/login` interception.

## P88 Provider Skill Installation Controller

P88 adds a bounded Host-owned controller for installing packaged Oysterun product
skills into provider skill folders. It is not a general provider-skill mutation
API and does not loosen runtime capability guardrails.

Read-only status:

- `GET /agent/provider-skill-status?agent_id=<id>&agent_folder=<path>&provider=<provider>`

Session Profile install/update:

- `POST /agent/provider-skill-install` with `agent_id`, optional
  `agent_folder`, `provider`, and `overwrite`. This installs a missing aggregate
  set or overwrites a marker-owned set only when `overwrite: true`.

Session Setup launch/resume payload:

- `install_oysterun_skills: true` requests copy-only install/overwrite of the
  aggregate `Oysterun` skill set before provider start.

Local Route C slash command:

- `/install_oysterun_skill` is intercepted by Host before provider send. It
  installs the aggregate skill set when missing, overwrites an owned existing
  folder only when the command includes `--overwrite`, `overwrite`, `--update`,
  or `update`, and refuses unowned existing folders.

Helper slash commands:

- `/oysterun_sessions_skill`
- `/oysterun_session_chat_skill`
- `/oysterun_find_context_skill`
- `/oysterun_scheduler_skill`
- `/oysterun_mail_skill`
- `/oysterun_notification_skill`
- `/oysterun_notifications_skill`
- `/oysterun_website_skill`
- `/oysterun_telegram_skill`

Helpers insert provider-relative module `SKILL.md` references only. They do not
auto-send, call backend install endpoints, or mutate provider skill folders.

Installed npm runtime behavior uses packaged
`host-service/assets/product-skills/Oysterun/` as the source and must not require
development-only `skills/` or `.codex/skills/` roots for status/install.
Provider contract details live in `docs/routec/provider_contract.md`; the
user-facing skill installation contract lives in
`docs/routec/skill_installation.md`.

## Target And Auth Resolution

Target origin resolution order:

1. `--host`, `--origin`, or `--target`
2. `OYSTERUN_HOST_ORIGIN`
3. saved CLI profile
4. Host config `direct_host_url`, `public_base_url`, or `port`

Auth token resolution order:

For live Host sessions, product CLI commands prefer Host-injected runtime
authority when `OYSTERUN_HOST_ORIGIN`, `OYSTERUN_CAPABILITY_TOKEN`, and
`OYSTERUN_SESSION_ID` are present. This P183/P307 runtime authority alignment is
Host-wide for installed Oysterun product skills and must not require dashboard
login or saved dashboard profiles. Saved dashboard profiles and
`OYSTERUN_DASHBOARD_TOKEN` must not steal precedence from in-session runtime
authority. Explicit `--token` remains the operator override.

External dashboard auth resolution order:

1. `--token`
2. `OYSTERUN_DASHBOARD_TOKEN`
3. saved CLI profile token

`oysterun auth login` writes the CLI profile fallback file at
`~/.oysterun/cli-profiles.json`, or `OYSTERUN_CLI_PROFILE_PATH` when set. The
file is written mode `0600`. Host-side token truth remains the authenticated
dashboard session store; raw token material is not printed.

## Command Groups

### Auth

Commands:

- `oysterun auth login`
- `oysterun auth status`
- `oysterun auth logout`

Host APIs:

- `POST /auth/login`
- `GET /auth/status`
- `POST /auth/logout`

### Sessions

Commands:

- `oysterun sessions list`
- `oysterun sessions start`
- `oysterun sessions status`
- `oysterun sessions url`
- `oysterun sessions profile get`
- `oysterun sessions profile update`
- `oysterun sessions rename`
- `oysterun sessions stop --confirm`
- `oysterun sessions interrupt --confirm`
- `oysterun sessions restart --confirm`
- `oysterun sessions resume`
- `oysterun sessions branch-resume`

Provider permission fields:

- Normal mode accepts only default provider permission values: Claude
  `permission_mode=bypassPermissions` and Codex `approval_policy=never`.
- Non-default `permission_mode` / `approval_policy` CLI requests require Host
  `config.debug.json` key
  `provider_permission.debug_mode_dropdown_enable=true` plus
  `--confirm-beta-provider-permission-mode`.
- Codex `approval_policy` accepts only `on-request` and `never`; `suggested` is
  not valid.

Host APIs:

- `GET /sessions`
- `POST /session/start`
- `GET /session/status`
- `POST /session/rename`
- `PATCH /session/profile-config`
- `POST /session/stop`
- `POST /session/interrupt`
- `POST /session/restart`
- `POST /session/resume`
- `POST /sessions/resume`

`POST /session/restart` is the only Restart-session mutation used by Route C
chat and Sessions UI. The response `session_id` is authoritative; clients must
navigate to `/app/sessions/<response.session_id>/chat` rather than assuming the
request id. Chat header Restart and Sessions live-row Restart show
`Restarting...`, guard duplicate clicks while pending, and keep Stop pending
state independent. History-session rows do not expose Restart.

`sessions url` formats `/app/sessions/<session_id>/chat` from the resolved Host
origin and does not call a mutating endpoint.

`sessions profile get/update` mirrors normal Session Profile fields through
typed Host-owned endpoints. It may update session name, notifications, allowed
paths, website access/enabled/password, and Telegram settings. Provider runtime
fields remain read-only. Runtime capability toggles are not normal CLI behavior,
and the CLI must not expose arbitrary raw config editing.

In live Host sessions, `--session-ref` or `--session` resolves visible live
session display names for session/chat/profile commands. `resume` and
`branch-resume` may resolve exact history session id or display name; ambiguous
history display names fail closed.

### Chat And In-Session Loop

Commands:

- `oysterun chat send`
- `oysterun chat recent`
- `oysterun chat messages`
- `oysterun chat messages-around`
- `oysterun chat search`
- `oysterun chat loop list`
- `oysterun chat loop create`
- `oysterun chat loop update`
- `oysterun chat loop enable`
- `oysterun chat loop disable`
- `oysterun chat loop delete --confirm`

Host APIs:

- `POST /session/send`
- `GET /session/history`
- `GET /session/messages`
- `GET /session/transcript`
- `GET /sessions/matrix-transcripts`
- `GET /session/tool-event-detail`
- `GET /session/loops`
- `POST /session/loops`
- `PATCH /session/loops/<loop_id>`
- `DELETE /session/loops/<loop_id>`

`oysterun chat search` is current-session only. It reads the existing
Matrix-backed `GET /session/messages` product transcript truth and applies
bounded CLI-side filtering; it must not call the removed
`/session/transcript/search` or `/sessions/search` legacy routes.

`oysterun chat messages-around` is also current-session only. It requires an
explicit event/message id, reads the same Matrix-backed `GET /session/messages`
product transcript truth, and returns a bounded before/target/after context
window. It is the product-runtime retrieval boundary for
`oysterun-find-context`; it does not add cross-session search, a new Host search
route, direct Matrix facade calls, or raw local Codex session-history access.

Cross-session `sessions search` is not part of the P86 first slice unless the
product Matrix search/index contract is upgraded.

Large tool details use P131 summary-first transfer. Normal transcript and
Matrix timeline delivery returns bounded tool summaries; full detail is fetched
explicitly from `GET /session/tool-event-detail` with `session_id`,
`matrix_room_id`, and `matrix_event_id`. The endpoint is authenticated,
room-bound, and must not expose raw Host storage paths.

### Scheduler

Commands:

- `oysterun scheduler list`
- `oysterun scheduler create`
- `oysterun scheduler get`
- `oysterun scheduler update`
- `oysterun scheduler enable`
- `oysterun scheduler disable --confirm`
- `oysterun scheduler delete --confirm`
- `oysterun scheduler test-run`
- `oysterun scheduler runs`
- `oysterun scheduler run-log`

Host APIs:

- `GET /scheduler/schedules`
- `POST /scheduler/schedules`
- `GET /scheduler/schedules/<schedule_id>`
- `PATCH /scheduler/schedules/<schedule_id>`
- `DELETE /scheduler/schedules/<schedule_id>`
- `POST /scheduler/schedules/<schedule_id>/test-run`
- `GET /scheduler/schedules/<schedule_id>/runs`
- `GET /scheduler/schedules/<schedule_id>/runs/<run_id>/log`

`oysterun scheduler create` creates Host scheduler rows backed by a portable
outside-scheduler setup snapshot. In live-session product runtime, omitting a
target uses the current session as the saved-session source; `--session-ref`
resolves another live session display name and sends a `saved_session` target
binding so the Host copies the session setup into a portable snapshot. Host
scheduler create/update uses rule fields such as `--frequency daily --time
HH:mm`, `--frequency weekly --weekdays monday,wednesday --time HH:mm`, or
`--frequency once --run-at <ISO time>`. `--interval` belongs to `oysterun chat
loop create`, not Host scheduler rows.

### Mail

Commands:

- `oysterun mail send`
- `oysterun mail unread-count`
- `oysterun mail list`
- `oysterun mail get`
- `oysterun mail read`
- `oysterun mail unread`
- `oysterun mail archive`
- `oysterun mail unarchive`
- `oysterun mail update`
- `oysterun mail delete --confirm`

Host APIs:

- `POST /mail/send`
- `GET /mail/unread-count`
- `GET /mail/items`
- `GET /mail/items/<mail_id>`
- `PATCH /mail/items/<mail_id>`
- `DELETE /mail/items/<mail_id>`
- `POST /mail/items/<mail_id>/read`
- `POST /mail/items/<mail_id>/unread`
- `POST /mail/items/<mail_id>/archive`
- `POST /mail/items/<mail_id>/unarchive`

`mail send` is a normal dashboard-authenticated product path. The older
capability-scoped `POST /mail/items` remains for scheduler/agent runtime Mail
creation and is not the product CLI send route.

Mail send defaults to the Host owner recipient. Dashboard authentication
claims remain actor/audit identity only and must not become the default Mail
recipient unless that Host app user exists explicitly. Explicit recipient
overrides fail closed when the Host app user is not available.

### Notifications

Commands:

- `oysterun notifications status`
- `oysterun notifications send`

Host APIs:

- `GET /notifications/status`
- `POST /notifications/send`

The send endpoint accepts title/body/url and reports cloud/local readiness and
redacted delivery details. The CLI does not rely on debug APNs scripts.

### Website

Commands:

- `oysterun website status`
- `oysterun website url`
- `oysterun website validate`
- `oysterun website init`
- `oysterun website access get`
- `oysterun website access set --confirm`
- `oysterun website password set --confirm`

Host APIs:

- `GET /website/status`
- `POST /website/validate`
- `POST /website/init`
- `GET /website/access`
- `PATCH /website/access`
- `POST /website/password`

Website init creates deterministic scaffolding only:

- `.oysterun/config.json`
- `.oysterun/site/`
- `.oysterun/site/assets/`
- `.oysterun/site/index.html`

Session Setup and Session Profile use the same canonical scaffold template at
`host-service/templates/agent-site/index.html` when `web.enabled` is true. The
template write is no-overwrite/no-delete: existing `index.html` content is
preserved, disabling `web.enabled` never removes site files, and
`web.password` remains Host-local only.

`POST /website/init` and the endpoint-backed `oysterun website init` command
must call the same Host scaffold helper used by Session Setup/Profile Website
Enabled. The Website init API keeps its P86 response contract and creates
`.oysterun/site/assets/` plus shared `web.enabled=true` on non-dry-run, while
dry-run remains non-mutating and registry folder persistence happens only after
successful non-dry-run scaffolding.

### Telegram

Commands:

- `oysterun telegram status`
- `oysterun sessions telegram get`
- `oysterun sessions telegram enable`
- `oysterun sessions telegram disable`
- `oysterun sessions telegram update`

Host APIs:

- `GET /telegram/status`
- `POST /telegram/test-send`
- `GET /session/status`
- `PATCH /session/profile-config`

Forbidden product commands:

- `oysterun telegram feature enable`
- `oysterun telegram feature disable`
- `oysterun telegram send`

Telegram setup is per-session. `telegram.enabled` defaults off and normal
product paths do not depend on a Host-level Telegram product flag.

`POST /telegram/test-send` is dashboard-authenticated and is shared by Session
Setup and Session Profile. It resolves a draft token and allowed users first,
then existing local/private Telegram config, sends the exact text
`Oysterun Telegram test message.`, and returns redacted success/failure. It is
not a product CLI send command, has no Mock fallback in the normal UI, and must
not start provider runtime, write Matrix/timeline chat rows, or produce provider
tool responses.

## P183/P307 Runtime Authority Alignment

P183/P307 runtime authority alignment makes the installed product skill command
surface use live-session product runtime capability auth instead of dashboard
login.

Installed Oysterun product skills run inside a live Host session with
Host-injected product runtime environment. They must be callable without
dashboard login for their bounded P86 operation surface:

- sessions: list, start, status, URL, profile get/update, rename, stop,
  interrupt, restart, resume, and branch-resume
- chat: send, recent, messages, messages-around, search, and loop CRUD
- scheduler: read schedules/runs/logs, create/update schedules, and test-run
- mail: send, unread-count, list, get, read/unread, archive/unarchive, update,
  and delete
- notifications: status and send
- website, Telegram, and find-context commands use the same product CLI/runtime
  authority path

Runtime-capability tokens must come from a currently live source session, but
installed Oysterun product skills have Host-wide product authority. Current
session env values are defaults for omitted parameters, not cross-session
restrictions. Dashboard login, dashboard cookies, and dashboard bearer tokens
remain the authority for admin surfaces, provider auth, credentials, raw config
editing, provider skill installation/update controls, diagnostics, and external
operator shells without live-session runtime env. Product skills must not ask an
in-session agent to run `oysterun auth login` or inject a broad dashboard token
as a workaround.

Dangerous commands keep the P86 `--dry-run` / `--confirm` behavior. Runtime
responses preserve redaction for tokens, cookies, auth headers, provider
credentials, raw profile files, and secret message material. P183 does not add
general Host-admin authority to session runtime capabilities. Runtime capability
toggles are not normal CLI behavior.

## P87 Product Skill Modules

Phase 87 product skills are narrow module wrappers around this P86 CLI surface.
They must not call Host APIs directly or mutate Host DB files, agent config
files, runtime JSON files, dashboard local state, or AgentStore package content.

## P194 First-Run Explorer Onboarding

Explorer onboarding is a Host/dashboard operation, not a provider runtime
operation. The dashboard must let first-run users open an existing project
folder through Host-backed absolute path validation, browse from Default Browse
Root, or copy the packaged `oysterun-github-tracker` demo agent template. Demo
copy never starts a session automatically and must not overwrite an existing
folder; the Host chooses a non-conflicting folder name and returns the copied
path for Explorer navigation.

The packaged demo template must remain public-safe: no credentials, tokens,
Owner-local paths, private repository names, or generated runtime state.

## P196 macOS Explorer Folder Access Guidance

Explorer folder access recovery remains a Host/dashboard operation. On macOS,
worker `EPERM`/`EACCES` responses are normalized into structured
`folder_access_denied` payloads, and folder browse timeouts are normalized into
structured `folder_browse_timeout` payloads. Both payload families include the
blocked path, platform, reason, System Settings URI, and
`suggested_permission=node_folder_access` so the dashboard can render the same
Explorer folder access card instead of a generic one-line error.

Permission denied copy must tell the user to allow Node.js to access this folder, then retry.
Timeout copy must say macOS may be waiting for folder access
permission and ask the user to check the desktop permission prompt and allow
Node.js to access this folder, then retry. Both modes include the fallback once:
If no prompt appears, open System Settings > Privacy & Security > Full Disk Access and allow Node.js / the terminal app running Oysterun.

Canonical product skill source remains:

```text
skills/<product-skill>/
```

Generated mirrors remain:

```text
.codex/skills/<product-skill>/
host-service/assets/product-skills/<product-skill>/
```

The P87 first-slice product skill modules are:

- `oysterun-sessions` wraps `oysterun sessions ...`
- `oysterun-session-chat` wraps `oysterun chat ...`, including loop commands
- `oysterun-find-context` wraps `oysterun chat messages-around ...` for bounded
  target-session context around a known Matrix/chat event
- `oysterun-scheduler` wraps `oysterun scheduler ...`
- `oysterun-mail` wraps `oysterun mail ...` and keeps the scheduler/agent
  runtime Mail capability helper only as compatibility support
- `oysterun-notifications` wraps `oysterun notifications ...`
- `oysterun-website` wraps `oysterun website ...`
- `oysterun-telegram` wraps `oysterun telegram ...` and documents per-session
  `oysterun sessions telegram ...` setup

## Product Skill Auth And Cross-Session Contract

Product skills are CLI wrappers, not independent authorization layers. They
must not impose their own current-session-only rule when a command receives a
valid Host auth source. Cross-session operations are allowed whenever the
resolved Host auth token/claims authorize the requested operation.

Auth resolution is owned by the P86 CLI:

- explicit `--token`
- Host-injected live runtime env such as `OYSTERUN_HOST_ORIGIN`,
  `OYSTERUN_CAPABILITY_TOKEN`, `OYSTERUN_SESSION_ID`, and `OYSTERUN_AGENT_ID`
- `OYSTERUN_DASHBOARD_TOKEN`
- saved CLI auth profile

The skill layer must:

- use the P86 CLI or packaged helper scripts;
- avoid direct Host endpoint calls;
- avoid direct Matrix facade calls;
- avoid requiring a separate in-session dashboard login;
- avoid pre-denying cross-session usage solely because the command is invoked
  from an agent session;
- pass explicit `--session-id`, `--agent-id`, or related target options through
  when the user or route asks for a non-current target;
- let the Host/API response decide whether the supplied auth can operate on the
  requested target.

Current-session defaults such as `OYSTERUN_SESSION_ID` and `OYSTERUN_AGENT_ID`
are convenience defaults only. They are not a product-level ban on
cross-session skill operations.

Dashboard/Owner auth is a privileged Host auth mode. In current Host code,
dashboard-authenticated claims short-circuit agent capability checks:

```text
claims._dashboardAuth -> hasAgentCapability(...) === true
```

Therefore, under a valid dashboard token, legacy agent capability labels such as
`can_start_session`, `can_chat`, and `can_manage_config` are not effective
Owner restrictions. The labels still exist for non-dashboard auth paths such as
Cloud/JWT `agent_perms`, and live runtime capability auth does not use
`can_start_session` as its authorization model. Live runtime auth is resolved
through Host-owned runtime capability claims and endpoint checks.

If a future phase changes runtime capability scope, the code, skills, and this
document must stay aligned. A skill must not encode a narrower scope than the
Host auth contract.

The older broad product skills are retired from the normal Host product-skill
set:

- `oysterun-host-startup`
- `oysterun-session-ops`
- `oysterun-website-authoring`

Website guidance from the original OysterAgents site-authoring guide is
preserved in `oysterun-website`, including `.oysterun/site/index.html`,
relative links/assets, `/sites/<agent_id>/...` routes, 375px phone-first design,
viewport meta with `viewport-fit=cover`, tap-friendly 44x44 controls, no
hover-only dependency, no fixed-width horizontal overflow, scrollable dense
content, and no unsupported offline/service-worker claims.

OysterunAgentStore references are external to this source tree. Updating
AgentStore seed-package references or copied `.claude/skills/agent-site-authoring`
content requires an explicit routed AgentStore update; P87 source implementation
must remain coherent without mutating an external AgentStore checkout.

## Confirmation And Dry Run

Dangerous commands must pass `--confirm` unless `--dry-run` is used:

- sessions stop/restart/interrupt
- chat loop delete
- scheduler delete/disable
- mail delete
- website access set
- website password set

Dry runs return the redacted planned request without executing it.

## Stop Conditions

P86 must stop rather than proceed if implementation would require:

- raw bearer token storage on the Host
- direct Host DB/config mutation by the CLI
- notification sending without a product endpoint
- Mail send through special runtime-only capability coupling
- reintroducing a normal Host-level Telegram product dependency
