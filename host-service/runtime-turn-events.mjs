const TURN_SCOPED_RUNTIME_EVENT_TYPES = new Set([
  "message.assistant",
  "message.thinking",
  "tool.call",
  "tool.result",
  "stderr",
  "turn.completed",
]);

function normalizeTurnId(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function shouldAttachRuntimeTurnId(eventType) {
  return TURN_SCOPED_RUNTIME_EVENT_TYPES.has(eventType);
}

export function attachRuntimeTurnId(event, resolveTurnId) {
  if (!event || typeof event !== "object") return event;
  if (!shouldAttachRuntimeTurnId(event.type)) return event;

  const existingTurnId = normalizeTurnId(event.turn_id) || normalizeTurnId(event.turnId);
  if (existingTurnId) {
    return {
      ...event,
      turn_id: existingTurnId,
    };
  }

  const sessionId =
    (typeof event.sessionId === "string" && event.sessionId.trim() ? event.sessionId.trim() : null)
    || (typeof event.session_id === "string" && event.session_id.trim() ? event.session_id.trim() : null);
  if (!sessionId || typeof resolveTurnId !== "function") return event;

  const agentId =
    (typeof event.agentId === "string" && event.agentId.trim() ? event.agentId.trim() : null)
    || (typeof event.agent_id === "string" && event.agent_id.trim() ? event.agent_id.trim() : null);

  const resolvedTurnId = normalizeTurnId(resolveTurnId(sessionId, agentId));
  if (!resolvedTurnId) return event;
  return {
    ...event,
    turn_id: resolvedTurnId,
  };
}
