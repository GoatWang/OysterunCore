# Host PostHog Daily Telemetry

P314 adds the Owner permission surface for Host daily telemetry. P315 adds the
first Host-side daily aggregate sender.

## Consent

`oysterun setup` asks:

```text
Help improve Oysterun?
Enable daily telemetry? (Y/n)
```

The same setting is available in Host Preferences. The value is stored in the
Host config as:

```json
{
  "daily_telemetry_enabled": true,
  "daily_telemetry_consent_recorded_at": "2026-07-08T00:00:00.000Z"
}
```

Host Preferences saves take effect immediately for later telemetry writes and
send attempts. A Host restart is not required.

## Send Gates

The sender checks current Host config before each send attempt:

- if `daily_telemetry_enabled !== true`, send nothing;
- if `host_id` is missing, send nothing;
- do not create a Host ID only for telemetry;
- do not use dashboard tokens, runtime tokens, device tokens, APNs tokens,
  pairing tokens, provider credentials, or any other credential as an identity.

If consent is enabled before Host registration exists, local aggregate counters
may be kept in the bounded local store, but no telemetry leaves the machine
until normal Host registration creates `host_id`.

## Event

PostHog event:

```text
host_daily_telemetry_report
```

PostHog `distinct_id` is the same Host ID as `properties.host_id`.

## Payload

The payload is one aggregate event per Host local date:

```json
{
  "schema_version": 1,
  "host_id": "host_xxxxx",
  "date": "2026-07-08",
  "app_version": "1.4.4",
  "host_os": "darwin",
  "host_arch": "arm64",
  "node_major": 22,
  "host_active_today": true,
  "session_started_count": 0,
  "session_resumed_count": 0,
  "session_branch_resumed_count": 0,
  "session_restarted_count": 0,
  "session_stopped_count": 0,
  "session_interrupted_count": 0,
  "user_message_sent_count": 0,
  "provider_turn_completed_count": 0,
  "provider_auth_required_count": 0,
  "provider_start_failed_count": 0,
  "approval_request_count": 0,
  "approval_accepted_count": 0,
  "approval_rejected_count": 0,
  "tool_call_count": 0,
  "tool_result_count": 0,
  "large_tool_output_count": 0,
  "scheduler_schedule_created_count": 0,
  "scheduler_schedule_updated_count": 0,
  "scheduler_schedule_deleted_count": 0,
  "scheduler_run_count": 0,
  "scheduler_run_success_count": 0,
  "scheduler_run_failed_count": 0,
  "notification_send_requested_count": 0,
  "notification_send_cloud_accepted_count": 0,
  "notification_send_failed_count": 0,
  "notification_bootstrap_created_count": 0,
  "mail_created_count": 0,
  "mail_read_count": 0,
  "mail_archived_count": 0,
  "mail_deleted_count": 0,
  "website_init_count": 0,
  "website_access_changed_count": 0,
  "website_password_set_count": 0,
  "terminal_opened_count": 0,
  "terminal_input_sent_count": 0,
  "file_explorer_opened_count": 0,
  "file_preview_count": 0,
  "html_preview_count": 0,
  "folder_created_count": 0,
  "demo_agent_created_count": 0,
  "feature_usage": {
    "sessions": 0,
    "session_setup": 0,
    "chat": 0,
    "file_explorer": 0,
    "file_preview": 0,
    "html_preview": 0,
    "mail": 0,
    "scheduler": 0,
    "terminal": 0,
    "host_preferences": 0,
    "agent_profile": 0,
    "browser_site": 0,
    "website_settings": 0,
    "telegram_settings": 0,
    "notifications_settings": 0,
    "tool_detail": 0
  }
}
```

`feature_usage` is an aggregate usage counter. It is not a unique visitor,
unique session, or unique page-view metric.

## Local Store

The local store is under the Host config directory:

```text
<OYSTERUN_CONFIG_DIR>/telemetry/daily-usage.json
```

Override for tests:

```text
OYSTERUN_HOST_TELEMETRY_STORE_PATH=/tmp/daily-usage.json
```

The store keeps date-bucketed aggregate counters with 30-day retention.
Counter write failures are logged as redacted warnings and do not fail the user
action that triggered the counter.

## Excluded Data

The Host daily payload must never include:

- chats, prompts, assistant responses, Matrix event bodies, or message IDs;
- tool arguments, tool output, tool result bodies, or tool names;
- file names, file paths, folder paths, project names, repository names, or file
  extensions;
- terminal command text, terminal output, shell cwd, or environment variables;
- provider credentials, provider auth output, dashboard tokens, runtime tokens,
  pairing tokens, APNs tokens, device tokens, or secrets;
- notification title/body/route payload;
- mail subject/body/sender/recipient;
- website passwords;
- cloud app registration, Host/app pairing, APNs registration, or APNs delivery
  details.

## Cloud Boundary

This phase does not add Cloud registration metrics, APNs token registration
metrics, Host/app pair success metrics, or APNs delivery metrics.

Host notification counters are limited to the Host request boundary:

- send requested;
- Cloud candidate request accepted by Cloud;
- Host-observed send failure.

They do not claim APNs delivery success.

## PostHog Configuration

Default capture endpoint:

```text
https://us.i.posthog.com/capture/
```

The project token is the public project token used for capture. It can be
overridden for local testing:

```bash
OYSTERUN_HOST_POSTHOG_API_HOST=https://us.i.posthog.com \
OYSTERUN_HOST_POSTHOG_PROJECT_TOKEN=phc_xxx \
node host-service/test-host-telemetry.mjs
```

## Verification

Focused checks:

```bash
node --check host-service/host-telemetry.mjs
node --check host-service/server.mjs
node --check host-service/setup.mjs
node host-service/test-host-telemetry.mjs
node dev/client/web/build-index.mjs
```

Manual verification:

1. Open Host Preferences.
2. Confirm the `Help improve Oysterun?` card is visible.
3. Toggle daily telemetry and save.
4. Confirm the value persists after reloading Host Preferences.
5. Confirm disabling the setting prevents later sends without restarting Host.
