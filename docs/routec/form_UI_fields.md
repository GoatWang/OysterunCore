# Route C Form UI Fields Contract

This document is the product contract for Route C form fields in Host
Preferences, Session Setup, and Session Profile. It records the intended field
ownership and persistence model so future UI, setup, and config work stays
aligned.

## Owning Surfaces

Source locations:

```text
dev/client/web/src/index.template.html
host-service/config.mjs
host-service/server.mjs
```

The same Route C dashboard surface is used by web and Capacitor. Product form
work for this contract belongs to Route C Host/web/Capacitor code. Swift UI is
not an owner for these fields.

## Config Hierarchy

[contract] Oysterun session config uses this hierarchy:

```text
1. Built-in defaults
   host-service/config.mjs

2. Host config
   ~/.oysterun/config.json
   or the stack config directory selected by OYSTERUN_CONFIG_DIR

3. Agent shared config
   <agent_folder>/.oysterun/config.json

4. Agent local/private config
   <agent_folder>/.oysterun/local.json

5. Live session override
   Running-session state only; not durable unless the user explicitly persists.
```

[contract] `.codex/config.json` is not an Oysterun session config source. New
form code, docs, and setup flows must not add `.codex/config.json` as a config
layer.

[contract] If a value is missing from Host config, Host startup should use the
built-in default from `config.mjs` and normalize/write the Host config when the
install/setup path requires a durable value.

[contract] If an agent folder does not have
`<agent_folder>/.oysterun/config.json`, Session Setup should initialize form
defaults from Host config session defaults. The default product behavior is to
create `<agent_folder>/.oysterun/config.json` when starting a new session. The
user may opt out through the Session Setup "Do not create .oysterun/config.json"
mode.

## Shared Form Rules

[contract] Host Preferences is the owner of Host-level defaults. Session Setup
is the owner of the next session launch payload. Session Profile is the owner of
current live-session overrides and optional persistence back to agent config.

[contract] "Update .oysterun/config.json" means:

```text
checked   -> persist eligible shared fields to <agent_folder>/.oysterun/config.json
unchecked -> apply to this running session or launch only
```

[contract] Private/local fields are never written into the shared agent config.
They are written only into `<agent_folder>/.oysterun/local.json` when the
feature explicitly supports local persistence.

[contract] Runtime Capabilities are hidden in normal Host Preferences, Session
Setup, and Session Profile. They are revealed only when
`debug_show_capability_ui=true` is set in `<host_config_dir>/config.debug.json`.
The normal hidden mode omits runtime_capabilities from payloads,
so new sessions resolve default-on runtime capabilities instead of replaying
stale disabled selections.

[contract] `notifications.enabled` controls whether complete-message
notifications are sent for a session. Host-level sound toggles only mute sound;
they do not disable notification delivery.

[contract] Project-only mode is removed from Oysterun product UI. Session Setup
hides `Interface Style` by default and keeps the hidden first-party value as
`coding`. The row is visible only when
`show_interface_style_in_session_setup_profile=true` is set in
`<host_config_dir>/config.debug.json`.

[contract] Host Preferences, Session Setup, and Session Profile use the shared
P75 settings-list page shell, section group, row, field, toggle, disclosure, and
action-row styling. The page title/back action is owned by the existing app
title bar. These pages must not render a duplicate inner titlebar, previous-page
button, large centered header, subtitle, banner treatment, or visible
topbar/page-description subtitle.

[contract] Checkbox controls in Host Preferences, Session Setup, and Session
Profile render as compact same-row label plus checkbox controls. Checkbox label
rows must not carry explanatory helper descriptions, except Host Preferences
sound rows may show the required short helper copy `Mute sound only;`.

[contract] When Host Preferences or Session Profile has a dirty draft and the
user attempts to leave through in-app navigation, the app shows an `Unsaved changes`
confirmation before discarding the draft. Preferred copy is `You have unsaved
changes. If you leave this page, your changes will be lost.` with `Stay on Page`
and `Leave without Saving` actions. Browser refresh/tab close may use the native
beforeunload prompt. Session Setup is not covered by this dirty-exit confirmation.

## Host Preferences Fields

Host Preferences edits Host config and Host-level Session Setup defaults.

| Section | UI label / control | Editable | Config source | Persist target | Validation / behavior |
| --- | --- | --- | --- | --- | --- |
| macOS Folder Access | `host-open-permissions-btn` | action | macOS permission state + `config.debug.json` flag | none | Hidden by default. Visible only when `debug_host_preferences_full_disk_access_block_enabled` is true in `<host_config_dir>/config.debug.json`. Opens System Settings. Oysterun can start without this; protected file access may fail until granted. |
| Connection | Local URL / `host-preferences-local-url` | no | running Host origin | none | Diagnostic display only. |
| Connection | Direct Host URL / `host-public-base-url` | yes | `direct_host_url` or `public_base_url` | Host config `direct_host_url` and `public_base_url` | Optional manual connect URL. Runtime connection changes require Host restart. |
| Connection | Generate Login QR / `host-login-qr-btn` | action | Host config + one-time token | transient bootstrap token | Generates short-lived login QR for the phone app. |
| Connection | Restart Host / `host-restart-btn` | action | current Host service + Host-local restart restore transaction | `<host_config_dir>/restart-restore-state.json` + service state | Existing Host Preferences action. Used after connection settings that require process restart. Do not add a second Restart Host control. The Host prepares a local restore transaction before scheduling restart. After boot, sessions that were live/ready before restart must rebuild a real provider runtime through provider resume metadata; metadata-only empty shells are not a restored runtime state. Enabled in-session loops are restored, and terminal/scheduler/shell exec work is marked interrupted without replay. This uses the same internal restore prepare/consume contract as setup restart, `Update & Restart`, and terminal `oysterun service:restart --restore-sessions`; only the trigger/auth wrapper differs. |
| Update | Current Version / `host-update-current` | no | installed npm package metadata | none | Diagnostic display of the currently installed Oysterun Host package version. |
| Update | Newest Version / `host-update-newest` | no | Host `/admin/update-status` and `/admin/update-check` `newest_version` | none | Displays the newest eligible production npm version after automatic or manual check. The legacy hidden `host-update-latest` alias may mirror this value for compatibility, but normal UI copy uses newest version. No beta/dev/source channel selector or arbitrary exact-version install field is exposed. |
| Update | Status / `host-update-status` | no | Host-owned update check / update operation state | none | Shows concise check status, update availability, unsupported stack state, failure, or final reconciliation status. Automatic check failures stay quiet and do not overwrite visible manual/success status. Normal UI does not display operation log paths. |
| Update | Last checked / `host-update-last-checked` | no | Host `checked_at` + `source` | none | Compact footnote-style text beside `Update & Restart`, including automatic/manual source and timestamp. |
| Update | Progress / `host-update-progress-spinner` + `host-update-phase` | no | Host update operation state | none | Visible while update or restart verification is running or reconnecting. Phase copy uses `Installing...`, `Restarting...`, or `Verifying...`; `Check for updates` and `Update & Restart` are disabled while an operation is running or the persisted operation state is unknown/nonterminal after refresh or reconnect. |
| Update | Check for updates / `host-update-check-btn` | action | installed package metadata + effective npm registry | `<host_config_dir>/update-noticed-version.json` when a new production update is found | Manual check bypasses automatic cooldown, writes a redacted operation log, records `noticed_version` when an update is available, and never installs or restarts by itself. Verification stacks may set `OYSTERUN_UPDATE_REGISTRY_URL`; the registry URL is not a normal Host Preferences control. |
| Update | Update & Restart / `host-update-run-btn` + `host-update-confirmation` | action | newest production version resolved to exact npm version + Host-local restart restore transaction | npm global package + `<host_config_dir>/restart-restore-state.json` + service restart + redacted operation log + update operation state | Explicit owner action. The button opens a visible in-app confirmation surface with current version, target version, P76 restore-aware restart copy, interruption/no-replay copy, visible Cancel, and visible Confirm Update & Restart. `/admin/update-run` fires only after the visible confirm action. Production npm Host stack by default; Route C verification stacks may exercise the same production/latest path only when a valid `OYSTERUN_UPDATE_REGISTRY_URL` override is active. Installs `oysterun@<exact-version>` with `--prefer-online`, passes the same `--registry` override used by update-check when `OYSTERUN_UPDATE_REGISTRY_URL` is set, prepares P76 restore state before restart through the shared restore prepare helper, schedules restart through a one-shot non-keepalive runner with an operation-state claim guard, waits/reconciles Host return, verifies the observed package version, and keeps dev/test/source stacks without a verification registry override from mutating the global npm installation. Active work is marked interrupted and is not replayed. |
| Update | Notification message box / `update-reminder-box` | action | Host `should_notify` from automatic authenticated app-shell check | Host-owned `noticed_version` prevents repeated same-version notice | Non-modal app-shell notice shown after Host returns `should_notify: true`. Copy includes the exact newest version. Actions are Not now, Host Preferences, and close. Display is queued while live work is responding and is dropped after 30 minutes. |
| Browser Notifications | Origin / `host-notification-origin` | no | browser origin | none | Diagnostic display only. |
| Browser Notifications | Secure Context / `host-notification-secure` | no | browser `isSecureContext` | none | Shows HTTPS/localhost requirement and re-check guidance. |
| Browser Notifications | Browser Permission / `host-notification-permission` | no | browser Notification permission | none | Shows promptable/granted/denied/unsupported state and re-check guidance. |
| Browser Notifications | Sound notification on web / `host-notification-web-sound-toggle` | yes | `notification_sound_web_enabled` | Host config `notification_sound_web_enabled` | Visible helper copy: `Mute sound only;`. Mutes the website-only Oysterun beep and does not disable browser notifications. The Web Notifications API has no custom notification sound field; the optional website beep is foreground web media playback and must not set Media Session metadata. |
| Browser Notifications | Sound notification on app / `host-notification-app-sound-toggle` | yes | `notification_sound_app_enabled` | Host config `notification_sound_app_enabled` | Visible helper copy: `Mute sound only;`. Mutes app APNs/local native notification sound only and does not disable app notifications. Capacitor iOS must not use hidden web audio, WebAudio, browser Notification sound, or Media Session metadata for notification sound. |
| Browser Notifications | Re-check / `host-notification-recheck-btn` | action | current browser/app state | none | Refreshes displayed permission and support state. |
| Browser Notifications | Send test notification / `host-notification-test-btn` | action | current browser/app state | none | Sends a diagnostic notification through the currently available notification path. |
| Host Identity And Browse Root | Host Display Name / `host-display-name` | yes | `display_name` | Host config `display_name` | Empty value falls back to default Host display name. |
| Host Identity And Browse Root | Default Browse Root / `host-default-browse-path` | yes | `default_browse_path` | Host config `default_browse_path` | Required in product setup. Save must reject empty or unavailable paths. |
| Host Identity And Browse Root | Folder picker / `host-default-browse-path-picker` | action | local filesystem | `default_browse_path` after Save | Picks an existing folder for Default Browse Root. |
| Host Identity And Browse Root | Active Config File / `host-preferences-config-path` | no | resolved Host config path | none | Diagnostic display only. P75 renders it as its own full-width row. |
| Session Defaults | Default Runtime / `host-default-provider` | yes | `session_defaults.default_provider` | Host config `session_defaults.default_provider` | Fresh Session Setup uses this before folder config overrides it. |
| Session Defaults | Notifications / `host-default-notifications-enabled` | yes | `session_defaults.notifications.enabled` | Host config `session_defaults.notifications.enabled` | Default for new session `notifications.enabled`. |
| Session Defaults | Runtime Capabilities / `host-default-runtime-capabilities` | debug only | `session_defaults.runtime_capabilities` | Host config `session_defaults.runtime_capabilities` | Hidden unless `debug_show_capability_ui=true`; normal saves omit `session_defaults.runtime_capabilities` to avoid stale disabled selections. Values must be boolean per capability when debug-visible. |
| Claude Runtime Defaults | Claude Command / `host-claude-command` | yes | `claude_command` | Host config `claude_command` | Full path may be shown in the input. Blank disables Claude on this Host. |
| Claude Runtime Defaults | Claude Model / `host-claude-model` | yes | `session_defaults.claude.model` | Host config `session_defaults.claude.model` | Options come from Claude model catalog/defaults. |
| Claude Runtime Defaults | Claude Reasoning Effort / `host-claude-reasoning-effort` | yes | `session_defaults.claude.reasoning_effort` | Host config `session_defaults.claude.reasoning_effort` | Must be valid for selected Claude model/provider. |
| Claude Runtime Defaults | Claude Permission Mode / `host-claude-permission` | debug gated | default `bypassPermissions` unless `provider_permission.debug_mode_dropdown_enable=true` | Host config `session_defaults.claude.permission_mode` only in debug mode | Visible in normal mode but disabled and default-only as `Approve everything`; non-default saves require debug config plus `confirm_beta_provider_permission_mode`. |
| Codex Runtime Defaults | Codex Command / `host-codex-command` | yes | `codex_command` | Host config `codex_command` | Full path may be shown in the input. Blank disables Codex on this Host. |
| Codex Runtime Defaults | Codex Model / `host-codex-model` | yes | `session_defaults.codex.model` | Host config `session_defaults.codex.model` | Options come from Codex model catalog/defaults. |
| Codex Runtime Defaults | Codex Reasoning Effort / `host-codex-reasoning-effort` | yes | `session_defaults.codex.reasoning_effort` | Host config `session_defaults.codex.reasoning_effort` | Must be valid for selected Codex model/provider. |
| Codex Runtime Defaults | Codex Approval Style / `host-codex-approval` | debug gated | default `never` unless `provider_permission.debug_mode_dropdown_enable=true` | Host config `session_defaults.codex.approval_policy` only in debug mode | Visible in normal mode but disabled and default-only as `never`; debug mode offers only `on-request` and `never`; `suggested` is not valid. |
| Actions | Save / `host-preferences-save-btn` | action | current form draft | Host config | Explicitly saves changed Host Preferences. |
| Actions | Reset / `host-preferences-clear-btn` | action | current persisted preferences | form only | Clears local draft back to loaded values. |
| Actions | Reload / `host-preferences-reload-btn` | action | Host config | form only | Reloads current persisted preferences. |

## Session Setup Fields

Session Setup creates a launch payload. If the update/create config mode is
active, eligible fields are persisted before launch.

The Session Setup page groups fields into `Session Config`, `Provider Runtime`,
`Website`, and `Telegram` settings-list blocks. `Session Config` is first.
Checkbox rows show the row label once; the value cell contains only the
checkbox control.

| UI label / control | Editable | Source/default | Runtime payload | Persist target when enabled | Notes |
| --- | --- | --- | --- | --- | --- |
| Agent ID / `create-agent-id` | yes | folder slug, history source, or user input | `agent_id` | none | Required for launch. Hidden in Scheduler-mode. Selecting Start Folder may auto-fill it. |
| Session Name / `create-session-name` | yes | generated default, history source, or user input | `session_name` | none | Required and unique among running sessions. Hidden in Scheduler-mode. |
| Agent Runtime / `runtime-claude`, `runtime-codex`, `runtime-debug-fixture`, `runtime-debug-large-tool-spillover`, `runtime-debug-p135-codex-replay` | yes | Host default runtime or folder config | `provider` | shared config `interface.provider` | Debug Fixture is internal and hidden unless debug fixture is enabled. P82 Spillover Fake is dev/verification-only and hidden unless `<host_config_dir>/config.debug.json` enables `debug_large_tool_spillover_provider_enabled`; P147 P135 Codex Replay is hidden unless `<host_config_dir>/config.debug.json` enables `debug_p135_codex_replay_provider_enabled`. No Host Preferences toggle is exposed for the hidden debug providers. |
| Model / `create-model` | yes | provider model default or folder config | `model` | shared config `model` and `interface.model` | Provider-specific options from `GET /providers`. |
| Refresh Provider Models / `create-model-refresh` | action | current selected product provider | none | none | Calls dashboard-authenticated `POST /providers/model-refresh` for the current `claude` or `codex` Session Setup provider only. It refreshes catalog/status, preserves the selected model when still available, skips unavailable providers before child runtime spawn, and does not change saved defaults. |
| Provider auth card / `create-provider-auth-card` | action/display | provider auth status | none | none | Blocks launch when provider auth is unavailable. |
| Claude Reasoning Effort / `create-reasoning-effort` | yes | Host/folder Claude default | `reasoning_effort` | shared config `reasoning_effort` and `interface.reasoning_effort` | Claude-only. |
| Claude Permission Mode / `create-permission` | debug gated | default `bypassPermissions` unless `provider_permission.debug_mode_dropdown_enable=true` | `permission_mode` | shared config `permission_mode` and `interface.permission_mode` only in debug mode | Claude-only. Visible in normal mode but disabled and submitted as `bypassPermissions` / `Approve everything`; non-default runtime or CLI/API requests require debug config plus confirmation. |
| Codex Reasoning Effort / `create-reasoning-effort-codex` | yes | Host/folder Codex default | `reasoning_effort` | shared config `reasoning_effort` and `interface.reasoning_effort` | Codex-only. |
| Codex Approval Style / `create-codex-approval` | debug gated | default `never` unless `provider_permission.debug_mode_dropdown_enable=true` | `approval_policy` | shared config `interface.approval_policy` only in debug mode | Codex-only. Visible in normal mode but disabled and submitted as `never`; debug mode offers only `on-request` and `never`; `suggested` is removed. |
| Start Folder / `create-agent-folder` | yes | Host default browse path, selected folder, or source session folder | `agent_folder` | determines config location | Folder selection should auto-generate Agent ID and Session Name when appropriate. |
| Folder picker / `create-agent-folder-picker` | action | local filesystem | `agent_folder` | none | Picks Start Folder. |
| Update session name / `create-update-session-name-btn` | action | Start Folder | `session_name` | none | Manual helper for generated session name. |
| Interface Style / `create-interface` | debug only | `session_defaults.interface_type` | `interface_type` | shared config `interface.type` and `ui.default_surface` | Hidden unless `show_interface_style_in_session_setup_profile=true`. Missing or false keeps the hidden first-party value as `coding`. |
| Website Enabled / `create-website-enabled` | yes | Host default or folder config `web.enabled` | `web_enabled` | shared config `web.enabled` | When enabled, Host creates `.oysterun/site/index.html` from the canonical template before session handoff if the file is missing. Disabling never deletes or overwrites existing site files. |
| Website Access / `create-website-access` | yes | Host default or folder config `web.access` | `web_access` | shared config `web.access` | Values: `owner_only`, `password`, `public`. |
| Website Password / `create-website-password` | yes when Website Access is `password` | local/private config status only | `web_password` when non-empty | local config `web.password` | Plaintext Host-local password for `/sites` password mode. Never written to shared config or Host Preferences. If no local password exists, the effective default is `0000` until Owner replaces it locally. |
| Complete message notifications / `create-notifications-enabled` | yes | Host default or folder config `notifications.enabled` | `notifications_enabled` | shared config `notifications.enabled` | Per-session notification delivery toggle. |
| Install/Overwrite Oysterun Skills / `create-install-oysterun-skills` | yes | read-only Host provider skill status | `install_oysterun_skills` only when checked | none | Session Setup launch-time copy controller. Missing `Oysterun` provider skill set defaults checked/install. Existing marker-owned skill set defaults unchecked and overwrites only when checked. Existing unowned/missing-marker folder disables the checkbox and refuses overwrite. |
| Enabled / `create-telegram-enabled` | yes | folder config | `telegram_enabled` | shared config `telegram.enabled` | Telegram block per-session setting. Defaults off; no normal Host-level feature gate. |
| Send tool activity / `create-telegram-send-tool-messages` | yes | folder config | `telegram_send_tool_messages` | shared config `telegram.send_tool_messages` | Telegram block per-session setting. Defaults off. |
| Telegram Bot Token / `create-telegram-bot-token` | yes | local/private config | `telegram_bot_token` | local config `telegram.bot_token` | Password input. Must not be written to shared config. The helper text says: "Get a bot token from Telegram BotFather, then paste it here." Required when Telegram is enabled and no prior local token exists. |
| Telegram Allowed Users / `create-telegram-allowed-users` | yes | local/private config | `telegram_allowed_users` | local config `telegram.allowed_users` | Required when Telegram is enabled and no prior allowed users exist. |
| Telegram Test Send / `create-telegram-test-send-btn` | action | draft fields first, then local/private config | `telegram_bot_token`, `telegram_allowed_users` | none | Sends the fixed test text `Oysterun Telegram test message.` through `POST /telegram/test-send` using redacted draft/local setup material. It does not start a provider session, send Matrix/chat rows, or use a Mock fallback. |
| Allowed Paths / `create-allowed-paths` | yes | Host/folder config | `allowed_paths` | shared config `permissions.allowed_paths` | Comma-separated. Relative paths resolve from Start Folder. `/` means unrestricted. |
| Use Start Folder / `create-use-start-folder` | action | Start Folder | updates `allowed_paths` draft | none | Helper that sets Allowed Paths to Start Folder. |
| Runtime Capabilities / `create-runtime-capabilities` | debug only | default-on Host runtime capability bundle | `runtime_capabilities` only when debug-visible | shared config `runtime_capabilities` only through debug-visible update flow | Hidden unless `debug_show_capability_ui=true`. In normal hidden mode launch payloads omit `runtime_capabilities`; Host starts new sessions with default-on general capabilities. |
| Update .oysterun/config.json / `create-persist-config` | yes | selected Start Folder config state | controls pre-launch persistence | shared/local config as eligible | Existing config mode: checked persists current values. No-config mode: label becomes "Do not create"; checked prevents creating config. |
| Start Session / `create-start-btn` | action | current form | launch request | optional pre-launch config write | Must validate Agent ID, Session Name, Start Folder, provider availability, and required provider fields. |

When P192 provider startup preflight fails before a session is created, Session
Setup renders the failure in `create-error` with the required support command:

```text
grep '\[provider-startup\]' ~/.oysterun/logs/oysterun-host.log | tail -n 80
```

This diagnostic row does not create or select a live session, does not mutate
history, and must not expose provider secrets.

## Session Profile Fields

Session Profile edits the selected live session. Durable persistence is only
performed when the row's "Update .oysterun/config.json" toggle is checked.
The P75 layout groups these fields into Provider Runtime, Session Identity,
Workspace Policy, Website Access, and Telegram sections. Provider runtime fields
are read-only because changing them requires a provider restart.

| UI row / control | Editable | Runtime effect | Persist target when enabled | Notes |
| --- | --- | --- | --- | --- |
| Provider Runtime: Runtime / `agent-profile-runtime-provider` | no | none | none | Read-only provider identity. |
| Provider Runtime: Model / `agent-profile-runtime-model` | no | none | none | Read-only provider/runtime identity. |
| Provider Runtime: Reasoning Effort / `agent-profile-runtime-reasoning-effort` | no | none | none | Read-only current runtime setting. |
| Provider Runtime: Permission Mode/Approval Style / `agent-profile-runtime-permission` | no | none | none | Read-only current Claude permission mode or Codex approval policy. |
| Rename / `agent-profile-rename-input` | yes | updates Oysterun live session label and history | shared config `session_name` when update-config is checked | Does not restart provider runtime. |
| Session Identity update config / `agent-profile-identity-update-config` | yes | controls persistence | shared config `session_name` | Unchecked saves only the running session and history. Checked also persists the Session Identity rename to `.oysterun/config.json` for future launches from the same agent folder. |
| Session Identity Save / `agent-profile-identity-save-btn` | action | commits live label/history and optional shared config write | optional shared config `session_name` | Must validate non-empty label. Save reads the update-config checkbox. No separate Cancel action is required. |
| Agent ID | no | none | none | Read-only current session identity. |
| Session ID | no | none | none | Read-only current session identity. |
| Working Directory | no | none | none | Read-only current session cwd. |
| Install/Update Oysterun Skills / `agent-profile-install-oysterun-skills-btn` | action | installs or updates the aggregate Oysterun provider skill set for the selected live session folder/provider | none | Uses `GET /agent/provider-skill-status` followed by `POST /agent/provider-skill-install`. Missing `Oysterun` provider skill set installs without confirmation. Existing marker-owned skill set requires confirmation before overwrite. Existing unowned/missing-marker folder refuses overwrite. |
| Workspace Root / `agent-profile-website-root` | no | none | none | Read-only root path for this session. |
| Allowed Paths / `agent-profile-workspace-allowed-paths` | yes | live `workspacePolicy.allowedPaths` refresh for this running session | shared config `permissions.allowed_paths` when update-config is checked | Comma or newline separated. Unchecked saves are runtime-only and must not mutate `.oysterun/config.json` or restart the provider. Invalid/missing paths fail closed before any update. |
| Notifications Enable / `agent-profile-notifications-enabled` | yes | live session notification policy | shared config `notifications.enabled` | Controls complete-message notification delivery for this session. |
| Runtime Capabilities / `agent-profile-runtime-capabilities` | debug only | live runtime capability state | shared config `runtime_capabilities` only when debug-visible | Hidden unless `debug_show_capability_ui=true`; use the Host capabilities UI pattern when visible. |
| Workspace Policy update config / `agent-profile-workspace-update-config` | yes | controls persistence for Workspace Policy-owned fields | shared config `permissions.allowed_paths`, `notifications.enabled`, and `runtime_capabilities` only when debug-visible | Visible in normal Session Profile. Runtime Capabilities stay hidden unless `debug_show_capability_ui=true`; hidden capability state is not replayed. |
| Workspace Policy Save / `agent-profile-workspace-save-btn` | action | applies Allowed Paths and Notifications, plus Runtime Capabilities only when debug-visible | optional shared config write when update-config is checked | Unchecked save updates the live `workspacePolicy` only, without config/local mutation or provider restart. Checked save persists `permissions.allowed_paths` and refreshes the live policy. |
| Website Enabled / `agent-profile-website-enabled` | yes | live session `web.enabled` override | shared config `web.enabled` | Enabling scaffolds `.oysterun/site/index.html` before the profile save succeeds when the file is missing. Disabling does not delete or overwrite site files. |
| Website Access / `agent-profile-website-access` | yes | live session `web.access` override | shared config `web.access` | Unchecked update-config saves only this running session. |
| Website Password / `agent-profile-website-password` | yes when Website Access is `password` | local/private config status only | `web_password` when non-empty and update-config is checked | local config `web.password` | Plaintext Host-local password replacement. Not exposed in responses. If no local password exists, the effective default is `0000` until Owner replaces it locally. |
| Website update config / `agent-profile-website-update-config` | yes | controls persistence | shared config `web.enabled` and `web.access`; local config `web.password` only when entered | Checked persists `web.enabled`, `web.access`, and any entered local website password. |
| Website Root / `agent-profile-website-root` | no | none | none | Read-only site root for this session. |
| Website Save / `agent-profile-website-save-btn` | action | applies Website Access | optional shared config write | Shows saved runtime-only vs config-mutated status. |
| Telegram enabled / `agent-profile-telegram-enabled` | yes | live Telegram listener policy | shared config `telegram.enabled` | Per-session setting. Defaults off; no normal Host-level feature gate. |
| Telegram Send tool activity / `agent-profile-telegram-send-tool-messages` | yes | live Telegram tool policy | shared config `telegram.send_tool_messages` | Per-session setting. Defaults off. |
| Telegram Bot Token / `agent-profile-telegram-bot-token` | yes | local Telegram runtime credential | local config `telegram.bot_token` | Password input; redacted status only. Required when enabling Telegram without an existing local token. |
| Telegram Allowed Users / `agent-profile-telegram-allowed-users` | yes | local Telegram user allowlist | local config `telegram.allowed_users` | Required when enabling Telegram without existing allowlist. |
| Telegram Test Send / `agent-profile-telegram-test-send-btn` | action | live session state plus draft fields | none | Uses the same `POST /telegram/test-send` endpoint as Session Setup. Draft token/users override the live local/private config for the test request only. Returned status is redacted and does not create provider, Matrix, timeline, or tool response output. |
| Telegram update config / `agent-profile-telegram-update-config` | yes | controls persistence | shared + local config | Checked persists shared Telegram settings and local private fields. |
| Telegram Save / `agent-profile-telegram-save-btn` | action | applies Telegram settings | optional shared/local config write | Shows redacted runtime status. |

## Validation Contract

[contract] Host Preferences save must validate:

```text
- display_name is string or null
- notification_sound_web_enabled is boolean
- notification_sound_app_enabled is boolean
- default_browse_path is a non-empty existing/resolvable directory
- direct_host_url/public_base_url is a valid URL or null
- claude_command/codex_command is string or null
- session_defaults is an object and each nested value is normalized
- Website Access defaults are not editable from Host Preferences.
```

[contract] Session Setup must validate before launch:

```text
- Agent ID is present
- Session Name is present and not used by another running session
- Start Folder is present
- selected provider is available on this Host
- provider model/reasoning/permission fields are valid for that provider
- required local/private fields are present when enabling a feature that needs them
- website password mode may launch without a local password, but `/sites` remains locked until `web.password` is saved in `.oysterun/local.json`
- website enabled mode creates `.oysterun/site/index.html` from the canonical Host template if missing and must not overwrite or delete existing files
- cloned password-mode folders without local `web.password` use effective default `0000` until Owner replaces the password locally
```

[contract] First-run Explorer onboarding must expose these empty-state and
folder actions:

```text
Sessions empty state:
  No sessions yet
  Start from an existing project folder.
  [New Session] [Open Explorer]

Running Sessions row menu:
  Duplicate Setup
  Branch
  Restart / Restarting...
  Stop

History Sessions row menu:
  Duplicate Setup
  Resume Chat, only when resume metadata is available

Explorer empty state:
  Open a folder
  Choose a project folder, paste a full path, or create a demo agent.
  [Open Path] [Choose Folder] [Create Demo Agent]

Create subfolder modal:
  [Create Folder] [Copy Demo Agent]
```

`Open Path` submits only after the Host validates an absolute existing readable
directory. `Create Demo Agent` copies the packaged public-safe
`oysterun-github-tracker` template into the current Explorer path or Default
Browse Root, then opens Explorer on the copied folder without starting a
session.

[contract] macOS Explorer folder access failures use the
`explorer-folder-access-card`, not the generic `explorer-error` line, for both
permission denied and folder-read timeout cases. Permission denied copy says:
`Oysterun cannot access this folder yet. Allow Node.js to access this folder, then retry.`
Timeout copy says macOS may be waiting for folder access permission and asks the
user to check the desktop permission prompt and allow Node.js to access this folder, then retry.
Both card modes include this fallback once: `If no prompt appears, open System Settings > Privacy & Security > Full Disk Access and allow Node.js / the terminal app running Oysterun.`

[contract] Route C chat header session actions expose Restart above Stop. Both
chat header Restart and Running Sessions row Restart call `POST
/session/restart`, display `Restarting...` while pending, guard duplicate
clicks, and navigate to `/app/sessions/<response.session_id>/chat` using the
response session id. Stop retains its existing independent pending behavior.

[contract] Provider-auth failure copy in chat must be a Markdown
`session_lifecycle` row that tells the user to log in from the machine terminal,
or open `/app/terminal` if the remote terminal is available, run `codex /login`
for Codex or `claude /login` for Claude, and then use Restart session. The copy
must not expose provider secrets, suggest a dashboard-token workaround, or
special-case Claude `/login` inside `/session/send`.

[contract] Session Profile must validate before applying live changes:

```text
- selected live session still exists
- update_config is explicit per row
- shared fields only persist to .oysterun/config.json
- private/local fields only persist to .oysterun/local.json
- runtime-only updates must not silently mutate durable config
- Session Identity rename is runtime/history-only unless `agent-profile-identity-update-config` is checked; checked saves shared `session_name` to `.oysterun/config.json`
- Workspace Policy Allowed Paths save is runtime-only unless `agent-profile-workspace-update-config` is checked; checked saves shared `permissions.allowed_paths` to `.oysterun/config.json` and refreshes the live workspace policy without provider restart
- invalid Allowed Paths fail closed before runtime or config mutation
- website password replacement persists only when the Website update-config control is checked
- website enable scaffolding runs before a Session Profile save can report success and preserves no-overwrite/no-delete behavior
- P96 preservation: Session Profile Workspace Policy uses one visible update-config checkbox and one Save action for Allowed Paths and Notifications
- Session Profile Workspace Policy hides runtime capability controls unless `debug_show_capability_ui=true`; normal saves omit hidden capability state
```

## UAT Checklist

Use this checklist when changing any field in these forms:

```text
1. Host Preferences
   - edit Host Display Name, Default Browse Root, notification sound toggles
   - confirm Website Access is not exposed in Host Preferences
   - save and confirm Host config JSON changes only for the intended keys
   - reload and confirm values round-trip

2. Session Setup with existing <agent_folder>/.oysterun/config.json
   - change provider/model/web access/website password/notifications; verify Interface Style appears only when `show_interface_style_in_session_setup_profile=true` and runtime capabilities appear only when `debug_show_capability_ui=true`
   - leave Update unchecked and confirm launch uses values without config mutation
   - check Update and confirm eligible fields persist to shared config

3. Session Setup without <agent_folder>/.oysterun/config.json
   - confirm defaults come from Host config session_defaults
   - default path creates agent .oysterun/config.json on launch
   - "Do not create .oysterun/config.json" prevents config creation

4. Session Profile
   - change Website Access, Website Password, Notifications, and debug-visible Runtime Capabilities when enabled
   - unchecked update-config changes only the running session
   - checked update-config persists to <agent_folder>/.oysterun/config.json

5. Private/local fields
   - Website Password writes only `web.password` in `.oysterun/local.json`
   - Telegram token/allowed users never appear in shared config
   - local/private values are redacted in UI status

6. Cross-surface defaults
   - Host Preferences session defaults flow into fresh Session Setup
   - folder config overrides Host defaults
   - Session Profile live-only overrides do not change future Session Setup
```
