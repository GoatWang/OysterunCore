import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { getUploadDir } from "../upload-manager.mjs";

// Test-only archival adapter retained for Host boundary fixture coverage.
// Product SessionManager must not import or register this provider runtime.

const MOCK_PREVIEW_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR42mP8z/D/PwAHggJ/P3cuVQAAAABJRU5ErkJggg==";
const OYSTERUN_SEMANTIC_FIXTURE_ID = "oysterun_full_semantic_fixture";
const OYSTERUN_SEMANTIC_FIXTURE_MARKER =
  "oysterun_fake_provider_full_semantic_fixture_no_pass";

function normalizeMessagePayload(payload) {
  if (typeof payload === "string") {
    return {
      rawText: payload,
      text: payload,
      slashCommandName: null,
    };
  }
  return {
    rawText: typeof payload?.rawText === "string" ? payload.rawText : "",
    text: typeof payload?.text === "string" ? payload.text : "",
    slashCommandName:
      typeof payload?.slashCommandName === "string" &&
      payload.slashCommandName.trim()
        ? payload.slashCommandName.trim().toLowerCase()
        : null,
  };
}

function extractExactReplyTarget(rawText) {
  if (typeof rawText !== "string") return null;
  const match = /reply with exactly\s+(.+?)\s+and no other text\.?$/i.exec(
    rawText.trim()
  );
  if (!match) return null;
  const candidate = match[1]?.trim();
  return candidate || null;
}

function buildMockReply(rawText, slashCommandName) {
  const exactReply = extractExactReplyTarget(rawText);
  if (exactReply) {
    return {
      thinkingText: "Preparing deterministic exact reply.",
      assistantText: exactReply,
      media: [],
    };
  }

  if (slashCommandName === "media") {
    return {
      thinkingText: "Preparing deterministic media row.",
      assistantText: "MOCK_MEDIA_ROW_READY",
      mediaMode: "image",
    };
  }

  if (slashCommandName === "help") {
    return {
      thinkingText: "Collecting mock commands.",
      assistantText: "Available mock commands: /media, /help, /thinking",
      media: [],
    };
  }

  if (slashCommandName === "thinking") {
    return {
      thinkingText: "Mock thinking row complete.",
      assistantText: "MOCK_THINKING_ROW_READY",
      media: [],
    };
  }

  if (
    slashCommandName === "semantic-fixture" ||
    slashCommandName === "p1-fpc-05-fixture" ||
    slashCommandName === "p1-fpc-05-semantic-fixture"
  ) {
    return {
      semanticFixture: true,
      fixtureId: OYSTERUN_SEMANTIC_FIXTURE_ID,
      thinkingText: null,
      assistantText: "MOCK_SEMANTIC_FIXTURE_COMPLETE",
      media: [],
    };
  }

  const normalizedText = rawText.trim();
  return {
    thinkingText: "Mock deterministic turn in progress.",
    assistantText: normalizedText.isEmpty
      ? "MOCK_EMPTY_MESSAGE"
      : `MOCK_REPLY: ${normalizedText}`,
    media: [],
  };
}

function buildSemanticFixtureEvents(turnId) {
  const base = {
    type: "routec.semantic.fixture",
    provider: "mock",
    provider_turn_id: turnId,
    provider_turn_id_kind: "provider_reported_turn_id",
    semantic_fixture_id: OYSTERUN_SEMANTIC_FIXTURE_ID,
    semantic_contract: "semantic_fixture_full_renderer_contract",
    semantic_fixture_marker: OYSTERUN_SEMANTIC_FIXTURE_MARKER,
    direct_matrix_harness_write_used: false,
    direct_dom_injection: false,
    real_codex_e2e_claimed: false,
    full_provider_parity_claimed: false,
    readiness_claimed: false,
    foundation_pass_claimed: false,
  };
  const positiveRows = [
    {
      semantic_type: "session_lifecycle",
      semantic_lifecycle: "fixture_session_ready",
      semantic_body: "Mock session lifecycle fixture ready.",
      semantic_fixture_label: "session lifecycle",
    },
    {
      semantic_type: "thinking.reasoning",
      semantic_lifecycle: "fixture_reasoning_final",
      semantic_body: "Mock reasoning fixture complete.",
      semantic_fixture_label: "thinking reasoning",
    },
    {
      semantic_type: "tool.call",
      semantic_lifecycle: "fixture_tool_call_final",
      semantic_body: "Mock tool call fixture requested telegram dry-run.",
      semantic_fixture_label: "tool call",
      tool_name: "telegram-stable-mock-tool",
      call_id: `mock-tool-call-${turnId}`,
    },
    {
      semantic_type: "tool.output",
      semantic_lifecycle: "fixture_tool_output_final",
      semantic_body: "Mock tool output fixture produced deterministic text.",
      semantic_fixture_label: "tool output",
      call_id: `mock-tool-call-${turnId}`,
    },
    {
      semantic_type: "tool.result",
      semantic_lifecycle: "fixture_tool_result_final",
      semantic_body: "Mock tool result fixture succeeded.",
      semantic_fixture_label: "tool result",
      call_id: `mock-tool-call-${turnId}`,
      is_error: false,
    },
    {
      semantic_type: "tool.failure",
      semantic_lifecycle: "fixture_tool_failure_final",
      semantic_body:
        "Mock tool failure fixture captured deterministic failure.",
      semantic_fixture_label: "tool failure",
      call_id: `mock-tool-failure-${turnId}`,
      is_error: true,
    },
    {
      semantic_type: "control.request",
      semantic_lifecycle: "fixture_control_request_final",
      semantic_body: "Mock control request fixture requested approval.",
      semantic_fixture_label: "control request",
      control_request_id: `mock-control-${turnId}`,
      control_kind: "permissions",
      control_family: "provider_request",
      control_origin: "provider",
      allowed_actions: ["accept", "reject"],
    },
    {
      semantic_type: "control.outcome",
      semantic_lifecycle: "fixture_control_outcome_final",
      semantic_body: "Mock control outcome fixture approved.",
      semantic_fixture_label: "control outcome",
      control_request_id: `mock-control-${turnId}`,
      control_kind: "permissions",
      control_family: "provider_request",
      control_origin: "user",
      actor: "oysterun-ui",
      control_outcome: "approved",
    },
    {
      semantic_type: "control.cancel.request",
      semantic_lifecycle: "fixture_cancel_request_final",
      semantic_body:
        "Mock cancel request fixture targets the source Matrix event.",
      semantic_fixture_label: "cancel request",
      control_request_id: `mock-cancel-${turnId}`,
      control_kind: "cancel",
      control_family: "session_control",
      control_origin: "user",
      allowed_actions: ["cancel"],
    },
    ...[
      "accepted",
      "too_late_to_cancel",
      "already_canceled",
      "already_completed",
      "not_found",
    ].map((cancelOutcome) => ({
      semantic_type: "control.cancel.outcome",
      semantic_lifecycle: `fixture_cancel_outcome_${cancelOutcome}`,
      semantic_body: `Mock cancel outcome fixture: ${cancelOutcome}.`,
      semantic_fixture_label: `cancel outcome ${cancelOutcome}`,
      control_request_id: `mock-cancel-${turnId}-${cancelOutcome}`,
      control_kind: "cancel",
      control_family: "session_control",
      control_origin: "user",
      actor: "oysterun-ui",
      cancel_outcome: cancelOutcome,
    })),
    {
      semantic_type: "outbox.delivery",
      semantic_lifecycle: "fixture_outbox_delivery_final",
      semantic_body: "Mock outbox delivery fixture committed.",
      semantic_fixture_label: "outbox delivery",
      outbox_delivery_state: "committed",
    },
    {
      semantic_type: "ambiguous.stalled",
      semantic_lifecycle: "fixture_ambiguous_stalled_final",
      semantic_body:
        "Mock ambiguous stalled fixture retained as transcript row.",
      semantic_fixture_label: "ambiguous stalled",
      ambiguous_state: "stalled",
    },
    {
      semantic_type: "runtime.error",
      semantic_lifecycle: "fixture_runtime_error_final",
      semantic_body:
        "Mock runtime error fixture retained without terminating the session.",
      semantic_fixture_label: "runtime error",
    },
  ];
  const absenceRows = [
    {
      type: "routec.semantic.absence",
      provider: "mock",
      provider_turn_id: turnId,
      provider_turn_id_kind: "provider_reported_turn_id",
      semantic_fixture_id: OYSTERUN_SEMANTIC_FIXTURE_ID,
      semantic_fixture_label: "transport stream error absence",
      negative_contract: "transport.stream_error",
      semantic_fixture_marker: OYSTERUN_SEMANTIC_FIXTURE_MARKER,
      direct_matrix_harness_write_used: false,
      real_codex_e2e_claimed: false,
      foundation_pass_claimed: false,
    },
    {
      type: "routec.semantic.absence",
      provider: "mock",
      provider_turn_id: turnId,
      provider_turn_id_kind: "provider_reported_turn_id",
      semantic_fixture_id: OYSTERUN_SEMANTIC_FIXTURE_ID,
      semantic_fixture_label: "internal cancellation absence",
      negative_contract: "internal.cancellation",
      semantic_fixture_marker: OYSTERUN_SEMANTIC_FIXTURE_MARKER,
      direct_matrix_harness_write_used: false,
      real_codex_e2e_claimed: false,
      foundation_pass_claimed: false,
    },
  ];
  return [
    ...positiveRows.map((row, index) => ({
      ...base,
      ...row,
      semantic_fixture_step: index + 1,
    })),
    ...absenceRows.map((row, index) => ({
      ...row,
      semantic_fixture_step: positiveRows.length + index + 1,
    })),
  ];
}

export class MockChatAdapter {
  constructor() {
    this.providerId = "mock";
    this.capabilities = {
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

  startSession({
    sessionId,
    cwd,
    agentId,
    model,
    reasoningEffort,
    permissionMode,
  }) {
    return new MockChatSession({
      id: sessionId,
      cwd,
      agentId,
      model,
      reasoningEffort,
      permissionMode,
    });
  }

  sendMessage(session, payload) {
    session.send(payload);
  }

  respondToControl() {
    throw new Error(
      "Mock adapter does not expose interactive control requests"
    );
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

export class MockChatSession extends EventEmitter {
  constructor(options) {
    super();
    this.id = options.id;
    this.cwd = options.cwd;
    this.agentId = options.agentId;
    this.provider = "mock";
    this.transport = "mock";
    this.model = options.model || "telegram-stable-mock";
    this.reasoningEffort = options.reasoningEffort || "high";
    this.permissionMode = options.permissionMode || "default";
    this.providerResumeId = `mock-resume-${this.id}`;
    this.providerThreadId = `mock-thread-${this.id}`;
    this.alive = true;
    this._ready = false;
    this._turnSequence = 0;
    this._timers = new Set();
    this._pendingTurnId = null;

    this.queueTimer(() => {
      if (!this.alive) return;
      this._ready = true;
      this.emit("event", {
        type: "session.ready",
        provider: this.provider,
        model: this.model,
        reasoningEffort: this.reasoningEffort,
        permissionMode: this.permissionMode,
        cwd: this.cwd,
        toolsCount: 0,
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
    for (const timer of this._timers) {
      clearTimeout(timer);
    }
    this._timers.clear();
  }

  ensureMockMediaFile() {
    const uploadDir = getUploadDir(this.cwd, this.agentId);
    mkdirSync(uploadDir, { recursive: true });
    const mediaPath = join(uploadDir, "phase2-mock-preview.png");
    if (!existsSync(mediaPath)) {
      writeFileSync(mediaPath, Buffer.from(MOCK_PREVIEW_PNG_BASE64, "base64"));
    }
    const size = Buffer.from(MOCK_PREVIEW_PNG_BASE64, "base64").length;
    return {
      resource_ref: mediaPath,
      filename: "phase2-mock-preview.png",
      mime_type: "image/png",
      byte_size: size,
      is_image: true,
    };
  }

  send(payload) {
    if (!this.alive) {
      throw new Error(`Mock session ${this.id} is no longer alive`);
    }
    const normalized = normalizeMessagePayload(payload);
    const scenario = buildMockReply(
      normalized.rawText,
      normalized.slashCommandName
    );
    const turnId = `mock-turn-${++this._turnSequence}`;
    const semanticFixtureEvents = scenario.semanticFixture
      ? buildSemanticFixtureEvents(turnId)
      : [];
    const assistantDelayMs =
      semanticFixtureEvents.length > 0
        ? 50 + semanticFixtureEvents.length * 15
        : 90;
    const completedDelayMs = assistantDelayMs + 40;
    this._pendingTurnId = turnId;

    this.queueTimer(() => {
      if (!this.alive || this._pendingTurnId !== turnId) return;
      this.emit("event", {
        type: "session.notice",
        provider: this.provider,
        subtype: "turn.started",
        payload: {
          turn: { id: turnId },
        },
      });
    }, 10);

    if (scenario.thinkingText) {
      this.queueTimer(() => {
        if (!this.alive || this._pendingTurnId !== turnId) return;
        this.emit("event", {
          type: "message.thinking",
          provider: this.provider,
          text: scenario.thinkingText,
        });
      }, 40);
    }

    semanticFixtureEvents.forEach((fixtureEvent, index) => {
      this.queueTimer(() => {
        if (!this.alive || this._pendingTurnId !== turnId) return;
        this.emit("event", fixtureEvent);
      }, 35 + index * 15);
    });

    this.queueTimer(() => {
      if (!this.alive || this._pendingTurnId !== turnId) return;
      const media =
        scenario.mediaMode === "image"
          ? [this.ensureMockMediaFile()]
          : Array.isArray(scenario.media)
          ? scenario.media
          : [];
      this.emit("event", {
        type: "message.assistant",
        provider: this.provider,
        text: scenario.assistantText || "",
        media,
        semantic_fixture_id: scenario.fixtureId || null,
        semantic_fixture_step:
          semanticFixtureEvents.length > 0
            ? semanticFixtureEvents.length + 1
            : null,
        semantic_fixture_label: scenario.semanticFixture
          ? "assistant message"
          : null,
        semantic_contract: scenario.semanticFixture
          ? "semantic_fixture_full_renderer_contract"
          : null,
        semantic_fixture_marker: scenario.semanticFixture
          ? OYSTERUN_SEMANTIC_FIXTURE_MARKER
          : null,
        direct_matrix_harness_write_used: false,
        real_codex_e2e_claimed: false,
        full_provider_parity_claimed: false,
      });
    }, assistantDelayMs);

    this.queueTimer(() => {
      if (!this.alive || this._pendingTurnId !== turnId) return;
      this._pendingTurnId = null;
      this.emit("event", {
        type: "turn.completed",
        provider: this.provider,
        turn_id: turnId,
        status: "completed",
      });
    }, completedDelayMs);
  }

  interrupt() {
    const turnId = this._pendingTurnId;
    this.clearTimers();
    if (!this.alive || !turnId) return;
    this._pendingTurnId = null;
    this.emit("event", {
      type: "turn.completed",
      provider: this.provider,
      turn_id: turnId,
      status: "interrupted",
    });
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
