import { EventEmitter } from "events";

const PROVIDER_ID = "debug-large-tool-spillover";
const MAX_TOOL_EVENT_COUNT = 10_000;
const EMIT_BATCH_SIZE = 25;
const EMIT_BATCH_DELAY_MS = 10;

function normalizePayloadText(payload) {
  if (typeof payload === "string") return payload;
  if (typeof payload?.rawText === "string") return payload.rawText;
  if (typeof payload?.text === "string") return payload.text;
  return "";
}

function parseToolEventCount(payload) {
  const text = normalizePayloadText(payload).trim();
  const match = /^(\d{1,5})$/.exec(text);
  if (!match) {
    throw new Error("Spillover Fake expects a numeric tool event count");
  }
  const count = Number(match[1]);
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_TOOL_EVENT_COUNT) {
    throw new Error(`Spillover Fake count must be between 1 and ${MAX_TOOL_EVENT_COUNT}`);
  }
  return count;
}

function buildToolEvent(turnId, ordinal) {
  const cycle = (ordinal - 1) % 4;
  const callId = `${turnId}-tool-${String(Math.ceil(ordinal / 4)).padStart(4, "0")}`;
  const base = {
    provider: PROVIDER_ID,
    turn_id: turnId,
    provider_turn_id: turnId,
    provider_turn_id_kind: "provider_reported_turn_id",
    p82_spillover_fake_provider: true,
    p82_tool_event_index: ordinal,
    debug_large_tool_spillover_provider: true,
  };
  if (cycle === 0) {
    return {
      ...base,
      type: "tool.call",
      call_id: callId,
      name: "p82_spillover_fake_tool",
      input: {
        command: `p82-spillover-fake ${ordinal}`,
        fixture: "p82-large-tool-event-spillover",
        ordinal,
      },
    };
  }
  if (cycle === 1) {
    return {
      ...base,
      type: "tool.output",
      call_id: callId,
      text: `P82 Spillover Fake tool.output ${ordinal}`,
      stream: null,
    };
  }
  if (cycle === 2) {
    return {
      ...base,
      type: "tool.result",
      call_id: callId,
      name: "p82_spillover_fake_tool",
      is_error: false,
      content: {
        stdout: `P82 Spillover Fake tool.result ${ordinal}`,
        stderr: "",
        exit_code: 0,
        success: true,
      },
    };
  }
  return {
    ...base,
    type: "tool.result",
    call_id: callId,
    name: "p82_spillover_fake_tool",
    is_error: true,
    content: {
      stdout: "",
      stderr: `P82 Spillover Fake tool.failure ${ordinal}`,
      exit_code: 1,
      success: false,
    },
  };
}

export class DebugLargeToolSpilloverProviderAdapter {
  constructor() {
    this.providerId = PROVIDER_ID;
  }

  getCapabilities() {
    return {
      interactiveSession: true,
      resume: false,
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
    return new DebugLargeToolSpilloverProviderSession({
      id: sessionId,
      cwd,
      agentId,
      model,
    });
  }

  sendMessage(session, payload) {
    session.send(payload);
  }

  respondToControl() {
    throw new Error("Spillover Fake provider does not expose controls");
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
    return false;
  }

  supportsPermissionResponses() {
    return false;
  }
}

export class DebugLargeToolSpilloverProviderSession extends EventEmitter {
  constructor(options) {
    super();
    this.id = options.id;
    this.cwd = options.cwd;
    this.agentId = options.agentId;
    this.provider = PROVIDER_ID;
    this.transport = "debug-large-tool-spillover";
    this.model = options.model || "spillover-fake";
    this.providerResumeId = null;
    this.providerThreadId = null;
    this.alive = true;
    this._ready = false;
    this._turnSequence = 0;
    this._pendingTurnId = null;
    this._timers = new Set();

    this.queueTimer(() => {
      if (!this.alive) return;
      this._ready = true;
      this.emit("event", {
        type: "session.ready",
        provider: this.provider,
        model: this.model,
        cwd: this.cwd,
        toolsCount: 1,
      });
    }, 5);
  }

  queueTimer(fn, delayMs) {
    const timer = setTimeout(() => {
      this._timers.delete(timer);
      fn();
    }, delayMs);
    this._timers.add(timer);
    return timer;
  }

  clearTimers() {
    for (const timer of this._timers) clearTimeout(timer);
    this._timers.clear();
  }

  emitTurnCompleted(turnId, status = "completed") {
    if (!this.alive || this._pendingTurnId !== turnId) return false;
    this._pendingTurnId = null;
    this.emit("event", {
      type: "turn.completed",
      provider: this.provider,
      turn_id: turnId,
      provider_turn_id: turnId,
      provider_turn_id_kind: "provider_reported_turn_id",
      status,
      p82_spillover_fake_provider: true,
    });
    return true;
  }

  send(payload) {
    if (!this.alive) {
      throw new Error(`Spillover Fake session ${this.id} is no longer alive`);
    }
    if (this._pendingTurnId) {
      throw new Error(`Spillover Fake session ${this.id} is already running`);
    }
    const count = parseToolEventCount(payload);
    const turnId = `debug-large-tool-spillover-turn-${++this._turnSequence}`;
    this._pendingTurnId = turnId;
    this.queueTimer(() => {
      if (!this.alive || this._pendingTurnId !== turnId) return;
      this.emit("event", {
        type: "session.notice",
        provider: this.provider,
        subtype: "turn.started",
        payload: { turn: { id: turnId } },
      });
    }, 1);

    let nextOrdinal = 1;
    const emitBatch = () => {
      if (!this.alive || this._pendingTurnId !== turnId) return;
      const end = Math.min(count, nextOrdinal + EMIT_BATCH_SIZE - 1);
      while (nextOrdinal <= end) {
        this.emit("event", buildToolEvent(turnId, nextOrdinal));
        nextOrdinal += 1;
      }
      if (nextOrdinal <= count) {
        this.queueTimer(emitBatch, EMIT_BATCH_DELAY_MS);
        return;
      }
      this.queueTimer(() => this.emitTurnCompleted(turnId), EMIT_BATCH_DELAY_MS);
    };
    this.queueTimer(emitBatch, EMIT_BATCH_DELAY_MS);
  }

  interrupt() {
    const turnId = this._pendingTurnId;
    this.clearTimers();
    if (!this.alive || !turnId) return;
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
