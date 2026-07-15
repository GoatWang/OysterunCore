import { existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { writeAtomicJsonFile } from "./atomic-file.mjs";
import { homedir } from "os";

const CONFIG_DIR =
  process.env.OYSTERUN_CONFIG_DIR || join(homedir(), ".oysterun");
const BINDING_PATH = join(CONFIG_DIR, "routec-matrix-bindings.json");
const ROUTEC_MATRIX_ACTOR_REGISTRY_VERSION = "routec.matrix_actor_registry.v1";
const ROUTEC_HUMAN_ACTOR_DISPLAY_NAME = "Host Owner";

function sanitizeBindingKey(value) {
  return String(value).replace(/[^A-Za-z0-9_.:-]/g, "_");
}

function sanitizeMatrixLocalpartSegment(value) {
  const sanitized = sanitizeBindingKey(value)
    .replace(/[:]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return sanitized || "actor";
}

function normalizeProviderId(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function uniqueProviderIds(...values) {
  return [...new Set(values.map(normalizeProviderId).filter(Boolean))];
}

function buildActorUserId({ agentId, sessionId, actorKey }) {
  return `@oysterun-${sanitizeMatrixLocalpartSegment(
    agentId
  )}-${sanitizeMatrixLocalpartSegment(
    sessionId
  )}-${sanitizeMatrixLocalpartSegment(actorKey)}:oysterun.local`;
}

function buildRouteCMatrixActor({
  actorKey,
  actorKind,
  matrixUserId,
  displayName,
  providerId = null,
  browserSendAllowed = false,
}) {
  if (!actorKey || !actorKind || !matrixUserId || !displayName) {
    throw new Error(
      "Route C Matrix actor requires actorKey, actorKind, matrixUserId, and displayName"
    );
  }
  return {
    actor_key: actorKey,
    actor_kind: actorKind,
    provider_id: providerId,
    matrix_user_id: matrixUserId,
    display_name: displayName,
    membership: "join",
    browser_send_allowed: browserSendAllowed,
    sender_source: browserSendAllowed
      ? "host_scoped_facade_human_actor"
      : "host_owned_routec_actor_registry",
  };
}

function providerDisplayName(providerId) {
  if (!providerId) return "Provider";
  if (providerId === "codex") return "Codex";
  if (providerId === "claude") return "Claude";
  return providerId
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeRouteCMatrixActorRegistry(registry) {
  if (
    registry?.registry_version !== ROUTEC_MATRIX_ACTOR_REGISTRY_VERSION ||
    !Array.isArray(registry.actors)
  ) {
    return registry;
  }
  return {
    ...registry,
    actors: registry.actors.map((actor) => {
      if (actor?.actor_key !== "human") return actor;
      if (actor.display_name === ROUTEC_HUMAN_ACTOR_DISPLAY_NAME) return actor;
      return {
        ...actor,
        display_name: ROUTEC_HUMAN_ACTOR_DISPLAY_NAME,
      };
    }),
  };
}

export function buildRouteCMatrixActorRegistry({
  session,
  agentId,
  matrixUserId,
}) {
  if (!session?.id) {
    throw new Error("buildRouteCMatrixActorRegistry requires session.id");
  }
  if (!agentId) {
    throw new Error("buildRouteCMatrixActorRegistry requires agentId");
  }
  if (!matrixUserId) {
    throw new Error("buildRouteCMatrixActorRegistry requires matrixUserId");
  }
  const sessionId = session.id;
  const actors = [
    buildRouteCMatrixActor({
      actorKey: "human",
      actorKind: "human",
      matrixUserId,
      displayName: ROUTEC_HUMAN_ACTOR_DISPLAY_NAME,
      browserSendAllowed: true,
    }),
    buildRouteCMatrixActor({
      actorKey: "assistant",
      actorKind: "assistant",
      matrixUserId: buildActorUserId({
        agentId,
        sessionId,
        actorKey: "assistant",
      }),
      displayName: "Oysterun Assistant",
    }),
    buildRouteCMatrixActor({
      actorKey: "host",
      actorKind: "host",
      matrixUserId: buildActorUserId({ agentId, sessionId, actorKey: "host" }),
      displayName: "Oysterun Host",
    }),
    buildRouteCMatrixActor({
      actorKey: "tool",
      actorKind: "tool",
      matrixUserId: buildActorUserId({ agentId, sessionId, actorKey: "tool" }),
      displayName: "Oysterun Tool",
    }),
    buildRouteCMatrixActor({
      actorKey: "control",
      actorKind: "control",
      matrixUserId: buildActorUserId({
        agentId,
        sessionId,
        actorKey: "control",
      }),
      displayName: "Oysterun Control",
    }),
  ];
  for (const providerId of uniqueProviderIds(
    session.provider,
    session.adapterId
  )) {
    actors.push(
      buildRouteCMatrixActor({
        actorKey: `assistant:${providerId}`,
        actorKind: "assistant",
        providerId,
        matrixUserId: buildActorUserId({
          agentId,
          sessionId,
          actorKey: `assistant-${providerId}`,
        }),
        displayName: providerDisplayName(providerId),
      })
    );
    actors.push(
      buildRouteCMatrixActor({
        actorKey: `control:${providerId}`,
        actorKind: "control",
        providerId,
        matrixUserId: buildActorUserId({
          agentId,
          sessionId,
          actorKey: `control-${providerId}`,
        }),
        displayName: `${providerDisplayName(providerId)} Control`,
      })
    );
  }
  return {
    registry_version: ROUTEC_MATRIX_ACTOR_REGISTRY_VERSION,
    source_of_truth: "host_owned_routec_matrix_room_binding",
    committed_sender_truth: "matrix_event_sender",
    semantic_role_is_sender: false,
    actors,
  };
}

export function getRouteCMatrixActorRegistry(binding) {
  const registry = binding?.routec_matrix_actor_registry;
  if (
    registry?.registry_version === ROUTEC_MATRIX_ACTOR_REGISTRY_VERSION &&
    Array.isArray(registry.actors)
  ) {
    return normalizeRouteCMatrixActorRegistry(registry);
  }
  if (
    !binding?.host_session_id ||
    !binding?.host_agent_id ||
    !binding?.matrix_user_id
  ) {
    throw new Error(
      "Route C Matrix actor registry requires host session, agent, and matrix user binding"
    );
  }
  return buildRouteCMatrixActorRegistry({
    session: {
      id: binding.host_session_id,
      provider: binding.provider_id || binding.provider || null,
      adapterId: binding.adapter_id || null,
    },
    agentId: binding.host_agent_id,
    matrixUserId: binding.matrix_user_id,
  });
}

export function getRouteCMatrixActorByKey(binding, actorKey) {
  const registry = getRouteCMatrixActorRegistry(binding);
  return registry.actors.find((actor) => actor.actor_key === actorKey) || null;
}

export function getRouteCMatrixActorByUserId(binding, matrixUserId) {
  const registry = getRouteCMatrixActorRegistry(binding);
  return (
    registry.actors.find((actor) => actor.matrix_user_id === matrixUserId) ||
    null
  );
}

export function resolveRouteCMatrixActorForSemantic({
  binding,
  semanticType,
  providerId = null,
  controlOrigin = null,
  controlFamily = null,
}) {
  const providerKey = normalizeProviderId(providerId);
  const candidates = [];
  switch (semanticType) {
    case "message.assistant":
    case "thinking.reasoning":
      if (providerKey) candidates.push(`assistant:${providerKey}`);
      candidates.push("assistant");
      break;
    case "tool.call":
    case "tool.update":
    case "tool.output":
    case "tool.result":
    case "tool.failure":
      candidates.push("tool");
      break;
    case "control.request":
      if (
        controlOrigin === "provider" ||
        controlFamily === "provider_request"
      ) {
        if (providerKey) candidates.push(`control:${providerKey}`);
        candidates.push("control");
      } else {
        candidates.push("control", "host");
      }
      break;
    case "control.outcome":
    case "control.cancel.outcome":
    case "terminal.command.started":
    case "terminal.command.result":
    case "runtime.error":
    case "session_lifecycle":
    case "outbox.delivery":
    case "ambiguous.stalled":
      candidates.push("host");
      break;
    default:
      candidates.push("host");
      break;
  }
  for (const candidate of candidates) {
    const actor = getRouteCMatrixActorByKey(binding, candidate);
    if (actor) return actor;
  }
  throw new Error(
    `Route C Matrix actor not found for semantic sender: ${
      semanticType || "missing"
    }`
  );
}

function readBindingStore() {
  if (!existsSync(BINDING_PATH)) return {};
  const parsed = JSON.parse(readFileSync(BINDING_PATH, "utf-8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid Route C matrix binding store: ${BINDING_PATH}`);
  }
  return parsed;
}

function writeBindingStore(store) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeAtomicJsonFile(BINDING_PATH, store);
}

function resolveMatrixRoomId({ sessionId, requestedRoomId, existingRoomId }) {
  const configuredRoomId = requestedRoomId || existingRoomId || null;
  if (configuredRoomId) {
    return {
      matrix_room_id: configuredRoomId,
      binding_source: requestedRoomId
        ? "request"
        : "host_session_binding_store",
      matrix_room_ready: true,
    };
  }
  return {
    matrix_room_id: `!oysterun-routec-${sanitizeBindingKey(
      sessionId
    )}:oysterun.local`,
    binding_source: "host_session_id_deterministic_room",
    matrix_room_ready: true,
  };
}

export function createRouteCMatrixRoomBinding({
  session,
  agentId,
  requestedRoomId = null,
  matrixUserId = null,
}) {
  if (!session || typeof session !== "object") {
    throw new Error("createRouteCMatrixRoomBinding requires session object");
  }
  if (!session.id) {
    throw new Error("createRouteCMatrixRoomBinding requires session.id");
  }
  if (!agentId) {
    throw new Error("createRouteCMatrixRoomBinding requires agentId");
  }
  const now = new Date().toISOString();
  const existingStore = readBindingStore();
  const existing = existingStore[session.id] || {};
  const resolvedRoom = resolveMatrixRoomId({
    sessionId: session.id,
    requestedRoomId,
    existingRoomId: existing.matrix_room_id,
  });
  const binding = {
    host_session_id: session.id,
    parent_session_id:
      session.parentSessionId || existing.parent_session_id || null,
    host_agent_id: agentId,
    host_session_name: session.sessionName || null,
    provider_id: session.provider || session.adapterId || null,
    matrix_room_id: resolvedRoom.matrix_room_id,
    matrix_room_ready: resolvedRoom.matrix_room_ready,
    binding_source: resolvedRoom.binding_source,
    matrix_user_id:
      matrixUserId ||
      existing.matrix_user_id ||
      `@oysterun-${sanitizeBindingKey(agentId)}-${sanitizeBindingKey(
        session.id
      )}:oysterun.local`,
    created_at: existing.created_at || now,
    updated_at: now,
    committed_transcript_truth: "matrix_room_timeline",
    host_truth_scope: [
      "session_metadata",
      "matrix_room_binding",
      "matrix_actor_registry",
      "facade_auth",
      "outbox_correlation",
      "diagnostic_artifacts",
    ],
  };
  binding.routec_matrix_actor_registry = buildRouteCMatrixActorRegistry({
    session,
    agentId,
    matrixUserId: binding.matrix_user_id,
  });
  existingStore[session.id] = binding;
  writeBindingStore(existingStore);
  return binding;
}

export function getRouteCMatrixRoomBinding(hostSessionId) {
  if (!hostSessionId) return null;
  const store = readBindingStore();
  return store[hostSessionId] || null;
}

export function requireRouteCMatrixRoomBinding(hostSessionId) {
  const binding = getRouteCMatrixRoomBinding(hostSessionId);
  if (!binding) {
    throw new Error(
      `Route C Matrix room binding not found for host session: ${hostSessionId}`
    );
  }
  return binding;
}

export function getRouteCMatrixBindingStorePath() {
  return BINDING_PATH;
}
