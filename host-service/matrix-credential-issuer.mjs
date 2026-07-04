import { createHash, randomUUID } from "crypto";
import { readConfig } from "./config.mjs";

const FACADE_TOKEN_PREFIX = "oysterun_facade_";
const facadeTokens = new Map();

function getFacadeTokenTtlMs() {
  return readConfig().debug_routec_facade_token_ttl_ms;
}

function buildExpiresAtMs(issuedAtMs, ttlMs) {
  if (ttlMs === -1) return null;
  return issuedAtMs + ttlMs;
}

function isExpiredFacadeTokenRecord(record, nowMs) {
  if (!record) return true;
  if (record.expires_at_ms === null) return false;
  return (
    !Number.isInteger(record.expires_at_ms) || record.expires_at_ms <= nowMs
  );
}

function pruneExpiredFacadeTokens(nowMs = Date.now()) {
  for (const [token, record] of facadeTokens.entries()) {
    if (isExpiredFacadeTokenRecord(record, nowMs)) {
      facadeTokens.delete(token);
    }
  }
}

function getBearerToken(req) {
  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.slice("Bearer ".length);
}

function getQueryAccessToken(url) {
  if (!(url instanceof URL)) return null;
  const token = url.searchParams.get("access_token");
  return typeof token === "string" && token.trim() ? token.trim() : null;
}

export function hashRouteCFacadeToken(accessToken) {
  if (typeof accessToken !== "string" || !accessToken.trim()) return null;
  return createHash("sha256").update(accessToken).digest("hex");
}

function buildFacadeAuthDiagnostic(token) {
  const activeFacadeTokenHashes = [...facadeTokens.keys()]
    .map(hashRouteCFacadeToken)
    .filter(Boolean);
  if (!token) {
    return {
      token_present: false,
      presented_token_kind: "missing",
      presented_facade_token_hash: null,
      active_facade_token_count: facadeTokens.size,
      active_facade_token_hashes: activeFacadeTokenHashes,
    };
  }
  const isFacadeToken = token.startsWith(FACADE_TOKEN_PREFIX);
  return {
    token_present: true,
    presented_token_kind: isFacadeToken
      ? "host_scoped_matrix_facade_token"
      : "non_oysterun_token",
    presented_facade_token_hash: isFacadeToken
      ? hashRouteCFacadeToken(token)
      : null,
    active_facade_token_count: facadeTokens.size,
    active_facade_token_hashes: activeFacadeTokenHashes,
  };
}

export function issueRouteCMatrixFacadeCredential({ binding, hostOrigin, claims }) {
  if (!binding?.host_session_id) {
    throw new Error("issueRouteCMatrixFacadeCredential requires binding.host_session_id");
  }
  if (!binding?.matrix_room_id) {
    throw new Error("issueRouteCMatrixFacadeCredential requires binding.matrix_room_id");
  }
  const issuedAtMs = Date.now();
  const ttlMs = getFacadeTokenTtlMs();
  const accessToken = `${FACADE_TOKEN_PREFIX}${randomUUID()}`;
  const record = {
    token_kind: "host_scoped_matrix_facade_token",
    access_token: accessToken,
    host_session_id: binding.host_session_id,
    host_agent_id: binding.host_agent_id,
    matrix_room_id: binding.matrix_room_id,
    matrix_user_id: binding.matrix_user_id,
    routec_matrix_actor_registry: binding.routec_matrix_actor_registry || null,
    routec_facade_sender_actor_key: "human",
    routec_facade_sender_restriction: "human_actor_only",
    device_id: `OYSTERUN_ROUTE_C_${binding.host_session_id}`,
    issued_to_user_id: claims?.user_id || null,
    issued_at_ms: issuedAtMs,
    expires_at_ms: buildExpiresAtMs(issuedAtMs, ttlMs),
    raw_synapse_token_exposed: false,
  };
  facadeTokens.set(accessToken, record);
  return {
    baseUrl: hostOrigin,
    accessToken,
    userId: record.matrix_user_id,
    deviceId: record.device_id,
    hostSessionId: binding.host_session_id,
    matrixRoomId: binding.matrix_room_id,
    routeCMatrixActorRegistry: record.routec_matrix_actor_registry,
    routeCFacadeSenderActorKey: record.routec_facade_sender_actor_key,
    routeCFacadeSenderRestriction: record.routec_facade_sender_restriction,
    expiresInMs: ttlMs === -1 ? null : ttlMs,
    tokenKind: record.token_kind,
    rawSynapseTokenExposed: false,
  };
}

export function authenticateRouteCMatrixFacadeRequest(
  req,
  { url, allowQueryAccessToken = false } = {}
) {
  pruneExpiredFacadeTokens();
  const token =
    getBearerToken(req) ||
    (allowQueryAccessToken ? getQueryAccessToken(url) : null);
  if (!token) {
    return {
      ok: false,
      status: 401,
      matrix_error: "M_MISSING_TOKEN",
      reason: "missing_host_scoped_facade_token",
      diagnostics: buildFacadeAuthDiagnostic(token),
    };
  }
  if (!token.startsWith(FACADE_TOKEN_PREFIX)) {
    return {
      ok: false,
      status: 401,
      matrix_error: "M_UNKNOWN_TOKEN",
      reason: "non_oysterun_facade_token_rejected",
      diagnostics: buildFacadeAuthDiagnostic(token),
    };
  }
  const record = facadeTokens.get(token);
  if (!record) {
    return {
      ok: false,
      status: 401,
      matrix_error: "M_UNKNOWN_TOKEN",
      reason: "expired_or_unknown_facade_token",
      diagnostics: buildFacadeAuthDiagnostic(token),
    };
  }
  return {
    ok: true,
    token_record: record,
  };
}

export function listRouteCFacadeTokenProofs() {
  pruneExpiredFacadeTokens();
  return [...facadeTokens.values()].map((record) => ({
    token_kind: record.token_kind,
    host_session_id: record.host_session_id,
    host_agent_id: record.host_agent_id,
    matrix_room_id: record.matrix_room_id,
    matrix_user_id: record.matrix_user_id,
    routec_matrix_actor_registry: record.routec_matrix_actor_registry,
    routec_facade_sender_actor_key: record.routec_facade_sender_actor_key,
    routec_facade_sender_restriction: record.routec_facade_sender_restriction,
    device_id: record.device_id,
    issued_to_user_id: record.issued_to_user_id,
    issued_at_ms: record.issued_at_ms,
    expires_at_ms: record.expires_at_ms,
    facade_token_hash: hashRouteCFacadeToken(record.access_token),
    raw_synapse_token_exposed: false,
  }));
}
