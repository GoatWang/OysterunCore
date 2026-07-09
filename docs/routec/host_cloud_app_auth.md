# Route C Host / Cloud / App Auth Contract

This document records the Stage 1 auth and storage contract for direct-IP Host
connectivity with Cloud-mediated APNs notification.

## Source Of Truth

Production Cloud endpoint is a git-tracked code default:

```text
host-service/config.mjs
PRODUCT_CLOUD_BACKEND_URL = https://api.oysterun.com
```

It is not a Host Preferences field and is not user-editable product config.
Local Cloud development must use an explicit internal override:

```text
OYSTERUN_BACKEND_URL
setup.mjs --backend-url <url>
```

Cloud stage selection is a debug/internal override, not a user product setting:

```text
<host_config_dir>/config.debug.json
  debug_cloud_backend_stage: "prod" | "beta" | "dev"
```

The Host/app append this as a query parameter to Cloud calls:

```text
oysterun_stage=<stage>
```

Missing debug config means `prod`. `config.json` must not persist the Cloud
stage.

## Host Runtime Files

Host user/deployment preferences live in:

```text
<host_config_dir>/config.json
```

`config.json` must not persist:

```text
backend_url
device_id
device_token
host_id
host_credential
registered_at
```

Host Cloud identity lives in:

```text
<host_config_dir>/cloud_identity.json
```

`cloud_identity.json` is not a user preference file. It stores Host-to-Cloud
credential state:

```text
device_id
device_token
registered_at
cloud_registration_state
```

It may also contain compatibility aliases and registration metadata required by
the Host runtime:

```text
host_id
host_credential
onboarding_token
onboarding_url
device_signing_public_key
device_signing_kid
cloud_public_key
```

For explicit local Cloud development only, `cloud_identity.json` may store a
non-production `backend_url`. Production uses the tracked code default.

## Stage 1 Auth Roles

Host product login is separate from App installation identity:

```text
Host product login:
  Host password, or
  Host-owned one-time QR/bootstrap token.

App installation identity:
  installation_id + installation credential.
  Used for App -> Cloud pairing and APNs token registration.
```

`installation_id` must not become Host product login auth.

## Stage 1 Interaction

Setup:

```text
Host setup
  -> reads product Cloud endpoint from tracked code or explicit dev override
  -> POST /api/device/register
  -> Cloud creates host/device row
  -> Cloud returns device_id + device_token
  -> Host writes device_id/device_token to cloud_identity.json
  -> Host writes user/deployment preferences to config.json
  -> Host terminal shows QR with direct_host_url and one-time login token
```

App login:

```text
App
  -> scans QR or manually enters Host URL + password
  -> authenticates to Host product login
  -> enters Sessions page
```

Manual Host URL entry in the Capacitor runtime bootstrap must be explicit and
diagnostic:

- The app must not hard-code a review or deployment Host URL in the login UI or
  error messages.
- Explicit `http://` and `https://` inputs keep their scheme.
- Bare IP / `localhost` inputs default to `http://` and port `8802` when the
  port is missing.
- Bare domains without a port default to `https://`.
- Bare domains with a port must ask the user to add `http://` or `https://`.
- Email-like input must be rejected as an email address.
- A normalized input must expose `<Host origin>/health` as a Health URL with a
  copy control so users and App Review can verify Host reachability in a
  browser.

Notification bootstrap:

```text
App after Host login
  -> asks Host for notification bootstrap
Host
  -> uses cloud_identity.json device_token to request a short-lived pairing token
Cloud
  -> returns notification_registration_token
App
  -> sends installation_id + credential + notification_registration_token to Cloud
Cloud
  -> pairs installation_id with Host device_id
```

APNs registration:

```text
App
  -> obtains APNs token from iOS when permission allows
  -> registers APNs token with Cloud for host_id + installation_id
Cloud
  -> stores token and later sends APNs
```

Later notification:

```text
Host
  -> observes committed Matrix notification truth
  -> builds bounded title/body/route metadata
  -> POSTs notification candidate to Cloud using device_token
Cloud
  -> validates Host credential
  -> selects paired APNs tokens
  -> signs APNs with Cloud-held p8
  -> persists delivery result
App
  -> receives notification
  -> opens saved direct_host_url and focuses session/message when reachable
```

## Migration Rule

Older `config.json` files may contain `backend_url` or `device_token`. Runtime
config normalization must migrate cloud identity material to
`cloud_identity.json` and remove cloud identity keys from `config.json`.

A stale `config.json` value such as `backend_url=http://localhost:8000` must not
override the tracked production endpoint unless it was explicitly written as a
local development Cloud identity.

Stage selector migration follows the same separation rule: historical or
manual stage overrides belong in `config.debug.json`, never in `config.json`.
