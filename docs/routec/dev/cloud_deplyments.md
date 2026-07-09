# Route C Cloud And Site Deployment Contract

This document is the production-facing deployment contract for the Stage 1
Oysterun Cloud backend and the public Oysterun landing site currently served
from the same droplet. It records the intended product deploy path, not every
historical experiment.

Last checked against the live droplet on 2026-06-30 through a dedicated tmux SSH
session to `root@68.183.190.51`.

## Scope

Stage 1 Cloud provides:

- app installation identity APIs
- direct-IP Host registration and pairing APIs
- APNs token registration storage
- notification candidate intake
- APNs delivery

Stage 1 Cloud does not provide the product tunnel. Host chat traffic still uses
the user's direct Host URL/IP:port.

The same droplet currently also serves the public product landing site for:

```text
https://oysterun.com
https://www.oysterun.com
```

That public site is static content from `static/site/`, deployed under
`/opt/oysterun-site` and served by Caddy.

## Local Secret Workspace

Local deploy secrets must live in a repo-local ignored folder:

```text
.secrets/
  cloud_backend.env
  database_url
  AuthKey.p8
  cloud_metrics_admin_password
```

The checklist template is tracked:

```text
.secrets.example/cloud_backend.env.example
```

`.secrets/cloud_backend.env` is a shell env file. It stores deploy variables
such as:

```text
OYSTERUN_CLOUD_SSH_TARGET
OYSTERUN_CLOUD_PUBLIC_URL
OYSTERUN_CLOUD_LOCAL_DATABASE_URL_FILE
OYSTERUN_CLOUD_LOCAL_APNS_P8_KEY_FILE
OYSTERUN_CLOUD_LOCAL_METRICS_ADMIN_PASSWORD_FILE
OYSTERUN_CLOUD_APNS_KEY_ID
OYSTERUN_CLOUD_APNS_TEAM_ID
OYSTERUN_CLOUD_APNS_BUNDLE_ID
OYSTERUN_CLOUD_APNS_TOPIC_KEY_FILES
OYSTERUN_CLOUD_APNS_SANDBOX
OYSTERUN_CLOUD_APP_ATTEST_*
```

The `.p8` content is not stored in an env var. The env file points to a local
ignored `.p8` file. The deploy script uploads that file to the Cloud host as a
root-only secret file.

## Cloud Runtime Secret Location

On the Cloud host, runtime secrets live outside the release directory:

```text
/etc/oysterun-cloud/database_url
/etc/oysterun-cloud/AuthKey.p8
/etc/oysterun-cloud/apple_developer/AuthKey_<KEYID>.p8
/etc/oysterun-cloud/metrics_admin_password
/etc/oysterun-cloud/oysterun-cloud.env
```

The backend service reads:

```text
OYSTERUN_DATABASE_URL_FILE=/etc/oysterun-cloud/database_url
OYSTERUN_APNS_P8_KEY_FILE=/etc/oysterun-cloud/AuthKey.p8
OYSTERUN_METRICS_ADMIN_PASSWORD_FILE=/etc/oysterun-cloud/metrics_admin_password
```

APNs signing config uses an explicit topic-specific key map:

```text
OYSTERUN_APNS_KEY_ID
OYSTERUN_APNS_TEAM_ID
OYSTERUN_APNS_TOPIC_KEY_FILES
```

`OYSTERUN_APNS_TOPIC_KEY_FILES` is a comma-separated `topic=path` map. The
backend requires every APNs token to carry its own topic and environment. It
chooses the p8 file by APNs token topic, derives the Apple Key ID from
`AuthKey_<KEYID>.p8`, and chooses the APNs endpoint from token environment.
Cloud dispatch must not fall back to a fixed bundle ID, fixed APNs environment,
or global p8 key. Current expected mapping on the Cloud host:

```text
com.oysterun.phone=/etc/oysterun-cloud/apple_developer/AuthKey_5698DUXF2F.p8
com.oysterun.phone.dev=/etc/oysterun-cloud/apple_developer/AuthKey_V28LC8T2Q3.p8
com.oysterun.phone.beta=/etc/oysterun-cloud/apple_developer/AuthKey_7QHMWQ8A3P.p8
```

Per-device APNs tokens are not env vars. They are stored in the Cloud DB.

The metrics dashboard password is a founder-stage plaintext password file by
Owner decision. Initial value is `0000`. Update the ignored local source file
before `secrets:install`:

```text
.secrets/cloud_metrics_admin_password
```

The deploy script copies it to:

```text
/etc/oysterun-cloud/metrics_admin_password
```

Do not commit this password file and do not print its content in logs.

Live droplet check on 2026-06-30:

```text
/etc/oysterun-cloud/metrics_admin_password exists
owner/group: root/root
mode: 600
size: 5 bytes
content check: equals documented initial value 0000 after trimming newline
```

This confirms the current live state still matches the founder-stage initial
metrics dashboard password contract. Do not print the file content in logs or
reports.

## Deployment Script

The deploy entrypoint is:

```bash
tool_scripts/cloud_backend.sh
```

The script automatically sources this file when present:

```text
.secrets/cloud_backend.env
```

Normal commands:

```bash
tool_scripts/cloud_backend.sh secrets:status
tool_scripts/cloud_backend.sh secrets:install
tool_scripts/cloud_backend.sh deploy
tool_scripts/cloud_backend.sh status
tool_scripts/cloud_backend.sh restart
tool_scripts/cloud_backend.sh logs
tool_scripts/cloud_backend.sh smoke
```

## Current Stage 1 Deploy Method

The current Stage 1 deploy method is local artifact upload, not git pull.

Deploy steps:

```text
1. Read the local git commit.
2. Package backend/ into backend.tar.gz.
3. Exclude local/generated files:
     backend/.venv
     backend/.pytest_cache
     backend/__pycache__
     backend/test_oysterun.db
     */__pycache__
4. scp backend.tar.gz to:
     /opt/oysterun-cloud/releases/<timestamp>-<commit>/backend.tar.gz
5. Extract it on the Cloud host.
6. Run uv sync --no-dev on the Cloud host.
7. Update:
     /opt/oysterun-cloud/current -> selected release
8. Write/update:
     /etc/systemd/system/oysterun-backend.service
9. Ensure required secret files exist.
10. Restart the systemd service.
11. Smoke:
      GET https://api.oysterun.com/health
      GET https://api.oysterun.com/api/metrics/summary?days=1&oysterun_stage=prod
      GET https://api.oysterun.com/admin/metrics
```

The release symlink exists so the systemd unit has a stable path:

```text
/opt/oysterun-cloud/current/backend
```

Each release keeps a timestamp and commit. Rollback is done by pointing
`current` back to a previous release and restarting the service.

## Observed Backend Runtime State

Live droplet check on 2026-06-30:

```text
host: oysterun-frps-poc
OS: Ubuntu 24.04.4 LTS
public IP: 68.183.190.51
root filesystem: 83% used
memory: 458 MiB total, about 255 MiB available during inspection
```

Backend release state:

```text
/opt/oysterun-cloud/current
  -> /opt/oysterun-cloud/releases/20260607T164846Z-62e797bad0d1

/opt/oysterun-cloud/current/REVISION
  62e797bad0d1
```

Runtime service:

```text
systemd unit: oysterun-backend.service
status: active/enabled
working directory: /opt/oysterun-cloud/current/backend
environment file: /etc/oysterun-cloud/oysterun-cloud.env
exec: uv run python -m uvicorn app.main:app --host 127.0.0.1 --port 8001
local health: curl -fsS http://127.0.0.1:8001/health -> {"status":"ok"}
```

The droplet keeps many backend releases under `/opt/oysterun-cloud/releases`.
This matches the local artifact upload and `current` symlink deployment model.

## DNS And Caddy

The Cloud API public URL is:

```text
https://api.oysterun.com
```

DNS must point:

```text
api.oysterun.com A 68.183.190.51
```

On the droplet, Caddy routes:

```text
oysterun.com, www.oysterun.com -> /opt/oysterun-site/current
*.oysterun.com -> 127.0.0.1:7500
api.oysterun.com -> 127.0.0.1:8001
```

The backend service should bind to localhost:

```text
127.0.0.1:8001
```

Do not use the old temporary `oysterun-cloud.service` / port `8000` path for
normal deploy verification.

## Public Landing Site Deployment

Caddy currently serves the public static landing site from:

```text
/opt/oysterun-site/current
  -> /opt/oysterun-site/releases/20260630T133024Z-7473981ae652
```

Observed on 2026-06-30:

```text
Caddy route:
  oysterun.com, www.oysterun.com
  root * /opt/oysterun-site/current
  encode zstd gzip
  try_files {path} {path}/index.html /index.html
  file_server

Deployed install snippets contain:
  npm install -g oysterun@latest --prefer-online
```

No reusable site deploy helper script was found on the droplet under `/opt`,
`/root`, or `/usr/local/bin` during the 2026-06-30 inspection. The observed live
site deployment model is local artifact upload into a timestamped release
directory, followed by updating `/opt/oysterun-site/current`.

Current source of truth for the public site content:

```text
static/site/
```

Manual static site deployment contract:

```bash
cd <repo-root>
release_id="$(date -u +%Y%m%dT%H%M%SZ)-$(git rev-parse --short=12 HEAD)"
archive="/tmp/oysterun-site-${release_id}.tar.gz"

tar -C static/site -czf "${archive}" .
ssh root@68.183.190.51 "mkdir -p '/opt/oysterun-site/releases/${release_id}'"
scp "${archive}" root@68.183.190.51:/tmp/oysterun-site.tar.gz
ssh root@68.183.190.51 "tar -xzf /tmp/oysterun-site.tar.gz -C '/opt/oysterun-site/releases/${release_id}' && ln -sfn '/opt/oysterun-site/releases/${release_id}' /opt/oysterun-site/current"
```

After deploying the static site, verify:

```bash
curl -fsS https://oysterun.com >/tmp/oysterun-site-home.html
grep -n "npm install -g oysterun" /tmp/oysterun-site-home.html
curl -fsS https://oysterun.com/privacy/ >/dev/null
```

Rollback is done by repointing `/opt/oysterun-site/current` to a previous
directory under `/opt/oysterun-site/releases`.

## Per-Deploy Verification Checklist

Every deploy must verify:

```text
1. Deployed revision
   cat /opt/oysterun-cloud/current/REVISION

2. Service active
   systemctl is-active oysterun-backend.service

3. Public health
   curl -fsS https://api.oysterun.com/health

4. Public metrics summary route
   curl -fsS 'https://api.oysterun.com/api/metrics/summary?days=1&oysterun_stage=prod'

5. Metrics dashboard login page
   curl -fsS https://api.oysterun.com/admin/metrics

6. Secret presence, redacted
   tool_scripts/cloud_backend.sh secrets:status

7. DB-backed smoke
   app installation challenge/register/me
   Host direct registration
   bootstrap token
   app pairing

8. Logs have no startup error
   journalctl -u oysterun-backend.service
```

Public site deploys must additionally verify:

```text
1. Caddy active
   systemctl is-active caddy

2. Current site release
   readlink -f /opt/oysterun-site/current

3. Public home page reachable
   curl -fsS https://oysterun.com

4. Public privacy page reachable
   curl -fsS https://oysterun.com/privacy/

5. Install command is current
   grep -n "npm install -g oysterun" /opt/oysterun-site/current/index.html
```

## Stage Selector

The production Cloud endpoint remains:

```text
https://api.oysterun.com
```

Stage selection is done per request with query parameter:

```text
oysterun_stage=prod | beta | dev
```

Rules:

```text
missing query parameter -> prod
invalid stage -> 400
first version uses one Cloud database with cloud_stage columns
do not split DB/schema for prod/beta/dev in Stage 1
Host debug override lives in <host_config_dir>/config.debug.json
normal user config.json does not store the stage
```

Examples:

```text
https://api.oysterun.com/api/device/register
https://api.oysterun.com/api/device/register?oysterun_stage=dev
```

Do not encode the stage into the base URL. Host/app clients append endpoint
paths and should call a stage-aware URL builder.

## Metrics Dashboard

Dashboard URL:

```text
https://api.oysterun.com/admin/metrics
```

The first version uses password-only login and a HttpOnly cookie. Password
source:

```text
local ignored source: .secrets/cloud_metrics_admin_password
remote runtime file:  /etc/oysterun-cloud/metrics_admin_password
initial value:        0000
```

Metrics storage:

```text
cloud_metric_samples
  bucket_start_at
  bucket_seconds = 300
  metric_name
  cloud_stage
  dimensions_json
  value
  created_at
```

First-version charted metrics:

```text
http_requests_total
http_request_duration_ms
system.cpu_usage_percent
system.memory_used_percent
system.disk_root_used_percent
process.memory_rss_mb
```

Dashboard charts:

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

Chart layout is two cards per row on desktop/tablet and one card per row on
small screens. Each chart shows y-axis min/max ticks and x-axis first/last
bucket labels. Percent charts use a fixed 0% to 100% y-axis.
The APNs deliveries chart belongs in the first Operational Charts block. The
second APNs Deliveries block is for the latest sanitized delivery table only.

Each chart card has its own range controls:

```text
1h
1d
1w
1m
```

The `1m` range maps to the current 30-day retention window. Changing a single
chart range does not force every other chart to change range.

System metrics are sampled by the backend at most once per stage/bucket during
normal request metrics collection. They are operational health gauges, not user
analytics.

Retention:

```text
30 days
```

The dashboard must not expose raw APNs tokens, device tokens, password hashes,
chat content, notification body content, or APNs p8 material.

Real iPhone APNs delivery is not required for every deploy. It is required
when any of these change:

```text
- p8 / Key ID / Team ID
- bundle id / APNs topic
- sandbox/prod environment
- APNs token registration flow
- notification candidate schema or payload builder
- APNs sender code
- notification tap route metadata
```

## iOS Bundle Identity Contract

The iOS bundle id used for App Attest registration and APNs topic selection is
owned by the native app build. The web client must resolve it from
`App.getInfo().id` through the registered `@capacitor/app` native plugin.

Host config must not store iOS bundle identity, and Host notification bootstrap
must not return an `app_bundle_id` fallback. If `App.getInfo().id` is unavailable
inside the iOS app, that is an app packaging/plugin-registration defect and must
fail visibly instead of being hidden by Host runtime config.

## Future Product Deployment Direction

The current local-artifact deploy is acceptable for Stage 1 beta/manual
operation. The product deployment path should later move to:

```text
GitHub commit/tag/release
  -> CI test
  -> release artifact or container image
  -> Cloud deploy
  -> DB migration
  -> health/smoke
  -> metrics smoke
  -> rollback point
  -> metrics check
```

Until that exists, `tool_scripts/cloud_backend.sh` is the owning backend
deployment entrypoint. The public static landing site is still deployed through
the manual `/opt/oysterun-site/releases` and `/opt/oysterun-site/current`
artifact process documented above.
