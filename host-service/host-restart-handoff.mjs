export const HOST_RESTART_HANDOFF_SECONDS = 10;
export const HOST_RESTART_HANDOFF_MS = HOST_RESTART_HANDOFF_SECONDS * 1000;

function requireFiniteTimestamp(value, label) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`${label} must be a finite timestamp`);
  }
  return timestamp;
}

export function createHostRestartHandoff(nowMs = Date.now()) {
  const acceptedAtMs = requireFiniteTimestamp(nowMs, "handoff accepted time");
  return {
    handoff_started_at: new Date(acceptedAtMs).toISOString(),
    execute_not_before: new Date(
      acceptedAtMs + HOST_RESTART_HANDOFF_MS
    ).toISOString(),
    handoff_seconds: HOST_RESTART_HANDOFF_SECONDS,
  };
}

export function getHostRestartHandoffDelayMs(
  executeNotBefore,
  nowMs = Date.now()
) {
  const deadlineMs = Date.parse(String(executeNotBefore || ""));
  if (!Number.isFinite(deadlineMs)) {
    throw new Error("restart execute_not_before must be a valid ISO timestamp");
  }
  return Math.max(
    0,
    deadlineMs - requireFiniteTimestamp(nowMs, "handoff current time")
  );
}
