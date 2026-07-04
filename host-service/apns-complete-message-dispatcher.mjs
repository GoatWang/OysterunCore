import { appendFileSync, mkdirSync } from "fs";
import { join } from "path";
import { buildApnsAlertPayload, ApnsProviderTokenCache } from "./apns-client.mjs";
import { readApnsLocalConfig } from "./apns-config.mjs";
import { buildCloudApiUrl, readConfig, resolveCloudBackendStage } from "./config.mjs";
import { dedupeApnsDevicesByToken } from "./apns-device-store.mjs";
import { OYSTERUN_SEMANTIC_NAMESPACE } from "./matrix-event-writer.mjs";
import {
  normalizeCommittedProviderOutputMatrixNotificationCandidate,
  normalizeProviderCompletionReleaseMarker,
} from "./complete-message-notification-predicate.mjs";

const MAX_HANDLED_KEYS = 500;
const APNS_RUNTIME_OBSERVABILITY_FILE = "apns-runtime-observability.jsonl";
const APNS_RUNTIME_OBSERVABILITY_MARKER = "oysterun_apns_runtime_observability_v1";
const IOS_SILENT_NOTIFICATION_SOUND = "oysterun_silent.caf";

export function isApnsRuntimeObservabilityEnabled(config = readConfig()) {
  return (
    config.debug_host_artifact_writes_enabled === true &&
    config.debug_apns_runtime_observability_enabled === true
  );
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function semanticTypeOf(payload) {
  return (
    normalizeString(payload?.semantic_type) ||
    normalizeString(payload?.semantic_category)
  );
}

function getMatrixEventId(event) {
  return normalizeString(event?.event_id) || normalizeString(event?.eventId);
}

function getMatrixRoomId(event, semanticPayload) {
  return (
    normalizeString(event?.room_id) ||
    normalizeString(event?.roomId) ||
    normalizeString(semanticPayload?.matrix_room_id)
  );
}

function getMatrixEventContent(event) {
  const content = event?.content;
  return content && typeof content === "object" && !Array.isArray(content)
    ? content
    : null;
}

function getMatrixSemanticPayload(content) {
  const payload = content?.[OYSTERUN_SEMANTIC_NAMESPACE];
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload
    : null;
}

function notificationBodyFromMatrixContent(content) {
  return normalizeString(content?.body);
}

function getMatrixSemanticType(matrixEvent) {
  const content = getMatrixEventContent(matrixEvent);
  const semanticPayload = content ? getMatrixSemanticPayload(content) : null;
  return semanticPayload ? semanticTypeOf(semanticPayload) : "";
}

function normalizeProviderTurnIdFromRuntimeEvent(event) {
  return (
    normalizeString(event?.provider_turn_id) ||
    normalizeString(event?.providerTurnId) ||
    normalizeString(event?.turn_id) ||
    normalizeString(event?.turnId) ||
    normalizeString(event?.routec_matrix_delivery?.provider_turn_id)
  );
}

function apnsRuntimeObservabilityPath(configDir) {
  return join(configDir, APNS_RUNTIME_OBSERVABILITY_FILE);
}

function buildApnsRuntimeRecord({
  stage,
  matrixEventId,
  semanticType,
  candidateCreated,
  selectedDeviceCount,
  tokenSuffix = null,
  apnsStatusCode = null,
  apnsId = null,
  apnsReason = null,
  ok = null,
}) {
  const normalizedApnsStatusCode =
    apnsStatusCode !== null &&
    apnsStatusCode !== undefined &&
    Number.isFinite(Number(apnsStatusCode))
      ? Number(apnsStatusCode)
      : null;
  return {
    marker: APNS_RUNTIME_OBSERVABILITY_MARKER,
    recorded_at: new Date().toISOString(),
    stage,
    matrix_event_id: matrixEventId || null,
    semantic_type: semanticType || null,
    on_committed_matrix_event_observed: true,
    candidate_created: candidateCreated === true,
    selected_device_count: Number.isFinite(Number(selectedDeviceCount))
      ? Number(selectedDeviceCount)
      : null,
    token_suffix: tokenSuffix || null,
    apns_status_code: normalizedApnsStatusCode,
    apns_id: apnsId || null,
    apns_reason: apnsReason || null,
    ok,
  };
}

export function buildCommittedProviderOutputMatrixNotificationCandidate(
  matrixEvent,
  { getSession = () => null } = {}
) {
  const content = getMatrixEventContent(matrixEvent);
  if (!content) return null;
  const semanticPayload = getMatrixSemanticPayload(content);
  const matrixEventId = getMatrixEventId(matrixEvent);
  const matrixRoomId = getMatrixRoomId(matrixEvent, semanticPayload);
  const hostSessionId =
    normalizeString(semanticPayload?.host_session_id) ||
    normalizeString(matrixEvent?.unsigned?.host_session_id);
  const session = getSession(hostSessionId);
  const result = normalizeCommittedProviderOutputMatrixNotificationCandidate({
    eventType: matrixEvent?.type,
    matrixEventId,
    matrixRoomId,
    hostSessionId,
    contentBody: notificationBodyFromMatrixContent(content),
    contentDelta: content.delta === true,
    semanticPayload,
    sessionName: session?.sessionName,
  });
  return result.accepted ? result.candidate : null;
}

export class ApnsCompleteMessageDispatcher {
  constructor({
    deviceStore,
    sendApnsAlert,
    configDir,
    getSession = () => null,
    getHostConfig = readConfig,
    isSessionNotificationEnabled = () => true,
    logger = console,
  }) {
    this.deviceStore = deviceStore;
    this.sendApnsAlert = sendApnsAlert;
    this.configDir = configDir;
    this.getSession = getSession;
    this.getHostConfig = getHostConfig;
    this.isSessionNotificationEnabled = isSessionNotificationEnabled;
    this.logger = logger;
    this.tokenCache = new ApnsProviderTokenCache();
    this.handledKeys = new Set();
    this.pendingNotifiableOutputCandidatesByProviderTurnId = new Map();
    this.providerTurnTerminalState = new Map();
  }

  recordApnsRuntime(record) {
    if (!isApnsRuntimeObservabilityEnabled(this.getHostConfig())) {
      return false;
    }
    try {
      mkdirSync(this.configDir, { recursive: true });
      appendFileSync(
        apnsRuntimeObservabilityPath(this.configDir),
        `${JSON.stringify(record)}\n`
      );
    } catch (err) {
      this.logger.warn?.("[apns-runtime] observability write failed", {
        error: err.message || String(err),
      });
    }
    this.logger.log?.(`[apns-runtime] ${JSON.stringify(record)}`);
    return true;
  }

  rememberHandledKey(key) {
    if (!key || this.handledKeys.has(key)) return false;
    this.handledKeys.add(key);
    while (this.handledKeys.size > MAX_HANDLED_KEYS) {
      const oldest = this.handledKeys.values().next().value;
      if (!oldest) break;
      this.handledKeys.delete(oldest);
    }
    return true;
  }

  rememberProviderTurnTerminalState(providerTurnId, state) {
    if (!providerTurnId) return;
    this.providerTurnTerminalState.set(providerTurnId, state);
    while (this.providerTurnTerminalState.size > MAX_HANDLED_KEYS) {
      const oldest = this.providerTurnTerminalState.keys().next().value;
      if (!oldest) break;
      this.providerTurnTerminalState.delete(oldest);
    }
  }

  rememberPendingNotifiableOutputCandidate(candidate) {
    if (!candidate?.providerTurnId) return;
    this.pendingNotifiableOutputCandidatesByProviderTurnId.set(
      candidate.providerTurnId,
      candidate
    );
    while (
      this.pendingNotifiableOutputCandidatesByProviderTurnId.size >
      MAX_HANDLED_KEYS
    ) {
      const oldest =
        this.pendingNotifiableOutputCandidatesByProviderTurnId.keys().next().value;
      if (!oldest) break;
      this.pendingNotifiableOutputCandidatesByProviderTurnId.delete(oldest);
    }
  }

  buildCommittedProviderOutputMatrixCandidate(matrixEvent) {
    return buildCommittedProviderOutputMatrixNotificationCandidate(matrixEvent, {
      getSession: this.getSession,
    });
  }

  // ── Cloud-mediated delivery (notify PR #21) ─────────────────────────────
  // Complete-message APNs delivery is Cloud-owned: the Host POSTs the candidate
  // to Cloud, which selects tokens and signs the APNs JWT with the p8 it holds.
  // If Cloud delivery is not configured, the product path fails visibly instead
  // of silently falling back to Host-local p8 signing.
  resolveCloudDelivery() {
    let hostConfig;
    try {
      hostConfig = this.getHostConfig();
    } catch (err) {
      this.logger.warn?.("[apns] cloud delivery config read failed", {
        error: err.message || String(err),
      });
      return null;
    }
    const backendUrl = normalizeString(hostConfig?.backend_url);
    const deviceToken = normalizeString(hostConfig?.device_token);
    if (!backendUrl || !deviceToken) return null;
    return {
      backendUrl: backendUrl.replace(/\/+$/, ""),
      backendStage: resolveCloudBackendStage(hostConfig),
      deviceToken,
    };
  }

  async dispatchCandidateViaCloud(
    candidate,
    semanticType,
    { backendUrl, backendStage = "prod", deviceToken, releaseReason = null }
  ) {
    const requestBody = {
      dedupe_key: candidate.matrixEventId,
      session_id: candidate.sessionId,
      matrix_event_id: candidate.matrixEventId,
      focus_event_id: candidate.matrixEventId,
      semantic_type:
        semanticType ||
        candidate.semanticType ||
        candidate.semantic_type ||
        candidate.notifiableOutputType ||
        candidate.notifiable_output_type ||
        "message.assistant",
      title: candidate.title,
      body: candidate.body,
      route: candidate.url,
    };
    try {
      const response = await fetch(
        buildCloudApiUrl(
          backendUrl,
          "/api/notifications/candidates",
          backendStage
        ),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${deviceToken}`,
          },
          body: JSON.stringify(requestBody),
        }
      );
      let data = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }
      const ok = response.ok && data?.accepted !== false;
      this.recordApnsRuntime(
        buildApnsRuntimeRecord({
          stage: "cloud_candidate_sent",
          matrixEventId: candidate.matrixEventId,
          semanticType,
          candidateCreated: true,
          selectedDeviceCount: data?.selected_token_count ?? null,
          apnsStatusCode: response.status,
          apnsReason: ok ? null : data?.reason || `http_${response.status}`,
          ok,
        })
      );
      return {
        attempted: true,
        delivery: "cloud",
        candidate,
        ok,
        status_code: response.status,
        selected_token_count: data?.selected_token_count ?? null,
        reason: ok ? null : data?.reason || `http_${response.status}`,
        notificationReleased: true,
        releaseReason,
      };
    } catch (err) {
      this.logger.warn?.("[apns] cloud candidate post failed", {
        matrix_event_id: candidate.matrixEventId,
        error: err.message || String(err),
      });
      this.recordApnsRuntime(
        buildApnsRuntimeRecord({
          stage: "cloud_candidate_sent",
          matrixEventId: candidate.matrixEventId,
          semanticType,
          candidateCreated: true,
          selectedDeviceCount: null,
          apnsReason: err.message || "cloud_post_failed",
          ok: false,
        })
      );
      return {
        attempted: true,
        delivery: "cloud",
        candidate,
        ok: false,
        reason: err.message || "cloud_post_failed",
        notificationReleased: true,
        releaseReason,
      };
    }
  }

  buildProviderCompletionReleaseMarker(matrixEvent) {
    const content = getMatrixEventContent(matrixEvent);
    if (!content) return null;
    const semanticPayload = getMatrixSemanticPayload(content);
    const result = normalizeProviderCompletionReleaseMarker({
      eventType: matrixEvent?.type,
      matrixEventId: getMatrixEventId(matrixEvent),
      matrixRoomId: getMatrixRoomId(matrixEvent, semanticPayload),
      hostSessionId:
        normalizeString(semanticPayload?.host_session_id) ||
        normalizeString(matrixEvent?.unsigned?.host_session_id),
      semanticPayload,
    });
    return result.accepted ? result.release : null;
  }

  async dispatchCommittedMatrixEvent(matrixEvent) {
    const completion = this.buildProviderCompletionReleaseMarker(matrixEvent);
    if (completion) {
      return this.releaseProviderTurnCompletion(completion);
    }
    return this.dispatchCommittedProviderOutputMatrixEvent(matrixEvent);
  }

  async dispatchCommittedProviderOutputMatrixEvent(matrixEvent) {
    const semanticType = getMatrixSemanticType(matrixEvent);
    const candidate = this.buildCommittedProviderOutputMatrixCandidate(matrixEvent);
    if (!candidate) {
      return {
        attempted: false,
        reason: "not_committed_matrix_provider_output_candidate",
      };
    }

    const terminalState = this.providerTurnTerminalState.get(
      candidate.providerTurnId
    );
    if (terminalState?.successful === true) {
      return this.dispatchNotifiableProviderOutputNotificationCandidate(candidate, {
        semanticType,
        releaseReason: "provider_turn_already_completed",
      });
    }
    if (terminalState?.successful === false) {
      return {
        attempted: false,
        reason: "provider_turn_not_successful",
        candidate,
        notificationReleased: false,
      };
    }

    this.rememberPendingNotifiableOutputCandidate(candidate);
    this.recordApnsRuntime(
      buildApnsRuntimeRecord({
        stage: "candidate_pending_provider_completion",
        matrixEventId: candidate.matrixEventId,
        semanticType,
        candidateCreated: true,
        selectedDeviceCount: 0,
        apnsReason: "pending_provider_turn_completion",
        ok: null,
      })
    );
    return {
      attempted: false,
      reason: "pending_provider_turn_completion",
      candidate,
      notificationReleased: false,
    };
  }

  async releaseProviderTurnCompletion(completion) {
    this.rememberProviderTurnTerminalState(completion.providerTurnId, {
      successful: completion.successful === true,
      status: completion.status,
      state: completion.state,
      matrixEventId: completion.matrixEventId,
    });

    const candidate =
      this.pendingNotifiableOutputCandidatesByProviderTurnId.get(
        completion.providerTurnId
      );
    this.pendingNotifiableOutputCandidatesByProviderTurnId.delete(
      completion.providerTurnId
    );

    if (!completion.successful) {
      return {
        attempted: false,
        reason: "provider_turn_not_successful",
        completion,
        notificationReleased: false,
      };
    }
    if (!candidate) {
      return {
        attempted: false,
        reason: "provider_turn_completed_without_notifiable_output_candidate",
        completion,
        notificationReleased: false,
      };
    }

    return this.dispatchNotifiableProviderOutputNotificationCandidate(candidate, {
      semanticType:
        candidate.semanticType ||
        candidate.semantic_type ||
        candidate.notifiableOutputType ||
        candidate.notifiable_output_type ||
        "message.assistant",
      releaseReason: "provider_turn_completed",
      completion,
    });
  }

  async dispatchNotifiableProviderOutputNotificationCandidate(
    candidate,
    { semanticType = "message.assistant", releaseReason = null } = {}
  ) {
    const per_session_notification_enabled =
      this.isSessionNotificationEnabled(
        candidate.sessionId,
        candidate.matrixRoomId
      ) !== false;
    if (!per_session_notification_enabled) {
      this.recordApnsRuntime(
        buildApnsRuntimeRecord({
          stage: "dispatch_skipped",
          matrixEventId: candidate.matrixEventId,
          semanticType,
          candidateCreated: true,
          selectedDeviceCount: 0,
          apnsReason: "per_session_notification_disabled",
          ok: false,
        })
      );
      return {
        attempted: false,
        reason: "per_session_notification_disabled",
        candidate,
        per_session_notification_enabled,
        notificationReleased: false,
        releaseReason,
      };
    }
    if (!this.rememberHandledKey(candidate.key)) {
      return {
        attempted: false,
        reason: "duplicate_notification_candidate",
        candidate,
        notificationReleased: false,
      };
    }

    // Cloud-only delivery (fail-fast): Cloud owns token selection + APNs (the p8
    // lives on Cloud). There is NO Host-direct fallback — the Host never signs
    // with a p8. If the Host is not cloud-registered we record a clear skip so a
    // misconfiguration is visible, not silently masked.
    const cloud = this.resolveCloudDelivery();
    if (!cloud) {
      this.recordApnsRuntime(
        buildApnsRuntimeRecord({
          stage: "dispatch_skipped",
          matrixEventId: candidate.matrixEventId,
          semanticType,
          candidateCreated: true,
          selectedDeviceCount: 0,
          apnsReason: "cloud_delivery_not_configured",
          ok: false,
        })
      );
      return {
        attempted: false,
        reason: "cloud_delivery_not_configured",
        candidate,
        notificationReleased: true,
        releaseReason,
      };
    }
    return this.dispatchCandidateViaCloud(candidate, semanticType, {
      ...cloud,
      releaseReason,
    });
  }

  async handleRuntimeEvent(event = {}) {
    const providerTurnId = normalizeProviderTurnIdFromRuntimeEvent(event);
    if (
      event?.type === "turn.completed" &&
      providerTurnId &&
      (event.status === "failed" || event.status === "interrupted")
    ) {
      this.pendingNotifiableOutputCandidatesByProviderTurnId.delete(
        providerTurnId
      );
    }
    return {
      attempted: false,
      reason: "runtime_event_not_notification_truth",
    };
  }

  async dispatchNotifiableProviderOutputNotificationCandidateViaHostDirect(
    candidate,
    { semanticType = "message.assistant", releaseReason = null } = {}
  ) {
    const config = readApnsLocalConfig(this.configDir);
    if (!config.enabled) {
      this.recordApnsRuntime(
        buildApnsRuntimeRecord({
          stage: "dispatch_skipped",
          matrixEventId: candidate.matrixEventId,
          semanticType,
          candidateCreated: true,
          selectedDeviceCount: 0,
          apnsReason: config.error || "apns_not_enabled",
          ok: false,
        })
      );
      return {
        attempted: false,
        reason: config.error || "apns_not_enabled",
        candidate,
        notificationReleased: true,
        releaseReason,
      };
    }
    const listedDevices = this.deviceStore.listDevices({
      topic: config.topic,
      environment: config.environment,
    });
    const devices = dedupeApnsDevicesByToken(listedDevices);
    if (!devices.length) {
      this.recordApnsRuntime(
        buildApnsRuntimeRecord({
          stage: "dispatch_skipped",
          matrixEventId: candidate.matrixEventId,
          semanticType,
          candidateCreated: true,
          selectedDeviceCount: 0,
          apnsReason: "no_registered_devices",
          ok: false,
        })
      );
      return {
        attempted: false,
        reason: "no_registered_devices",
        candidate,
        notificationReleased: true,
        releaseReason,
      };
    }

    const hostConfig = this.getHostConfig();
    const results = [];
    for (const device of devices) {
      try {
        const payload = buildApnsAlertPayload({
          title: candidate.title,
          body: candidate.body,
          sessionId: candidate.sessionId,
          url: candidate.url,
          eventId: candidate.matrixEventId,
          matrixEventId: candidate.matrixEventId,
          turnId: candidate.providerTurnId,
          sound:
            hostConfig.notification_sound_app_enabled === false
              ? IOS_SILENT_NOTIFICATION_SOUND
              : "default",
        });
        const result = await this.sendApnsAlert({
          config,
          deviceToken: device.token,
          payload,
          collapseId: candidate.key.slice(0, 64),
          tokenCache: this.tokenCache,
        });
        this.deviceStore.markPushResult({
          installationId: device.installation_id,
          userId: device.user_id,
          ok: result.ok,
          errorCode: result.reason,
        });
        results.push({
          installation_id: device.installation_id,
          token_suffix: device.token_suffix,
          ok: result.ok,
          status_code: result.statusCode,
          apns_id: result.apnsId,
          reason: result.reason,
        });
        this.recordApnsRuntime(
          buildApnsRuntimeRecord({
            stage: "send_result",
            matrixEventId: candidate.matrixEventId,
            semanticType,
            candidateCreated: true,
            selectedDeviceCount: devices.length,
            tokenSuffix: device.token_suffix,
            apnsStatusCode: result.statusCode,
            apnsId: result.apnsId,
            apnsReason: result.reason,
            ok: result.ok,
          })
        );
      } catch (err) {
        this.deviceStore.markPushResult({
          installationId: device.installation_id,
          userId: device.user_id,
          ok: false,
          errorCode: err.message || "send_failed",
        });
        this.logger.warn?.("[apns] complete-message send failed", {
          installation_id: device.installation_id,
          token_suffix: device.token_suffix,
          error: err.message,
        });
        results.push({
          installation_id: device.installation_id,
          token_suffix: device.token_suffix,
          ok: false,
          reason: err.message || "send_failed",
        });
        this.recordApnsRuntime(
          buildApnsRuntimeRecord({
            stage: "send_result",
            matrixEventId: candidate.matrixEventId,
            semanticType,
            candidateCreated: true,
            selectedDeviceCount: devices.length,
            tokenSuffix: device.token_suffix,
            apnsReason: err.message || "send_failed",
            ok: false,
          })
        );
      }
    }
    return {
      attempted: true,
      candidate,
      results,
      notificationReleased: true,
      releaseReason,
    };
  }
}
