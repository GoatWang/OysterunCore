import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import {
  DEBUG_ROUTEC_STRUCTURAL_REPLAY_MODEL_ID,
  DEBUG_ROUTEC_STRUCTURAL_REPLAY_PROVIDER_ID,
  buildSizedStructuralReplayText,
  validateStructuralReplayManifest,
} from "../debug-routec-structural-replay.mjs";

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_BATCH_DELAY_MS = 1;

function readBatchDelayMs(env) {
  const raw = env.OYSTERUN_DEBUG_ROUTEC_STRUCTURAL_REPLAY_BATCH_DELAY_MS;
  if (raw === undefined || raw === "") return DEFAULT_BATCH_DELAY_MS;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0 || value > 60_000) {
    throw new Error(
      "OYSTERUN_DEBUG_ROUTEC_STRUCTURAL_REPLAY_BATCH_DELAY_MS must be an integer from 0 to 60000"
    );
  }
  return value;
}

function normalizePayloadText(payload) {
  if (typeof payload === "string") return payload;
  if (typeof payload?.rawText === "string") return payload.rawText;
  if (typeof payload?.text === "string") return payload.text;
  return "";
}

function parseReplayTurnOrdinal(payload) {
  const match = /^P015 Owner #(\d{4,})\b/.exec(
    normalizePayloadText(payload).trim()
  );
  if (!match) {
    throw new Error(
      "Structural Replay expects `P015 Owner #NNNN` as the prompt prefix"
    );
  }
  const ordinal = Number(match[1]);
  if (!Number.isSafeInteger(ordinal) || ordinal < 1) {
    throw new Error("Structural Replay turn ordinal must be positive");
  }
  return ordinal;
}

function parseReplaySourceTurnOrdinal(payload) {
  const match = /\bsource turn (\d{4,})\b/.exec(normalizePayloadText(payload));
  if (!match) return null;
  const ordinal = Number(match[1]);
  if (!Number.isSafeInteger(ordinal) || ordinal < 1) {
    throw new Error("Structural Replay source turn ordinal must be positive");
  }
  return ordinal;
}

function loadManifestFromEnv(env = process.env) {
  const manifestPath =
    typeof env.OYSTERUN_DEBUG_ROUTEC_STRUCTURAL_REPLAY_MANIFEST_PATH ===
    "string"
      ? env.OYSTERUN_DEBUG_ROUTEC_STRUCTURAL_REPLAY_MANIFEST_PATH.trim()
      : "";
  if (!manifestPath) {
    throw new Error(
      "OYSTERUN_DEBUG_ROUTEC_STRUCTURAL_REPLAY_MANIFEST_PATH is required"
    );
  }
  return validateStructuralReplayManifest(
    JSON.parse(readFileSync(manifestPath, "utf8"))
  );
}

function replayMetadata(turnId, sourceTurn, eventOrdinal) {
  return {
    provider: DEBUG_ROUTEC_STRUCTURAL_REPLAY_PROVIDER_ID,
    turn_id: turnId,
    provider_turn_id: turnId,
    provider_turn_id_kind: "provider_reported_turn_id",
    debug_routec_structural_replay_provider: true,
    debug_routec_structural_replay_source_turn: sourceTurn.id,
    debug_routec_structural_replay_event_ordinal: eventOrdinal,
  };
}

function buildReplayRuntimeEvent(descriptor, context) {
  const label = `P015 ${context.sourceTurn.id} event-${String(
    descriptor.ordinal
  ).padStart(4, "0")}`;
  const text = buildSizedStructuralReplayText(
    label,
    descriptor.body_size_bucket
  );
  const metadata = replayMetadata(
    context.turnId,
    context.sourceTurn,
    descriptor.ordinal
  );
  const callId = descriptor.call_ref
    ? `${context.turnId}-${descriptor.call_ref}`
    : `${context.turnId}-event-${descriptor.ordinal}`;

  switch (descriptor.kind) {
    case "message.assistant":
      return { ...metadata, type: "message.assistant", text: text || label };
    case "message.thinking":
      return {
        ...metadata,
        type: "message.thinking",
        text: text || `${label} hidden thinking status`,
        redacted: false,
      };
    case "tool.call":
      return {
        ...metadata,
        type: "tool.call",
        call_id: callId,
        name: "p015_structural_replay_tool",
        input: {
          command: `p015-structural-replay ${context.globalTurnOrdinal} ${descriptor.ordinal}`,
          payload: text || label,
          sanitized: true,
        },
      };
    case "tool.output":
      return {
        ...metadata,
        type: "tool.output",
        call_id: callId,
        stream: null,
        text: text || label,
      };
    case "tool.result":
    case "tool.failure":
      return {
        ...metadata,
        type: "tool.result",
        call_id: callId,
        name: "p015_structural_replay_tool",
        is_error: descriptor.kind === "tool.failure",
        content: {
          stdout: descriptor.kind === "tool.failure" ? "" : text || label,
          stderr: descriptor.kind === "tool.failure" ? text || label : "",
          exit_code: descriptor.kind === "tool.failure" ? 1 : 0,
          success: descriptor.kind !== "tool.failure",
        },
      };
    case "session.lifecycle":
      return {
        ...metadata,
        type: "session.lifecycle",
        status: "progress",
        semantic_body: text || `${label} lifecycle progress`,
      };
    case "control.request": {
      const controlRequestId = `${context.turnId}-control-1`;
      return {
        ...metadata,
        type: "control.request",
        request_id: controlRequestId,
        control_request_id: controlRequestId,
        control_kind: "permissions",
        control_family: "provider_request",
        control_origin: "provider",
        actor: DEBUG_ROUTEC_STRUCTURAL_REPLAY_PROVIDER_ID,
        target_id: context.turnId,
        target_turn_id: context.turnId,
        allowed_actions: ["accept", "reject"],
        durable: true,
        replay_policy: "latest_state_only",
        expires_at: "1970-01-01T00:00:00.000Z",
        semantic_body: text || `${label} control request`,
        debug_replayed_source_semantic_type: "control.request",
      };
    }
    case "control.outcome": {
      const controlRequestId = `${context.turnId}-control-1`;
      return {
        ...metadata,
        type: "control.outcome",
        request_id: controlRequestId,
        control_request_id: controlRequestId,
        control_outcome_id: `${context.turnId}-control-outcome-1`,
        control_kind: "permissions",
        control_family: "provider_request",
        control_origin: "host",
        control_outcome: "accepted",
        outcome: "accepted",
        actor: DEBUG_ROUTEC_STRUCTURAL_REPLAY_PROVIDER_ID,
        target_id: context.turnId,
        target_turn_id: context.turnId,
        durable: true,
        replay_policy: "always",
        semantic_body: text || `${label} control outcome`,
        debug_replayed_source_semantic_type: "control.outcome",
      };
    }
    default:
      throw new Error(
        `Unsupported structural replay event kind ${descriptor.kind}`
      );
  }
}

export class DebugRouteCStructuralReplayProviderAdapter {
  constructor(options = {}) {
    this.providerId = DEBUG_ROUTEC_STRUCTURAL_REPLAY_PROVIDER_ID;
    this.manifest = options.manifest || null;
    this.env = options.env || process.env;
  }

  getCapabilities() {
    return {
      interactiveSession: true,
      resume: true,
      permissionResponses: false,
      historyImport: false,
      interrupt: true,
      workspacePolicy: true,
    };
  }

  getConfiguredCommand() {
    return null;
  }

  startSession({ sessionId, cwd, agentId, model }) {
    return new DebugRouteCStructuralReplayProviderSession({
      id: sessionId,
      cwd,
      agentId,
      model,
      manifest: this.manifest || loadManifestFromEnv(this.env),
      batchDelayMs: readBatchDelayMs(this.env),
    });
  }

  sendMessage(session, payload) {
    session.send(payload);
  }

  respondToControl() {
    throw new Error("Structural Replay provider does not expose controls");
  }

  stopSession(session) {
    session.stop();
  }

  interruptSession(session) {
    session.interrupt();
  }

  killSession(session) {
    session.kill();
  }

  supportsInteractiveSession() {
    return true;
  }

  supportsResume() {
    return true;
  }

  supportsPermissionResponses() {
    return false;
  }
}

export class DebugRouteCStructuralReplayProviderSession extends EventEmitter {
  constructor(options) {
    super();
    this.id = options.id;
    this.cwd = options.cwd;
    this.agentId = options.agentId;
    this.provider = DEBUG_ROUTEC_STRUCTURAL_REPLAY_PROVIDER_ID;
    this.transport = "debug-routec-structural-replay";
    this.model = DEBUG_ROUTEC_STRUCTURAL_REPLAY_MODEL_ID;
    this.manifest = validateStructuralReplayManifest(options.manifest);
    this.providerResumeId = null;
    this.providerThreadId = null;
    this.alive = true;
    this._ready = false;
    this._pendingTurnId = null;
    this._timers = new Set();
    this._batchSize = options.batchSize || DEFAULT_BATCH_SIZE;
    this._batchDelayMs = options.batchDelayMs ?? DEFAULT_BATCH_DELAY_MS;
    this.queueTimer(() => {
      if (!this.alive) return;
      this._ready = true;
      this.emit("event", {
        type: "session.ready",
        provider: this.provider,
        model: this.model,
        cwd: this.cwd,
        toolsCount: 1,
        debug_routec_structural_replay_provider: true,
      });
    }, 5);
  }

  queueTimer(fn, delayMs) {
    const timer = setTimeout(() => {
      this._timers.delete(timer);
      fn();
    }, delayMs);
    this._timers.add(timer);
  }

  clearTimers() {
    for (const timer of this._timers) clearTimeout(timer);
    this._timers.clear();
  }

  emitTurnCompleted(turnId, status = "completed") {
    if (!this.alive || this._pendingTurnId !== turnId) return;
    this._pendingTurnId = null;
    this.emit("event", {
      type: "turn.completed",
      provider: this.provider,
      turn_id: turnId,
      provider_turn_id: turnId,
      provider_turn_id_kind: "provider_reported_turn_id",
      status,
      debug_routec_structural_replay_provider: true,
    });
  }

  send(payload) {
    if (!this.alive) {
      throw new Error(
        `Structural Replay session ${this.id} is no longer alive`
      );
    }
    if (this._pendingTurnId) {
      throw new Error(
        `Structural Replay session ${this.id} is already running`
      );
    }
    const globalTurnOrdinal = parseReplayTurnOrdinal(payload);
    const sourceTurnOrdinal = parseReplaySourceTurnOrdinal(payload);
    if (
      sourceTurnOrdinal !== null &&
      sourceTurnOrdinal > this.manifest.turns.length
    ) {
      throw new Error(
        `Structural Replay source turn ${sourceTurnOrdinal} exceeds manifest length ${this.manifest.turns.length}`
      );
    }
    const sourceTurnIndex = sourceTurnOrdinal
      ? sourceTurnOrdinal - 1
      : (globalTurnOrdinal - 1) % this.manifest.turns.length;
    const sourceTurn = this.manifest.turns[sourceTurnIndex];
    const turnId = `debug-routec-structural-replay-turn-${String(
      globalTurnOrdinal
    ).padStart(6, "0")}`;
    this._pendingTurnId = turnId;
    this.emit("event", {
      type: "session.notice",
      provider: this.provider,
      subtype: "turn.started",
      payload: { turn: { id: turnId } },
    });

    let nextIndex = 0;
    const emitBatch = () => {
      if (!this.alive || this._pendingTurnId !== turnId) return;
      const end = Math.min(
        sourceTurn.events.length,
        nextIndex + this._batchSize
      );
      while (nextIndex < end) {
        const descriptor = sourceTurn.events[nextIndex];
        this.emit(
          "event",
          buildReplayRuntimeEvent(descriptor, {
            turnId,
            sourceTurn,
            globalTurnOrdinal,
          })
        );
        nextIndex += 1;
      }
      if (nextIndex < sourceTurn.events.length) {
        this.queueTimer(emitBatch, this._batchDelayMs);
        return;
      }
      this.queueTimer(() => this.emitTurnCompleted(turnId), this._batchDelayMs);
    };
    this.queueTimer(emitBatch, this._batchDelayMs);
  }

  interrupt() {
    const turnId = this._pendingTurnId;
    this.clearTimers();
    if (!turnId) return;
    this.emitTurnCompleted(turnId, "interrupted");
  }

  stop() {
    if (!this.alive) return;
    this.clearTimers();
    this.alive = false;
    this._pendingTurnId = null;
    this.emit("exit", 0);
  }

  kill() {
    if (!this.alive) return;
    this.clearTimers();
    this.alive = false;
    this._pendingTurnId = null;
    this.emit("exit", 1);
  }
}
