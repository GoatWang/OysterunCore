# Route C Host Setup Contract

This document records the production user journey contract for installing and
starting an Oysterun Host. It focuses on the final intended user path, not
historical setup experiments.

## Stage 1 Product Model

Stage 1 uses:

- direct Host URL/IP:port for app/web connectivity
- Cloud for app installation identity, pairing metadata, and APNs notification
- one saved Host in the phone app
- durable login until explicit logout, credential revocation, or app storage
  reset

Stage 1 does not require the Oysterun tunnel for normal chat.

## Release Setup Command Contract

The source-worktree install path should be:

```bash
npm install
npm run setup
```

`npm install` only installs dependencies. It must not start the Host or mutate
runtime config.

The npm package install path should be:

```bash
npm install -g oysterun
oysterun
```

`oysterun` enters setup automatically when required Host config is missing.
`npm run setup` and `oysterun setup` both run the first-run wizard. Interactive
setup questions use a step-based terminal format such as `[1/7] Host name` and
a stable `?` prompt prefix, so explanatory copy and questions are visually
separate.

```text
[1/6] Host name
1. Ask for Host display name.

[2/6] Host port
2. Ask for Host port.
   - default production port is 8802.
   - if occupied by the same managed Oysterun service, allow the selected port
     and restart that service at the final step.
   - if occupied by another process, offer the next available port.

[3/6] iPhone connection URL
3. Ask how the iPhone will connect to this Mac.
   - prefer detected Tailscale/VPN or LAN URL.
   - localhost is Mac-browser-only; for iPhone on the same Wi-Fi/LAN, use the
     Mac LAN IP address.
   - if not on the same reachable network, use Tailscale, Cloudflare Tunnel,
     VPN, or another reachable tunnel/direct URL.

[4/6] Host password
4. Ask for Host password.
   - password input must be hidden.
   - first setup must confirm password by entering it twice.
   - local dashboard user is admin; user does not input a username.
5. Write Host config.
6. Create dashboard credential hash.
7. Register Stage 1 direct-IP Host with Cloud when Cloud direct mode is enabled.
8. Write Host Cloud identity to cloud_identity.json, not config.json.

[5/6] Phone app
9. Explain: "You need the Oysterun phone app to scan the login QR."
   Ask: "Show phone app download link and QR code?"
   - yes: show the phone app download link and QR.
   - no: continue to service start.
   - first version download URL: `https://oysterun.com`.
   - later production URL should be the App Store link.

[6/6] Start Host
10. Prepare the managed Host service.
    - macOS: install/use the launchd service.
    - Linux: use the pid-file managed Host service; do not call launchd.
    - Linux setup rerun against an already running managed Host must call the
      service restart path, not service install, so the existing Host on 8802 is
      treated as restartable instead of a port conflict.
11. If no managed Oysterun service is running, ask whether to start Host now,
    default yes.
12. If a managed Oysterun service is already running, ask whether to restart
    Host now, default yes.
    - warn that existing live runtime sessions and running loops will close.
    - explain that chat history remains and supported sessions can be resumed
      from Sessions after restart.
13. yes:
      managed Host start or restart
      health check
      display Web URL
      on interactive macOS setup, open `<Host URL>/app/sessions` in the browser
      after health check succeeds
      create and print a fresh 15-minute one-time Host login QR
    no:
      print `oysterun` as the start command.
      explain that the start command will print a fresh login QR.
```

Setup must not ask for macOS Full Disk Access during first-run installation.
macOS folder access recovery UI is a Host Preferences debug block, hidden by
default and shown only when `config.debug.json` explicitly enables it.

Setup must run before the server starts. The server reads the config generated
by setup.

When `OYSTERUN_CONFIG_DIR` points at a stack folder such as:

```text
~/.oysterun-stacks/test4/host
```

setup should run service actions against that same stack. Production setup uses
`~/.oysterun` and therefore the production service stack.

If the Host is already running and setup changes runtime connection settings,
setup should tell the user restart is required and offer to restart through the
service manager.

Setup rerun must still go through the normal setup questions. A running Host
does not skip port selection, password update, login QR readiness explanation,
or the final service action. The login QR itself is only printed after the
service starts or restarts successfully.

## Service Contract

Release Host should run as a local managed service, not as a foreground
terminal process.

Required commands:

```bash
oysterun service:start
oysterun service:stop
oysterun service:restart
oysterun service:restart --restore-sessions
oysterun service:logs
oysterun service:uninstall
oysterun show-qr
```

Release service behavior:

```text
- starts after Mac login
- restarts on crash
- writes stdout/stderr to a fixed log path
- can be restarted from Host Preferences
- does not require the user to remember a raw server command
```

`oysterun service:start` and `oysterun service:restart` must print a fresh
15-minute one-time Host login QR at the end after the Host start/restart
finishes successfully.

`oysterun service:restart --restore-sessions` is the restore-aware terminal
restart path. It must ask the running local Host to prepare the same P76
restart restore transaction used by Host Preferences before stop/start. After
boot, sessions that were live/ready before restart must rebuild a real provider
runtime through provider resume metadata. Metadata-only empty shells are not a
restored runtime state and must not accept user messages. In-progress provider
replies, terminal commands, scheduler runs, and shell execs are marked
interrupted and are not replayed.

The restore-aware CLI path uses a Host config-dir local service-control token
over loopback to call `POST /admin/restart-prepare`. The token is not dashboard
auth, is not user-editable product config, and must not be accepted from remote
browser clients.

`oysterun uninstall` is the user-facing cleanup command. It performs
idempotent managed-service cleanup and preserves user data by default:

```bash
oysterun uninstall
```

Config directory deletion is allowed only when the user provides the exact
confirmation token:

```bash
oysterun uninstall --confirm DELETE
```

The uninstall command must not delete the configured Default Browse Root or
agent folders. It should explain that those folders are preserved and can be
removed manually only when the user intends to remove their project data. The
command also leaves the globally installed npm package in place and should
print `npm uninstall -g oysterun` as the follow-up command for removing the CLI
package itself.

macOS uninstall removes the launchd LaunchAgent, clears managed runtime pid and
origin state, and remains safe when the service is already absent. Linux has no launchd LaunchAgent; the same command still clears managed pid/origin runtime
state and reports that no launchd service existed.

## QR Login Contract

The setup QR is a convenience login/bootstrap path. It should contain enough
information for the app to connect and log in without typing IP:port/password:

```text
direct_host_url
one-time login/bootstrap token
```

The terminal QR should use the smallest app-compatible payload. In Stage 1 this
is `u` for Host URL and `b` for the one-time login/bootstrap token. Host ID,
Host display name, and expiry are product state shown or fetched separately, not
required QR fields. The one-time token should expire after 15 minutes.

Host Preferences must provide a "generate login QR" action for later pairing or
re-login. It creates a new short-lived token and displays the QR.

Scanning the QR must not make `installation_id` into Host product login auth.
Host product login remains:

```text
- Host password, or
- Host-owned one-time QR/bootstrap token
```

## Cloud Identity Storage Contract

The production Cloud API endpoint is a tracked code default, not Host user
config:

```text
host-service/config.mjs
PRODUCT_CLOUD_BACKEND_URL = https://api.oysterun.com
```

`config.json` stores user/deployment preferences. It must not persist
`backend_url`, `device_token`, or other Host Cloud identity credentials.

Host Cloud identity is stored in:

```text
<host_config_dir>/cloud_identity.json
```

That file stores:

```text
device_id
device_token
registered_at
cloud_registration_state
```

Host Preferences may show Cloud registration status, but must not expose a
user-editable Cloud backend URL or token field.

## Phone App First Page Contract

Stage 1 phone app first page should support:

```text
1. Scan QR code.
2. Manual Host URL/IP:port + password login.
3. Open saved Host.
```

Open saved Host should show the saved Host display name and URL. Selecting a
saved Host fills the login page fields or opens the saved Host according to
whether durable auth is still valid.

Logout from the phone app should return to the phone app bootstrap/login page,
not to the web dashboard login page.

## Web Login Contract

Web login should remain Host-local:

```text
- password only
- no username field in product UI
- dashboard user is admin internally
```

The web login page is separate from the phone app bootstrap/login shell.

## Host Preferences Runtime Settings

Host Preferences may allow changing Host URL/IP:port and related connection
settings. For settings that require process restart:

```text
1. Save the setting.
2. Show a clear "restart required" notice.
3. Provide a restart action.
4. After restart, redirect or instruct the user to open the new URL.
```

Runtime edits must not require rebuilding the phone app. Capacitor sync/build
is only for app code changes, not day-to-day Host/IP changes.

## Host Update Control

Host Preferences may expose package update controls for npm installs:

```text
current Oysterun version
update channel, such as latest or beta
latest version from npm registry after manual check
Check for updates
Update now
```

Update now is explicit. It must not run automatically on startup.

First implementation:

```text
1. Owner clicks Check for updates.
2. Host queries npm registry for the selected channel.
3. If a newer version exists, Host enables Update now.
4. Owner clicks Update now and confirms the restart warning.
5. Host runs npm install -g oysterun@<channel>.
6. Host restarts through the same service restart path.
```

Update now is supported only on the production npm Host stack. Dev/test stacks
may show version and check status, but must not mutate the global npm package.

Until runtime restore is implemented, update/restart UI must warn:

```text
Updating restarts Oysterun Host. Existing live runtime sessions and running
loops will close; chat history remains and supported sessions can be resumed
from Sessions after restart.
```

## Stage 2 Direction

Stage 2 may add:

- Oysterun tunnel connection option
- Host list / multi-Host details
- biometric unlock

Stage 2 must not rewrite Stage 1 notification identity. The app installation
identity and APNs registration model should remain compatible.
