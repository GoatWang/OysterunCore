# Oysterun npm Publish

This document defines the Oysterun Host npm package boundary and publish gate.
It is a release/operator document, not a general npm tutorial.

## Goal

The first public Host install path is:

```bash
npm install -g oysterun
oysterun
```

`npm install -g oysterun` installs package files and exposes the `oysterun`
command. It must not run setup, install a service, start a service, or ask
interactive questions.

## Package Boundary

Do not publish the monorepo root.

The npm package must be built from a clean release staging package. The staging
package is produced by:

```bash
node tool_scripts/package_oysterun_npm.mjs
```

The staging package includes only the Host runtime surface:

```text
package.json
README.md
bin/oysterun.mjs
host-service/
tool_scripts/ required by Host setup/service lifecycle
dev/client/web/ prebuilt dashboard assets
dev/client/web-chat/dist/ prebuilt Route C web-chat assets
static/
docs/routec/ minimal release docs
```

The package must exclude:

```text
backend/
dev/client/phone-app/
dev/client/web-chat/ios/
dev/client/web-chat/src/
<gitignored-operational-notes>/
.secrets/
node_modules/
host-service/node_modules/
dev/client/web-chat/node_modules/
runtime config files
cloud_identity.json
DB/log/jsonl artifacts
Apple .p8 keys
credential_copy/
DerivedData/
```

## Package Name And Command

Target npm package name:

```text
oysterun
```

Target installed command:

```text
oysterun
```

If npm name ownership blocks `oysterun`, choose the fallback package name in a
separate Owner decision. Do not silently publish under another name.

## User Install Journey

Install:

```bash
npm install -g oysterun
```

First run:

```bash
oysterun
```

If required Host config is missing or incomplete, `oysterun` enters setup
automatically.

Explicit setup:

```bash
oysterun setup
```

Setup performs the release onboarding flow:

```text
ask Host display name
ask Host port, default 8802, with next-available fallback if occupied
ask Host URL/IP:port:
  prefer detected Tailscale/VPN or LAN URL
  localhost is only for a browser on the Mac running Oysterun
  iPhone on the same Wi-Fi/LAN should use the Mac LAN IP address
  otherwise use Tailscale, Cloudflare Tunnel, VPN, or another reachable URL
ask Host password with hidden input
confirm first-time Host password by entering it twice
write ~/.oysterun/config.json
create dashboard credential hash
register Cloud direct mode when enabled by release setup
write Host Cloud identity state outside user-editable config
show phone app download/QR step
explain that Host login QR is shown after service start
install service manager integration
start Host by default after explicit setup flow
wait for /health
create and show a fresh 15-minute Host login QR only when Host starts
show/open /app/sessions when browser open is available
```

If setup runs in a headless or SSH environment, it should print the URL instead
of forcing a browser open.

## Service Model

First release target:

```text
macOS launchd LaunchAgent
Linux pid-file managed Host service
```

Linux must not use launchd. The first Linux release path uses the same
config/run/log layout and starts the Host as a detached pid-file managed
process through `oysterun service:start`. A boot-persistent Linux supervisor,
such as a systemd user service, is a later explicit phase and must not be
claimed until verified on Linux.

Service commands:

```bash
oysterun service:start
oysterun service:stop
oysterun service:restart
oysterun service:status
oysterun service:logs
```

Explicit service commands should fail fast when setup has not completed. They
must not silently create config or run setup.

`oysterun service:start` and `oysterun service:restart` print a fresh
15-minute one-time Host login QR after the Host start/restart succeeds.

## Update Control

The npm package must support owner-visible update awareness after install.

Host Preferences may show:

```text
current_version
channel: latest or beta
latest_version after manual npm registry check
Check for updates
Update now
```

Update now must be explicit and restart-aware:

```text
1. Owner clicks Update now.
2. Host confirms that updating restarts Oysterun Host.
3. Host runs npm install -g oysterun@<channel>.
4. Host restarts through the release service path.
5. Host keeps config.json, cloud_identity.json, Matrix history, and agent
   folders untouched.
```

Update now is production-stack only. Dev/test stacks may check npm but must not
mutate the global npm installation from Host Preferences.

Until runtime restore is implemented, the update confirmation must warn that
live runtime sessions and running loops will close, while durable chat history
remains and supported sessions can be resumed from Sessions.

## Cloud Endpoint

The production Cloud endpoint is a git-tracked product constant.

It is not a user-editable Host Preference field and should not be stored as a
normal user-managed runtime config value.

Dev/local Cloud endpoints require an explicit debug config, environment
variable, or setup flag.

Host Cloud identity state belongs in runtime state such as:

```text
<host_config_dir>/cloud_identity.json
```

It must not be bundled into npm packages.

## Maintainer Build And Pack

Before packing, rebuild all prebuilt browser assets in the source worktree:

```bash
npm --prefix dev/client/web-chat run build
node dev/client/web/build-index.mjs
```

This is mandatory before every npm publish. `node
tool_scripts/package_oysterun_npm.mjs` copies the existing
`dev/client/web-chat/dist/` directory into `dist/npm/oysterun`; it does not
build Route C web-chat. If a frontend source fix was made but
`dev/client/web-chat/dist/` is stale, npm will publish the old browser bundle
even though the TypeScript source is correct.

Before continuing, inspect the browser asset diff:

```bash
git diff --stat -- dev/client/web-chat/dist dev/client/web/index.html
```

Do not publish if a browser-facing source fix is expected but the rebuilt
prebuilt asset output is unchanged or missing.

Create staging package:

```bash
node tool_scripts/package_oysterun_npm.mjs
```

Inspect pack contents:

```bash
cd dist/npm/oysterun
npm pack --dry-run
```

Do not continue if the tarball includes any excluded file or directory.

## Publish Gate

Do not publish until all of these pass:

```text
host-service/package.json version is bumped to a never-published npm version
registry version check confirms the exact version is not already published
package boundary exists
packaging script produced clean staging package
npm pack --dry-run passed
tarball content review found no excluded files
clean temp install works
oysterun --help works
oysterun with missing config enters setup
oysterun setup can create config and start Host on macOS
Host /health passes
web login / sessions page works
phone QR/manual login works
```

Only after the gate passes, Owner publishes from the staging package.

The npm package version is generated from:

```text
host-service/package.json
```

The monorepo root `package.json` does not own the public `oysterun` package
version. Before every beta publish, use the fixed prepare script:

```bash
cd <repo-root>
npm run publish:beta:prepare
```

The script is the only normal beta version-bump path. It queries the registry
with `npm view oysterun versions --json`, finds the highest published
`<base>-beta.N` for the current base version, writes `N + 1` to
`host-service/package.json`, and rebuilds `dist/npm/oysterun`.

Do not manually choose the beta number during normal release work, and do not
invent a new one-off version-bump command. npm permanently rejects publishing
over an existing version, for example:

```text
npm error 403 You cannot publish over the previously published versions
```

The script may be dry-run for inspection:

```bash
cd <repo-root>
npm run publish:beta:prepare -- --dry-run
```

Do not run `npm publish` if the prepare script fails. If the current base should
change, pass an explicit base after Owner decides the new train:

```bash
npm run publish:beta:prepare -- --base 0.1.2
```

When a new public stable version is published, verify the public npm dist-tag
before site deployment:

```bash
npm view oysterun dist-tags version --json
```

The public website install/update commands in `static/site/index.html` must use
the general stable channel:

```bash
npm install -g oysterun@latest --prefer-online
```

Do not put a fixed package version such as `oysterun@0.1.1` in the public site,
and do not use `oysterun@beta`. A stable release should move the npm `latest`
dist-tag to the intended general version; the public site should only need an
HTML update when the install command itself changes.

Do not use the deprecated `npm publish --otp <code>` flow as the normal
Oysterun publish path. npm now requires Owner to complete the account auth/2FA
flow directly, so the maintainer should provide the exact command block and let
Owner run the final `npm publish` command in an authenticated terminal.

Owner publish script:

```bash
cd <repo-root>
npm --prefix dev/client/web-chat run build
node dev/client/web/build-index.mjs
git diff --stat -- dev/client/web-chat/dist dev/client/web/index.html
npm run publish:beta:prepare

cd <repo-root>/dist/npm/oysterun
npm pkg get version
npm pack --dry-run
npm login
npm publish --tag beta
```

For stable, replace the last command with:

```bash
npm publish --tag latest
```

## Review Host Install Command

Every beta deploy/publish handoff must include the exact command block for the
review Host:

```text
ssh root@167.172.88.163
```

The command must install/update Oysterun through the P224 non-root runtime user
contract. Do not tell Owner only "npm install"; always provide:

```text
1. first-install command, for a cleaned review Host
2. update command, for an existing review Host that already has the `oysterun`
   user/config
3. the beta version being installed
```

Prefer interactive `oysterun setup` for first install. Do not hand Owner a long
non-interactive setup block unless the task specifically requires reproducible
headless install.

First install after `npm publish --tag beta`:

```bash
ssh root@167.172.88.163

if ! id -u oysterun >/dev/null 2>&1; then
  adduser oysterun
fi
usermod -aG sudo oysterun

su - oysterun
npm config set prefix "$HOME/.local/npm"
export PATH="$HOME/.local/npm/bin:$PATH"
npm view oysterun@beta version
npm install -g oysterun@beta --prefer-online
oysterun --version
oysterun setup
oysterun service:restart --restore-sessions
oysterun service:status
```

Update existing review Host after `npm publish --tag beta`.

This command assumes the `oysterun` user already exists and config is already
valid, so it must not run `adduser` or setup again:

```bash
ssh root@167.172.88.163

su - oysterun
export PATH="$HOME/.local/npm/bin:$PATH"
npm view oysterun@beta version
npm install -g oysterun@beta --prefer-online
oysterun --version
oysterun service:restart --restore-sessions
oysterun service:status
```

Use plain `oysterun service:restart` only when no restore transaction is needed
or when intentionally exercising the raw stop/start service path. Normal
production/review Host update instructions should use
`oysterun service:restart --restore-sessions` so the running Host prepares P76
restart restore state before stop/start.

## Dist Tag Verification And Beta Practice

After publishing, verify registry tags explicitly. The publish success line:

```text
+ oysterun@0.1.0
```

only proves that the version was published. It does not prove which dist-tag was
assigned.

Verification commands:

```bash
npm dist-tag ls oysterun
npm view oysterun dist-tags --json
npm view oysterun@beta version
npm view oysterun@latest version
```

Install-channel smoke:

```bash
npm install -g oysterun@beta
oysterun --help
```

Current first publish result, 2026-06-06:

```text
beta:   0.1.0
latest: 0.1.0
```

This is acceptable for the first public bootstrap package because there was no
previous stable version to preserve. It means both commands install the same
package:

```bash
npm install -g oysterun@beta
npm install -g oysterun
```

Best practice for future beta releases:

```text
Use prerelease semver for beta channel:
  0.1.1-beta.0
  0.1.1-beta.1

Publish those with:
  npm login
  npm publish --tag beta

Keep latest for stable releases only:
  0.1.1
  npm login
  npm publish --tag latest
```

If a future beta publish accidentally moves `latest` away from the last stable
release, restore `latest` explicitly:

```bash
npm dist-tag add oysterun@<last-stable-version> latest
```

Do not use a semver-looking string as a dist-tag. `beta`, `next`, and `canary`
are valid channel names; tags like `v1.4` are not appropriate because npm
dist-tags share the same namespace as versions.

## Manual Product Smoke

After install/setup, maintainers may run a manual Cloud notification smoke.
This is not part of npm install and not part of setup automation.

Purpose:

```text
verify npm-installed Host -> Oysterun Cloud -> Apple APNs -> iPhone app
```

Checklist:

```text
1. Install package in a clean environment.
2. Run oysterun and complete setup.
3. Pair/login the iPhone app with the Host.
4. Enter sessions page.
5. Enable notifications.
6. Confirm app APNs token registration is accepted by Cloud.
7. Click Send test notification.
8. Confirm iPhone receives the test notification.
9. Run a provider complete-message flow.
10. Confirm iPhone receives the complete-message notification.
```

The iPhone app obtains the APNs token from Apple and registers it with Cloud.
The Host does not own APNs tokens or Apple `.p8` keys. The Host only submits
notification candidates to Cloud.

## Rollback

npm unpublish has strict registry limitations and should not be the normal
rollback path.

Preferred rollback:

```text
publish a patched version
deprecate the bad version with npm deprecate
tell users to install a known good version or tag
```
