# Provider Startup Diagnostics

Status: P192 provider startup preflight and durable error visibility contract.

P192 keeps provider startup failures visible before a broken provider runtime can
create an empty or unusable session shell. Host performs a bounded startup
preflight before `sessionManager.start()` when Session Setup starts a provider
runtime.

## Preflight Contract

Host records structured `[provider-startup]` log lines for startup attempts.
The lines are single JSON objects with redacted stdout/stderr tails and bounded
environment summaries. They must not include tokens, API keys, passwords,
cookies, authorization headers, raw environment dumps, or other secret material.

Required event names:

```text
preflight_start
preflight_pass
preflight_fail
session_start_request
session_start_response
session_ready
runtime_error_before_ready
early_exit_before_ready
early_exit_after_ready_grace
```

Required diagnostic fields include attempt id, provider, agent id, cwd, session
id candidate, configured command, resolved command, HOME, bounded PATH summary,
provider home, phase, duration, success flag, error code, redacted message,
redacted stdout/stderr tails, exit code, signal, history_written, and ready.

## Provider Rules

Codex startup preflight resolves the configured command, starts
`codex app-server --listen stdio://`, sends the JSON-RPC `initialize` request,
requires a response within the bounded timeout, sends `initialized` on success,
and terminates the preflight child.

Claude startup preflight resolves the configured command and records auth status
diagnostics through the existing provider auth manager. `auth_required` remains
an in-chat recovery condition and is not treated as a generic startup failure by
itself. Chat `/session/send` does not special-case Claude `/login`; users log in
from a machine terminal or `/app/terminal`, then use Restart session.

## P310 Start Binding And Claude Startup Readiness

P310 requires a successful `POST /session/start` response to prove the Route C
Matrix room binding before the response is returned. A start response includes
`chat_shell_ready`, `provider_ready`, `routec_matrix_binding_ready`, and
`routec_matrix_binding_materialized_before_session_start_response`. If the
binding cannot be created, Host stops the just-started runtime and returns
`routec_session_start_matrix_binding_required` instead of advertising a usable
session.

`chat_shell_ready` means the Host session shell can be opened. `provider_ready`
means the provider runtime emitted its ready event. Claude keeps the shell ready
for `/login` before ACP `session.ready`, but `provider_ready` stays false until
that ACP readiness signal is received.

Claude startup preflight also verifies managed ACP runner readiness. Missing ACP
materialization returns a structured `claude_acp_startup_readiness` failure
before a start response. Claude auth status parsing accepts structured
`claude auth status` JSON from stdout even when the CLI exits nonzero, so
login-required and authenticated states remain visible instead of collapsing
into an opaque unknown status.

## Session Setup Error

Fatal preflight failures return before history or live-session creation. Session
Setup must render:

```text
Provider startup failed before the session was created.
See provider startup diagnostics:
grep '\[provider-startup\]' ~/.oysterun/logs/oysterun-host.log | tail -n 80
```

Later runtime errors and early exits that occur after session start still emit
durable `[provider-startup]` diagnostics so support can distinguish preflight
failure, before-ready runtime error, before-ready exit, and after-ready grace
exit.
