import { createHash } from "node:crypto";

export const DEBUG_ROUTEC_STRUCTURAL_REPLAY_PROVIDER_ID =
  "debug-routec-structural-replay";
export const DEBUG_ROUTEC_STRUCTURAL_REPLAY_MODEL_ID =
  "routec-structural-replay";
export const DEBUG_ROUTEC_STRUCTURAL_REPLAY_SCHEMA =
  "routec.debug_structural_replay_manifest.v1";

const PRIVATE_VALUE_PATTERNS = Object.freeze([
  /(?:^|[\s"'])https?:\/\//i,
  /(?:^|[\s"'])file:\/\//i,
  /\/Users\//,
  /\/home\//,
  /(?:^|[\s"'])![^\s:]+:[^\s"']+/,
  /(?:^|[\s"'])\$routec_[a-f0-9]+/i,
  /\b(?:token|password|secret|authorization|cookie)\b/i,
]);

const SUPPORTED_EVENT_KINDS = new Set([
  "message.assistant",
  "message.thinking",
  "tool.call",
  "tool.output",
  "tool.result",
  "tool.failure",
  "session.lifecycle",
  "control.request",
  "control.outcome",
]);

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function assertPositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
}

function canonicalManifestCore(manifest) {
  const { checksum: _checksum, ...core } = manifest;
  return core;
}

export function computeStructuralReplayManifestChecksum(manifest) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalManifestCore(manifest)))
    .digest("hex");
}

function assertNoPrivateStrings(value, path = "manifest") {
  if (typeof value === "string") {
    for (const pattern of PRIVATE_VALUE_PATTERNS) {
      if (pattern.test(value)) {
        throw new Error(`${path} contains a forbidden private value shape`);
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertNoPrivateStrings(entry, `${path}[${index}]`)
    );
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    assertNoPrivateStrings(entry, `${path}.${key}`);
  }
}

export function validateStructuralReplayManifest(manifest) {
  assertObject(manifest, "structural replay manifest");
  if (manifest.schema_version !== DEBUG_ROUTEC_STRUCTURAL_REPLAY_SCHEMA) {
    throw new Error("invalid structural replay manifest schema_version");
  }
  if (manifest.provider_id !== DEBUG_ROUTEC_STRUCTURAL_REPLAY_PROVIDER_ID) {
    throw new Error("invalid structural replay manifest provider_id");
  }
  if (manifest.sanitized !== true) {
    throw new Error("structural replay manifest must be sanitized");
  }
  if (!Array.isArray(manifest.turns) || manifest.turns.length === 0) {
    throw new Error("structural replay manifest turns are required");
  }
  assertPositiveInteger(
    manifest.source_shape?.source_event_count,
    "source_shape.source_event_count"
  );
  assertPositiveInteger(
    manifest.source_shape?.owner_turn_count,
    "source_shape.owner_turn_count"
  );
  if (manifest.source_shape.owner_turn_count !== manifest.turns.length) {
    throw new Error("owner turn count does not match manifest turns");
  }
  for (const [turnIndex, turn] of manifest.turns.entries()) {
    assertObject(turn, `turns[${turnIndex}]`);
    if (turn.id !== `turn-${String(turnIndex + 1).padStart(4, "0")}`) {
      throw new Error(`turns[${turnIndex}].id is not deterministic`);
    }
    if (!Array.isArray(turn.events)) {
      throw new Error(`turns[${turnIndex}].events must be an array`);
    }
    for (const [eventIndex, event] of turn.events.entries()) {
      assertObject(event, `turns[${turnIndex}].events[${eventIndex}]`);
      if (!SUPPORTED_EVENT_KINDS.has(event.kind)) {
        throw new Error(
          `turns[${turnIndex}].events[${eventIndex}] has unsupported kind ${event.kind}`
        );
      }
      if (event.ordinal !== eventIndex + 1) {
        throw new Error(
          `turns[${turnIndex}].events[${eventIndex}].ordinal is not contiguous`
        );
      }
    }
  }
  assertNoPrivateStrings(canonicalManifestCore(manifest));
  const checksum = computeStructuralReplayManifestChecksum(manifest);
  if (manifest.checksum !== checksum) {
    throw new Error("structural replay manifest checksum mismatch");
  }
  return manifest;
}

export function summarizeStructuralReplayDiversity(manifest) {
  const toolRunLengths = [];
  let singleAssistantTurns = 0;
  let multipleAssistantTurns = 0;
  let thinkingEvents = 0;
  let lifecycleEvents = 0;
  let controlEvents = 0;

  for (const turn of manifest.turns) {
    const assistantCount = turn.events.filter(
      (event) => event.kind === "message.assistant"
    ).length;
    if (assistantCount === 1) singleAssistantTurns += 1;
    if (assistantCount > 1) multipleAssistantTurns += 1;

    let currentToolRunLength = 0;
    for (const event of [...turn.events, { kind: "turn.end" }]) {
      if (event.kind.startsWith("tool.")) {
        currentToolRunLength += 1;
      } else if (currentToolRunLength > 0) {
        toolRunLengths.push(currentToolRunLength);
        currentToolRunLength = 0;
      }
      if (event.kind === "message.thinking") thinkingEvents += 1;
      if (event.kind === "session.lifecycle") lifecycleEvents += 1;
      if (
        event.kind === "control.request" ||
        event.kind === "control.outcome"
      ) {
        controlEvents += 1;
      }
    }
  }

  return {
    single_assistant_turns: singleAssistantTurns,
    multiple_assistant_turns: multipleAssistantTurns,
    tool_runs_below_10: toolRunLengths.filter((length) => length < 10).length,
    tool_runs_equal_10: toolRunLengths.filter((length) => length === 10).length,
    tool_runs_above_10: toolRunLengths.filter((length) => length > 10).length,
    max_tool_run_length: Math.max(0, ...toolRunLengths),
    thinking_events: thinkingEvents,
    lifecycle_events: lifecycleEvents,
    control_events: controlEvents,
  };
}

export function assertStructuralReplayDiversity(manifest) {
  const summary = summarizeStructuralReplayDiversity(manifest);
  const requiredPositiveFields = [
    "single_assistant_turns",
    "multiple_assistant_turns",
    "tool_runs_below_10",
    "tool_runs_equal_10",
    "tool_runs_above_10",
    "thinking_events",
    "lifecycle_events",
    "control_events",
  ];
  for (const field of requiredPositiveFields) {
    if (summary[field] < 1) {
      throw new Error(
        `structural replay manifest lacks required diversity: ${field}`
      );
    }
  }
  return summary;
}

export function bodySizeBucket(length) {
  const size = Number(length);
  if (!Number.isFinite(size) || size <= 0) return "empty";
  if (size <= 80) return "short";
  if (size <= 500) return "medium";
  if (size <= 4000) return "long";
  return "large";
}

export function timingBucket(deltaMs) {
  const delta = Number(deltaMs);
  if (!Number.isFinite(delta) || delta <= 100) return "immediate";
  if (delta <= 1000) return "short";
  if (delta <= 5000) return "medium";
  return "long";
}

function parseContent(contentJson) {
  if (typeof contentJson !== "string") return {};
  try {
    const parsed = JSON.parse(contentJson);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function replayTurnOrdinalFromProviderTurnId(value) {
  if (typeof value !== "string") return null;
  const match = /^debug-routec-structural-replay-turn-(\d+)$/.exec(value);
  if (!match) return null;
  const ordinal = Number(match[1]);
  return Number.isSafeInteger(ordinal) && ordinal > 0 ? ordinal : null;
}

export function auditStructuralReplayMatrixRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("structural replay Matrix rows are required");
  }
  let currentOwnerOrdinal = 0;
  let ownerEventCount = 0;
  let providerEventCount = 0;
  const completedTurnOrdinals = new Set();

  for (const [index, row] of rows.entries()) {
    const content = parseContent(row.content_json);
    if (row.semantic_type === "message.user") {
      const match = /^P015 Owner #(\d+)\b/.exec(
        typeof content.body === "string" ? content.body : ""
      );
      if (!match) {
        throw new Error(
          `structural replay Owner row ${index} lacks an ordinal`
        );
      }
      const ownerOrdinal = Number(match[1]);
      if (ownerOrdinal !== ownerEventCount + 1) {
        throw new Error(
          `structural replay Owner ordinals are not contiguous at ${ownerOrdinal}`
        );
      }
      currentOwnerOrdinal = ownerOrdinal;
      ownerEventCount += 1;
      continue;
    }

    const semantic =
      content["org.oysterun.semantic.v1"] &&
      typeof content["org.oysterun.semantic.v1"] === "object"
        ? content["org.oysterun.semantic.v1"]
        : {};
    const providerTurnOrdinal = replayTurnOrdinalFromProviderTurnId(
      semantic.provider_turn_id
    );
    if (providerTurnOrdinal === null) continue;
    providerEventCount += 1;
    if (providerTurnOrdinal !== currentOwnerOrdinal) {
      throw new Error(
        `structural replay provider turn ${providerTurnOrdinal} crossed Owner boundary ${currentOwnerOrdinal}`
      );
    }
    if (semantic.provider_completion_state === "turn_completed") {
      completedTurnOrdinals.add(providerTurnOrdinal);
    }
  }

  if (ownerEventCount === 0) {
    throw new Error("structural replay Matrix room has no Owner events");
  }
  for (let ordinal = 1; ordinal <= ownerEventCount; ordinal += 1) {
    if (!completedTurnOrdinals.has(ordinal)) {
      throw new Error(
        `structural replay Owner turn ${ordinal} lacks a Matrix completion boundary`
      );
    }
  }
  return {
    owner_event_count: ownerEventCount,
    provider_event_count: providerEventCount,
    completed_turn_count: completedTurnOrdinals.size,
    ordering_valid: true,
  };
}

function replayKindForSemanticType(semanticType) {
  switch (semanticType) {
    case "message.assistant":
      return "message.assistant";
    case "thinking.reasoning":
      return "message.thinking";
    case "tool.call":
    case "tool.output":
    case "tool.result":
    case "tool.failure":
    case "control.request":
    case "control.outcome":
      return semanticType;
    case "session_lifecycle":
      return "session.lifecycle";
    default:
      return null;
  }
}

function summarizeNumericDistribution(values) {
  if (values.length === 0) {
    return { min: 0, p50: 0, p90: 0, p99: 0, max: 0 };
  }
  const ordered = [...values].sort((a, b) => a - b);
  const percentile = (ratio) =>
    ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * ratio))];
  return {
    min: ordered[0],
    p50: percentile(0.5),
    p90: percentile(0.9),
    p99: percentile(0.99),
    max: ordered[ordered.length - 1],
  };
}

export function buildSanitizedStructuralReplayManifest({ rows, humanSender }) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("source Matrix rows are required");
  }
  if (typeof humanSender !== "string" || !humanSender.trim()) {
    throw new Error("source human sender is required");
  }

  const turns = [];
  const semanticCounts = {};
  const excludedCounts = {};
  const bodyBuckets = {};
  const callRefs = new Map();
  let nextCallRef = 1;
  let previousTimestamp = null;
  let currentTurn = null;

  const safeCallRef = (sourceCallId) => {
    if (typeof sourceCallId !== "string" || !sourceCallId.trim()) return null;
    if (!callRefs.has(sourceCallId)) {
      callRefs.set(
        sourceCallId,
        `call-${String(nextCallRef++).padStart(6, "0")}`
      );
    }
    return callRefs.get(sourceCallId);
  };

  for (const row of rows) {
    const content = parseContent(row.content_json);
    const body = typeof content.body === "string" ? content.body : "";
    const bucket = bodySizeBucket(body.length);
    bodyBuckets[bucket] = (bodyBuckets[bucket] || 0) + 1;
    const isHuman = row.sender === humanSender && row.is_state !== 1;
    const timestamp = Number(row.origin_server_ts);
    const eventTimingBucket = timingBucket(
      previousTimestamp === null ? 0 : timestamp - previousTimestamp
    );
    previousTimestamp = Number.isFinite(timestamp)
      ? timestamp
      : previousTimestamp;

    if (isHuman) {
      currentTurn = {
        id: `turn-${String(turns.length + 1).padStart(4, "0")}`,
        owner: {
          body_size_bucket: bucket,
          source_message_kind: content.msgtype === "m.image" ? "image" : "text",
        },
        events: [],
      };
      turns.push(currentTurn);
      continue;
    }

    if (!currentTurn) {
      excludedCounts.before_first_owner =
        (excludedCounts.before_first_owner || 0) + 1;
      continue;
    }
    if (row.is_state === 1) {
      excludedCounts.state_event = (excludedCounts.state_event || 0) + 1;
      continue;
    }

    const semanticType =
      typeof row.semantic_type === "string" ? row.semantic_type : "";
    const kind = replayKindForSemanticType(semanticType);
    if (!kind) {
      excludedCounts[semanticType || "unknown"] =
        (excludedCounts[semanticType || "unknown"] || 0) + 1;
      continue;
    }
    semanticCounts[semanticType] = (semanticCounts[semanticType] || 0) + 1;
    const semantic =
      content["org.oysterun.semantic.v1"] &&
      typeof content["org.oysterun.semantic.v1"] === "object"
        ? content["org.oysterun.semantic.v1"]
        : {};
    const callRef = safeCallRef(
      semantic.tool_call_id || semantic.call_id || semantic.toolCallId
    );
    const event = {
      ordinal: currentTurn.events.length + 1,
      kind,
      body_size_bucket: bucket,
      timing_bucket: eventTimingBucket,
    };
    if (callRef) event.call_ref = callRef;
    if (kind === "tool.failure") event.is_error = true;
    currentTurn.events.push(event);
  }

  if (turns.length === 0) {
    throw new Error("source Matrix rows contain no Host Owner turns");
  }

  const turnSizes = turns.map((turn) => turn.events.length);
  const core = {
    schema_version: DEBUG_ROUTEC_STRUCTURAL_REPLAY_SCHEMA,
    provider_id: DEBUG_ROUTEC_STRUCTURAL_REPLAY_PROVIDER_ID,
    model_id: DEBUG_ROUTEC_STRUCTURAL_REPLAY_MODEL_ID,
    sanitized: true,
    source_shape: {
      source_event_count: rows.length,
      owner_turn_count: turns.length,
      replayable_provider_event_count: turnSizes.reduce(
        (sum, value) => sum + value,
        0
      ),
      semantic_counts: semanticCounts,
      excluded_counts: excludedCounts,
      body_size_buckets: bodyBuckets,
      turn_event_distribution: summarizeNumericDistribution(turnSizes),
    },
    turns,
  };
  const manifest = {
    ...core,
    checksum: computeStructuralReplayManifestChecksum(core),
  };
  return validateStructuralReplayManifest(manifest);
}

const TARGET_TEXT_LENGTH = Object.freeze({
  empty: 0,
  short: 56,
  medium: 320,
  long: 2400,
  large: 8000,
});

export function buildSizedStructuralReplayText(label, bucket) {
  const target = TARGET_TEXT_LENGTH[bucket] ?? TARGET_TEXT_LENGTH.short;
  if (target === 0) return "";
  const seed = `${label} sanitized structural replay content `;
  return seed.repeat(Math.ceil(target / seed.length)).slice(0, target);
}
