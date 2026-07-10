import { appendFileSync, mkdirSync } from "fs";
import { join } from "path";
import { buildCloudApiUrl, readConfig, resolveCloudBackendStage } from "./config.mjs";
import { isApnsRuntimeObservabilityEnabled } from "./apns-complete-message-dispatcher.mjs";

const APNS_RUNTIME_OBSERVABILITY_FILE = "apns-runtime-observability.jsonl";
const APNS_RUNTIME_OBSERVABILITY_MARKER = "oysterun_apns_runtime_observability_v1";

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function truncateNotificationBody(text) {
  const normalized = normalizeString(text).replace(/\s+/g, " ");
  if (!normalized) return "New Mail is available.";
  return normalized.length > 180 ? `${normalized.slice(0, 177).trimEnd()}...` : normalized;
}

function mailNotificationBody(mail) {
  return truncateNotificationBody(
    normalizeString(mail?.summary) ||
      stripHtml(mail?.body_html) ||
      normalizeString(mail?.body_markdown)
  );
}

function mailNotificationTitle(mail) {
  return normalizeString(mail?.title) || "Oysterun Mail";
}

function mailNotificationUrl(mailId) {
  return `/app/mail/${encodeURIComponent(mailId)}`;
}

function apnsRuntimeObservabilityPath(configDir) {
  return join(configDir, APNS_RUNTIME_OBSERVABILITY_FILE);
}

function buildMailApnsRuntimeRecord({
  stage,
  mailId,
  recipientUserId,
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
    notification_type: "mail_item",
    recorded_at: new Date().toISOString(),
    stage,
    mail_id: mailId || null,
    recipient_user_id: recipientUserId || null,
    on_committed_mail_item_observed: true,
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

export function buildCommittedMailNotificationCandidate(mail) {
  const mailId = normalizeString(mail?.id);
  if (!mailId) return null;
  const recipientUserId = normalizeString(mail?.recipient_user_id) || "host_owner";
  const key = `mail:${mailId}`;
  return {
    type: "mail_notification",
    source: "mail_item_committed",
    key,
    dedupeKey: key,
    dedupe_key: key,
    mailId,
    mail_id: mailId,
    recipientUserId,
    recipient_user_id: recipientUserId,
    title: mailNotificationTitle(mail),
    body: mailNotificationBody(mail),
    url: mailNotificationUrl(mailId),
    createdAt: normalizeString(mail?.created_at),
    created_at: normalizeString(mail?.created_at),
    sourceType: normalizeString(mail?.source_type),
    source_type: normalizeString(mail?.source_type),
    sourceName: normalizeString(mail?.source_name),
    source_name: normalizeString(mail?.source_name),
    scheduleId: normalizeString(mail?.schedule_id),
    schedule_id: normalizeString(mail?.schedule_id),
    scheduleRunId: normalizeString(mail?.schedule_run_id),
    schedule_run_id: normalizeString(mail?.schedule_run_id),
    agentId: normalizeString(mail?.agent_id),
    agent_id: normalizeString(mail?.agent_id),
  };
}

export class ApnsMailNotificationDispatcher {
  constructor({ configDir, getHostConfig = readConfig, logger = console }) {
    this.configDir = configDir;
    this.getHostConfig = getHostConfig;
    this.logger = logger;
  }

  // Cloud holds the APNs p8 and does the signing. The Host only posts a
  // notification candidate (Cloud selects tokens, signs, and sends).
  resolveCloudDelivery() {
    let hostConfig;
    try {
      hostConfig = this.getHostConfig();
    } catch (err) {
      this.logger.warn?.("[apns] mail cloud delivery config read failed", {
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
      this.logger.warn?.("[apns-runtime] mail observability write failed", {
        error: err.message || String(err),
      });
    }
    this.logger.log?.(`[apns-runtime] ${JSON.stringify(record)}`);
    return true;
  }

  async dispatchCommittedMailItem(mail) {
    const candidate = buildCommittedMailNotificationCandidate(mail);
    if (!candidate) {
      return {
        attempted: false,
        reason: "not_committed_mail_item_candidate",
      };
    }
    return this.dispatchMailNotificationCandidate(candidate);
  }

  async dispatchMailNotificationCandidate(candidate) {
    if (!candidate || candidate.source !== "mail_item_committed") {
      return {
        attempted: false,
        reason: "not_committed_mail_item_candidate",
      };
    }
    const cloud = this.resolveCloudDelivery();
    if (!cloud) {
      this.recordApnsRuntime(
        buildMailApnsRuntimeRecord({
          stage: "dispatch_skipped",
          mailId: candidate.mailId,
          recipientUserId: candidate.recipientUserId,
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
      };
    }

    const requestBody = {
      dedupe_key: candidate.dedupeKey,
      // Mail items have no chat session; use the mail id as the candidate's
      // session identifier (the schema only requires a non-empty string).
      session_id: candidate.mailId,
      matrix_event_id: candidate.dedupeKey,
      semantic_type: "mail",
      title: candidate.title,
      body: candidate.body,
      route: candidate.url,
    };
    try {
      const response = await fetch(
        buildCloudApiUrl(
          cloud.backendUrl,
          "/api/notifications/candidates",
          cloud.backendStage
        ),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${cloud.deviceToken}`,
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
        buildMailApnsRuntimeRecord({
          stage: "cloud_candidate_sent",
          mailId: candidate.mailId,
          recipientUserId: candidate.recipientUserId,
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
      };
    } catch (err) {
      this.logger.warn?.("[apns] mail cloud candidate post failed", {
        mail_id: candidate.mailId,
        error: err.message || String(err),
      });
      this.recordApnsRuntime(
        buildMailApnsRuntimeRecord({
          stage: "cloud_candidate_sent",
          mailId: candidate.mailId,
          recipientUserId: candidate.recipientUserId,
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
      };
    }
  }
}
