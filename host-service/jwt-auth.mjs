import { createVerify, createPublicKey } from "crypto";

/**
 * Validates ES256 JWT access tokens from Oysterun Cloud.
 *
 * The device signing public key is stored locally at setup time.
 * No Cloud call needed for validation.
 */

/**
 * Decode and verify an ES256 JWT access_token.
 *
 * @param {string} token - The JWT string (header.payload.signature)
 * @param {string} deviceSigningPublicKeyPem - PEM-encoded EC public key from Cloud
 * @param {string | null} expectedKid - Expected key ID for this device
 * @param {string} expectedDeviceId - This device's ID (reject tokens for other devices)
 * @returns {{ user_id: string, client_key_id: string, device_id: string, agent_ids: string[], agent_perms: Record<string, Record<string, boolean>> }} Decoded claims
 * @throws {Error} If token is invalid, expired, or for wrong device
 */
export function verifyAccessToken(token, deviceSigningPublicKeyPem, expectedKid, expectedDeviceId) {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid JWT format");
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  // 1. Decode header and verify algorithm
  const header = JSON.parse(base64UrlDecode(headerB64));
  if (header.alg !== "ES256") {
    throw new Error(`Unsupported algorithm: ${header.alg}`);
  }
  if (!header.kid) {
    throw new Error("JWT missing required kid header");
  }
  if (expectedKid && header.kid !== expectedKid) {
    throw new Error(`JWT kid mismatch: expected ${expectedKid}, got ${header.kid}`);
  }

  // 2. Verify signature
  const signingInput = `${headerB64}.${payloadB64}`;
  const signature = base64UrlToBuffer(signatureB64);

  // ES256 JWT uses raw R||S format (64 bytes), but Node's crypto expects DER
  const derSignature = rawToDer(signature);

  const publicKey = createPublicKey({
    key: deviceSigningPublicKeyPem,
    format: "pem",
    type: "spki",
  });

  const verifier = createVerify("SHA256");
  verifier.update(signingInput);
  const valid = verifier.verify(
    { key: publicKey, dsaEncoding: "der" },
    derSignature,
  );

  if (!valid) {
    throw new Error("Invalid JWT signature");
  }

  // 3. Decode payload
  const payload = JSON.parse(base64UrlDecode(payloadB64));

  // 4. Validate issuer and audience
  if (payload.iss !== "oysterun-cloud") {
    throw new Error(`JWT issuer mismatch: expected "oysterun-cloud", got "${payload.iss}"`);
  }
  if (payload.aud !== expectedDeviceId) {
    throw new Error(`JWT audience mismatch: expected ${expectedDeviceId}, got ${payload.aud}`);
  }

  // 5. Check time claims (all REQUIRED)
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number") {
    throw new Error("JWT missing required exp claim");
  }
  if (payload.exp <= now) {
    throw new Error("JWT expired");
  }
  if (typeof payload.nbf === "number" && payload.nbf > now) {
    throw new Error("JWT not yet valid (nbf is in the future)");
  }

  // 6. Check device_id
  if (payload.device_id !== expectedDeviceId) {
    throw new Error(`JWT device_id mismatch: expected ${expectedDeviceId}, got ${payload.device_id}`);
  }

  // 7. Validate required claims
  if (!payload.user_id) {
    throw new Error("JWT missing required user_id claim");
  }
  if (!payload.client_key_id) {
    throw new Error("JWT missing required client_key_id claim");
  }
  if (!Array.isArray(payload.agent_ids)) {
    throw new Error("JWT missing required agent_ids claim");
  }
  if (!payload.agent_perms || typeof payload.agent_perms !== "object") {
    throw new Error("JWT missing required agent_perms claim");
  }

  return {
    user_id: payload.user_id,
    client_key_id: payload.client_key_id,
    device_id: payload.device_id,
    agent_ids: payload.agent_ids,
    agent_perms: payload.agent_perms,
  };
}

/**
 * Extract and verify the Bearer token from an HTTP request.
 *
 * @param {import("http").IncomingMessage} req
 * @param {string} deviceSigningPublicKeyPem
 * @param {string | null} expectedKid
 * @param {string} deviceId
 * @returns {{ user_id: string, client_key_id: string, device_id: string, agent_ids: string[], agent_perms: Record<string, Record<string, boolean>> }}
 * @throws {Error} If missing or invalid
 */
export function authenticateRequest(req, deviceSigningPublicKeyPem, expectedKid, deviceId) {
  const authHeader = req.headers["authorization"];
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new Error("Missing or invalid Authorization header");
  }

  const token = authHeader.slice(7);
  return verifyAccessToken(token, deviceSigningPublicKeyPem, expectedKid, deviceId);
}

// ── Base64URL helpers ─────────────────────────────────────────

function base64UrlDecode(str) {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64").toString("utf-8");
}

function base64UrlToBuffer(str) {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64");
}

/**
 * Convert raw R||S signature (64 bytes for P-256) to DER format.
 * Node.js crypto.verify expects DER-encoded ECDSA signatures.
 */
function rawToDer(rawSig) {
  if (rawSig.length !== 64) {
    // Already DER or unexpected format — return as-is
    return rawSig;
  }

  const r = rawSig.subarray(0, 32);
  const s = rawSig.subarray(32, 64);

  function encodeInteger(buf) {
    // If high bit is set, prepend 0x00
    if (buf[0] & 0x80) {
      return Buffer.concat([Buffer.from([0x02, buf.length + 1, 0x00]), buf]);
    }
    // Strip leading zeros (but keep at least one byte)
    let start = 0;
    while (start < buf.length - 1 && buf[start] === 0) start++;
    const trimmed = buf.subarray(start);
    if (trimmed[0] & 0x80) {
      return Buffer.concat([Buffer.from([0x02, trimmed.length + 1, 0x00]), trimmed]);
    }
    return Buffer.concat([Buffer.from([0x02, trimmed.length]), trimmed]);
  }

  const rDer = encodeInteger(r);
  const sDer = encodeInteger(s);
  const totalLen = rDer.length + sDer.length;

  return Buffer.concat([Buffer.from([0x30, totalLen]), rDer, sDer]);
}
