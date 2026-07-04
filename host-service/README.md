# Oysterun Host Service

The Host service runs on the Mac mini (Oyster Farm). It manages Host-owned agent sessions, serves the web client and Host-local assets, and can run either in direct Host-only mode or in the original Cloud-connected mode.

## Current Phase 1 status

- `claude` is runtime-backed through the native Claude CLI adapter.
- `codex` is runtime-backed through `codex app-server`.
- Oysterun now keeps a stable Host-owned `session_id`; provider-native resume and thread identifiers are stored separately.
- Recent session records are persisted locally, and transcripts plus uploads now live under `~/.oysterun/...`.
- Agent config is layered from shared project config, local/private project config, and machine-local Host defaults.
- The web client now supports folder browse, markdown file preview, image upload plus inline image rendering, and dashboard-only `!command` shell execution.

## Quick Start

```bash
npm run setup                     # First-run direct Host setup (~/.oysterun on 8802)
npm run setup -- --enable-cloud   # Optional Cloud registration flow
npm start                         # Start the Host service
npm run dev                       # Start with --watch (auto-reload)
npm run cli                       # Interactive CLI client
```

What `npm run setup` does now:

- defaults to direct/local mode
- writes the Host port and requires a dashboard username/password on first run
- can optionally save a public Host URL for manual client connection
- clears Cloud registration values unless you explicitly use `--enable-cloud`

Cloud registration is now an explicit opt-in step instead of the default first-run setup path.

Port notes:

- Production default and setup default: `8802` in `~/.oysterun/config.json`
- Staging stack: `9902`
- Disposable test slots: `3022`, `3302`, `4022`, `4402`
- Current founder deployment uses production on internal port `8802`

## Config

Host config is stored at `~/.oysterun/config.json`. The Host now bootstraps this file on first use with the full known key set so users have one machine-local place to inspect and edit defaults. Most runtime keys can still be overridden by environment variables, but dashboard credentials are read from the config file.

| Config Key                    | Env Var                              | Description                                                                                                                                                                     |
| ----------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connection_mode`             | `OYSTERUN_CONNECTION_MODE`           | `direct` or `cloud`. Default `direct`.                                                                                                                                          |
| `port`                        | `OYSTERUN_PORT`                      | Service port. Code default is `8802`.                                                                                                                                           |
| `backend_url`                 | `OYSTERUN_BACKEND_URL`               | Cloud backend URL. Default `http://localhost:8000`.                                                                                                                             |
| `public_base_url`             | none                                 | Optional manual-connect URL for direct mode clients. Display/share metadata only; not used for Host binding.                                                                    |
| `device_id`                   | `OYSTERUN_DEVICE_ID`                 | Device ID from Cloud registration.                                                                                                                                              |
| `device_signing_public_key`   | `OYSTERUN_DEVICE_SIGNING_PUBLIC_KEY` | EC public key used to verify Host JWT access tokens.                                                                                                                            |
| `device_signing_kid`          | `OYSTERUN_DEVICE_SIGNING_KID`        | Expected JWT `kid` for this Host.                                                                                                                                               |
| `device_token`                | `OYSTERUN_DEVICE_TOKEN`              | Bearer token for Host-to-Cloud route and heartbeat calls.                                                                                                                       |
| `ngrok_domain`                | `OYSTERUN_NGROK_DOMAIN`              | Static ngrok domain for Stage 1 transport.                                                                                                                                      |
| `dashboard_user`              | none                                 | Dashboard login username. Required during setup before the local owner can be used.                                                                                             |
| `dashboard_password_hash`     | none                                 | Scrypt password hash for the dashboard login. The Host never persists the plaintext password.                                                                                   |
| `default_browse_path`         | internal runtime override only       | Machine-local default browse/start root. Product installs write a concrete `~/OysterunAgents` path into config.json; Host Preferences edits this value directly. |
| `display_name`                | none                                 | Host identity label. Defaults to `oysterun-<LocalHostName>` and is editable in Host Preferences.                                                                                |
| `session_defaults`            | none                                 | Machine-local fresh Session Setup runtime defaults, including `interface_type` plus Claude/Codex provider settings.                                                             |

Current bootstrap defaults:

```json
{
  "connection_mode": "direct",
  "port": 8802,
  "backend_url": "http://localhost:8000",
  "public_base_url": null,
  "device_id": null,
  "device_signing_public_key": null,
  "device_signing_kid": null,
  "cloud_public_key": null,
  "device_token": null,
  "ngrok_domain": null,
  "dashboard_user": "your-dashboard-user",
  "dashboard_password_hash": "scrypt$N=16384,r=8,p=1,keylen=32$<salt_base64>$<hash_base64>",
  "default_browse_path": "~/OysterunAgents",
  "display_name": "oysterun-<LocalHostName>",
  "onboarding_token": null,
  "onboarding_url": null,
  "registered_at": null,
  "session_defaults": {
    "default_provider": "claude",
    "interface_type": "coding",
    "claude": {
      "model": "opus",
      "permission_mode": "bypassPermissions",
      "allow_dangerously_skip_permissions": false,
      "dangerous_mode": false,
      "image_input_enabled": true
    },
    "codex": {
      "model": "gpt-5-codex",
      "approval_policy": "never",
      "sandbox_mode": "danger-full-access",
      "dangerous_mode": false,
      "search_enabled": false,
      "image_input_enabled": false,
      "provider_profile": null,
      "provider_args": [],
      "provider_commands": [],
      "provider_config_overrides": {}
    }
  }
}
```

## Agent Config Layers

Resolved agent runtime config comes from three layers:

- Shared project config: `<agent_folder>/.oysterun`
- Local private project config: `<agent_folder>/.oysterun.local`
- Machine-local Host defaults: `~/.oysterun/config.json -> session_defaults`

Current write behavior:

- Shared runtime fields such as `provider`, `model`, `permission_mode`, `approval_policy`, `dangerous_mode`, `search_enabled`, `image_input_enabled`, and shared `allowed_paths` are written to `.oysterun`.
- Local/private fields such as `provider_profile`, `provider_args`, `provider_commands`, `provider_config_overrides`, and `permissions.local_allowed_paths` are written to `.oysterun.local`.
- Host defaults stay machine-local in `~/.oysterun/config.json`.
- Host Preferences reports the active config file and whether it comes from the default `~/.oysterun` location or an `OYSTERUN_CONFIG_DIR` override.
- Host Preferences can edit `display_name`, but dashboard credentials stay out of the UI except for the dedicated Change Password flow.

Provider-native sandbox is no longer a first-party Session Setup source of truth. Oysterun owns permission scope through workspace policy and allowed paths, then derives any provider-native sandbox hint from that policy at runtime.

This separation is important: Host now keeps shared `.oysterun` writes and private `.oysterun.local` writes distinct instead of collapsing them into one file.

## Session Identity Model

The Host session identity model changed during the 2026-03-24 cleanup.

- `session_id`: Oysterun Host-owned logical session identifier.
- `provider_resume_id`: provider-native identifier used for restart/resume.
- `provider_thread_id`: provider-native thread identifier when exposed by the runtime. This is especially relevant for Codex app-server.
- `provider_transport`: current runtime transport label. Today this is `app-server` for Codex and `null` for Claude.

Current behavior:

- `POST /session/start` creates a Host-owned `session_id`.
- `POST /session/restart` keeps that same Host `session_id` and reuses provider-native resume metadata where available.
- `POST /sessions/resume` starts a new Host session from a stored transcript and returns `resumed_from_session_id` for the source transcript session.

## Authentication

Two auth mechanisms are tried in order:

1. Dashboard auth: `Bearer <session_token>` from `POST /auth/login`, plus the same dashboard session as an HttpOnly same-origin cookie for iframe/subresource requests
2. JWT auth: `Bearer <access_token>` signed by Cloud with the device signing key

JWT verification follows the ES256 validation rules in `jwt-auth.mjs`.

Dashboard auth sessions do not use a user-facing TTL setting. Normal product
behavior has no automatic TTL expiry. Debug-only expiry simulation is controlled
by `config.debug.json`; see `docs/routec/dev/login_expire_logic.md`.

### Direct mode vs Cloud mode

- `direct` mode is the current v1 default. The Host starts and runs with only local config plus dashboard login.
- `cloud` mode is optional. The Host uses `backend_url`, device registration material, and Cloud-issued JWT access tokens.
- The Host does not need Cloud to boot. If `connection_mode` is `direct`, missing Cloud registration is normal.
- In `direct` mode, the owner can save a `public_base_url` during setup or in Host Preferences so client apps have a machine-local reference URL for manual connection.

### Current boundary rules

- Membership alone is not enough for Host control endpoints.
- Host enforces Cloud-issued per-agent capabilities from JWT claims.
- JWT-facing Host APIs identify an agent, not a host-local folder.
- Host resolves local folder paths from trusted Host-local state.
- Dashboard auth is still a local admin bypass for the web client surface.
- `GET /session/history` is live buffered event history for one agent.
- `GET /sessions/history` is persisted Host-local session summary history.
- Transcript replay is backed by the Route C Matrix timeline surfaces. The legacy
  transcript export/list/search routes are absent and return the normal Host 404.

### Endpoint auth summary

| Endpoint                               | Current gate                                                   |
| -------------------------------------- | -------------------------------------------------------------- |
| `GET /agent/config`                    | Agent access required                                          |
| `PUT /agent/config`                    | `can_manage_config`                                            |
| `GET /agent/commands`                  | `can_chat`                                                     |
| `GET /session/history`                 | `can_chat`                                                     |
| `POST /session/send`                   | `can_chat`                                                     |
| `GET /session/messages`                | `can_chat`                                                     |
| `GET /session/transcript`              | `can_chat`                                                     |
| `POST /session/uploads`                | Deprecated/forbidden; returns `410 session_uploads_deprecated` |
| `GET /session/uploads/content`         | Deprecated/forbidden; returns `410 session_uploads_deprecated` |
| `POST /session/interrupt`              | `can_chat`                                                     |
| `POST /session/start`                  | `can_start_session`                                            |
| `POST /session/stop`                   | `can_start_session`                                            |
| `POST /session/restart`                | `can_start_session`                                            |
| `POST /sessions/resume`                | `can_start_session`                                            |
| `GET /sessions/matrix-transcripts`     | `can_chat`                                                     |
| WebSocket subscribe                    | `can_chat`                                                     |
| WebSocket `send`                       | `can_chat`                                                     |
| WebSocket `exec`                       | Dashboard auth only                                            |

## HTTP API

All endpoints below are current Host behavior, not aspirational product behavior.

### Public endpoints

#### `GET /health`

Returns basic service status.

Example response:

```json
{
  "status": "ok",
  "sessions": 2,
  "connection_mode": "direct",
  "ngrok": {
    "alive": true,
    "publicUrl": "https://foo.ngrok-free.dev"
  },
  "device_id": "d-xyz789"
}
```

#### `GET /app`, `GET /app/`, `GET /app/*`

Serves the web client SPA. Nested web client routes under `/app/*` return the same HTML document so History API refreshes and deep links work.

#### `POST /auth/login`

Dashboard login using local username and password.

Example request:

```json
{
  "username": "your-dashboard-user",
  "password": "<current dashboard password>"
}
```

Example response:

```json
{
  "token": "uuid-session-token"
}
```

The login response also sets an HttpOnly dashboard session cookie so sandboxed same-origin content routes can authenticate iframe and subresource requests.

### Authenticated general endpoints

#### `POST /auth/logout`

Invalidates the dashboard session token.

#### `GET /providers`

Returns the current provider registry, including capabilities, controls, and native config hints.

Current provider differences that matter:

- Claude supports native command discovery from `.claude/commands` and image input.
- Codex supports `sandbox_mode`, provider config overrides, search, image input, interrupt, and app-server thread resume.

Representative response shape:

```json
{
  "providers": [
    {
      "id": "claude",
      "runtime_supported": true,
      "capabilities": {
        "resume": true,
        "nativeCommands": true,
        "imageInput": true
      }
    },
    {
      "id": "codex",
      "runtime_supported": true,
      "capabilities": {
        "resume": true,
        "interrupt": true,
        "search": true,
        "imageInput": true,
        "configOverrides": true
      },
      "controls": {
        "sandboxMode": false
      },
      "native_config": {
        "authPath": "~/.codex/auth.json",
        "configPath": "~/.codex/config.toml",
        "sessionPath": "~/.codex/sessions"
      }
    }
  ]
}
```

#### `GET /agents/catalog`

Returns the accessible agent catalog plus browse roots used by the web client.

### Dashboard-only web client endpoints

These routes are for the local web client surface, not the Cloud-facing client contract.

#### `GET /dev/folders`

Returns a paginated folder listing for Explorer and Folder Picker.

#### `GET /dev/file`

Returns a preview payload for one file. The web client uses this to classify and render:

- rendered markdown preview
- rendered HTML preview via a sandboxed iframe
- rendered image preview for browser-supported local image files
- syntax-highlighted code preview
- plain-text preview
- explicit unsupported/binary preview states

Representative response fields:

- `preview_kind`
- `content_type`
- `language`
- `text_available`
- `truncated`
- `content`
- `asset_root_path`
- `asset_relative_path`
- `unsupported_reason`

#### `GET /dev/fs/<encoded_root>/<relative_path>`

Serves authenticated file content under a declared local root for the web preview iframe.

The Host validates that the requested file stays inside the declared root after path resolution and realpath checks, so local HTML files can load their relative CSS, JS, and image assets without escaping that root.

This route accepts standard content auth through:

- `?token=...`
- `Authorization: Bearer ...`
- the dashboard session cookie for same-origin requests

#### `GET /dev/fs-auth/<encoded_token>/<encoded_root>/<relative_path>`

Serves the same authenticated content as `/dev/fs/...`, but carries the auth token in the path so relative asset URLs inside a sandboxed HTML iframe inherit the token automatically.

The web client HTML preview uses this route for rendered `.html` files with local CSS, JS, or image assets.

#### `GET /dev/folder-config`

Reads resolved runtime/config state for a folder before it has an agent mapping.

This powers the web client folder picker and session-setup defaults.

### Agent config endpoints

#### `GET /agent/config?agent_id=<id>`

Returns resolved runtime config for an agent, including:

- `hasConfig`, `hasLocalConfig`, `hasDefaultConfig`
- `configPath`, `localConfigPath`, `defaultConfigPath`
- resolved provider/runtime fields
- `coderSettings`
- `native`
- `workspacePolicy`
- `rawConfig`

#### `PUT /agent/config`

Updates agent runtime config and persists shared versus local fields into the correct file layer.

Representative request:

```json
{
  "agent_id": "agent-1",
  "provider": "codex",
  "model": "gpt-5-codex",
  "approval_policy": "never",
  "search_enabled": true,
  "image_input_enabled": true,
  "provider_config_overrides": {
    "model_reasoning_effort": "medium"
  },
  "provider_args": ["--profile", "fast"]
}
```

#### `GET /agent/commands?agent_id=<id>`

Lists slash commands discovered from `.claude/commands/*.md` in the agent folder. Response also includes the resolved provider.

### Session lifecycle endpoints

#### `POST /session/start`

Starts a runtime-backed session for an agent.

Current behavior:

- Claude uses the native Claude CLI adapter.
- Codex uses the `codex app-server` adapter.
- The response includes both Host and provider-native session metadata.

Representative response:

```json
{
  "success": true,
  "session_id": "uuid",
  "agent_id": "agent-1",
  "provider": "codex",
  "provider_resume_id": "thread-abc",
  "provider_thread_id": "thread-abc",
  "provider_transport": "app-server",
  "alive": true,
  "ready": false,
  "workspace_policy": {
    "root": "/Users/jeremy/Projects/MyApp",
    "allowed_paths": ["/Users/jeremy/Projects/MyApp"]
  }
}
```

#### `POST /session/send`

Sends a user message to a running session and broadcasts a `message.user` event to subscribers.

#### Deprecated: `POST /session/uploads`

This product upload route is forbidden and disabled. It is retained only to reject legacy callers with `410 session_uploads_deprecated`.

#### Deprecated: `GET /session/uploads/content?agent_id=<id>&path=<absolute_saved_path>`

This uploaded-content route is forbidden and disabled. It is retained only to reject legacy callers with `410 session_uploads_deprecated`.

#### `POST /session/interrupt`

Interrupts the running session when the active provider supports it. This is currently relevant for Codex.

#### `POST /session/stop`

Stops a session gracefully. Use `force: true` to kill it.

#### `POST /session/restart`

Restarts a session while keeping the Host-owned `session_id` stable.

Current restart behavior:

- Claude reuses provider resume metadata through the adapter resume path.
- Codex reuses the persisted app-server thread identity.

Representative response:

```json
{
  "session_id": "uuid",
  "agent_id": "agent-1",
  "provider": "codex",
  "provider_resume_id": "thread-abc",
  "provider_thread_id": "thread-abc",
  "provider_transport": "app-server",
  "resumed": true
}
```

#### `GET /session/status?session_id=<id>`

Returns current active state for one live session, including:

- `session_id`
- `provider_resume_id`
- `provider_thread_id`
- `provider_transport`
- `provider_info`
- `alive`
- `ready`
- `workspace_policy`
- `pending_control_requests`

#### `GET /sessions`

Lists currently active sessions.

#### `GET /session/history?session_id=<id>`

Returns the live buffered event history for one live session.

Important distinction:

- This route is still memory-backed.
- It is used for live web client/chat replay.
- It is not the persisted session summary history.

### Persisted history and Matrix transcript endpoints

#### `GET /sessions/history`

Returns recent persisted session summary records from Host-local storage.

Current record fields include:

- `session_id`
- `agent_id`
- `agent_folder`
- `runtime`
- `model`
- `provider_resume_id`
- `provider_thread_id`
- `provider_transport`
- `created_at`
- `last_active_at`

#### `GET /session/messages`

Returns the current session's Route C Matrix-backed committed messages.

#### `GET /session/transcript`

Returns a paginated Route C Matrix transcript view for one session.

#### `GET /sessions/matrix-transcripts`

Lists Matrix-backed transcript summaries. Legacy transcript file list/export
routes were removed; old callers receive the normal Host 404 by route absence.

#### `POST /sessions/resume`

Starts a new Host session by replaying the source Route C Matrix timeline into a
new Matrix room before provider startup. The response includes:

- `session_id`
- `resumed_from_session_id`
- `transcript_message_count`
- Matrix replay proof fields
- provider/runtime metadata

## WebSocket API

### `ws://host:<port>/session/stream?agent_id=<id>&token=<token>`

Real-time bidirectional connection for chat, runtime events, and dashboard-only shell execution.

### Server-to-client messages

#### `status`

Sent on connect. Includes:

- `session_id`
- `provider`
- `provider_info`
- `provider_resume_id`
- `provider_thread_id`
- `provider_transport`
- `workspace_policy`

#### `history`

Sent on connect with the current buffered event history.

#### `event`

The current runtime event stream includes, among others:

- `message.user`
- `message.assistant`
- `tool.call`
- `tool.result`
- `turn.completed`
- `session.started`
- `session.ready`
- `session.exit`
- `shell.start`
- `shell.result`

Shell execution events are used to render structured shell cards with stdout, stderr, exit code, duration, and `stderr_severity`. Shell runs are also persisted into transcript history as typed shell rows so transcript replay can reconstruct shell cards later.

### Client-to-server messages

#### `send`

Sends a chat message to the subscribed agent stream.

Example:

```json
{
  "type": "send",
  "text": "What is 2+2?",
  "nickname": "Alice"
}
```

#### `exec`

Dashboard-only shell execution on the subscribed agent folder.

Example:

```json
{
  "type": "exec",
  "agentId": "agent-1",
  "command": "git status --short"
}
```

The web client currently maps `!command` input onto this execution path.

#### `control_response`

Responds to a provider permission or control request.

Example:

```json
{
  "type": "control_response",
  "request_id": "uuid",
  "allow": true,
  "answers": {
    "approval_mode": {
      "answers": ["Allow once"]
    }
  },
  "response": {
    "action": "accept",
    "content": {
      "profile": "work"
    },
    "_meta": null
  },
  "grant_suggestion": {
    "type": "setMode",
    "mode": "acceptEdits",
    "destination": "session"
  }
}
```

Notes:

- approval-style requests use `allow`
- Codex `item/tool/requestUserInput` uses structured `answers`
- Codex `mcpServer/elicitation/request` uses structured `response`
- Claude permission widgets may attach a Host-only `grant_suggestion` so the live session can widen future permission handling before sending the normal allow response to Claude
- the websocket is already scoped to a subscribed `session_id`, so `control_response` does not need to repeat `session_id` in the payload body

## Outbound Calls To Cloud

The Host service uses `device_token` auth for these outbound Cloud calls:

| Method  | Endpoint                                | Trigger                                                     |
| ------- | --------------------------------------- | ----------------------------------------------------------- |
| `POST`  | `/api/device/{device_id}/route`         | ngrok tunnel ready, report hostname                         |
| `POST`  | `/api/device/{device_id}/heartbeat`     | periodic heartbeat, default every 60 seconds                |
| `PATCH` | `/api/device/{device_id}/session-state` | session lifecycle updates: `active`, `closed`, `restarting` |

## Local State

Current Host-local state is split between config data and asset data.

### Config-like state

These use `OYSTERUN_CONFIG_DIR` when set, otherwise `~/.oysterun/`:

- `config.json`
- `agent-registry.json`
- `session-history.json`

### Asset-like state

These currently live under `~/.oysterun/`:

- `transcripts/<agent_bucket>/<session_id>.json`
- `uploads/<agent_bucket>/<session_id>/<timestamp>_<index>_<filename>`

`agent_bucket` is derived from:

- sanitized `agent_id`
- sanitized real folder basename
- a stable hash of the real folder path

This keeps transcripts and uploads aligned to the same Host-local bucket identity.

## File Structure

```text
host-service/
  server.mjs                         # HTTP server, WebSocket server, route handlers
  session-manager.mjs                # Agent session lifecycle and stable Host session IDs
  host-authz.mjs                     # Capability-based Host authorization helpers
  agent-registry.mjs                 # Host-local agent_id -> folder registry
  agent-config.mjs                   # Shared/local/default config layering and workspace policy
  session-history.mjs                # Persisted recent session summary records
  session-assets.mjs                 # Shared transcript/upload bucket helpers
  upload-manager.mjs                 # Session upload persistence
  jwt-auth.mjs                       # ES256 JWT verification
  config.mjs                         # Host config read/write
  ngrok-agent.mjs                    # ngrok tunnel management and heartbeat
  setup.mjs                          # Direct-mode setup and optional Cloud registration
  cli.mjs                            # Interactive CLI client
  adapters/
    claude-code-adapter.mjs          # Native Claude CLI adapter
    codex-app-server-adapter.mjs     # Codex app-server adapter
dev/client/
  app/index.html                     # Web Client served at /app
```

## CLI Usage

Example against the current temporary deployment port:

```bash
node cli.mjs --port 8802 --token <jwt_or_dashboard_token> --nickname "Alice"
```

Code default remains `8802` if `--port` is omitted and no config/env override is present.
