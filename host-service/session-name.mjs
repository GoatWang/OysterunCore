function stringifySessionName(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new Error("session_name must be a string");
  }
  return value.trim();
}

export function normalizeSessionName(value) {
  const trimmed = stringifySessionName(value);
  return trimmed || null;
}

// Pure-function name builder for agent-scoped counter.
// counterValue === 1 → just the agent id (no suffix).
// counterValue >= 2 → `${agentId}-${counterValue}`.
export function buildDefaultSessionName(agentId, counterValue) {
  const normalizedAgentId = typeof agentId === "string" && agentId.trim()
    ? agentId.trim()
    : "session";
  const n = Number(counterValue);
  if (!Number.isFinite(n) || n <= 1) {
    return normalizedAgentId;
  }
  return `${normalizedAgentId}-${n}`;
}

// Pure-function name builder for branch-scoped counter.
// Always suffixed `-branch-N` regardless of counter value.
// parentSessionName is the resolved name of the source session (already
// counter-based or legacy uuid-style — we just append onto it).
export function buildDefaultBranchName(parentSessionName, counterValue) {
  const base = typeof parentSessionName === "string" && parentSessionName.trim()
    ? parentSessionName.trim()
    : "session";
  const n = Number(counterValue);
  const suffix = Number.isFinite(n) && n >= 1 ? n : 1;
  return `${base}-branch-${suffix}`;
}

// Uniqueness-aware default-name generator. Takes a counter-provider fn
// that returns the next monotonic value; if the generated name collides
// with a currently-running session (rare — only happens when a legacy
// session explicitly occupies the candidate name), advance the counter
// and retry. Hard-cap retries at 100 to avoid infinite loop on broken
// isTaken implementations.
export function buildUniqueDefaultSessionName(agentId, isTaken, nextCounterValue) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const n = nextCounterValue();
    const candidate = buildDefaultSessionName(agentId, n);
    if (!isTaken(candidate)) return candidate;
  }
  throw new Error("Could not generate a unique default session name");
}

export function buildUniqueDefaultBranchName(parentSessionName, isTaken, nextCounterValue) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const n = nextCounterValue();
    const candidate = buildDefaultBranchName(parentSessionName, n);
    if (!isTaken(candidate)) return candidate;
  }
  throw new Error("Could not generate a unique default branch name");
}

export function buildSessionNameConflictMessage(sessionName) {
  return `Session name ${sessionName} is already in use by a running session`;
}
