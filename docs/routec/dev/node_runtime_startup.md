# Node Runtime Startup

Status: P193 source contract.

Oysterun service startup requires Node.js >=20. The public commands remain:

```text
oysterun service:start
oysterun service:restart
oysterun service:restart --restore-sessions
oysterun service:install
```

The npm `oysterun` command itself still uses `#!/usr/bin/env node`, so the
invoking shell must be able to start Node before JavaScript code can run.
Service scripts add a second runtime preflight for Host-managed paths.

## Resolution Order

Service scripts resolve Node in this order:

1. `OYSTERUN_NODE_BIN`, when it is set to an executable file.
2. `command -v node`.
3. `which node`.
4. Common install paths:
   - `/opt/homebrew/bin/node`
   - `/usr/local/bin/node`
   - `$HOME/.local/bin/node`
   - `$HOME/bin/node`

The resolved executable must report Node.js >=20 through `--version`. Missing,
non-executable, unparsable, or older Node runtimes fail before Host startup.
Diagnostics include the attempted/resolved path and version, but do not dump raw
environment variables or credentials.

## LaunchAgent Behavior

macOS LaunchAgents do not source interactive shell files such as `.zshrc`,
`.profile`, nvm, asdf, or volta initialization scripts. During
`oysterun service:install`, Oysterun writes the resolved Node path into the
LaunchAgent as `OYSTERUN_NODE_BIN`.

If that path later disappears or stops being executable, the service fails with
a bounded diagnostic. Reinstall/update the service or set `OYSTERUN_NODE_BIN`
to a valid Node.js >=20 executable before retrying.

## Update And Restart Jobs

Host Preferences update/restart jobs do not rely on `oysterun` being discoverable
on `PATH`. They schedule restart through an absolute Node executable and the
absolute `bin/oysterun.mjs` path while preserving the active stack through
`OYSTERUN_RELEASE_STACK` and `OYSTERUN_STACK`.

This keeps user-facing service commands unchanged while making background
restart behavior deterministic in sparse launchd-like environments.
