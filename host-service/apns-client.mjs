import http2 from "http2";
import { randomUUID, sign } from "crypto";
import { readFileSync } from "fs";

const TOKEN_REFRESH_MAX_MS = 55 * 60 * 1000;
const APNS_PAYLOAD_LIMIT_BYTES = 4096;

function base64Url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function apnsHostForEnvironment(environment) {
  return environment === "production"
    ? "api.push.apple.com"
    : "api.sandbox.push.apple.com";
}

export function createApnsProviderToken({ keyId, teamId, privateKeyPem, nowMs = Date.now() }) {
  const normalizedKeyId = normalizeString(keyId);
  const normalizedTeamId = normalizeString(teamId);
  const normalizedPrivateKey = normalizeString(privateKeyPem);
  if (!normalizedKeyId) throw new Error("APNs key_id required");
  if (!normalizedTeamId) throw new Error("APNs team_id required");
  if (!normalizedPrivateKey) throw new Error("APNs private key required");

  const header = base64Url(
    JSON.stringify({
      alg: "ES256",
      kid: normalizedKeyId,
    })
  );
  const payload = base64Url(
    JSON.stringify({
      iss: normalizedTeamId,
      iat: Math.floor(nowMs / 1000),
    })
  );
  const unsigned = `${header}.${payload}`;
  const signature = sign("sha256", Buffer.from(unsigned), {
    key: normalizedPrivateKey,
    dsaEncoding: "ieee-p1363",
  });
  return `${unsigned}.${base64Url(signature)}`;
}

export class ApnsProviderTokenCache {
  constructor({ readPrivateKey = readFileSync } = {}) {
    this.readPrivateKey = readPrivateKey;
    this.cache = new Map();
  }

  getToken(config, nowMs = Date.now()) {
    const cacheKey = [
      config.environment,
      config.teamId,
      config.keyId,
      config.keyPath,
    ].join(":");
    const existing = this.cache.get(cacheKey);
    if (existing && nowMs - existing.createdAtMs < TOKEN_REFRESH_MAX_MS) {
      return existing.token;
    }

    const privateKeyPem = this.readPrivateKey(config.keyPath, "utf-8");
    const token = createApnsProviderToken({
      keyId: config.keyId,
      teamId: config.teamId,
      privateKeyPem,
      nowMs,
    });
    this.cache.set(cacheKey, { token, createdAtMs: nowMs });
    return token;
  }
}

export function buildApnsAlertPayload({
  title,
  body,
  sessionId,
  url,
  eventId = "",
  matrixEventId = "",
  turnId = "",
  sound = "default",
  oysterunType = "provider_complete",
  threadId = "",
  mailId = "",
  recipientUserId = "",
  extra = null,
}) {
  const normalizedSound = normalizeString(sound);
  const normalizedSessionId = normalizeString(sessionId);
  const normalizedOysterunType = normalizeString(oysterunType) || "provider_complete";
  const normalizedMailId = normalizeString(mailId);
  const normalizedRecipientUserId = normalizeString(recipientUserId);
  const payload = {
    aps: {
      alert: {
        title: normalizeString(title) || "Oysterun",
        body: normalizeString(body) || "Assistant reply is complete.",
      },
      "thread-id": normalizeString(threadId) || normalizedSessionId || "oysterun",
    },
    oysterun_type: normalizedOysterunType,
    url: normalizeString(url) || "/app",
  };
  if (normalizedSessionId) payload.host_session_id = normalizedSessionId;
  if (normalizedOysterunType === "provider_complete" && !normalizedSessionId) {
    payload.host_session_id = "";
  }
  if (normalizedMailId) payload.mail_id = normalizedMailId;
  if (normalizedRecipientUserId) payload.recipient_user_id = normalizedRecipientUserId;
  if (normalizedSound) {
    payload.aps.sound = normalizedSound;
  }
  if (extra && typeof extra === "object" && !Array.isArray(extra)) {
    for (const [key, value] of Object.entries(extra)) {
      if (key === "aps") continue;
      if (value !== undefined) payload[key] = value;
    }
  }
  const normalizedEventId = normalizeString(eventId);
  const normalizedMatrixEventId = normalizeString(matrixEventId);
  const normalizedTurnId = normalizeString(turnId);
  if (normalizedEventId) payload.event_id = normalizedEventId;
  if (normalizedMatrixEventId) payload.matrix_event_id = normalizedMatrixEventId;
  if (normalizedTurnId) payload.turn_id = normalizedTurnId;
  return payload;
}

export function buildApnsRequest({ config, deviceToken, providerToken, payload, collapseId = "" }) {
  const token = normalizeString(deviceToken);
  if (!token) throw new Error("APNs device token required");
  const body = JSON.stringify(payload);
  if (Buffer.byteLength(body, "utf-8") > APNS_PAYLOAD_LIMIT_BYTES) {
    throw new Error("APNs payload exceeds 4096 bytes");
  }
  return {
    host: apnsHostForEnvironment(config.environment),
    path: `/3/device/${token}`,
    body,
    headers: {
      ":method": "POST",
      ":path": `/3/device/${token}`,
      authorization: `bearer ${providerToken}`,
      "apns-id": randomUUID(),
      "apns-push-type": "alert",
      "apns-priority": "10",
      "apns-topic": config.topic,
      ...(collapseId ? { "apns-collapse-id": collapseId } : {}),
    },
  };
}

export async function sendApnsAlert({
  config,
  deviceToken,
  payload,
  collapseId = "",
  tokenCache = new ApnsProviderTokenCache(),
  http2Connect = http2.connect,
}) {
  const providerToken = tokenCache.getToken(config);
  const request = buildApnsRequest({
    config,
    deviceToken,
    providerToken,
    payload,
    collapseId,
  });
  const client = http2Connect(`https://${request.host}`);
  return await new Promise((resolve, reject) => {
    let settled = false;
    const closeClient = () => {
      try {
        client.close();
      } catch {
        // best effort cleanup
      }
    };
    client.on("error", (err) => {
      if (settled) return;
      settled = true;
      closeClient();
      reject(err);
    });
    const req = client.request(request.headers);
    let responseBody = "";
    let statusCode = 0;
    let apnsId = "";
    req.setEncoding("utf8");
    req.on("response", (headers) => {
      statusCode = Number(headers[":status"] || 0);
      apnsId = normalizeString(headers["apns-id"]);
    });
    req.on("data", (chunk) => {
      responseBody += chunk;
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      closeClient();
      let parsed = null;
      if (responseBody.trim()) {
        try {
          parsed = JSON.parse(responseBody);
        } catch {
          parsed = { raw: responseBody };
        }
      }
      resolve({
        ok: statusCode >= 200 && statusCode < 300,
        statusCode,
        apnsId,
        reason: parsed?.reason || null,
        body: parsed,
      });
    });
    req.on("error", (err) => {
      if (settled) return;
      settled = true;
      closeClient();
      reject(err);
    });
    req.end(request.body);
  });
}
