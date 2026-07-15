#!/usr/bin/env node

import { readFileSync } from "fs";
import { stdin as processStdin } from "process";
import { pathToFileURL } from "url";

const BODY_FORMATS = new Set(["html"]);
const MULTI_VALUE_FLAGS = new Set(["tag", "link", "link-json"]);

function normalizeString(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function requireString(value, label) {
  const normalized = normalizeString(value);
  if (!normalized) {
    throw new Error(`${label} is required`);
  }
  return normalized;
}

function normalizeHostOrigin(value) {
  const origin = requireString(value, "OYSTERUN_HOST_ORIGIN");
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    throw new Error("OYSTERUN_HOST_ORIGIN must be an absolute URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("OYSTERUN_HOST_ORIGIN must use http or https");
  }
  return parsed.origin;
}

export function resolveRuntimeEnv(env = process.env) {
  const hostOrigin = normalizeHostOrigin(env.OYSTERUN_HOST_ORIGIN);
  const token =
    normalizeString(env.OYSTERUN_MAIL_WRITE_TOKEN) ||
    normalizeString(env.OYSTERUN_CAPABILITY_TOKEN);
  if (!token) {
    throw new Error(
      "OYSTERUN_MAIL_WRITE_TOKEN or OYSTERUN_CAPABILITY_TOKEN is required"
    );
  }
  return {
    hostOrigin,
    token,
    scheduleId: normalizeString(env.OYSTERUN_SCHEDULE_ID),
    scheduleRunId: normalizeString(env.OYSTERUN_SCHEDULE_RUN_ID),
    agentId: normalizeString(env.OYSTERUN_AGENT_ID),
  };
}

function toOptionKey(flag) {
  return flag.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}

function pushOption(options, key, value) {
  if (MULTI_VALUE_FLAGS.has(key)) {
    if (!Array.isArray(options[key])) options[key] = [];
    options[key].push(value);
    return;
  }
  options[key] = value;
}

export function parseArgs(argv = []) {
  const options = {
    bodyFormat: "html",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }
    const withoutPrefix = arg.slice(2);
    const equalsIndex = withoutPrefix.indexOf("=");
    let rawKey = withoutPrefix;
    let value = null;
    if (equalsIndex >= 0) {
      rawKey = withoutPrefix.slice(0, equalsIndex);
      value = withoutPrefix.slice(equalsIndex + 1);
    } else {
      if (index + 1 >= argv.length || argv[index + 1].startsWith("--")) {
        throw new Error(`Missing value for --${rawKey}`);
      }
      index += 1;
      value = argv[index];
    }
    const key = toOptionKey(rawKey);
    pushOption(options, key, value);
  }
  return options;
}

export function isFullDocumentHtml(body) {
  const lower = normalizeString(body).toLowerCase();
  return (
    lower.startsWith("<!doctype html") ||
    lower.startsWith("<html") ||
    lower.startsWith("<body")
  );
}

export function resolveBodyFormat(body, requestedFormat = "html") {
  void body;
  const normalizedFormat = normalizeString(requestedFormat || "html").toLowerCase();
  if (!BODY_FORMATS.has(normalizedFormat)) {
    throw new Error("body_format must be html");
  }
  return normalizedFormat;
}

function readStdinSync(stdin = processStdin) {
  try {
    if (stdin.isTTY) return "";
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

export function resolveBodyInput(options, stdin = processStdin) {
  void stdin;
  if (options.body !== undefined) {
    throw new Error("Mail body must come from a .html file; use --html-file <path>.html");
  }
  const filePath = requireString(
    options.htmlFile ||
      options.bodyHtmlFile ||
      options.bodyFile ||
      options.file,
    "html file path"
  );
  if (!filePath.toLowerCase().endsWith(".html")) {
    throw new Error("Mail deliverable must use a .html extension");
  }
  return readFileSync(filePath, "utf8");
}

function parseJsonObject(value, label) {
  const normalized = requireString(value, label);
  let parsed;
  try {
    parsed = JSON.parse(normalized);
  } catch (err) {
    throw new Error(`${label} must be valid JSON: ${err.message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed;
}

function parseTags(options) {
  const tags = [];
  for (const entry of Array.isArray(options.tag) ? options.tag : []) {
    const normalized = normalizeString(entry);
    if (normalized) tags.push(normalized);
  }
  if (options.tags !== undefined) {
    for (const entry of String(options.tags).split(",")) {
      const normalized = normalizeString(entry);
      if (normalized) tags.push(normalized);
    }
  }
  return tags.length ? tags : undefined;
}

function normalizeLink(link) {
  return {
    id: normalizeString(link.id) || undefined,
    label: normalizeString(link.label),
    href: normalizeString(link.href),
    link_type:
      normalizeString(link.link_type) ||
      normalizeString(link.linkType) ||
      "external",
  };
}

function parseDelimitedLink(value) {
  const parts = String(value).split("|");
  if (parts.length < 2 || parts.length > 3) {
    throw new Error("--link must use label|href or label|href|link_type");
  }
  return normalizeLink({
    label: parts[0],
    href: parts[1],
    link_type: parts[2] || "external",
  });
}

function parseLinkJson(value) {
  const parsed = JSON.parse(requireString(value, "link JSON"));
  if (Array.isArray(parsed)) return parsed.map(normalizeLink);
  if (parsed && typeof parsed === "object") return [normalizeLink(parsed)];
  throw new Error("link JSON must be an object or array");
}

function parseLinks(options) {
  const links = [];
  for (const value of Array.isArray(options.linkJson) ? options.linkJson : []) {
    links.push(...parseLinkJson(value));
  }
  for (const value of Array.isArray(options.link) ? options.link : []) {
    links.push(parseDelimitedLink(value));
  }
  return links.length ? links : undefined;
}

function addIfPresent(payload, key, value) {
  const normalized = normalizeString(value);
  if (normalized) payload[key] = normalized;
}

export function buildMailPayload(options, runtime, stdin = processStdin) {
  const title = requireString(options.title, "title");
  const body = resolveBodyInput(options, stdin);
  if (!normalizeString(body)) {
    throw new Error("body is required");
  }
  const bodyFormat = resolveBodyFormat(body, options.bodyFormat);
  const payload = {
    title,
    body_format: "html",
    body_html: body,
  };
  addIfPresent(payload, "id", options.id);
  addIfPresent(payload, "recipient_user_id", options.recipientUserId);
  addIfPresent(payload, "recipient_synapse_user_id", options.recipientSynapseUserId);
  addIfPresent(payload, "summary", options.summary);
  addIfPresent(payload, "source_type", options.sourceType);
  addIfPresent(payload, "source_name", options.sourceName);
  addIfPresent(payload, "source_ref", options.sourceRef);
  addIfPresent(payload, "session_id", options.sessionId);
  addIfPresent(payload, "site_url", options.siteUrl);
  addIfPresent(payload, "severity", options.severity);
  addIfPresent(payload, "idempotency_key", options.idempotencyKey);
  addIfPresent(payload, "schedule_id", runtime.scheduleId || options.scheduleId);
  addIfPresent(payload, "schedule_run_id", runtime.scheduleRunId || options.scheduleRunId);
  addIfPresent(payload, "agent_id", runtime.agentId || options.agentId);
  const tags = parseTags(options);
  if (tags) payload.tags = tags;
  if (options.metadataJson !== undefined) {
    payload.metadata = parseJsonObject(options.metadataJson, "metadata JSON");
  }
  const links = parseLinks(options);
  if (links) payload.links = links;
  return payload;
}

export function redactSensitiveText(value, tokens = []) {
  let text = String(value || "");
  for (const token of tokens) {
    const normalized = normalizeString(token);
    if (normalized) text = text.split(normalized).join("[redacted]");
  }
  return text;
}

async function readResponseBody(response, token) {
  const text = await response.text();
  const safeText = redactSensitiveText(text, [token]);
  try {
    return {
      value: JSON.parse(safeText),
      safeText,
    };
  } catch {
    return {
      value: null,
      safeText,
    };
  }
}

export function formatSuccessOutput(responseBody) {
  const mailId = requireString(responseBody?.mail_id || responseBody?.mail?.id, "mail_id");
  const url =
    normalizeString(responseBody?.url) ||
    `/app/mail/${encodeURIComponent(mailId)}`;
  return JSON.stringify({
    mail_id: mailId,
    url,
    created: responseBody?.created === false ? false : true,
  });
}

export function buildUsageText() {
  return [
    "Usage: node .codex/skills/Oysterun/modules/oysterun-mail/scripts/send_mail.mjs --title <title> --html-file <path>.html [options]",
    "",
    "Required env: OYSTERUN_HOST_ORIGIN and OYSTERUN_MAIL_WRITE_TOKEN or OYSTERUN_CAPABILITY_TOKEN",
    "Body options: --html-file <path>.html, --body-html-file <path>.html, or --body-file <path>.html",
    "Format: HTML only; markdown, auto, stdin, and plain text bodies are rejected.",
  ].join("\n");
}

export async function sendMail({
  argv = process.argv.slice(2),
  env = process.env,
  fetchFn = globalThis.fetch,
  stdout = process.stdout,
  stderr = process.stderr,
  stdin = processStdin,
} = {}) {
  const options = parseArgs(argv);
  if (options.help) {
    stdout.write(`${buildUsageText()}\n`);
    return { help: true };
  }
  const runtime = resolveRuntimeEnv(env);
  if (typeof fetchFn !== "function") {
    throw new Error("fetch API is not available in this Node runtime");
  }
  const payload = buildMailPayload(options, runtime, stdin);
  const endpoint = new URL("/mail/items", `${runtime.hostOrigin}/`).toString();
  const response = await fetchFn(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${runtime.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const responseBody = await readResponseBody(response, runtime.token);
  if (!response.ok) {
    throw new Error(
      `Mail create failed with HTTP ${response.status}: ${responseBody.safeText}`
    );
  }
  const output = formatSuccessOutput(responseBody.value);
  const safeOutput = redactSensitiveText(output, [runtime.token]);
  stdout.write(`${safeOutput}\n`);
  return {
    endpoint,
    payload,
    output: safeOutput,
    response: responseBody.value,
  };
}

export async function main() {
  try {
    await sendMail();
  } catch (err) {
    const envToken =
      normalizeString(process.env.OYSTERUN_MAIL_WRITE_TOKEN) ||
      normalizeString(process.env.OYSTERUN_CAPABILITY_TOKEN);
    process.stderr.write(`${redactSensitiveText(err.message, [envToken])}\n`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  await main();
}
