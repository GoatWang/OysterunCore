export const COMPLETE_MESSAGE_PROVIDER_COMPLETION_MARKER =
  "oysterun_provider_complete_message_notification_v1";

export const COMPLETE_MESSAGE_PROVIDER_COMPLETION_PENDING_STATE =
  "pending_turn_completion";

export const COMPLETE_MESSAGE_PROVIDER_COMPLETION_COMPLETED_STATE =
  "turn_completed";

export const COMPLETE_MESSAGE_PROVIDER_COMPLETION_FAILED_STATE = "turn_failed";

export const COMPLETE_MESSAGE_PROVIDER_COMPLETION_INTERRUPTED_STATE =
  "turn_interrupted";

const FAILED_PROVIDER_COMPLETION_STATUSES = new Set([
  "failed",
  "error",
  "errored",
]);

const INTERRUPTED_PROVIDER_COMPLETION_STATUSES = new Set([
  "interrupted",
  "interrupt",
  "canceled",
  "cancelled",
]);

export function normalizeProviderCompletionStatus(value) {
  return typeof value === "string" && value.trim()
    ? value.trim().toLowerCase()
    : "completed";
}

export function providerCompletionStateForStatus(value) {
  const status = normalizeProviderCompletionStatus(value);
  if (FAILED_PROVIDER_COMPLETION_STATUSES.has(status)) {
    return COMPLETE_MESSAGE_PROVIDER_COMPLETION_FAILED_STATE;
  }
  if (INTERRUPTED_PROVIDER_COMPLETION_STATUSES.has(status)) {
    return COMPLETE_MESSAGE_PROVIDER_COMPLETION_INTERRUPTED_STATE;
  }
  return COMPLETE_MESSAGE_PROVIDER_COMPLETION_COMPLETED_STATE;
}

export function isSuccessfulProviderCompletionStatus(value) {
  return (
    providerCompletionStateForStatus(value) ===
    COMPLETE_MESSAGE_PROVIDER_COMPLETION_COMPLETED_STATE
  );
}
