# Route C Config Hierachy

This document records the Route C config hierarchy for Host runtime config,
debug flags, provider params, Cloud identity, and agent-folder config.

The filename intentionally follows the requested path spelling:

```text
docs/routec/config_hierachy.md
```

## Source References

Current source owners:

```text
host-service/config.mjs
host-service/agent-config.mjs
host-service/agent-config-migration.mjs
host-service/provider-model-params.mjs
host-service/provider-model-refresh-runner.mjs
host-service/apns-config.mjs
host-service/apns-device-store.mjs
tool_scripts/sync_host_stack_config.mjs
tool_scripts/stack_dashboard_credentials.mjs
docs/routec/form_UI_fields.md
docs/routec/host_cloud_app_auth.md
```

Internal requirement sources are maintained outside the public npm package.
The relevant source-owner areas are:

```text
P56/P57 session profile and Telegram config hierarchy
P59 in-session loop agent-folder persistence
P66 config debug file split and debug flag ownership
P72 agent-folder Scheduler portability
P125 dev HP auth and in-session CLI auth alignment
```

## Core Rules

[contract] Host product config and debug config are separate.

```text
<host_config_dir>/config.json        product/runtime/user preference config
<host_config_dir>/config.debug.json  optional debug/proof/diagnostic overlay
<host_config_dir>/config.dev.json    worker HP/browser verification login source
```

[contract] `config.debug.json` is optional. If it is missing, Host uses safe
defaults and must not create the file during normal config bootstrap.

[contract] Provider permission dropdown unlocking is debug-only. The optional
`config.debug.json` key
`provider_permission.debug_mode_dropdown_enable` defaults to `false`; normal
mode renders/submits Claude `bypassPermissions` (`Approve everything`) and
Codex `never` only. Non-default raw API/CLI requests require the debug key plus
`confirm_beta_provider_permission_mode` / `--confirm-beta-provider-permission-mode`.
Codex `suggested` is not a valid approval policy.

[contract] `config.dev.json` must not become a Host product runtime config
source and must not become a debug runtime flag source.

[contract] `config.dev.json` is the worker HP/browser visible login source. It
stores verification plaintext only for filling the UI login form and for
materializing the runtime dashboard hash grant when required. Product Host
runtime login reads `config.json`, not `config.dev.json`.

[contract] `config.dev.json` must not contain `ttl`, `expires_at`, or rotating
session-expiry fields while normal dashboard UI login has no automatic expiry
contract.

[contract] Cloud identity material belongs in `cloud_identity.json`, not in
`config.json`.

[contract] Agent shared config belongs in `<agent_folder>/.oysterun/config.json`.
Agent private/local config belongs in `<agent_folder>/.oysterun/local.json`.

[contract] `.codex/config.json` is not an Oysterun Route C session config
source.

[contract] No current Route C source-backed config path named `.security` was
found. Do not introduce `.security` as a product config layer without a new
requirement proposal and source-boundary tests.

## Host Config Directory

The Host config directory is selected by:

```text
OYSTERUN_CONFIG_DIR
```

If `OYSTERUN_CONFIG_DIR` is not set, production defaults to:

```text
~/.oysterun
```

Dev/test stacks normally use:

```text
~/.oysterun-stacks/<stack>/host
```

The selected directory is the root for Host runtime files such as `config.json`,
`config.debug.json`, `cloud_identity.json`, `params.json`, and operation logs.

## Host Runtime Files

| File / directory | Owner | Current role | Product editable? | Secret/token allowed? | Notes |
| --- | --- | --- | --- | --- | --- |
| `config.json` | Host runtime / Host Preferences / setup | Product runtime config, user-visible preferences, Host-level session defaults, dashboard password hash, provider command paths, browse root, display name, notification sound preferences. | Yes, through setup or Host Preferences for eligible fields. | Password hash yes; plaintext password no; Cloud device token no. | Source defaults come from `host-service/config.mjs`. `writeConfig()` strips debug keys and Cloud identity keys from persisted runtime storage. |
| `config.debug.json` | P66 debug split | Optional debug/proof/diagnostic overlay. | No normal product UI. | No. | Missing file returns safe defaults. Unknown keys fail fast. New debug writes target this file, not `config.json`. |
| `config.dev.json` | Verification environment | Worker HP/browser verification plaintext login credential source. | No product UI. | May contain worker login plaintext for verification only. | Product Host runtime must not read it. Startup/verification helpers can use it to materialize dashboard hash into `config.json`. |
| `cloud_identity.json` | Host Cloud auth | Host-to-Cloud identity state and credentials. | No. Host Preferences should show status only. | Yes, Host Cloud credential/token. | Stores `device_id`, `device_token`, aliases, registration state, onboarding metadata. Local Cloud dev may store non-production `backend_url`; production uses tracked code default. |
| `service-control-token.json` | Host local service control | Local loopback-only token used by terminal service commands such as `oysterun service:restart --restore-sessions` to call Host control endpoints without dashboard auth. | No. | Yes, local service-control token. | Stored in the Host config dir with owner-only permissions. It is not dashboard auth, is not accepted from remote browser clients, and must not be copied into product config or prompt artifacts. |
| `params.json` | P42 provider params | Current provider model/status catalog. | Not directly user-edited. | No. | Must not store APNs, dashboard credentials, command paths, Matrix/chat, scheduler/mail data, tokens, or secrets. |
| `operation_logs/provider_model_refresh.jsonl` | P42PostFix1 | Append-only provider model refresh operation log. | No. | No raw secrets. | Current operation history; `params.json` remains the current status/catalog source. |
| `apns.local.json` | Legacy/local APNs path | Local APNs p8 config for local Host-sent APNs. | No normal product UI. | Path/key metadata only; no p8 content. | Stage 1 product path uses Cloud-held p8. Local APNs config is not required for Cloud-mediated notification. |
| `apns.devices.json` | Legacy/local APNs path | Local registered APNs device store for local APNs sender. | No. | Device tokens yes. | Cloud token truth is Cloud DB for Stage 1 Cloud notification. |
| `apns-runtime-observability.jsonl` | APNs debug observability | Low-noise APNs runtime proof artifact. | No. | Token suffix only, no raw token. | Written only when both artifact and APNs observability debug gates are enabled. |
| `oysterun.sqlite` | Host DB | Host operational DB for non-Matrix product state. | No direct edit. | Depends on table. | Product chat truth is Matrix/Route C committed events, not legacy transcript rows. |
| `routec-matrix-bindings.json` | Route C Matrix facade | Host session to Matrix room binding metadata. | No. | No user edit. | Runtime artifact; do not hand-edit as a primary fix. |
| `matrix/homeserver.db` | Route C Matrix storage | Host-owned Matrix storage snapshot. The `.db` suffix is compatibility naming; the current file format is JSON storage, not SQLite. | No. | May contain committed chat/runtime event data. | Product Matrix truth snapshot. Do not delete before targeted storage repair has failed. |
| `matrix/homeserver.db.delta.jsonl` | Route C Matrix storage | WAL-like bounded delta persistence appended between full snapshot writes. | No. | May contain committed chat/runtime event data. | Product runtime file, not a debug log. Stale/superseded missing-room deltas must be auto-quarantined, not crash Host. Fresh/non-superseded corruption remains fail-fast. |
| `matrix/recovery/` | Route C Matrix storage recovery | Quarantined stale delta logs and recovery proofs. | No. | May contain committed chat/runtime event data. | Written by automatic storage recovery when a delta is proven superseded by `matrix/homeserver.db`. |
| `routec-matrix-media/` and `routec-matrix-media-index.json` | Route C media facade | Matrix media file/index storage. | No. | May contain user files/media. | Runtime artifact. |
| `oysterun-matrix-artifacts/` | Route C Matrix storage/artifacts | Matrix-related runtime storage/artifacts. | No. | May contain local/runtime data. | Runtime artifact. |
| `session-history.json` | Host session history | Active session index and resume metadata, including provider resume ids and session summaries. | No direct edit. | Local paths/session metadata possible. | Not a transcript DB and not a P112 removal target. Product chat truth remains Matrix/Route C committed events. |
| `transcripts.db` | Removed legacy transcript DB | Removed from live Route C Host runtime paths and legacy export/list/search endpoints. | No. | Historical chat data possible. | Runtime data cleanup/deletion requires a later explicit route; product chat truth must use Matrix routes. |
| `runtime/` | Host runtime | Process/run artifacts. | No. | May contain runtime proof/path data. | Generated. |
| `secrets/` | Host-local secrets | Local secret storage when a task explicitly owns it. | No. | Yes. | Must not be committed. |

## Host `config.json`

`config.json` is normalized by `host-service/config.mjs`.

Representative product/runtime fields:

```text
port
direct_host_url
public_base_url
connection_mode
dashboard_user
dashboard_password_hash
claude_command
codex_command
default_browse_path
show_hidden_files
notification_sound_web_enabled
notification_sound_app_enabled
routec_matrix_storage_cache_enabled
transcript_retention_days
display_name
session_defaults
```

`notification_sound_web_enabled` controls only the optional website Oysterun
beep. The Web Notifications API has no custom notification sound field, so the
website beep is foreground web media playback and must not set Media Session
metadata.

`notification_sound_app_enabled` controls native Capacitor iOS notification
sound through APNs `aps.sound` or Capacitor LocalNotifications sound. Capacitor
iOS must not fall back to hidden web audio, WebAudio, browser Notification
sound, or Media Session metadata for message notification sound.

`backend_url` is exposed as a runtime value through `readConfig()` for
compatibility, but production Cloud endpoint is a tracked source default:

```text
host-service/config.mjs
PRODUCT_CLOUD_BACKEND_URL = "https://api.oysterun.com"
```

`config.json` must not persist:

```text
backend_url
dashboard_session_ttl_hours
host_id
host_credential
device_id
device_token
registered_at
cloud_registration_state
onboarding_token
onboarding_url
device_signing_public_key
device_signing_kid
cloud_public_key
debug_* moved by P66
```

Legacy files may still contain some of these keys. Runtime normalization may
migrate them to the correct file, then remove them from persisted `config.json`.

## Host `config.debug.json`

P66 defines `config.debug.json` as the canonical debug/proof overlay:

```text
<host_config_dir>/config.debug.json
```

Current implemented allowlist:

| Key | Default | Purpose |
| --- | --- | --- |
| `debug_fixture_provider_enabled` | `false` | Enables the P33/P64 `debug-fixture` provider, displayed as `Fake` in Session Setup. |
| `debug_large_tool_spillover_provider_enabled` | `false` | Enables the P82 `debug-large-tool-spillover` provider, displayed as `Spillover Fake` in Session Setup for large tool event spillover verification. Hidden when missing or false. |
| `debug_p135_codex_replay_provider_enabled` | `false` | Enables the P147 `debug-p135-codex-replay` provider, displayed as `P135 Codex Replay` in Session Setup for sanitized P135 provider-stream replay verification. Hidden when missing or false. |
| `debug_show_capability_ui` | `false` | Reveals Runtime Capabilities controls in Host Preferences, Session Setup, and Session Profile for debug/verification. Normal product UI hides these controls and omits `runtime_capabilities` from normal hidden-mode payloads. |
| `show_interface_style_in_session_setup_profile` | `false` | Reveals the Session Setup `Interface Style` row for debug/manual profile work. Missing or false hides the row; the hidden first-party value remains `coding`. |
| `debug_cloud_backend_stage` | `"prod"` | Selects Cloud stage for internal/dev routing. Encoded as `?oysterun_stage=dev|beta`; never stored in `config.json`. |
| `debug_dashboard_session_ttl_hours` | `-1` | Debug-only dashboard bearer/cookie session TTL. `-1` means no automatic TTL expiry. Not user-facing. |
| `debug_routec_facade_token_ttl_ms` | `-1` | Debug-only Route C `oysterun_facade_` Matrix facade token TTL. `-1` means no automatic TTL expiry. Not user-facing. |
| `debug_host_artifact_writes_enabled` | `false` | Master gate for Host debug artifact writes. |
| `debug_routec_facade_transcript_enabled` | `false` | Matrix facade transcript JSONL/debug capture gate. |
| `debug_routec_runtime_proof_artifacts_enabled` | `false` | Route C runtime proof artifact gate. |
| `debug_routec_tool_detail_source_ui_enabled` | `false` | Enables expansion-only Route C tool-detail source metadata for verification. Normal collapsed chat rows do not expose this metadata. |
| `debug_apns_runtime_observability_enabled` | `false` | APNs runtime observability JSONL gate. |
| `debug_routec_facade_transcript_rotation_enabled` | `true` | Enables bounded rotation for facade transcript logs. |
| `debug_routec_facade_transcript_max_bytes` | `262144` | Bounded facade transcript max file size. |
| `debug_routec_facade_transcript_max_files` | `3` | Bounded facade transcript max file count. |
| `debug_host_preferences_full_disk_access_block_enabled` | `false` | Shows the Host Preferences macOS Folder Access recovery block for debug/manual diagnosis. Hidden in normal product setup. |

Behavior:

```text
missing config.debug.json -> safe defaults
invalid JSON -> fail fast
unknown key -> fail fast
debug key writes -> config.debug.json
product/user setting writes -> config.json
secrets -> never config.debug.json
```

Compatibility:

```text
old config.json debug fields may be read only for migration compatibility
explicit config.debug.json values supersede old config.json debug fields
config.dev.json is not a debug source
```

P90 moved login expiry controls into debug config. Legacy
`config.json.dashboard_session_ttl_hours` is tolerated for older installs but
ignored and removed during normalization; it is not a product/user setting.

Related environment override:

```text
OYSTERUN_DEBUG_FIXTURE_PROVIDER=1
```

This is a non-persistent override for the Fake provider gate.

## Host `config.dev.json`

`config.dev.json` is owned by worker HP/browser verification readiness. It is
not product runtime config and not debug config.

Final P125 helper contract:

```text
node tool_scripts/stack_dashboard_credentials.mjs status --config-dir <host_config_dir> --json
node tool_scripts/stack_dashboard_credentials.mjs ensure --config-dir <host_config_dir> --json
```

Rules:

```text
--config-dir is required
output is redacted JSON only
config.dev.json stores dashboard_user/dashboard_password for visible browser login
config.json stores dashboard_user/dashboard_password_hash for Host runtime login
OYSTERUN_DEV_USER/OYSTERUN_DEV_PASSWORD are bootstrap fallback only
OYSTERUN_STACK_DASHBOARD_USER/OYSTERUN_STACK_DASHBOARD_PASSWORD are stack helper inputs, not the worker HP source of truth
plaintext password must never be written to config.json
complete config.dev.json and config.json drift fails closed
config.dev.json has no ttl/expires_at while UI login has no normal expiry
```

Detailed runbook:

```text
docs/routec/dev/dev_auth_mechanism.md
```

## Cloud Stage Selector

Implemented debug config key:

```text
debug_cloud_backend_stage: "prod" | "beta" | "dev"
```

Rules:

```text
missing config.debug.json -> prod
missing debug_cloud_backend_stage -> prod
base Cloud URL remains https://api.oysterun.com
stage is appended per Cloud request, e.g. ?oysterun_stage=dev
do not put ?stage=... into the base URL, because Host/app clients append paths
do not write this into config.json
do not expose this as a user Host Preference
```

The term is `stage`, not `stack`, to avoid confusion with local Host stacks
such as `test4`, `beta`, or `staging`.

The first version uses the same Cloud DB and separates rows with `cloud_stage`
columns. It does not create separate DBs or schemas for prod/beta/dev.

## Host `cloud_identity.json`

Cloud identity path:

```text
<host_config_dir>/cloud_identity.json
```

Current allowed identity fields:

```text
backend_url
host_id
host_credential
device_id
device_token
registered_at
cloud_registration_state
onboarding_token
onboarding_url
device_signing_public_key
device_signing_kid
cloud_public_key
```

Rules:

```text
production backend URL comes from tracked code default
non-production backend_url is allowed only for explicit local Cloud development
Host Preferences shows registration status, not editable backend/token fields
device_token/host_credential are secrets
setup and registration write this file, not config.json
```

Aliases:

```text
host_id          compatibility alias for device_id
host_credential compatibility alias for device_token
```

## Host `params.json`

Provider model params path:

```text
<host_config_dir>/params.json
```

Purpose:

```text
current provider model catalog
provider model refresh status
last-known-good provider params
```

Provider model refresh scheduling:

```text
background refresh is enabled by default in product Host startup
OYSTERUN_PROVIDER_MODEL_REFRESH_BACKGROUND_ENABLE=false disables only the background timer
manual Session Setup refresh remains available when the background timer is disabled
the fixed 24h eligibility window is based on provider refreshed_at/attempt status
refresh.next_refresh_at is diagnostic only and is not scheduling authority
```

Forbidden content includes:

```text
APNs keys/tokens
dashboard credentials
provider command paths
auth tokens/secrets/private keys
Matrix/chat messages
mail data
scheduler data
session history
transcript DB rows
verification artifacts
```

`params.json` is not a general config file. It is a provider model/status
catalog only.

## Operation Logs

Provider model refresh operation log:

```text
<host_config_dir>/operation_logs/provider_model_refresh.jsonl
```

Rules:

```text
append-only operation history
no secrets
no command paths
no raw Host config
no chat/Mail/Scheduler payloads
params.json remains the current status/catalog source
manual refresh rows identify the selected provider only
missing or unavailable providers are skipped before child runtime spawn
```

## Cloud Deployment Secrets

Repo-local deployment secrets are not Host or agent config, but they are part
of the Cloud deployment config surface.

Local ignored file:

```text
.secrets/cloud_backend.env
```

Expected role:

```text
environment variable assignment file for deploy/install scripts
contains database URL and Cloud APNs p8 file path/key metadata
not committed
```

Remote secret/env target:

```text
/etc/oysterun-cloud/oysterun-cloud.env
/etc/oysterun-cloud/database_url
/etc/oysterun-cloud/AuthKey.p8
/etc/oysterun-cloud/metrics_admin_password
```

Stage 1 Cloud APNs signs notifications with Cloud-held p8 files. Host runtime
does not need local p8 files for Cloud-mediated notification.

## Cloud Metrics Config

P217/P219 provides a bounded aggregate summary endpoint plus a stage-aware
time-series dashboard.

Implemented storage:

```text
cloud_metric_samples
  sample_id
  bucket_start_at
  bucket_seconds = 300
  metric_name
  cloud_stage
  dimensions_json
  value
  created_at
```

Implemented charted metrics:

```text
http_requests_total
http_request_duration_ms
system.cpu_usage_percent
system.memory_used_percent
system.disk_root_used_percent
process.memory_rss_mb
```

The dashboard renders:

```text
HTTP requests
HTTP errors
Average latency
CPU usage
Memory used
Disk used
Backend RSS
APNs deliveries
```

Dashboard rendering uses two chart cards per row on desktop/tablet, one per row
on small screens, y-axis min/max ticks, and x-axis first/last bucket labels.
Percent charts use a fixed 0% to 100% scale.
The APNs deliveries chart is rendered in the first Operational Charts block;
the APNs Deliveries section below it is reserved for the latest sanitized
delivery table.

Every chart card exposes independent `1h`, `1d`, `1w`, and `1m` range controls.
The `1m` range maps to the 30-day retention window.

Retention:

```text
keep 30 days
cleanup old buckets on schedule
```

Dashboard:

```text
https://api.oysterun.com/admin/metrics
```

Password secret locations:

```text
local ignored source: .secrets/cloud_metrics_admin_password
remote file:          /etc/oysterun-cloud/metrics_admin_password
initial value:        0000
```

This is a founder-stage plaintext password file by Owner decision. It remains
outside git and must not be printed in deploy logs.

The dashboard must not expose raw APNs tokens, device tokens, password hashes,
chat content, notification body content, or p8 material.

## Agent Folder Config

Current agent config directory:

```text
<agent_folder>/.oysterun/
```

Current active files:

| File / directory | Owner | Current role | Shareable? | Secret/token allowed? | Notes |
| --- | --- | --- | --- | --- | --- |
| `.oysterun/config.json` | Agent shared config | Shared agent/session defaults. | Yes. | No. | Used by Session Setup/Profile when "Update .oysterun/config.json" is checked. |
| `.oysterun/local.json` | Agent local/private config | Private provider/web/Telegram/local overrides. | No. | Yes. | Local-only. Should not be copied into agent store packages. |
| `.oysterun/loops.json` | P59 in-session loops | Portable loop definitions. | Yes, if intended. | No. | Must not persist runtime fields such as enabled/status/last_run. |
| `.oysterun/schedulers.json` | P72 scheduler portability | Portable outside-scheduler definitions. | Yes, if intended. | No. | Must not persist run logs or secrets. |
| `.oysterun/site/` | Agent website | Static website source/assets for `/sites/<agent_id>/...`. | Yes, if intended. | No secrets. | Product site authoring surface. |
| `.oysterun/agent-store.json` | Agent Store package manifest | Agent package metadata for certified/seed agents. | Yes. | No. | Used for package validation and future install/listing. |

Legacy migration inputs:

| Legacy path | Current status |
| --- | --- |
| `<agent_folder>/.oysterun` as a file | Legacy shared config input; migrate to `.oysterun/config.json`. |
| `<agent_folder>/.oysterun.local` | Legacy local/private config input; migrate to `.oysterun/local.json`. |

## Agent Shared Config

Path:

```text
<agent_folder>/.oysterun/config.json
```

Known shared fields include:

```text
interface.provider
interface.type
interface.model
interface.reasoning_effort
interface.permission_mode
interface.approval_policy
interface.sandbox_mode
permissions.allowed_paths
runtime_capabilities
web.enabled
web.root
web.access
notifications.enabled
telegram.enabled
telegram.send_tool_messages
model
permission_mode
reasoning_effort
ui.default_surface
workspace_policy
```

P85 default-on runtime capabilities: normal hidden-mode Session Setup and Host
Preferences saves omit `runtime_capabilities`, and the Host resolves new
sessions to the default-on general capability bundle. Existing
`runtime_capabilities` config remains readable for debug-visible controls and
explicit update flows, but hidden normal payloads must not replay stale disabled
capability selections.

P128 provider permission dropdown lock: normal Session Setup, Host Preferences,
API, and CLI requests resolve Claude permission to `bypassPermissions` and Codex
approval to `never` unless `provider_permission.debug_mode_dropdown_enable=true`
is present in Host `config.debug.json`. With debug enabled, valid non-default
Claude/Codex values still require the explicit beta confirmation flag on raw
API/CLI writes. Codex approval options are only `on-request` and `never`.

P96 Session Profile Allowed Paths: `PATCH /session/profile-config` accepts
`allowed_paths` from the Workspace Policy section. With update-config unchecked,
Host validates every path and refreshes only the live session
`workspacePolicy.allowedPaths`; it does not mutate shared/local config and does not restart the provider. With update-config checked, Host writes
`permissions.allowed_paths` to `.oysterun/config.json`, then resolves the runtime
config again and refreshes the live workspace policy from the persisted shared
value. Invalid or missing paths fail closed before any runtime or durable
mutation.

Rules:

```text
shareable defaults only
no Telegram bot token
no Telegram allowed users
no web password hash
no provider private credentials
no APNs or Cloud identity material
```

## Agent Local Config

Path:

```text
<agent_folder>/.oysterun/local.json
```

Current local/private field groups:

```text
interface.provider_profile
interface.provider_args
interface.provider_commands
interface.provider_config_overrides
permissions.local_allowed_paths
web.password_hash
telegram.bot_token
telegram.allowed_users
```

Rules:

```text
local/private only
not shared through agent store
not written when only shared config persistence is requested
sanitized before being merged into general visible config
feature-specific resolvers may use private fields for runtime
```

### Telegram Setup Validation And Test Send

When `telegram.enabled` is enabled from Session Setup or Session Profile, Host
validates the effective setup before persisting or starting runtime state. The
effective token is the non-empty draft `telegram_bot_token`/`telegram.bot_token`
value first, otherwise the existing local/private `telegram.bot_token`. The
effective allowed-users list is the non-empty draft
`telegram_allowed_users`/`telegram.allowed_users` value first, otherwise the
existing local/private `telegram.allowed_users`. Missing effective token or
missing effective allowed users fails closed.

`POST /telegram/test-send` uses the same effective setup rules without writing
shared or local config. It sends only the fixed text
`Oysterun Telegram test message.` to the first explicit allowed user/chat id,
returns redacted success/failure, and does not use provider, Matrix, timeline,
tool-response, or Mock Telegram paths.

## Agent Config Precedence

Session Setup/Profile config resolution uses this order:

```text
1. Built-in defaults from host-service/config.mjs
2. Host session defaults from <host_config_dir>/config.json -> session_defaults
3. Agent shared config from <agent_folder>/.oysterun/config.json
4. Sanitized agent local config from <agent_folder>/.oysterun/local.json
5. Session Setup launch payload or live Session Profile override
```

Private local fields are handled separately by feature-specific resolvers. For
example, `web.password_hash` and `telegram.bot_token` are not exposed as general
shared config.

Provider-auth recovery is not a config write. When a live provider session loses
auth, Host emits `provider_session_authentication_failed` guidance that points
first to the machine terminal, then optionally to `/app/terminal`,
`codex /login`, `claude /login`, and Restart session. The user completes
provider login in terminal-backed provider storage; Oysterun does not persist
provider secrets, mutate `.oysterun/config.json`, or intercept Claude `/login`
in `/session/send` for this recovery path.

## Session Setup / Profile Persistence

`docs/routec/form_UI_fields.md` is the UI field contract. The persistence rule
is:

```text
checked Update .oysterun/config.json
  -> persist eligible shared fields to <agent_folder>/.oysterun/config.json
  -> persist supported private/local fields to <agent_folder>/.oysterun/local.json

unchecked Update .oysterun/config.json
  -> apply to launch/live session only
  -> do not mutate agent config files
```

For a new agent folder with no `.oysterun/config.json`, the default behavior is
to create it on session start. The user may opt out through the Session Setup
"Do not create .oysterun/config.json" mode.

## In-Session Loops

Loop definition path:

```text
<agent_folder>/.oysterun/loops.json
```

Allowed definition fields:

```text
id
interval_token
interval_ms
command_text
start_at
end_at
created_at
updated_at
source
```

Forbidden runtime fields:

```text
enabled
default_enabled
status
next_run_at
last_run_at
last_status
last_error
run_count
dispatch_count
skip_count
skipped_busy_count
```

Runtime enabled/paused state is Host live-session memory state, not persisted
to `loops.json`.

## Outside Schedulers

Portable scheduler definition path:

```text
<agent_folder>/.oysterun/schedulers.json
```

Rules from P72:

```text
scheduler definitions live in schedulers.json
do not store secrets in schedulers.json
do not store run logs in schedulers.json
Host scans only Host agent folders for schedulers.json
runtime/run state remains Host-owned
```

## Website Config

Agent website config uses:

```text
<agent_folder>/.oysterun/config.json
  web.enabled
  web.root
  web.access

<agent_folder>/.oysterun/local.json
  web.password

<agent_folder>/.oysterun/site/
  static site source/assets
```

`/sites/<agent_id>/...` is the canonical Route C site URL namespace. Website
enablement is shared in `web.enabled`; missing `web.enabled` resolves to true
only when `.oysterun/site/index.html` already exists so existing website agents
keep working. Enabling from Session Setup or Session Profile creates the
minimal `.oysterun/site/index.html` scaffold from
`host-service/templates/agent-site/index.html` when the file is missing. It must
not overwrite an existing `index.html` and disabling must not delete site files.
Website password material is local/private (`web.password`) and must not be
written into shared config.

## Agent Store Manifest

Agent Store package manifest path:

```text
<agent_folder>/.oysterun/agent-store.json
```

Rules:

```text
package metadata only
no secrets
no local token files
no host runtime config
validate before publishing/certifying
```

## Environment Overrides

Environment variables are internal/dev/ops controls. They are not normal user
instructions in Host Preferences.

Important examples:

| Env var | Role |
| --- | --- |
| `OYSTERUN_CONFIG_DIR` | Select Host config directory. |
| `OYSTERUN_BACKEND_URL` | Explicit local Cloud/backend override. |
| `OYSTERUN_DEVICE_ID` / `OYSTERUN_DEVICE_TOKEN` | Explicit Host Cloud credential override. |
| `OYSTERUN_PORT` | Startup script writes Host port into config. |
| `OYSTERUN_STACK` / `OYSTERUN_STACKS_DIR` | Stack startup selection. |
| `OYSTERUN_STACK_DASHBOARD_USER` / `OYSTERUN_STACK_DASHBOARD_PASSWORD` | Explicit stack dashboard credential source for startup helpers. |
| `OYSTERUN_NODE_BIN` | Optional explicit Node.js >=20 executable for service startup and LaunchAgent restart paths. |
| `OYSTERUN_CAPACITOR_HOST_CONFIG` | Build/sync helper reads stack Host config for phone bundle target. |
| `OYSTERUN_CAPACITOR_HOST_ORIGIN` | One-off phone bundle Host origin override. |
| `OYSTERUN_CAPACITOR_APP_ID` / `OYSTERUN_CAPACITOR_APP_NAME` | One-off Capacitor build/sync identity override. This must not be persisted in Host config. |
| `OYSTERUN_DEBUG_FIXTURE_PROVIDER` | Non-persistent Fake provider debug override. |

Do not use env overrides as a product UX substitute when a value needs a real
setup or Host Preferences field.

### Node Runtime Startup

Oysterun service startup requires Node.js >=20. Public commands such as
`oysterun service:start`, `oysterun service:restart`, and
`oysterun service:restart --restore-sessions` remain unchanged, but service
scripts preflight the concrete Node executable before starting Host helpers.

Resolution order is `OYSTERUN_NODE_BIN`, shell command lookup, then common
Homebrew/local install paths. macOS LaunchAgents do not source shell rc files, so
`oysterun service:install` persists the resolved Node path as
`OYSTERUN_NODE_BIN`. nvm/asdf/volta users should reinstall/update the service or
set `OYSTERUN_NODE_BIN` after changing Node. Internal update/restart jobs use
absolute executable paths instead of relying on `oysterun` from `PATH`.

Full contract: `docs/routec/dev/node_runtime_startup.md`.

### First-Run Explorer Root

`default_browse_path` is the Host-owned Default Browse Root used when Explorer
opens without an explicit path. First-run setup prompts:

```text
Explorer starts here. Choose a root where you can find project folders for agent sessions.
Default Browse Root [/Users/<user>/OysterunAgents]:
```

If the user presses Enter with an existing saved value, setup preserves that
value. If there is no saved value, the runtime default remains the resolved
`~/OysterunAgents` path. Explicit input must resolve to an existing directory.
The prompt does not create or start a session and does not set a Session Setup
Start Folder.

### macOS Explorer Folder Access Guidance

Explorer folder access recovery is Host-owned. On macOS, permission denied and
folder-read timeout cases share the existing Explorer folder access card. The
permission denied card tells the user to allow Node.js to access this folder,
then retry. The timeout card says macOS may be waiting for folder access
permission and asks the user to check the desktop permission prompt and allow
Node.js to access this folder, then retry.

Both card modes include the same fallback once: If no prompt appears, open
System Settings > Privacy & Security > Full Disk Access and allow Node.js / the
terminal app running Oysterun. Generic non-macOS timeouts remain bounded generic
errors and must not claim macOS permission state.

## `.security`

Current scan result:

```text
No active Route C Host or agent-folder config source named .security was found.
```

Policy:

```text
.security is not part of the current config hierarchy
do not silently interpret it
do not use it as a fallback for permissions, secrets, auth, or provider config
future introduction requires a dedicated proposal, validation rules, and tests
```

## Summary

Short version:

```text
Host product defaults/preferences:
  <host_config_dir>/config.json

Host debug/proof flags:
  <host_config_dir>/config.debug.json

Worker login verification credential:
  <host_config_dir>/config.dev.json

Host Cloud identity:
  <host_config_dir>/cloud_identity.json

Provider model/status params:
  <host_config_dir>/params.json

Agent shared config:
  <agent_folder>/.oysterun/config.json

Agent private/local config:
  <agent_folder>/.oysterun/local.json

In-session loop definitions:
  <agent_folder>/.oysterun/loops.json

Outside scheduler definitions:
  <agent_folder>/.oysterun/schedulers.json

Agent website:
  <agent_folder>/.oysterun/site/

Agent store package metadata:
  <agent_folder>/.oysterun/agent-store.json
```
