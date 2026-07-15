import {
  normalizeProviderModel,
  normalizeProviderPermissionPolicy,
  normalizeProviderReasoningEffort,
  readConfig,
} from "./config.mjs";
import { resolveAgentRuntimeConfig } from "./agent-config.mjs";
import { requireProvider } from "./provider-registry.mjs";

export const OYSTERUN_SESSION_SETUP_PROVIDER_MODEL_PERMISSION_PROOF_CONTRACT =
  "oysterun_session_setup_provider_model_permission_v1";

function normalizeString(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  return String(value).trim();
}

function normalizeStringArray(value) {
  if (value === null || value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new Error("allowed_paths must be an array");
  }
  return value.map((entry) => normalizeString(entry)).filter(Boolean);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value || {}, key);
}

function isObjectRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readExplicitRequestedProvider(body = {}) {
  if (!hasOwn(body, "provider")) {
    return { requestedProvider: null, hasExplicitProvider: false };
  }
  if (typeof body.provider !== "string" || !body.provider.trim()) {
    return {
      error: "provider must be a non-empty string",
      requestedProvider: null,
      hasExplicitProvider: true,
    };
  }
  const normalizedProvider = body.provider.trim();
  try {
    return {
      requestedProvider: requireProvider(normalizedProvider, {
        config: readConfig(),
      }).id,
      hasExplicitProvider: true,
    };
  } catch (err) {
    return {
      error: err.message,
      requestedProvider: null,
      hasExplicitProvider: true,
    };
  }
}

export function buildRuntimeOverridesFromBody(
  body = {},
  requestedProvider = undefined
) {
  const overrides = {};

  if (requestedProvider !== undefined) overrides.provider = requestedProvider;
  else if (hasOwn(body, "provider")) overrides.provider = body.provider;
  if (hasOwn(body, "model")) overrides.model = body.model;
  if (hasOwn(body, "reasoning_effort")) {
    const providerId = requestedProvider || body.provider || "claude";
    overrides.reasoningEffort = normalizeProviderReasoningEffort(
      providerId,
      body.reasoning_effort
    );
  }
  if (hasOwn(body, "permission_mode")) {
    overrides.permissionMode = normalizeProviderPermissionPolicy(
      "claude",
      body.permission_mode
    );
  }
  if (hasOwn(body, "approval_policy")) {
    overrides.approvalPolicy = normalizeProviderPermissionPolicy(
      "codex",
      body.approval_policy
    );
  }
  if (hasOwn(body, "allowed_paths")) {
    overrides.allowedPaths = normalizeStringArray(body.allowed_paths);
  }
  if (hasOwn(body, "allow_dangerously_skip_permissions")) {
    overrides.allowDangerouslySkipPermissions =
      body.allow_dangerously_skip_permissions;
  }
  if (hasOwn(body, "dangerous_mode")) {
    overrides.dangerousMode = body.dangerous_mode;
  }
  if (hasOwn(body, "search_enabled")) {
    overrides.searchEnabled = body.search_enabled;
  }
  if (hasOwn(body, "image_input_enabled")) {
    overrides.imageInputEnabled = body.image_input_enabled;
  }
  if (hasOwn(body, "provider_args")) {
    overrides.providerArgs = body.provider_args;
  }
  if (hasOwn(body, "provider_config_overrides")) {
    overrides.providerConfigOverrides = body.provider_config_overrides;
  }
  if (hasOwn(body, "provider_commands")) {
    overrides.providerCommands = body.provider_commands;
  }
  if (hasOwn(body, "provider_profile")) {
    overrides.providerProfile = body.provider_profile;
  }

  return overrides;
}

export function providerMismatchResponse(requestedProvider, resolvedProvider) {
  return {
    error: `Resolved runtime provider mismatch: requested "${requestedProvider}" but resolved "${resolvedProvider}"`,
    requested_provider: requestedProvider,
    resolved_provider: resolvedProvider,
  };
}

export function getSessionSetupOysterunPermissionPolicyKind(providerId) {
  if (providerId === "codex") return "approval_policy";
  if (providerId === "claude") return "permission_mode";
  return "none";
}

function getSessionSetupRequestOysterunPermissionPolicy(body = {}, providerId) {
  const kind = getSessionSetupOysterunPermissionPolicyKind(providerId);
  if (kind === "approval_policy")
    return normalizeString(body.approval_policy) || null;
  if (kind === "permission_mode")
    return normalizeString(body.permission_mode) || null;
  return null;
}

function getSessionSetupResolvedOysterunPermissionPolicy(runtime = {}, providerId) {
  const kind = getSessionSetupOysterunPermissionPolicyKind(providerId);
  if (kind === "approval_policy") return runtime.approvalPolicy || null;
  if (kind === "permission_mode") return runtime.permissionMode || null;
  return null;
}

export function buildSessionSetupProviderModelPermissionFields({
  body = {},
  requestedProvider = null,
  resolved,
  session = null,
}) {
  const provider = session?.provider || resolved.runtime.provider;
  const model = session?.model || resolved.runtime.model || null;
  const permissionPolicyKind =
    getSessionSetupOysterunPermissionPolicyKind(provider);
  const requestPermissionPolicy =
    getSessionSetupRequestOysterunPermissionPolicy(body, provider);
  const responsePermissionPolicy =
    getSessionSetupResolvedOysterunPermissionPolicy(resolved.runtime, provider);
  const requestedModel = normalizeString(body.model) || null;
  const requestedModelCanonical = requestedModel
    ? normalizeProviderModel(provider, requestedModel)
    : null;
  const modelMatches =
    Boolean(requestedModel) &&
    (requestedModel === model ||
      (Boolean(requestedModelCanonical) && requestedModelCanonical === model));
  const permissionPolicyMatches =
    permissionPolicyKind === "none"
      ? requestPermissionPolicy === null && responsePermissionPolicy === null
      : Boolean(requestPermissionPolicy) &&
        Boolean(responsePermissionPolicy) &&
        requestPermissionPolicy === responsePermissionPolicy;
  return {
    provider,
    model,
    permissionPolicyKind,
    requestPermissionPolicy,
    responsePermissionPolicy,
    requestedProvider: requestedProvider || null,
    requestedModel,
    requestedModelCanonical,
    request_response_provider_model_permission_match:
      Boolean(requestedProvider) &&
      requestedProvider === provider &&
      modelMatches &&
      permissionPolicyMatches,
  };
}

export function sessionSetupProviderModelPermissionMismatchResponse(fields) {
  return {
    error: "Session setup provider/model/Oysterun permission proof mismatch",
    code: "session_setup_provider_model_permission_mismatch",
    contract: OYSTERUN_SESSION_SETUP_PROVIDER_MODEL_PERMISSION_PROOF_CONTRACT,
    request_provider: fields.requestedProvider,
    response_provider: fields.provider,
    request_model: fields.requestedModel,
    request_model_canonical: fields.requestedModelCanonical,
    response_model: fields.model,
    request_oysterun_permission_policy_kind: fields.permissionPolicyKind,
    request_oysterun_permission_policy: fields.requestPermissionPolicy,
    response_oysterun_permission_policy: fields.responsePermissionPolicy,
    request_response_provider_model_permission_match: false,
  };
}

export function sessionSetupProviderModelPermissionProofMismatchResponse(proof) {
  return {
    error: "Session setup provider/model/Oysterun permission proof mismatch",
    code: "session_setup_provider_model_permission_mismatch",
    contract: OYSTERUN_SESSION_SETUP_PROVIDER_MODEL_PERMISSION_PROOF_CONTRACT,
    proof_surface: proof.proof_surface,
    response_status: proof.response_status,
    session_id: proof.session_id,
    request_provider: proof.request_provider,
    response_provider: proof.provider,
    request_model: proof.request_model,
    request_model_canonical: proof.request_model_canonical,
    response_model: proof.model,
    request_oysterun_permission_policy_kind:
      proof.request_oysterun_permission_policy_kind,
    request_oysterun_permission_policy:
      proof.request_oysterun_permission_policy,
    response_oysterun_permission_policy:
      proof.response_oysterun_permission_policy ?? proof.oysterun_permission_policy,
    request_response_provider_model_permission_match: false,
  };
}

export function buildSessionSetupProviderModelPermissionProof({
  body = {},
  requestedProvider = null,
  resolved,
  session,
  proofSurface = "host_session_start_response",
  responseStatus = "session_started",
  sessionStartResponseContractCountable = true,
}) {
  const fields = buildSessionSetupProviderModelPermissionFields({
    body,
    requestedProvider,
    resolved,
    session,
  });
  return {
    contract: OYSTERUN_SESSION_SETUP_PROVIDER_MODEL_PERMISSION_PROOF_CONTRACT,
    proof_surface: proofSurface,
    response_status: responseStatus,
    session_id: session.id,
    request_provider: fields.requestedProvider,
    request_model: fields.requestedModel,
    request_model_canonical: fields.requestedModelCanonical,
    request_oysterun_permission_policy_kind: fields.permissionPolicyKind,
    request_oysterun_permission_policy: fields.requestPermissionPolicy,
    provider: fields.provider,
    model: fields.model,
    oysterun_permission_policy_kind: fields.permissionPolicyKind,
    oysterun_permission_policy: fields.responsePermissionPolicy,
    response_oysterun_permission_policy: fields.responsePermissionPolicy,
    permission_source_of_truth: "oysterun_session_setup",
    provider_native_permission_fields_derived_from_oysterun_policy: true,
    provider_native_permission_fields: {
      permission_mode: resolved.runtime.permissionMode || null,
      approval_policy: resolved.runtime.approvalPolicy || null,
      sandbox_mode: resolved.runtime.sandboxMode || null,
    },
    request_response_provider_model_permission_match:
      fields.request_response_provider_model_permission_match,
    session_start_response_contract_countable:
      sessionStartResponseContractCountable === true,
    resume_session_setup_runtime_gate_countable:
      proofSurface === "host_sessions_resume_response" ? false : undefined,
    request_must_be_visible_ui_click: true,
    visible_click_runtime_proof_required: true,
    visible_click_runtime_proof_present: false,
    direct_session_start_api_substitute_runtime_proof_required: true,
    direct_session_start_api_substitute_source_static_countable: false,
    source_static_proof_satisfies_direct_api_substitute_predicate: false,
    real_codex_non_substitution_required: fields.provider === "codex",
    delivery_gate_accepted: false,
    closeout_readiness_claimed: false,
    phase2_handoff_claimed: false,
  };
}

export function requireSchedulerTargetString(value, label) {
  const normalized = normalizeString(value);
  if (!normalized) {
    const err = new Error(`${label} required`);
    err.code = "scheduler_target_required_field_missing";
    throw err;
  }
  return normalized;
}

function assertExplicitSetupSnapshotRuntimeProof(snapshot, { label }) {
  if (!isObjectRecord(snapshot)) {
    const err = new Error(`${label} setup_snapshot must be an object`);
    err.code = "scheduler_setup_snapshot_invalid";
    throw err;
  }
  const provider = requireSchedulerTargetString(
    snapshot.provider,
    `${label} setup_snapshot.provider`
  );
  requireSchedulerTargetString(snapshot.model, `${label} setup_snapshot.model`);
  const reasoningEffort = requireSchedulerTargetString(
    snapshot.reasoning_effort,
    `${label} setup_snapshot.reasoning_effort`
  );
  if (!normalizeProviderReasoningEffort(provider, reasoningEffort, snapshot.model)) {
    const err = new Error(
      `${label} setup_snapshot.reasoning_effort is not valid for ${provider}`
    );
    err.code = "scheduler_setup_snapshot_reasoning_effort_invalid";
    throw err;
  }
  requireSchedulerTargetString(
    snapshot.agent_folder || snapshot.cwd,
    `${label} setup_snapshot.agent_folder`
  );
  if (provider === "codex") {
    requireSchedulerTargetString(
      snapshot.approval_policy,
      `${label} setup_snapshot.approval_policy`
    );
    if (normalizeString(snapshot.permission_mode)) {
      const err = new Error(
        `${label} setup_snapshot.permission_mode is not valid for Codex`
      );
      err.code = "scheduler_setup_snapshot_provider_permission_field_mismatch";
      throw err;
    }
  } else if (provider === "claude") {
    requireSchedulerTargetString(
      snapshot.permission_mode,
      `${label} setup_snapshot.permission_mode`
    );
    if (normalizeString(snapshot.approval_policy)) {
      const err = new Error(
        `${label} setup_snapshot.approval_policy is not valid for Claude`
      );
      err.code = "scheduler_setup_snapshot_provider_permission_field_mismatch";
      throw err;
    }
  } else {
    const err = new Error(
      `${label} setup_snapshot.provider is not supported for scheduler setup snapshots: ${provider}`
    );
    err.code = "scheduler_setup_snapshot_provider_unsupported";
    throw err;
  }
}

export function buildSchedulerSetupPayloadFromTargetBinding(targetBinding) {
  const setupPayload = isObjectRecord(targetBinding.setup_snapshot)
    ? { ...targetBinding.setup_snapshot }
    : isObjectRecord(targetBinding.session_setup_payload)
    ? { ...targetBinding.session_setup_payload }
    : {};
  const setupFields = isObjectRecord(targetBinding.session_setup_fields)
    ? targetBinding.session_setup_fields
    : {};
  const provider =
    normalizeString(setupPayload.provider) ||
    normalizeString(setupFields.provider);
  const model =
    normalizeString(setupPayload.model) || normalizeString(setupFields.model);
  if (provider) setupPayload.provider = provider;
  if (model) setupPayload.model = model;
  const agentFolder =
    normalizeString(setupPayload.agent_folder) ||
    normalizeString(setupPayload.cwd) ||
    normalizeString(setupFields.agent_folder) ||
    normalizeString(setupFields.agentFolder);
  if (agentFolder) {
    setupPayload.agent_folder = agentFolder;
    if (!setupPayload.cwd) setupPayload.cwd = agentFolder;
  }
  if (provider === "codex") {
    const approvalPolicy =
      normalizeString(setupPayload.approval_policy) ||
      normalizeString(setupFields.approval_policy) ||
      normalizeString(setupFields.approvalPolicy);
    if (approvalPolicy) setupPayload.approval_policy = approvalPolicy;
  } else if (provider === "claude") {
    const permissionMode =
      normalizeString(setupPayload.permission_mode) ||
      normalizeString(setupFields.permission_mode) ||
      normalizeString(setupFields.permissionMode);
    if (permissionMode) setupPayload.permission_mode = permissionMode;
  }
  return setupPayload;
}

export function resolveSchedulerSessionSetupRuntimeBase({
  agentFolder,
  sessionPayload,
}) {
  const explicitProvider = readExplicitRequestedProvider(sessionPayload);
  if (explicitProvider.error) {
    const err = new Error(explicitProvider.error);
    err.code = "scheduler_session_setup_provider_invalid";
    throw err;
  }
  const resolved = resolveAgentRuntimeConfig(
    agentFolder,
    buildRuntimeOverridesFromBody(
      sessionPayload,
      explicitProvider.requestedProvider ?? undefined
    )
  );
  if (
    explicitProvider.requestedProvider &&
    resolved.runtime.provider !== explicitProvider.requestedProvider
  ) {
    const err = new Error(
      providerMismatchResponse(
        explicitProvider.requestedProvider,
        resolved.runtime.provider
      ).error
    );
    err.code = "scheduler_session_setup_provider_mismatch";
    throw err;
  }
  if (!resolved.runtime.providerInfo.runtimeSupported) {
    const err = new Error(
      `Provider "${resolved.runtime.provider}" is not runtime-supported yet`
    );
    err.code = "scheduler_session_setup_provider_unsupported";
    throw err;
  }
  return { explicitProvider, resolved };
}

export function completeSchedulerSessionSetupPayloadForRuntime({
  agentFolder,
  sessionPayload,
  label,
  requireExplicitRuntimeProof = false,
}) {
  const completedPayload = { ...(sessionPayload || {}) };
  if (requireExplicitRuntimeProof) {
    assertExplicitSetupSnapshotRuntimeProof(completedPayload, { label });
  }
  const normalizedAgentFolder = requireSchedulerTargetString(
    agentFolder || completedPayload.agent_folder || completedPayload.cwd,
    `${label} agent_folder`
  );
  completedPayload.agent_folder = normalizedAgentFolder;
  if (!completedPayload.cwd) completedPayload.cwd = normalizedAgentFolder;

  const initialRuntime = resolveSchedulerSessionSetupRuntimeBase({
    agentFolder: normalizedAgentFolder,
    sessionPayload: completedPayload,
  });
  const provider = initialRuntime.resolved.runtime.provider;
  if (!completedPayload.provider) completedPayload.provider = provider;
  if (!completedPayload.model && initialRuntime.resolved.runtime.model) {
    completedPayload.model = initialRuntime.resolved.runtime.model;
  }
  if (
    !completedPayload.reasoning_effort &&
    initialRuntime.resolved.runtime.reasoningEffort
  ) {
    completedPayload.reasoning_effort =
      initialRuntime.resolved.runtime.reasoningEffort;
  }
  if (provider === "codex" && !completedPayload.approval_policy) {
    completedPayload.approval_policy =
      initialRuntime.resolved.runtime.approvalPolicy;
  } else if (provider === "claude" && !completedPayload.permission_mode) {
    completedPayload.permission_mode =
      initialRuntime.resolved.runtime.permissionMode;
  }

  const runtimeResolution = resolveSchedulerSessionSetupRuntime({
    agentFolder: normalizedAgentFolder,
    sessionPayload: completedPayload,
  });
  return {
    sessionPayload: completedPayload,
    agentFolder: normalizedAgentFolder,
    runtimeResolution,
  };
}

export function completeSchedulerSetupPayloadFromTargetBinding(
  targetBinding,
  { label = "scheduler_setup", requireExplicitRuntimeProof = false } = {}
) {
  const sessionPayload = buildSchedulerSetupPayloadFromTargetBinding(targetBinding);
  return completeSchedulerSessionSetupPayloadForRuntime({
    agentFolder: sessionPayload.agent_folder || sessionPayload.cwd,
    sessionPayload,
    label,
    requireExplicitRuntimeProof,
  });
}

export function resolveSchedulerSessionSetupRuntime({
  agentFolder,
  sessionPayload,
}) {
  const { explicitProvider, resolved } = resolveSchedulerSessionSetupRuntimeBase({
    agentFolder,
    sessionPayload,
  });
  const proofFields = buildSessionSetupProviderModelPermissionFields({
    body: sessionPayload,
    requestedProvider: explicitProvider.requestedProvider,
    resolved,
  });
  if (!proofFields.request_response_provider_model_permission_match) {
    const err = new Error(
      "Session setup provider/model/Oysterun permission proof mismatch"
    );
    err.code = "session_setup_provider_model_permission_mismatch";
    throw err;
  }
  return {
    explicitProvider,
    resolved,
  };
}
