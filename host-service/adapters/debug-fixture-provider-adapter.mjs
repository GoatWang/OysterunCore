import { EventEmitter } from "events";

const DEBUG_FIXTURE_PROVIDER_ID = "debug-fixture";
const DEBUG_FIXTURE_MODELS = new Map([
  ["0.5s", 500],
  ["1s", 1_000],
  ["5s", 5_000],
  ["10s", 10_000],
]);
const DEBUG_FIXTURE_COMBO_MAX_UNITS = 160;
const P64_PATTERN_16_TOOL_PAIR_COUNT = 1_000;
const P64_PATTERN_16_SAFE_EMIT_BATCH_SIZE = 50;
const P64_PATTERN_16_SAFE_EMIT_DELAY_MS = 1;
const P67_TOOL_OUTPUT_STRESS_SCENARIO_ID =
  "p67-10000-tool-output-batches";
const P67_TOOL_OUTPUT_STRESS_COUNT = 10_000;
const P67_TOOL_OUTPUT_BATCH_SIZE = 200;
const P67_TOOL_OUTPUT_STRESS_INITIAL_DELAY_MS = 250;
const P67_TOOL_OUTPUT_STRESS_SAFE_EMIT_BATCH_SIZE = 10;
const P67_TOOL_OUTPUT_STRESS_MIN_BATCH_DELAY_MS = 50;
const P67_TOOL_OUTPUT_STRESS_MAX_BATCH_DELAY_MS = 100;
const P67_TOOL_OUTPUT_STRESS_TARGET_EMIT_MS = 16;
const P67_TOOL_OUTPUT_STRESS_BACKPRESSURE_STEP_MS = 25;
const P69_HYPERLINK_REGRESSION_SCENARIO_ID =
  "P69_HYPERLINK_REGRESSION_FIXTURE";
const P017_LIVE_TAIL_SCENARIO_ID = "P017_LIVE_TAIL_3S";
const P017_LIVE_TAIL_INTERVAL_MS = 3_000;
const P017_LIVE_TAIL_MESSAGE_COUNT = 20;

function normalizeMessagePayload(payload) {
  if (typeof payload === "string") {
    return {
      rawText: payload,
      text: payload,
    };
  }
  return {
    rawText: typeof payload?.rawText === "string" ? payload.rawText : "",
    text: typeof payload?.text === "string" ? payload.text : "",
  };
}

function normalizeDelayModel(model) {
  const normalized = typeof model === "string" ? model.trim() : "";
  return DEBUG_FIXTURE_MODELS.has(normalized) ? normalized : "1s";
}

function buildDeterministicBlock(label, targetChars) {
  const seed = [
    label,
    "This deterministic fixture block is intentionally shaped for Route C timeline rendering experiments.",
    "It avoids randomness so a phone screenshot, DOM dump, and Matrix payload can be compared across worktrees.",
    "abcdefghijklmnopqrstuvwxyz0123456789",
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ9876543210",
  ].join(" ");
  const lines = [];
  let index = 1;
  while (lines.join("\n").length < targetChars) {
    lines.push(`${String(index).padStart(3, "0")} ${seed}`);
    index += 1;
  }
  return lines.join("\n");
}

function buildToolJsonPayload(label, targetChars, extra = {}) {
  const fixturePayload = buildDeterministicBlock(label, targetChars);
  return {
    fixture: label,
    command: `printf '%s\\n' ${JSON.stringify(label)}`,
    cwd: `/tmp/oysterun/p33/${label.replace(/[^a-zA-Z0-9_-]+/g, "-")}`,
    command_actions: ["inspect", "read", "stress-render"],
    fixture_payload_chars: fixturePayload.length,
    fixture_payload: fixturePayload,
    ...extra,
  };
}

function buildToolResultPayload(label, targetChars, extra = {}) {
  const stdout = buildDeterministicBlock(`${label}-stdout`, targetChars);
  return {
    stdout,
    stderr: "",
    exit_code: 0,
    success: true,
    fixture_payload_chars: stdout.length,
    ...extra,
  };
}

function buildAtomicToolEvents(turnId, label, targetChars, options = {}) {
  const callId = options.omitCallId ? undefined : `${turnId}-${label}`;
  const toolName = options.omitName ? undefined : "exec_command";
  return [
    toolCallEvent(
      callId,
      toolName,
      buildToolJsonPayload(label, targetChars, options.inputExtra || {})
    ),
    toolResultEvent(
      callId,
      toolName,
      buildToolResultPayload(label, targetChars, options.resultExtra || {}),
      options.isError === true
    ),
  ];
}

function buildAtomicUnitEvents(unitNumber, turnId, occurrence = 1) {
  const unitLabel = `p33-unit-${unitNumber}-occurrence-${occurrence}`;
  switch (unitNumber) {
    case 1:
      return [
        textEvent("P33 unit 1: short assistant message.", {
          debug_fixture_unit_id: "u01",
        }),
      ];
    case 2:
      return [
        thinkingEvent("P33 unit 2: short thinking message.", {
          debug_fixture_unit_id: "u02",
        }),
      ];
    case 3:
      return buildAtomicToolEvents(turnId, unitLabel, 160).map((event) => ({
        ...event,
        debug_fixture_unit_id: "u03",
      }));
    case 4:
      return [
        textEvent(buildDeterministicBlock("P33 unit 4 long assistant", 1_800), {
          debug_fixture_unit_id: "u04",
        }),
      ];
    case 5:
      return [
        thinkingEvent(
          buildDeterministicBlock("P33 unit 5 long thinking", 1_800),
          {
            debug_fixture_unit_id: "u05",
          }
        ),
      ];
    case 6:
      return buildAtomicToolEvents(turnId, unitLabel, 1_800).map((event) => ({
        ...event,
        debug_fixture_unit_id: "u06",
      }));
    case 7:
      return [
        textEvent(
          buildDeterministicBlock("P33 unit 7 very long assistant", 8_000),
          {
            debug_fixture_unit_id: "u07",
          }
        ),
      ];
    case 8:
      return [
        thinkingEvent(
          buildDeterministicBlock("P33 unit 8 very long thinking", 8_000),
          {
            debug_fixture_unit_id: "u08",
          }
        ),
      ];
    case 9:
      return buildAtomicToolEvents(turnId, unitLabel, 8_000).map((event) => ({
        ...event,
        debug_fixture_unit_id: "u09",
      }));
    default:
      return [textEvent(`P33 unknown unit: ${String(unitNumber)}`)];
  }
}

function buildPattern11LongBlock(round, phase, toolIndex, kind) {
  const prefix = [
    `P33 pattern 11 ${kind}`,
    `round=${round}`,
    `phase=${phase}`,
    `tool=${toolIndex}`,
  ].join(" ");
  const seed = [
    prefix,
    "This deterministic long block intentionally exceeds one thousand characters so the Route C timeline can reproduce phone rendering pressure from long tool payloads.",
    "abcdefghijklmnopqrstuvwxyz0123456789",
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ9876543210",
  ].join(" | ");
  const body = Array.from({ length: 24 }, (_, index) => {
    return `${String(index + 1).padStart(2, "0")} ${seed}`;
  }).join("\n");
  return `${prefix}\n${body}`;
}

function buildPattern11Events(turnId) {
  const events = [];
  for (let round = 1; round <= 10; round += 1) {
    for (const phase of ["before-thinking", "after-thinking"]) {
      if (phase === "after-thinking") {
        events.push(
          thinkingEvent(
            [
              `P33 pattern 11 thinking round ${round}.`,
              "This thinking row separates two large groups of tool call/result events.",
              "The following rows should not break timeline row/index stability on phone.",
            ].join(" ")
          )
        );
      }
      for (let toolIndex = 1; toolIndex <= 10; toolIndex += 1) {
        const callId = `${turnId}-r${round}-${phase}-tool-${toolIndex}`;
        const commandBlock = buildPattern11LongBlock(
          round,
          phase,
          toolIndex,
          "tool-call-input"
        );
        const outputBlock = buildPattern11LongBlock(
          round,
          phase,
          toolIndex,
          "tool-result-output"
        );
        events.push(
          toolCallEvent(callId, "exec_command", {
            command: `printf '%s\\n' ${JSON.stringify(
              `p33-pattern-11-round-${round}-${phase}-tool-${toolIndex}`
            )}`,
            cwd: `/tmp/oysterun/p33/pattern-11/round-${round}/${phase}`,
            command_actions: ["inspect", "read", "stress-render"],
            fixture_payload_chars: commandBlock.length,
            fixture_payload: commandBlock,
          }),
          toolResultEvent(callId, "exec_command", {
            stdout: outputBlock,
            stderr: "",
            exit_code: 0,
            success: true,
            fixture_payload_chars: outputBlock.length,
          })
        );
      }
    }
  }
  events.push(
    textEvent(
      [
        "P33 pattern 11 complete: ten rounds of large tool call/result groups with thinking separators finished.",
        "Expected stress shape: 200 tool.call events, 200 tool.result events, 10 thinking events, and this final assistant message.",
      ].join(" ")
    )
  );
  return events;
}

function buildPattern12Events(turnId) {
  const events = [];
  for (let groupIndex = 1; groupIndex <= 5; groupIndex += 1) {
    if (groupIndex > 1) {
      events.push(
        thinkingEvent(
          [
            `P33 pattern 12 separator before tool group ${groupIndex}.`,
            "This row intentionally splits compressed tool groups while leaving the final visible state on a large tool group.",
          ].join(" ")
        )
      );
    }
    for (let toolIndex = 1; toolIndex <= 20; toolIndex += 1) {
      events.push(
        ...buildAtomicToolEvents(
          turnId,
          `p12-group-${groupIndex}-tool-${toolIndex}`,
          6_000
        )
      );
    }
  }
  return events;
}

function buildPattern13ValidToolJsonEvents(turnId) {
  const events = [];
  for (let toolIndex = 1; toolIndex <= 40; toolIndex += 1) {
    events.push(
      ...buildAtomicToolEvents(turnId, `p13a-valid-tool-json-${toolIndex}`, 9_000)
    );
  }
  return events;
}

function buildPattern13MissingCorrelationEvents(turnId) {
  const events = [];
  for (let toolIndex = 1; toolIndex <= 30; toolIndex += 1) {
    events.push(
      ...buildAtomicToolEvents(
        turnId,
        `p13b-missing-correlation-${toolIndex}`,
        7_000,
        {
          omitCallId: true,
          omitName: toolIndex % 3 === 0,
          inputExtra: {
            diagnostic: "tool_call_id intentionally omitted",
          },
          resultExtra: {
            diagnostic: "tool_call_id intentionally omitted",
          },
        }
      )
    );
  }
  return events;
}

function buildPattern13AssistantJsonEvents() {
  return Array.from({ length: 12 }, (_, index) =>
    textEvent(
      JSON.stringify(
        {
          fixture: "p13c-assistant-json-body",
          index: index + 1,
          command: "/bin/zsh -lc \"jq . package.json\"",
          cwd: "<repo-root>",
          command_actions: ["inspect", "render-json-body"],
          payload: buildDeterministicBlock(
            `P33 pattern 13c assistant json ${index + 1}`,
            5_000
          ),
        },
        null,
        2
      )
    )
  );
}

function buildPattern13LiveToolOnlyEvents(turnId) {
  const events = [];
  for (let toolIndex = 1; toolIndex <= 24; toolIndex += 1) {
    const callId = `${turnId}-p13d-live-tool-${toolIndex}`;
    events.push(
      toolCallEvent(
        callId,
        "exec_command",
        buildToolJsonPayload(`p13d-live-tool-${toolIndex}`, 5_000)
      ),
      toolOutputEvent(
        callId,
        buildDeterministicBlock(`P33 pattern 13d output ${toolIndex}`, 4_000)
      ),
      toolResultEvent(
        callId,
        "exec_command",
        buildToolResultPayload(`p13d-live-tool-${toolIndex}`, 5_000)
      )
    );
  }
  return events;
}

function buildPattern13Events(variant, turnId) {
  switch (variant) {
    case "b":
      return buildPattern13MissingCorrelationEvents(turnId);
    case "c":
      return buildPattern13AssistantJsonEvents(turnId);
    case "d":
      return buildPattern13LiveToolOnlyEvents(turnId);
    case "a":
    default:
      return buildPattern13ValidToolJsonEvents(turnId);
  }
}

function buildPattern16Events(turnId) {
  const events = [];
  for (
    let toolIndex = 1;
    toolIndex <= P64_PATTERN_16_TOOL_PAIR_COUNT;
    toolIndex += 1
  ) {
    const ordinal = String(toolIndex).padStart(4, "0");
    const callId = `${turnId}-p64-pattern-16-tool-${ordinal}`;
    const label = `p64-pattern-16-tool-${ordinal}`;
    const resultText = `p64 pattern 16 deterministic result ${ordinal}`;
    events.push(
      toolCallEvent(callId, "exec_command", {
        fixture: label,
        command: `printf '%s\\n' ${JSON.stringify(label)}`,
        cwd: "/tmp/oysterun/p64/pattern-16",
        command_actions: ["stress-render"],
        fixture_payload_chars: label.length,
        fixture_payload: label,
        p64_stress_pattern: 16,
        p64_tool_index: toolIndex,
      }),
      toolResultEvent(callId, "exec_command", {
        stdout: resultText,
        stderr: "",
        exit_code: 0,
        success: true,
        fixture_payload_chars: resultText.length,
        p64_stress_pattern: 16,
        p64_tool_index: toolIndex,
      })
    );
  }
  events.push(
    textEvent(
      [
        "P64 pattern 16 complete: deterministic fake provider stress emitted.",
        "Expected stress shape: 1000 tool.call events, 1000 tool.result events, and this final assistant message.",
      ].join(" "),
      {
        p64_stress_pattern: 16,
        p64_tool_pair_count: P64_PATTERN_16_TOOL_PAIR_COUNT,
      }
    )
  );
  return events;
}

function buildP67ToolOutputBatchEvents(turnId) {
  const callId = `${turnId}-p67-tool-output-batches`;
  const events = [
    toolCallEvent(callId, "exec_command", {
      fixture: P67_TOOL_OUTPUT_STRESS_SCENARIO_ID,
      command: "printf 'p67 deterministic tool output batch stress\\n'",
      cwd: "/tmp/oysterun/p67/tool-output-batches",
      command_actions: ["stress-render"],
      p67_stress_scenario: P67_TOOL_OUTPUT_STRESS_SCENARIO_ID,
      p67_tool_output_count: P67_TOOL_OUTPUT_STRESS_COUNT,
      p67_tool_output_batch_size: P67_TOOL_OUTPUT_BATCH_SIZE,
    }),
  ];
  for (
    let outputIndex = 1;
    outputIndex <= P67_TOOL_OUTPUT_STRESS_COUNT;
    outputIndex += 1
  ) {
    const ordinal = String(outputIndex).padStart(5, "0");
    events.push(
      toolOutputEvent(
        callId,
        `p67 deterministic tool output chunk ${ordinal}`,
        {
          p67_stress_scenario: P67_TOOL_OUTPUT_STRESS_SCENARIO_ID,
          p67_tool_output_index: outputIndex,
          p67_tool_output_batch_size: P67_TOOL_OUTPUT_BATCH_SIZE,
          p67_expected_batch_index:
            Math.floor((outputIndex - 1) / P67_TOOL_OUTPUT_BATCH_SIZE) + 1,
        }
      )
    );
  }
  events.push(
    toolResultEvent(callId, "exec_command", {
      stdout: "p67 deterministic tool output batch stress complete",
      stderr: "",
      exit_code: 0,
      success: true,
      p67_stress_scenario: P67_TOOL_OUTPUT_STRESS_SCENARIO_ID,
      p67_tool_output_count: P67_TOOL_OUTPUT_STRESS_COUNT,
      p67_tool_output_batch_size: P67_TOOL_OUTPUT_BATCH_SIZE,
      p67_expected_visible_batch_count:
        P67_TOOL_OUTPUT_STRESS_COUNT / P67_TOOL_OUTPUT_BATCH_SIZE,
    }),
    textEvent(
      [
        "P67 scenario p67-10000-tool-output-batches complete.",
        "Expected frontend display shape: 10000 raw tool.output events in 50 visible Tool Output Batch rows.",
      ].join(" "),
      {
        p67_stress_scenario: P67_TOOL_OUTPUT_STRESS_SCENARIO_ID,
        p67_tool_output_count: P67_TOOL_OUTPUT_STRESS_COUNT,
        p67_tool_output_batch_size: P67_TOOL_OUTPUT_BATCH_SIZE,
        p67_expected_visible_batch_count:
          P67_TOOL_OUTPUT_STRESS_COUNT / P67_TOOL_OUTPUT_BATCH_SIZE,
      }
    )
  );
  return events;
}

function buildP69HyperlinkRegressionFixtureEvents({ agentId }) {
  const fixtureAgentId =
    String(agentId || "").trim() || "oysterunp69hyperlinkfixtureagent";
  const fixtureSiteBase = `/sites/${encodeURIComponent(fixtureAgentId)}`;
  const message = [
    "# P69 hyperlink regression fixture",
    "",
    "Markdown local file: [local Markdown fixture](docs/local_markdown_fixture.md)",
    "Markdown local directory: [nested docs directory](docs/nested/)",
    "Plain local file path: data/sample.json",
    "Plain local directory path: docs/nested/",
    `Host site Markdown link: [site Markdown page](${fixtureSiteBase}/docs/site_markdown_page.md)`,
    "Local HTML filesystem path under site: .oysterun/site/reports/hyperlink_report.html",
    `Missing /sites target: [missing site target](${fixtureSiteBase}/missing/not-found.html)`,
    "External HTTPS URL: https://example.com/oysterun/p69-hyperlink-fixture",
    "Code fence negative path text:",
    "```text",
    "docs/nested/target_note.md",
    "```",
  ].join("\n");
  return [
    textEvent(message, {
      p69_hyperlink_scenario: P69_HYPERLINK_REGRESSION_SCENARIO_ID,
      p69_fixture_agent_id: fixtureAgentId,
      p69_site_markdown_target: `${fixtureSiteBase}/docs/site_markdown_page.md`,
      p69_missing_sites_target: `${fixtureSiteBase}/missing/not-found.html`,
      p69_local_file_target: "docs/local_markdown_fixture.md",
      p69_local_directory_target: "docs/nested/",
      p69_local_html_target: ".oysterun/site/reports/hyperlink_report.html",
      p69_external_target:
        "https://example.com/oysterun/p69-hyperlink-fixture",
      p69_code_fence_negative_target: "docs/nested/target_note.md",
    }),
  ];
}

function buildP017LiveTailEvents() {
  return Array.from({ length: P017_LIVE_TAIL_MESSAGE_COUNT }, (_, index) => {
    const sequence = index + 1;
    const ordinal = String(sequence).padStart(2, "0");
    const heightVariant = sequence % 3;
    const lines =
      heightVariant === 0
        ? Array.from(
            { length: 10 },
            (__, lineIndex) =>
              `P017 live tail ${ordinal}.${String(lineIndex + 1).padStart(2, "0")} deterministic tall row`
          )
        : heightVariant === 2
          ? [
              `P017 live tail ${ordinal} deterministic medium row`,
              "This row has stable extra height for bottom-follow geometry verification.",
              "No tool event or pagination behavior is involved in this fixture.",
            ]
          : [`P017 live tail ${ordinal} deterministic short row`];
    return textEvent(lines.join("\n"), {
      p017_live_tail_fixture: true,
      p017_live_tail_sequence: sequence,
      p017_live_tail_total: P017_LIVE_TAIL_MESSAGE_COUNT,
      p017_live_tail_interval_ms: P017_LIVE_TAIL_INTERVAL_MS,
      p017_live_tail_height_variant:
        heightVariant === 0 ? "tall" : heightVariant === 2 ? "medium" : "short",
    });
  });
}

function textEvent(text, extra = {}) {
  return {
    type: "message.assistant",
    provider: DEBUG_FIXTURE_PROVIDER_ID,
    text,
    delta: false,
    ...extra,
  };
}

function thinkingEvent(text, extra = {}) {
  return {
    type: "message.thinking",
    provider: DEBUG_FIXTURE_PROVIDER_ID,
    text,
    redacted: false,
    ...extra,
  };
}

function toolCallEvent(callId, name, input = {}) {
  const event = {
    type: "tool.call",
    provider: DEBUG_FIXTURE_PROVIDER_ID,
    input,
  };
  if (callId) event.call_id = callId;
  if (name) event.name = name;
  return event;
}

function toolOutputEvent(callId, text, extra = {}) {
  const event = {
    type: "tool.output",
    provider: DEBUG_FIXTURE_PROVIDER_ID,
    stream: null,
    text,
    ...extra,
  };
  if (callId) event.call_id = callId;
  return event;
}

function toolResultEvent(callId, name, content = {}, isError = false) {
  const event = {
    type: "tool.result",
    provider: DEBUG_FIXTURE_PROVIDER_ID,
    content,
    is_error: isError,
  };
  if (callId) event.call_id = callId;
  if (name) event.name = name;
  return event;
}

function withFixtureMetadata(events, patternId, turnId) {
  return events.map((event, index) => ({
    ...event,
    provider_turn_id: turnId,
    provider_turn_id_kind: "provider_reported_turn_id",
    turn_id: turnId,
    debug_fixture_pattern_id: patternId,
    debug_fixture_step: index + 1,
  }));
}

function buildPatternEvents(patternNumber, turnId) {
  const patternId = `p${String(patternNumber).padStart(2, "0")}`;
  const eventsByPattern = {
    1: buildAtomicUnitEvents(1, turnId),
    2: buildAtomicUnitEvents(2, turnId),
    3: buildAtomicUnitEvents(3, turnId),
    4: buildAtomicUnitEvents(4, turnId),
    5: buildAtomicUnitEvents(5, turnId),
    6: buildAtomicUnitEvents(6, turnId),
    7: buildAtomicUnitEvents(7, turnId),
    8: buildAtomicUnitEvents(8, turnId),
    9: buildAtomicUnitEvents(9, turnId),
    10: [
      textEvent("P33 pattern 10 streaming delta part A. ", { delta: true }),
      textEvent("P33 pattern 10 streaming delta part B. ", { delta: true }),
      thinkingEvent("P33 pattern 10 thinking delta.", { delta: true }),
      textEvent("P33 pattern 10 complete: final non-delta assistant message."),
    ],
    11: buildPattern11Events(turnId),
    12: buildPattern12Events(turnId),
    16: buildPattern16Events(turnId),
  };
  return withFixtureMetadata(
    eventsByPattern[patternNumber] || [
      textEvent(`P33 Fake echo: ${String(patternNumber)}`),
    ],
    patternId,
    turnId
  );
}

function parseDebugFixtureComboCommand(value) {
  if (!value.includes(",") && !value.includes("*")) return null;
  const tokens = value
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);
  if (!tokens.length) return null;

  const units = [];
  for (const token of tokens) {
    const match = /^([1-9])(?:\s*\*\s*(\d{1,3}))?$/.exec(token);
    if (!match) return null;
    const unit = Number(match[1]);
    const repeat = match[2] ? Number(match[2]) : 1;
    if (!Number.isInteger(repeat) || repeat < 1) return null;
    for (let index = 0; index < repeat; index += 1) {
      units.push(unit);
      if (units.length > DEBUG_FIXTURE_COMBO_MAX_UNITS) {
        return {
          error: `combo expands to more than ${DEBUG_FIXTURE_COMBO_MAX_UNITS} units`,
        };
      }
    }
  }

  return { units };
}

function buildDebugFixtureComboEvents(units, turnId) {
  const events = [];
  units.forEach((unit, index) => {
    events.push(
      ...buildAtomicUnitEvents(unit, turnId, index + 1).map((event) => ({
        ...event,
        debug_fixture_combo_index: index + 1,
        debug_fixture_combo_unit: unit,
      }))
    );
  });
  return withFixtureMetadata(events, "combo", turnId);
}

export class DebugFixtureProviderAdapter {
  constructor() {
    this.providerId = DEBUG_FIXTURE_PROVIDER_ID;
    this.capabilities = {
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
    return new DebugFixtureProviderSession({
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
    throw new Error("Debug fixture provider does not expose controls");
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

export class DebugFixtureProviderSession extends EventEmitter {
  constructor(options) {
    super();
    this.id = options.id;
    this.cwd = options.cwd;
    this.agentId = options.agentId;
    this.provider = DEBUG_FIXTURE_PROVIDER_ID;
    this.transport = "debug-fixture";
    this.model = normalizeDelayModel(options.model);
    this.delayMs = DEBUG_FIXTURE_MODELS.get(this.model) || 1_000;
    this.providerResumeId = null;
    this.providerThreadId = null;
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

  buildEvents(payload, turnId) {
    const normalized = normalizeMessagePayload(payload);
    const trimmed = normalized.rawText.trim();
    if (trimmed === P017_LIVE_TAIL_SCENARIO_ID) {
      return withFixtureMetadata(
        buildP017LiveTailEvents(),
        P017_LIVE_TAIL_SCENARIO_ID,
        turnId
      );
    }
    if (trimmed === P69_HYPERLINK_REGRESSION_SCENARIO_ID) {
      return withFixtureMetadata(
        buildP69HyperlinkRegressionFixtureEvents({ agentId: this.agentId }),
        P69_HYPERLINK_REGRESSION_SCENARIO_ID,
        turnId
      );
    }
    if (trimmed === P67_TOOL_OUTPUT_STRESS_SCENARIO_ID) {
      return withFixtureMetadata(
        buildP67ToolOutputBatchEvents(turnId),
        P67_TOOL_OUTPUT_STRESS_SCENARIO_ID,
        turnId
      );
    }
    const pattern13 = /^13([a-d])?$/i.exec(trimmed);
    if (pattern13) {
      const variant = (pattern13[1] || "a").toLowerCase();
      return withFixtureMetadata(
        buildPattern13Events(variant, turnId),
        `p13${variant}`,
        turnId
      );
    }
    const combo = parseDebugFixtureComboCommand(trimmed);
    if (combo?.error) {
      return withFixtureMetadata(
        [textEvent(`P33 Fake combo rejected: ${combo.error}.`)],
        "combo-rejected",
        turnId
      );
    }
    if (combo?.units) {
      return buildDebugFixtureComboEvents(combo.units, turnId);
    }
    const numericPattern = /^(16|12|11|10|[1-9])$/.exec(trimmed);
    if (numericPattern) {
      return buildPatternEvents(Number(numericPattern[1]), turnId);
    }
    return withFixtureMetadata(
      [
        textEvent(
          trimmed
            ? `P33 Fake echo: ${trimmed}`
            : "P33 Fake echo: empty message"
        ),
      ],
      "echo",
      turnId
    );
  }

  isP67ToolOutputStressTurn(events) {
    return events.some(
      (event) =>
        event?.p67_stress_scenario === P67_TOOL_OUTPUT_STRESS_SCENARIO_ID ||
        event?.debug_fixture_pattern_id === P67_TOOL_OUTPUT_STRESS_SCENARIO_ID
    );
  }

  isP017LiveTailTurn(events) {
    return events.some(
      (event) =>
        event?.p017_live_tail_fixture === true &&
        event?.debug_fixture_pattern_id === P017_LIVE_TAIL_SCENARIO_ID
    );
  }

  isP64Pattern16StressTurn(events) {
    return events.some(
      (event) =>
        event?.debug_fixture_pattern_id === "p16" ||
        event?.p64_stress_pattern === 16 ||
        event?.input?.p64_stress_pattern === 16 ||
        event?.content?.p64_stress_pattern === 16
    );
  }

  emitTurnEvent(turnId, event) {
    if (!this.alive || this._pendingTurnId !== turnId) return false;
    this.emit("event", event);
    return true;
  }

  emitTurnCompleted(turnId) {
    if (!this.alive || this._pendingTurnId !== turnId) return false;
    this._pendingTurnId = null;
    this.emit("event", {
      type: "turn.completed",
      provider: this.provider,
      turn_id: turnId,
      provider_turn_id: turnId,
      provider_turn_id_kind: "provider_reported_turn_id",
      status: "completed",
    });
    return true;
  }

  queueStandardTurnEvents(turnId, events) {
    events.forEach((event, index) => {
      this.queueTimer(() => {
        this.emitTurnEvent(turnId, event);
      }, this.delayMs * (index + 1));
    });

    this.queueTimer(() => {
      this.emitTurnCompleted(turnId);
    }, this.delayMs * (events.length + 1));
  }

  queueP017LiveTailEvents(turnId, events) {
    events.forEach((event, index) => {
      this.queueTimer(() => {
        this.emitTurnEvent(turnId, event);
      }, P017_LIVE_TAIL_INTERVAL_MS * (index + 1));
    });

    this.queueTimer(() => {
      this.emitTurnCompleted(turnId);
    }, P017_LIVE_TAIL_INTERVAL_MS * (events.length + 1));
  }

  queueP64Pattern16StressEvents(turnId, events) {
    let nextIndex = 0;
    const emitBatch = () => {
      if (!this.alive || this._pendingTurnId !== turnId) return;
      const endIndex = Math.min(
        nextIndex + P64_PATTERN_16_SAFE_EMIT_BATCH_SIZE,
        events.length
      );
      while (nextIndex < endIndex) {
        if (!this.emitTurnEvent(turnId, events[nextIndex])) return;
        nextIndex += 1;
      }
      if (nextIndex < events.length) {
        this.queueTimer(emitBatch, P64_PATTERN_16_SAFE_EMIT_DELAY_MS);
        return;
      }
      this.queueTimer(() => {
        this.emitTurnCompleted(turnId);
      }, P64_PATTERN_16_SAFE_EMIT_DELAY_MS);
    };
    this.queueTimer(emitBatch, P64_PATTERN_16_SAFE_EMIT_DELAY_MS);
  }

  queueP67ToolOutputStressEvents(turnId, events) {
    let nextIndex = 0;
    const emitBatch = () => {
      if (!this.alive || this._pendingTurnId !== turnId) return;
      const batchStartedAt = Date.now();
      const endIndex = Math.min(
        nextIndex + P67_TOOL_OUTPUT_STRESS_SAFE_EMIT_BATCH_SIZE,
        events.length
      );
      while (nextIndex < endIndex) {
        if (!this.emitTurnEvent(turnId, events[nextIndex])) return;
        nextIndex += 1;
      }
      if (nextIndex < events.length) {
        const elapsedMs = Date.now() - batchStartedAt;
        const pressureSteps = Math.max(
          0,
          Math.ceil(
            (elapsedMs - P67_TOOL_OUTPUT_STRESS_TARGET_EMIT_MS) /
              P67_TOOL_OUTPUT_STRESS_TARGET_EMIT_MS
          )
        );
        const nextDelayMs = Math.min(
          P67_TOOL_OUTPUT_STRESS_MAX_BATCH_DELAY_MS,
          P67_TOOL_OUTPUT_STRESS_MIN_BATCH_DELAY_MS +
            pressureSteps * P67_TOOL_OUTPUT_STRESS_BACKPRESSURE_STEP_MS
        );
        this.queueTimer(emitBatch, nextDelayMs);
        return;
      }
      this.queueTimer(
        () => {
          this.emitTurnCompleted(turnId);
        },
        P67_TOOL_OUTPUT_STRESS_MIN_BATCH_DELAY_MS
      );
    };
    this.queueTimer(emitBatch, P67_TOOL_OUTPUT_STRESS_INITIAL_DELAY_MS);
  }

  send(payload) {
    if (!this.alive) {
      throw new Error(`Debug fixture session ${this.id} is no longer alive`);
    }
    if (this._pendingTurnId) {
      throw new Error(`Debug fixture session ${this.id} is already running`);
    }
    const turnId = `debug-fixture-turn-${++this._turnSequence}`;
    const events = this.buildEvents(payload, turnId);
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

    if (this.isP017LiveTailTurn(events)) {
      this.queueP017LiveTailEvents(turnId, events);
    } else if (this.isP67ToolOutputStressTurn(events)) {
      this.queueP67ToolOutputStressEvents(turnId, events);
    } else if (this.isP64Pattern16StressTurn(events)) {
      this.queueP64Pattern16StressEvents(turnId, events);
    } else {
      this.queueStandardTurnEvents(turnId, events);
    }
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
      provider_turn_id: turnId,
      provider_turn_id_kind: "provider_reported_turn_id",
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
