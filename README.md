# Oysterun

Oysterun currently has three main runtime pieces:

- `backend/`: the Cloud API written in FastAPI
- `host-service/`: the Host daemon that runs on the Mac mini
- `dev/client/`: the local web client served by the Host service at `/app`

The web client does not have its own frontend server right now. The Host service serves the built HTML file directly.

## Architecture In One Minute

The current product/runtime shape is:

1. start the Host service
2. open the web client from the Host service
3. optionally connect the Host to Oysterun Cloud later

For local repo development, you can still run backend + Host together when you need the Cloud side of the stack.

In code terms:

- the backend owns users, devices, agents, onboarding, Cloud auth, and device route/access-token APIs
- the Host service owns local sessions, provider adapters, transcript/upload storage, the web client, and Host-local config
- the web client is just a Host-served frontend for interacting with the Host service

## Project Layout

```text
Oysterun/
  backend/               FastAPI Cloud backend
  host-service/          Local Host daemon and provider runtime bridge
  dev/client/          Host-served web client source
  docs/                  Product, design, auth, mock, and TODO docs
  local notes            Gitignored working notes, reports, and ad hoc verification files
  temp/                  Local export output from tool_scripts/export_key_files.sh
  test-results/          Playwright output
  tool_scripts/          One-off local utilities
  investigation-repos/   Reference repos used for research only
```

Folders you can usually ignore when reading product code:

- gitignored operational notes: plans, reports, and ad hoc verification files
- `temp/`: export bundles created by `tool_scripts/export_key_files.sh`
- `test-results/`: Playwright run output such as `.last-run.json`, traces, screenshots, and other browser-test artifacts
- `investigation-repos/`: external reference code, not the Oysterun runtime itself

## First-Time Setup

### Backend

```bash
cd <repo-root>/backend
uv sync --extra dev
```

### Host Service

```bash
cd <repo-root>/host-service
npm install
```

### Optional Root Packages

The root `package.json` is mainly for Playwright and repo-level utilities, not for the main app runtime.

```bash
cd <repo-root>
npm install
```

## How To Start The Project

### 1. Optional: start the backend for repo development

```bash
cd <repo-root>/backend
uv run python -m uvicorn app.main:app --reload
```

Default local URLs:

- API root: `http://localhost:8000/`
- health: `http://localhost:8000/health`
- FastAPI docs: `http://localhost:8000/docs`

Notes:

- backend config lives in `backend/app/config.py`
- default DB is SQLite via `sqlite+aiosqlite:///./oysterun.db`
- tables are auto-created on startup in dev by `backend/app/main.py`
- this backend is Oysterun Cloud infrastructure code, not part of the normal Host-only v1 startup path

### 2. Start the Host service

```bash
cd <repo-root>/host-service
npm run setup
npm start
```

Useful commands:

```bash
npm run setup   # first-run direct Host setup
npm run setup -- --enable-cloud  # optional Cloud registration
npm start       # plain start, no watch mode
npm run dev     # watch mode for Host JS files
npm run cli     # local CLI client
npm test        # Host-side tests
```

Default local URLs when you run `npm start` or `npm run dev` directly with the canonical home config:

- health: `http://localhost:8802/health`
- web client: `http://localhost:8802/app`

Port notes:

- production default is `8802` in `~/.oysterun/config.json`
- staging uses `9902`
- disposable test slots use `3022`, `3302`, `4022`, and `4402`
- phone app verification can use any running Host port; point the app at the actual user-approved port for that run
- backend URL default is `http://localhost:8000`
- Host config is stored in `~/.oysterun/config.json`
- direct mode can also store an optional `public_base_url` there for manual client connection
- fresh Session Setup runtime defaults, including interface style plus Claude/Codex provider defaults, are stored there under `session_defaults`
- Host Preferences shows the active config path, so `OYSTERUN_CONFIG_DIR` overrides are visible in the UI
- Host now defaults to direct Host mode unless Cloud registration is explicitly enabled

### Optional: start backend + Host together for repo development

For local repo development, you can launch the backend and Host together with the stack-aware foreground runner:

```bash
cd <repo-root>
./tool_scripts/dev_up.sh
./tool_scripts/dev_up.sh --stack staging
```

What it does:

- rebuilds `dev/client/web/index.html`
- starts the selected development backend in reload mode
- starts the selected Host in watch mode
- uses `staging` by default
- syncs the stack-owned Host port before start
- stops both when you press `Ctrl-C`

This is a repo development helper, not the normal product startup path and not a replacement for a real system service such as `launchd`.

### Optional: detached start/stop/restart scripts

If you want the Host to keep running after you close the current terminal, use the background service scripts instead of `tmux`:

```bash
cd <repo-root>
./tool_scripts/start_oysterun.sh
./tool_scripts/stop_oysterun.sh
./tool_scripts/restart_oysterun.sh
```

Convenience wrappers are also available at:

```bash
~/Projects/start_oysterun.sh
~/Projects/stop_oysterun.sh
~/Projects/restart_oysterun.sh
```

Stack-specific usage:

```bash
~/Projects/start_oysterun.sh --stack staging
~/Projects/restart_oysterun.sh --stack staging
~/Projects/stop_oysterun.sh --stack staging
```

What they do:

- rebuild the web client before Host start
- submit launchd-managed background jobs for the Host
- start the selected stack Host only
- do not initialize backend runtime state
- use `production` by default
- keep production Host config under `~/.oysterun/config.json`
- keep staging/test Host config under `~/.oysterun-stacks/<stack>/host/config.json`
- write PID files under `~/.oysterun/run/` or `~/.oysterun-stacks/<stack>/run/`
- write logs under `~/.oysterun/logs/` or `~/.oysterun-stacks/<stack>/logs/`

Important:

- this is more convenient than `tmux` for manual start/stop/restart
- these scripts use temporary `launchctl submit` jobs unless you explicitly install the persistent LaunchAgents
- for persistent login-time auto-start and crash auto-restart on `8802` and `9902`, use `./tool_scripts/install_oysterun_launch_agents.sh`
- these scripts use stable non-watch commands; use `./tool_scripts/dev_up.sh` when you want backend + Host live auto-reload during active repo development
- `./tool_scripts/dev_up.sh` is the only startup path that initializes backend runtime state
- the supported preset stacks are `production`, `staging`, `test1`, `test2`, `test3`, and `test4`
- `production` uses Host `8802`
- `staging` uses Host `9902`
- `test1..test4` use Host `3022`, `3302`, `4022`, and `4402`
- `./tool_scripts/dev_up.sh` is for staging-oriented repo development and uses backend `9000`
- set `OYSTERUN_STAGING_LAN_HOST=<your_lan_ip>` if the staging stack should advertise a different LAN IP than `192.168.0.188`

### 3. Use the web client

For the default production Host, open:

```text
http://localhost:8802/app
```

For staging, open:

```text
http://localhost:9902/app
```

The web client is served by the Host service. There is no separate frontend dev server to start.

## How To Work On The Frontend

Frontend files live here:

- `dev/client/web/src/index.template.html`
- `dev/client/web/src/styles.css`
- `dev/client/web/build-index.mjs`
- `dev/client/web/index.html`

How it works:

- `src/index.template.html` is the main UI source
- `src/styles.css` is injected into the template
- `build-index.mjs` generates `dev/client/web/index.html`
- `host-service/server.mjs` reads `dev/client/web/index.html` and serves it at `/app`

After frontend edits:

```bash
cd <repo-root>
node dev/client/web/build-index.mjs
```

Then restart the Host service.

Why restart is needed:

- the Host service reads `dev/client/web/index.html` at startup and keeps it in memory
- rebuilding the HTML alone does not refresh the running Host process

## How To Restart Things

### Backend restart

If you started it with:

```bash
uv run python -m uvicorn app.main:app --reload
```

then Python code changes should auto-reload.

If you need a clean restart:

1. stop the process with `Ctrl-C`
2. run the same command again

### Host service restart

If you started it with:

```bash
npm run dev
```

then Host `.mjs` code changes should auto-restart the service.

You still need a manual restart when:

- you rebuilt `dev/client/web/index.html`
- you changed non-imported static files that the watch process does not track the way you expect

Manual restart:

1. stop the Host process with `Ctrl-C`
2. run `npm run dev` again

### Detached service restart

If you started the Host background scripts, restart with:

```bash
~/Projects/restart_oysterun.sh
```

or:

```bash
cd <repo-root>
./tool_scripts/restart_oysterun.sh
```

For staging:

```bash
~/Projects/restart_oysterun.sh --stack staging
```

### Frontend restart

There is no separate frontend process.

To refresh frontend changes:

1. rebuild the web client HTML
2. restart the Host service

## Service Structure

### Backend structure

Main entry:

- `backend/app/main.py`

Core modules:

- `backend/app/config.py`: environment-backed settings
- `backend/app/database.py`: SQLAlchemy async engine and session dependency
- `backend/app/models/`: ORM models
- `backend/app/schemas/`: request/response schemas
- `backend/app/services/`: auth, crypto, email helpers
- `backend/app/routers/`: FastAPI route modules
- `backend/tests/`: backend tests

Backend router responsibilities:

- `routers/devices.py`: device register, heartbeat, route, Host access-token
- `routers/agents.py`: agent CRUD, memberships, invites
- `routers/auth.py`: device-link and email login flows
- `routers/onboarding.py`: device onboarding pages and completion
- `routers/sessions.py`: Cloud-side session state and deprecated compatibility stubs
- `routers/users.py`: current user and quota APIs
- `routers/email.py`: email send endpoint

### Host service structure

Main entry:

- `host-service/server.mjs`

Core modules:

- `host-service/session-manager.mjs`: Host-owned session lifecycle
- `host-service/provider-registry.mjs`: provider metadata and capabilities
- `host-service/adapters/claude-code-adapter.mjs`: Claude runtime bridge
- `host-service/adapters/codex-app-server-adapter.mjs`: Codex runtime bridge
- `host-service/agent-config.mjs`: `.oysterun` config layering and workspace policy
- `host-service/agent-registry.mjs`: Host-local agent-folder mapping
- `host-service/session-history.mjs`: recent session summaries
- `host-service/upload-manager.mjs`: uploaded file persistence
- `host-service/session-assets.mjs`: `~/.oysterun` asset paths
- `host-service/jwt-auth.mjs`: JWT verification
- `host-service/host-authz.mjs`: per-agent capability checks
- `host-service/folder-browser.mjs`: web client folder browsing
- `host-service/config.mjs`: Host config in `~/.oysterun/config.json`
- `host-service/ngrok-agent.mjs`: ngrok route reporting
- `host-service/setup.mjs`: direct-mode Host setup and optional Cloud registration
- `host-service/cli.mjs`: local CLI client

### Web Client structure

Main files:

- `dev/client/web/src/index.template.html`: primary UI markup and client logic
- `dev/client/web/src/styles.css`: web client styles
- `dev/client/web/build-index.mjs`: build step for the served HTML
- `dev/client/web/index.html`: built file served by the Host

## Recommended Code Reading Order

If you are new to the repo, read in this order:

1. `docs/_SPIRIT.md`
2. `docs/_DESIGN.md`
3. `README.md`
4. `backend/app/main.py`
5. `host-service/server.mjs`
6. `dev/client/README.md`
7. the specific service modules for the feature you are touching

Within each service, use this order:

### Backend

1. `app/main.py`
2. `app/config.py`
3. `app/database.py`
4. `app/models/`
5. `app/services/`
6. `app/routers/`
7. `backend/tests/`

### Host service

1. `server.mjs`
2. `session-manager.mjs`
3. `provider-registry.mjs`
4. `adapters/`
5. `agent-config.mjs`
6. transcript/upload/history modules

### Web Client

1. `dev/client/README.md`
2. `dev/client/web/build-index.mjs`
3. `dev/client/web/src/index.template.html`
4. `dev/client/web/src/styles.css`

## Useful Docs

- `docs/_SPIRIT.md`: product intent and direction
- `docs/_DESIGN.md`: confirmed architecture and auth flow
- `docs/_AUTH.md`: auth details
- `docs/_MOCK.md`: known mock/stub behavior
- `docs/_TODO.md`: current implementation backlog

## Tests

Backend:

```bash
cd <repo-root>/backend
uv run pytest
```

Host service:

```bash
cd <repo-root>/host-service
npm test
```

Browser and ad hoc verification artifacts in this repo have usually been kept as gitignored operational notes, not as a permanent full test suite under `tests/`.

## Local Artifact Folders

### `temp/`

`temp/` is mainly used by:

- `tool_scripts/export_key_files.sh`

That script creates export folders and zip files like:

- `temp/key-file-export-<timestamp>/`
- `temp/key-file-export-<timestamp>.zip`

These are manual local export artifacts, not app runtime files.

### `test-results/`

`test-results/` is Playwright output.

It is recreated by Playwright runs such as:

```bash
npx playwright test
```

It can contain files like:

- `.last-run.json`
- traces
- screenshots
- videos
