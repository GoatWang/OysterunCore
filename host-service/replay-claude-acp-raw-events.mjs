#!/usr/bin/env node

import {
  chmodSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

import {
  ClaudeAcpAssistantMessageAssembler,
  normalizeClaudeSessionUpdate,
} from "./adapters/claude-code-adapter.mjs";

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--input" || arg === "--output" || arg === "--session-id") {
      const value = argv[index + 1];
      if (!value) throw new Error(`${arg} requires a value`);
      options[arg.slice(2).replaceAll("-", "_")] = value;
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.input) throw new Error("--input is required");
  if (!options.output) throw new Error("--output is required");
  return options;
}

function redactSensitiveString(value) {
  return String(value)
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]")
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, "[redacted-anthropic-key]")
    .replace(/\b\d{8,12}:[A-Za-z0-9_-]{20,}\b/g, "[redacted-telegram-token]");
}

function redactSensitive(value, key = "") {
  if (/token|secret|password|credential|authorization|cookie/i.test(key)) {
    return "[redacted]";
  }
  if (typeof value === "string") return redactSensitiveString(value);
  if (Array.isArray(value)) {
    return value.map((entry) => redactSensitive(entry));
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      redactSensitive(entryValue, entryKey),
    ])
  );
}

function readTrace(path) {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        const parsed = JSON.parse(line);
        return {
          at: parsed.at ?? null,
          sequence: Number(parsed.sequence) || index + 1,
          direction: parsed.direction ?? "in",
          message: parsed.message ?? parsed,
        };
      } catch (error) {
        throw new Error(`invalid JSONL at line ${index + 1}: ${error.message}`);
      }
    });
}

function isPromptResult(message) {
  return Boolean(
    message &&
      typeof message === "object" &&
      !message.method &&
      message.result &&
      typeof message.result === "object" &&
      (Object.prototype.hasOwnProperty.call(message.result, "stopReason") ||
        Object.prototype.hasOwnProperty.call(message.result, "stop_reason"))
  );
}

function isVisibleArrangementEvent(event) {
  if (event?.type === "message.assistant") return event.delta !== true;
  return typeof event?.type === "string" && event.type.startsWith("tool.");
}

export function replayClaudeAcpRawRecords(records, { sessionId = "" } = {}) {
  const assembler = new ClaudeAcpAssistantMessageAssembler();
  const seenUpdates = new Set();
  const selectedRawRecords = [];
  const deterministicEvents = [];

  const appendEvent = (event, sourceSequence, trigger) => {
    deterministicEvents.push({ source_sequence: sourceSequence, trigger, event });
  };

  for (const record of records) {
    if (record.direction !== "in") continue;
    const message = record.message;
    if (!message || typeof message !== "object") continue;
    if (message.method === "session/update") {
      const recordSessionId = String(message.params?.sessionId ?? "");
      if (sessionId && recordSessionId !== sessionId) continue;
      selectedRawRecords.push(record);
      const dedupeKey = JSON.stringify(message.params ?? {});
      if (seenUpdates.has(dedupeKey)) continue;
      seenUpdates.add(dedupeKey);
      for (const event of normalizeClaudeSessionUpdate(message.params)) {
        for (const assembledEvent of assembler.consume(event)) {
          appendEvent(assembledEvent, record.sequence, "session/update");
        }
      }
      continue;
    }
    if (isPromptResult(message)) {
      selectedRawRecords.push(record);
      const confirmed = assembler.flush();
      if (confirmed) {
        appendEvent(confirmed, record.sequence, "session/prompt result");
      }
    }
  }

  const trailing = assembler.flush();
  if (trailing) {
    const lastSequence = selectedRawRecords.at(-1)?.sequence ?? null;
    appendEvent(trailing, lastSequence, "end of recording");
  }

  return {
    raw_records: selectedRawRecords,
    deterministic_events: deterministicEvents,
    visible_arrangement: deterministicEvents.filter((entry) =>
      isVisibleArrangementEvent(entry.event)
    ),
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const inputPath = resolve(options.input);
  const outputPath = resolve(options.output);
  const records = readTrace(inputPath);
  const replay = replayClaudeAcpRawRecords(records, {
    sessionId: options.session_id ?? "",
  });
  const output = {
    schema: "oysterun.claude_acp_adapter_replay.v1",
    generated_at: new Date().toISOString(),
    input_path: inputPath,
    session_id_filter: options.session_id ?? null,
    raw_record_count: replay.raw_records.length,
    deterministic_event_count: replay.deterministic_events.length,
    visible_arrangement_count: replay.visible_arrangement.length,
    raw_records: replay.raw_records.map((record) => redactSensitive(record)),
    deterministic_events: replay.deterministic_events.map((entry) =>
      redactSensitive(entry)
    ),
    visible_arrangement: replay.visible_arrangement.map((entry) =>
      redactSensitive(entry)
    ),
  };
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  chmodSync(outputPath, 0o600);
  process.stdout.write(
    `${JSON.stringify({
      output: outputPath,
      raw_record_count: output.raw_record_count,
      deterministic_event_count: output.deterministic_event_count,
      visible_arrangement_count: output.visible_arrangement_count,
    })}\n`
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  main();
}
