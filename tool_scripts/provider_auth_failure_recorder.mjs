#!/usr/bin/env node
import { readFileSync } from "fs";
import {
  buildProviderAuthFailureRecord,
  isProviderAuthFailureRecorderEnabled,
  writeProviderAuthFailureRecord,
} from "../host-service/provider-auth-failure-recorder.mjs";

function readStdinJson() {
  const raw = readFileSync(0, "utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

function readArgValue(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return "";
  return args[index + 1] || "";
}

const args = process.argv.slice(2);
const explicitEnable = args.includes("--enable");
const outputPath = readArgValue(args, "--output");
const cliScenario = readArgValue(args, "--scenario");
const cliProvider = readArgValue(args, "--provider");
const input = {
  ...readStdinJson(),
  ...(cliScenario ? { scenario: cliScenario } : {}),
  ...(cliProvider ? { provider: cliProvider } : {}),
};

const enabled = isProviderAuthFailureRecorderEnabled({
  explicit: explicitEnable,
});
const record = buildProviderAuthFailureRecord(input);
const result = writeProviderAuthFailureRecord({
  outputPath,
  record,
  enabled,
});

process.stdout.write(`${JSON.stringify({ ok: true, result }, null, 2)}\n`);
