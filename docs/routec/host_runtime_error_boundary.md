# Route C Host Runtime Error Boundary

Status: P99 source contract.

This document defines the P99 Host runtime hardening contract for required
config failures, runtime JSON persistence, Matrix facade request boundaries,
optional proof artifacts, live runtime metadata, stale lifecycle artifact
visibility, and last-resort fatal diagnostics.

## Required Config

Host product config is a required structured file once present. Invalid JSON in
`config.json` must fail visibly with the file path and parse error. Runtime
normalization errors must also keep the `config.json` path in the raised error.

Missing `config.json` can still bootstrap from source defaults. Invalid
required config must not be hidden by fallback defaults.

## Atomic Runtime Writes

Host-owned runtime JSON stores use same-directory temporary files followed by
rename. The accepted P99 first implementation covers:

```text
host-service/config.mjs
host-service/agent-registry.mjs
host-service/matrix-room-binding.mjs
host-service/apns-device-store.mjs
host-service/session-notification-settings-store.mjs
```

The write helper removes its temporary file on failure and does not write
through package, prompt, or source-tree evidence locations.

## Matrix Request Boundary

The Host HTTP request boundary awaits Route C Matrix facade handlers. Unexpected
Matrix facade exceptions are captured as Host runtime diagnostics and return a
bounded Matrix-style 500 response when no response has started.

The response must not expose raw secrets. Existing semantic Route C control
errors keep their existing status and payload shape.

## Optional Artifacts

Route C proof, transcript, and diagnostic artifact writes are optional side
effects. Artifact write failures must be captured as diagnostics and must not
break the product request they are observing.

Product runtime JSON stores are not optional artifacts; they retain their
required failure semantics.

## Runtime Metadata

On Host listen, Host writes redacted runtime metadata under the active Host run
directory. Stack Host config directories use:

```text
~/.oysterun-stacks/<stack>/run/host-runtime.json
```

Non-stack Host config directories use:

```text
<host_config_dir>/run/host-runtime.json
```

`/admin/runtime-status` reports the metadata path and parsed metadata when
available. Missing or unreadable metadata is visible in the status payload.

## Stale Script PID And Origin Artifacts

P99 treats stale service script pid/origin files as report-only. P99 must not
clean, rewrite, or migrate lifecycle-owned pid/origin artifacts.

The Host runtime metadata/status payload records:

```text
script_pid_origin_files_report_only: true
stale_script_pid_origin_cleanup_performed: false
```

## Fatal Diagnostics

`uncaughtException` and `unhandledRejection` handlers are last-resort
diagnostics only. They append a fatal diagnostic with controlled-exit metadata
and schedule process exit. They do not replace request-level error handling or
turn fatal errors into successful requests.
