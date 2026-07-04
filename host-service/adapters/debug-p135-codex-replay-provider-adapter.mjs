import { EventEmitter } from "events";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

export const DEBUG_P135_CODEX_REPLAY_PROVIDER_ID =
  "debug-p135-codex-replay";

const DEFAULT_FIXTURE_ID = "p135-codex-replay-default";
const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "debug-p135-codex-replay"
);
const MANIFEST_PATH = join(FIXTURE_DIR, "manifest.json");
const MAX_REPLAY_TOOL_BLOCKS = 40;
const MAX_REPLAY_LINES_PER_BLOCK = 80;
const MAX_REPLAY_TIMER_DELAY_MS = 10_000;

function readJsonFile(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    throw new Error(
      `Unable to load ${label} for ${DEBUG_P135_CODEX_REPLAY_PROVIDER_ID}: ${err.message}`
    );
  }
}

function assertSafeInteger(value, label, { min = 1, max }) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(
      `${label} must be a safe integer between ${min} and ${max}`
    );
  }
}

export function resolveDebugP135CodexReplayTimingContract(fixture) {
  const timing = fixture?.timing_contract;
  if (!timing || typeof timing !== "object" || Array.isArray(timing)) {
    throw new Error(
      "debug P135 Codex replay fixture timing_contract is required"
    );
  }

  const contract = {
    ready_delay_ms: timing.ready_delay_ms,
    turn_start_delay_ms: timing.turn_start_delay_ms,
    semantic_event_interval_ms: timing.semantic_event_interval_ms,
    completion_delay_ms: timing.completion_delay_ms,
    minimum_turn_active_ms: timing.minimum_turn_active_ms,
  };
  for (const [key, value] of Object.entries(contract)) {
    assertSafeInteger(value, `timing_contract.${key}`, {
      min: 1,
      max: MAX_REPLAY_TIMER_DELAY_MS,
    });
  }

  const replayEventCount = fixture.tool_block_count * 3 + 2;
  const lastReplayEventAtMs =
    contract.semantic_event_interval_ms * replayEventCount;
  if (contract.minimum_turn_active_ms < lastReplayEventAtMs) {
    throw new Error(
      "timing_contract.minimum_turn_active_ms must keep the replay active through the final semantic event"
    );
  }

  return Object.freeze(contract);
}

function validateManifest(manifest) {
  if (
    manifest?.schema_version !==
      "routec.debug_p135_codex_replay_manifest.v1" ||
    manifest.provider_id !== DEBUG_P135_CODEX_REPLAY_PROVIDER_ID ||
    manifest.sanitized !== true ||
    !Array.isArray(manifest.fixtures)
  ) {
    throw new Error("invalid debug P135 Codex replay manifest");
  }
  for (const fixture of manifest.fixtures) {
    if (typeof fixture?.id !== "string" || fixture.id.trim() === "") {
      throw new Error("debug P135 Codex replay fixture id is required");
    }
    assertSafeInteger(fixture.tool_block_count, "tool_block_count", {
      min: 1,
      max: MAX_REPLAY_TOOL_BLOCKS,
    });
    assertSafeInteger(fixture.lines_per_tool_result, "lines_per_tool_result", {
      min: 1,
      max: MAX_REPLAY_LINES_PER_BLOCK,
    });
    resolveDebugP135CodexReplayTimingContract(fixture);
  }
  return manifest;
}

export function loadDebugP135CodexReplayManifest() {
  return validateManifest(readJsonFile(MANIFEST_PATH, "fixture manifest"));
}

function resolveFixture(manifest, requestedModel) {
  const model = typeof requestedModel === "string" ? requestedModel.trim() : "";
  return (
    manifest.fixtures.find((fixture) => fixture.id === model) ||
    manifest.fixtures.find((fixture) => fixture.id === DEFAULT_FIXTURE_ID) ||
    manifest.fixtures[0]
  );
}

function buildBlockStdout(blockNumber, linesPerBlock) {
  const block = String(blockNumber).padStart(3, "0");
  const lines = [`P135_CODEX_REPLAY_BLOCK_${block}`];
  for (let lineNumber = 1; lineNumber <= linesPerBlock; lineNumber += 1) {
    const line = String(lineNumber).padStart(3, "0");
    lines.push(
      `P135 replay sanitized context ${block}.${line}: Route C web/chat integration investigation output`
    );
  }
  return `${lines.join("\n")}\n`;
}

function buildReplayEvents(fixture, turnId) {
  const events = [
    {
      type: "message.thinking",
      text: "Replaying sanitized P135 Codex investigation context through the provider semantic stream.",
      redacted: false,
    },
  ];

  for (let blockNumber = 1; blockNumber <= fixture.tool_block_count; blockNumber += 1) {
    const block = String(blockNumber).padStart(3, "0");
    const callId = `${turnId}-p135-replay-tool-${block}`;
    events.push(
      {
        type: "tool.call",
        call_id: callId,
        name: "exec_command",
        input: {
          command: `p135-replay-read-only-block-${block}`,
          fixture_id: fixture.id,
          block,
          readonly: true,
          sanitized: true,
        },
      },
      {
        type: "tool.output",
        call_id: callId,
        stream: null,
        text: `P135 replay block ${block} produced sanitized read-only output.`,
      },
      {
        type: "tool.result",
        call_id: callId,
        name: "exec_command",
        is_error: false,
        content: {
          stdout: buildBlockStdout(blockNumber, fixture.lines_per_tool_result),
          stderr: "",
          exit_code: 0,
          success: true,
        },
      }
    );
  }

  events.push({
    type: "message.assistant",
    text: `P135 Codex Replay completed ${fixture.tool_block_count} sanitized read-only tool blocks and preserved provider semantic delivery.`,
    delta: false,
  });

  return events;
}

function withReplayMetadata(event, fixture, turnId, step) {
  return {
    ...event,
    provider: DEBUG_P135_CODEX_REPLAY_PROVIDER_ID,
    turn_id: turnId,
    provider_turn_id: turnId,
    provider_turn_id_kind: "provider_reported_turn_id",
    debug_p135_codex_replay_provider: true,
    debug_p135_codex_replay_fixture_id: fixture.id,
    debug_p135_codex_replay_step: step,
  };
}

export class DebugP135CodexReplayProviderAdapter {
  constructor(options = {}) {
    this.providerId = DEBUG_P135_CODEX_REPLAY_PROVIDER_ID;
    this.manifest = options.manifest || loadDebugP135CodexReplayManifest();
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
    return new DebugP135CodexReplayProviderSession({
      id: sessionId,
      cwd,
      agentId,
      model,
      manifest: this.manifest,
    });
  }

  sendMessage(session, payload) {
    session.send(payload);
  }

  respondToControl() {
    throw new Error("P135 Codex Replay provider does not expose controls");
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

export class DebugP135CodexReplayProviderSession extends EventEmitter {
  constructor(options) {
    super();
    this.id = options.id;
    this.cwd = options.cwd;
    this.agentId = options.agentId;
    this.provider = DEBUG_P135_CODEX_REPLAY_PROVIDER_ID;
    this.transport = "debug-p135-codex-replay";
    this.manifest = options.manifest || loadDebugP135CodexReplayManifest();
    this.fixture = resolveFixture(this.manifest, options.model);
    this.timingContract = resolveDebugP135CodexReplayTimingContract(
      this.fixture
    );
    this.model = this.fixture.id;
    this.providerResumeId = null;
    this.providerThreadId = null;
    this.alive = true;
    this._ready = false;
    this._turnSequence = 0;
    this._pendingTurnId = null;
    this._timers = new Set();
    this._setTimer =
      typeof options.setTimer === "function" ? options.setTimer : setTimeout;
    this._clearTimer =
      typeof options.clearTimer === "function"
        ? options.clearTimer
        : clearTimeout;

    this.queueTimer(() => {
      if (!this.alive) return;
      this._ready = true;
      this.emit("event", {
        type: "session.ready",
        provider: this.provider,
        model: this.model,
        cwd: this.cwd,
        toolsCount: this.fixture.tool_block_count,
        debug_p135_codex_replay_provider: true,
      });
    }, this.timingContract.ready_delay_ms);
  }

  queueTimer(fn, delayMs) {
    const timer = this._setTimer(() => {
      this._timers.delete(timer);
      fn();
    }, delayMs);
    this._timers.add(timer);
    return timer;
  }

  clearTimers() {
    for (const timer of this._timers) this._clearTimer(timer);
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
      debug_p135_codex_replay_provider: true,
      debug_p135_codex_replay_fixture_id: this.fixture.id,
    });
    return true;
  }

  send() {
    if (!this.alive) {
      throw new Error(`P135 Codex Replay session ${this.id} is no longer alive`);
    }
    if (this._pendingTurnId) {
      throw new Error(`P135 Codex Replay session ${this.id} is already running`);
    }
    const turnId = `debug-p135-codex-replay-turn-${++this._turnSequence}`;
    this._pendingTurnId = turnId;

    this.queueTimer(() => {
      if (!this.alive || this._pendingTurnId !== turnId) return;
      this.emit("event", {
        type: "session.notice",
        provider: this.provider,
        subtype: "turn.started",
        payload: { turn: { id: turnId } },
      });
    }, this.timingContract.turn_start_delay_ms);

    const events = buildReplayEvents(this.fixture, turnId);
    events.forEach((event, index) => {
      this.queueTimer(() => {
        if (!this.alive || this._pendingTurnId !== turnId) return;
        this.emit(
          "event",
          withReplayMetadata(event, this.fixture, turnId, index + 1)
        );
      }, this.timingContract.semantic_event_interval_ms * (index + 1));
    });
    const finalSemanticEventAtMs =
      this.timingContract.semantic_event_interval_ms * events.length;
    const completionDelayMs = Math.max(
      finalSemanticEventAtMs + this.timingContract.completion_delay_ms,
      this.timingContract.minimum_turn_active_ms
    );
    this.queueTimer(
      () => this.emitTurnCompleted(turnId),
      completionDelayMs
    );
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
