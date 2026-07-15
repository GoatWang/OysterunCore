import { createHash } from "crypto";
import { TelegramBotApiAdapter } from "./telegram-adapter.mjs";
import {
  COMPLETE_MESSAGE_PROVIDER_COMPLETION_COMPLETED_STATE,
  COMPLETE_MESSAGE_PROVIDER_COMPLETION_PENDING_STATE,
  isSuccessfulProviderCompletionStatus,
} from "./provider-completion-notification-contract.mjs";

const DEFAULT_POLL_INTERVAL_MS = 2500;
const DEFAULT_LONG_POLL_TIMEOUT_SECONDS = 25;
const DEFAULT_TYPING_INTERVAL_MS = 4000;
const DEFAULT_OUTBOUND_TURN_TIMEOUT_MS = 60 * 60 * 1000;
const DEFAULT_TRANSCRIPT_LIMIT = 50;
const TELEGRAM_POLL_CONFLICT_REASON =
  "telegram_poll_conflict_other_consumer";
const MAX_TELEGRAM_OUTBOUND_LENGTH = 3500;
const MAX_TELEGRAM_MESSAGE_LENGTH = 4096;
const TELEGRAM_CODE_BLOCK_REG = /```(?:[^\n]*)\n?([\s\S]*?)```/g;
const TELEGRAM_INLINE_CODE_REG = /`([^`\n]+)`/g;
const TELEGRAM_MARKDOWN_LINK_REG = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;
const TELEGRAM_BARE_URL_REG = /https?:\/\/[^\s<>\u0000]+/gi;
const TELEGRAM_MESSAGE_EFFECTS = Object.freeze({
  CONFETTI: "5046509860389126442",
  THUMBS_UP: "5107584321108051014",
  THUMBS_DOWN: "5104858069142078462",
});

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function isTelegramPollConflictError(err) {
  return /conflict:\s*terminated by other getupdates request/i.test(
    normalizeString(err?.message || err)
  );
}

function stableHash(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function normalizeUsername(value) {
  const normalized = normalizeString(value).replace(/^@+/, "").toLowerCase();
  return normalized || "";
}

function normalizeAllowedUserEntry(value) {
  const normalized = normalizeString(value);
  if (!normalized) return "";
  if (normalized === ".") return ".";
  return normalized.replace(/^@+/, "").toLowerCase();
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function numericUpdateId(update) {
  const value = Number(update?.update_id);
  return Number.isSafeInteger(value) ? value : null;
}

function resolveTelegramMessage(update) {
  return update?.message || update?.edited_message || null;
}

function resolveTelegramCallback(update) {
  return update?.callback_query || null;
}

function normalizeTelegramChatId(chat) {
  if (chat?.id === undefined || chat?.id === null) return "";
  return String(chat.id);
}

function normalizeTelegramFrom(message) {
  const from = message?.from || {};
  return {
    id: from.id === undefined || from.id === null ? "" : String(from.id),
    username: normalizeUsername(from.username),
    isBot: from.is_bot === true,
  };
}

function normalizeTelegramMessage(update) {
  const message = resolveTelegramMessage(update);
  const text = normalizeString(message?.text || message?.caption);
  const chat = message?.chat || {};
  const updateId = numericUpdateId(update);
  if (!message || updateId === null || !text) return null;
  return {
    updateId,
    messageId:
      message.message_id === undefined || message.message_id === null
        ? null
        : String(message.message_id),
    chatId: normalizeTelegramChatId(chat),
    chatType: normalizeString(chat.type) || "private",
    chatMemberCount:
      Number.isInteger(chat.member_count)
        ? chat.member_count
        : Number.isInteger(chat.members_count)
        ? chat.members_count
        : null,
    from: normalizeTelegramFrom(message),
    text,
    replyTo: message.reply_to_message || null,
  };
}

function normalizeTelegramCallback(update) {
  const callback = resolveTelegramCallback(update);
  const callbackMessage = callback?.message || {};
  const chat = callbackMessage?.chat || {};
  const updateId = numericUpdateId(update);
  const data = normalizeString(callback?.data);
  if (!callback || updateId === null || !data) return null;
  return {
    updateId,
    callbackId:
      callback.id === undefined || callback.id === null
        ? ""
        : String(callback.id),
    messageId:
      callbackMessage.message_id === undefined ||
      callbackMessage.message_id === null
        ? null
        : String(callbackMessage.message_id),
    chatId: normalizeTelegramChatId(chat),
    chatType: normalizeString(chat.type) || "private",
    from: normalizeTelegramFrom(callback),
    data,
  };
}

function isReplyToBot(message, botIdentity) {
  const replyFrom = message?.replyTo?.from || null;
  if (!replyFrom) return false;
  const botId = botIdentity?.id === undefined ? "" : String(botIdentity.id);
  const replyId =
    replyFrom.id === undefined || replyFrom.id === null
      ? ""
      : String(replyFrom.id);
  if (botId && replyId && botId === replyId) return true;
  const botUsername = normalizeUsername(botIdentity?.username);
  const replyUsername = normalizeUsername(replyFrom.username);
  return Boolean(botUsername && replyUsername && botUsername === replyUsername);
}

function textMentionsBot(text, botIdentity) {
  const username = normalizeUsername(botIdentity?.username);
  if (!username) return false;
  return new RegExp(`(^|\\s)@${username}(?=\\b|\\s|$)`, "i").test(text);
}

function textHasBotCommandAddress(text, botIdentity) {
  const username = normalizeUsername(botIdentity?.username);
  if (!username) return false;
  return new RegExp(`^/[A-Za-z0-9_]+@${username}(?=\\b|\\s|$)`, "i").test(
    text
  );
}

function stripTelegramBotAddressing(text, botIdentity) {
  const username = normalizeUsername(botIdentity?.username);
  let normalized = normalizeString(text);
  if (!username) return normalized;
  normalized = normalized.replace(
    new RegExp(`^(/[A-Za-z0-9_]+)@${username}(?=\\b|\\s|$)`, "i"),
    "$1"
  );
  normalized = normalized.replace(
    new RegExp(`(^|\\s)@${username}(?=\\b|\\s|$)`, "gi"),
    " "
  );
  return normalized.replace(/\s+/g, " ").trim();
}

function passesGroupGate(message, botIdentity) {
  if (message.chatType === "private") {
    return { passed: true, reason: "private_chat" };
  }
  if (message.chatType !== "group" && message.chatType !== "supergroup") {
    return { passed: false, reason: "unsupported_chat_type" };
  }
  if (isReplyToBot(message, botIdentity)) {
    return { passed: true, reason: "reply_to_bot" };
  }
  if (textHasBotCommandAddress(message.text, botIdentity)) {
    return { passed: true, reason: "command_addressed_to_bot" };
  }
  if (textMentionsBot(message.text, botIdentity)) {
    return { passed: true, reason: "mention_addressed_to_bot" };
  }
  if (message.chatMemberCount === 2) {
    return { passed: true, reason: "two_member_group" };
  }
  return { passed: false, reason: "group_addressing_missing" };
}

function passesAllowedUsersGate(message, allowedUsers) {
  const entries = Array.isArray(allowedUsers)
    ? allowedUsers.map(normalizeAllowedUserEntry).filter(Boolean)
    : [];
  if (entries.includes(".")) return { passed: true, reason: "allow_all" };
  const fromId = normalizeAllowedUserEntry(message.from.id);
  const fromUsername = normalizeAllowedUserEntry(message.from.username);
  const matched = entries.some(
    (entry) => entry === fromId || (fromUsername && entry === fromUsername)
  );
  return {
    passed: matched,
    reason: matched ? "allowed_user_match" : "telegram_user_not_allowed",
  };
}

function classifyTelegramInput(text) {
  const normalized = normalizeString(text);
  if (normalized.startsWith("!!")) {
    return {
      kind: "interrupt_then_chat",
      text: normalized.slice(2).trim(),
    };
  }
  if (normalized.startsWith("!")) {
    return {
      kind: "terminal_command",
      text: normalized.slice(1).trim(),
    };
  }
  if (normalized.startsWith("/")) {
    return {
      kind: "slash_command",
      text: normalized,
    };
  }
  return {
    kind: "chat",
    text: normalized,
  };
}

function truncateOutboundText(text) {
  const normalized = normalizeString(text);
  if (normalized.length <= MAX_TELEGRAM_OUTBOUND_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_TELEGRAM_OUTBOUND_LENGTH - 20)}\n[truncated]`;
}

function escapeTelegramHtml(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeTelegramHtmlAttribute(text) {
  return escapeTelegramHtml(text).replaceAll('"', "&quot;");
}

function splitTelegramUrlTrailingPunctuation(value) {
  let url = String(value || "");
  let trailing = "";
  while (/[.,!?;:]$/.test(url)) {
    trailing = `${url.slice(-1)}${trailing}`;
    url = url.slice(0, -1);
  }
  const peelUnmatchedClosing = (opening, closing) => {
    while (url.endsWith(closing)) {
      const openingCount = url.split(opening).length - 1;
      const closingCount = url.split(closing).length - 1;
      if (closingCount <= openingCount) break;
      trailing = `${closing}${trailing}`;
      url = url.slice(0, -1);
    }
  };
  peelUnmatchedClosing("(", ")");
  peelUnmatchedClosing("[", "]");
  return { url, trailing };
}

function convertMarkdownToTelegramHtml(text) {
  let source = normalizeString(text);
  if (!source) return "";
  const protectedHtml = [];
  const protectHtml = (html) => {
    const placeholder = `\u0000TG${protectedHtml.length}\u0000`;
    protectedHtml.push(html);
    return placeholder;
  };
  source = source.replace(TELEGRAM_CODE_BLOCK_REG, (_match, code) =>
    protectHtml(`<pre><code>${escapeTelegramHtml(code.trim())}</code></pre>`)
  );
  source = source.replace(TELEGRAM_INLINE_CODE_REG, (_match, code) =>
    protectHtml(`<code>${escapeTelegramHtml(code)}</code>`)
  );
  source = source.replace(
    TELEGRAM_MARKDOWN_LINK_REG,
    (_match, label, href) =>
      protectHtml(
        `<a href="${escapeTelegramHtmlAttribute(href)}">${escapeTelegramHtml(
          label
        )}</a>`
      )
  );
  source = source.replace(TELEGRAM_BARE_URL_REG, (candidate) => {
    const { url, trailing } = splitTelegramUrlTrailingPunctuation(candidate);
    if (!url) return candidate;
    return `${protectHtml(escapeTelegramHtml(url))}${trailing}`;
  });
  let html = escapeTelegramHtml(source);
  html = html.replace(/^######\s+(.+)$/gm, "<b>$1</b>");
  html = html.replace(/^#####\s+(.+)$/gm, "<b>$1</b>");
  html = html.replace(/^####\s+(.+)$/gm, "<b>$1</b>");
  html = html.replace(/^###\s+(.+)$/gm, "<b>$1</b>");
  html = html.replace(/^##\s+(.+)$/gm, "<b>$1</b>");
  html = html.replace(/^#\s+(.+)$/gm, "<b>$1</b>");
  html = html.replace(/\*\*([^*\n][\s\S]*?[^*\n])\*\*/g, "<b>$1</b>");
  html = html.replace(/__([^_\n][\s\S]*?[^_\n])__/g, "<b>$1</b>");
  html = html.replace(/(^|[^\*])\*([^*\n]+)\*/g, "$1<i>$2</i>");
  html = html.replace(
    /(^|[\s(])_([^_\n]+?)_(?=$|[\s.,;:!?)\]])/gm,
    "$1<i>$2</i>"
  );
  html = html.replace(/^&gt;\s?(.+)$/gm, "<blockquote>$1</blockquote>");
  protectedHtml.forEach((protectedValue, index) => {
    html = html.replaceAll(`\u0000TG${index}\u0000`, protectedValue);
  });
  return html;
}

function collectTelegramProtectedSourceRanges(text) {
  const ranges = [];
  const overlapsExistingRange = (start, end) =>
    ranges.some((range) => start < range.end && end > range.start);
  const collect = (pattern) => {
    const matcher = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = matcher.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (!overlapsExistingRange(start, end)) ranges.push({ start, end });
      if (match[0].length === 0) matcher.lastIndex += 1;
    }
  };
  collect(TELEGRAM_CODE_BLOCK_REG);
  collect(TELEGRAM_INLINE_CODE_REG);
  collect(TELEGRAM_MARKDOWN_LINK_REG);
  collect(TELEGRAM_BARE_URL_REG);
  return ranges.sort((left, right) => left.start - right.start || left.end - right.end);
}

function adjustTelegramSplitForProtectedRange(text, splitAt) {
  const containingRange = collectTelegramProtectedSourceRanges(text).find(
    (range) => range.start < splitAt && splitAt < range.end
  );
  if (!containingRange) return splitAt;
  if (containingRange.start > 0) return containingRange.start;
  if (containingRange.end <= MAX_TELEGRAM_MESSAGE_LENGTH) {
    return containingRange.end;
  }
  return splitAt;
}

function splitTelegramText(text) {
  const normalized = normalizeString(text);
  if (!normalized) return [];
  const chunks = [];
  let remaining = normalized;
  while (remaining.length > MAX_TELEGRAM_OUTBOUND_LENGTH) {
    let splitAt = remaining.lastIndexOf("\n", MAX_TELEGRAM_OUTBOUND_LENGTH);
    if (splitAt < MAX_TELEGRAM_OUTBOUND_LENGTH * 0.5) {
      splitAt = remaining.lastIndexOf(" ", MAX_TELEGRAM_OUTBOUND_LENGTH);
    }
    if (splitAt < 1) splitAt = MAX_TELEGRAM_OUTBOUND_LENGTH;
    splitAt = adjustTelegramSplitForProtectedRange(remaining, splitAt);
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function telegramEffectFor(chatType, effectName) {
  if (chatType !== "private") return null;
  return TELEGRAM_MESSAGE_EFFECTS[effectName] || null;
}

function formatToolName(value) {
  const name = normalizeString(value);
  return name || "Tool";
}

function formatToolEmoji(toolName) {
  const normalized = normalizeString(toolName).toLowerCase();
  if (normalized === "read") return "📖";
  if (normalized.includes("read image")) return "👀";
  if (normalized === "write") return "📝";
  if (normalized === "edit" || normalized === "multiedit") return "✏️";
  if (normalized === "bash") return "▶️";
  if (normalized === "glob" || normalized === "websearch") return "🔍";
  if (normalized === "grep") return "🔎";
  if (normalized === "webfetch") return "🌐";
  if (normalized === "task") return "🎯";
  if (normalized === "todowrite") return "📋";
  if (normalized === "skill") return "💭";
  if (normalized.startsWith("mcp__")) return "🔧";
  return "🔧";
}

function matrixMessageEventId(message) {
  return (
    normalizeString(message?.matrix_event_id) ||
    normalizeString(message?.message_id) ||
    normalizeString(message?.event_id) ||
    normalizeString(message?.id)
  );
}

function isToolTranscriptMessage(message) {
  if (isAssistantTranscriptMessage(message) || isHiddenInternalTranscriptMessage(message)) {
    return false;
  }
  const semanticType = normalizeString(message?.semantic_type);
  const messageType = normalizeString(message?.message_type);
  return (
    semanticType.startsWith("tool.") ||
    messageType === "tool" ||
    Array.isArray(message?.tool_events)
  );
}

function isAssistantTranscriptMessage(message) {
  return (
    message?.role === "assistant" ||
    normalizeString(message?.semantic_type) === "message.assistant"
  );
}

function messageSeq(message) {
  const numeric = Number(message?.seq);
  return Number.isSafeInteger(numeric) && numeric >= 1 ? numeric : null;
}

function transcriptMessageSourceUserEventId(message) {
  return normalizeString(
    message?.source_user_event_id ||
      message?.routec_matrix_delivery?.source_user_event_id
  );
}

function transcriptMessageTargetUserEventId(message) {
  return normalizeString(
    message?.target_user_event_id ||
      message?.target_event_id ||
      message?.routec_matrix_delivery?.target_user_event_id
  );
}

function transcriptMessageProviderTurnId(message) {
  return normalizeString(
    message?.provider_turn_id ||
      message?.provider_completion_turn_id ||
      message?.routec_matrix_delivery?.provider_turn_id
  );
}

function isProviderCompletionTranscriptMessage(message) {
  const semanticType = normalizeString(message?.semantic_type);
  const messageType = normalizeString(message?.message_type);
  const completionStatus = normalizeString(message?.provider_completion_status);
  const completionState = normalizeString(message?.provider_completion_state);
  const completionMarker = normalizeString(message?.provider_completion_marker);
  return (
    semanticType === "turn.completed" ||
    semanticType === "provider.completed" ||
    completionStatus !== "" ||
    completionState === "turn_completed" ||
    ((semanticType === "session_lifecycle" ||
      semanticType === "session.lifecycle" ||
      messageType === "session_lifecycle") &&
      completionMarker !== "")
  );
}

function providerCompletionOutcome(message) {
  if (!isProviderCompletionTranscriptMessage(message)) return null;
  const state = normalizeString(message?.provider_completion_state);
  const status = normalizeString(message?.provider_completion_status);
  const successful =
    state === COMPLETE_MESSAGE_PROVIDER_COMPLETION_COMPLETED_STATE &&
    message?.provider_completion_success === true &&
    isSuccessfulProviderCompletionStatus(status);
  return {
    successful,
    state: state || null,
    status: status || null,
    matrixEventId: matrixMessageEventId(message),
    seq: messageSeq(message),
    message,
  };
}

function outboundTurnRuntimeStatus(turn) {
  if (!turn) return null;
  const assistant = turn.latestAssistantMessage;
  const completion = turn.completion;
  return {
    source_user_event_id_hash: turn.sourceUserEventId
      ? stableHash(turn.sourceUserEventId).slice(0, 16)
      : null,
    provider_turn_id_hash: turn.providerTurnId
      ? stableHash(turn.providerTurnId).slice(0, 16)
      : null,
    delivered_assistant_message_count:
      turn.deliveredAssistantMessageCount || 0,
    latest_assistant_message_seq: assistant?.seq ?? null,
    latest_assistant_message_event_id_hash: assistant?.matrixEventId
      ? stableHash(assistant.matrixEventId).slice(0, 16)
      : null,
    completion_seq: completion?.seq ?? null,
    completion_event_id_hash: completion?.matrixEventId
      ? stableHash(completion.matrixEventId).slice(0, 16)
      : null,
    completion_successful:
      typeof completion?.successful === "boolean"
        ? completion.successful
        : null,
    token_redacted: true,
    allowed_users_redacted: true,
    chat_id_redacted: true,
  };
}

function isHiddenInternalTranscriptMessage(message) {
  const semanticType = normalizeString(message?.semantic_type);
  return (
    semanticType === "turn.completed" ||
    semanticType === "provider.completed" ||
    semanticType === "session.lifecycle" ||
    semanticType === "session_lifecycle" ||
    semanticType === "message.thinking" ||
    semanticType.startsWith("debug.") ||
    semanticType.startsWith("proof.") ||
    semanticType === "thinking.reasoning"
  );
}

function isFatalTelegramChatError(err) {
  const message = normalizeString(err?.message || err).toLowerCase();
  return (
    message.includes("chat not found") ||
    message.includes("bot was blocked") ||
    message.includes("forbidden: bot was blocked") ||
    message.includes("forbidden: user is deactivated")
  );
}

function buildToolStatus(message) {
  const semanticType = normalizeString(message?.semantic_type);
  const toolName = formatToolName(
    message?.tool_name ||
      message?.toolName ||
      message?.name ||
      message?.tool?.name ||
      message?.tool_summary ||
      semanticType.replace(/^tool\./, "")
  );
  const key =
    normalizeString(message?.tool_call_id) ||
    normalizeString(message?.toolCallId) ||
    normalizeString(message?.call_id) ||
    normalizeString(message?.id) ||
    matrixMessageEventId(message) ||
    stableHash(`${toolName}:${message?.seq || ""}`);
  const completed =
    semanticType === "tool.result" ||
    semanticType === "tool.completed" ||
    message?.status === "completed" ||
    message?.complete === true;
  return {
    key,
    toolName,
    emoji: formatToolEmoji(toolName),
    completed,
  };
}

function formatOutboundTranscriptMessage(message, sendToolMessages) {
  if (isHiddenInternalTranscriptMessage(message)) return null;
  const semanticType = normalizeString(message?.semantic_type);
  const messageType = normalizeString(message?.message_type);
  const text = normalizeString(message?.text || message?.content);
  if (!text && !normalizeString(message?.tool_summary)) return null;

  if (isToolTranscriptMessage(message)) {
    if (sendToolMessages !== true) return null;
    const summary =
      normalizeString(message?.tool_summary) ||
      text ||
      `${semanticType || "tool"} activity`;
    return {
      text: truncateOutboundText(summary),
      final: false,
      kind: "tool_summary",
    };
  }

  if (message?.role === "assistant" || semanticType === "message.assistant") {
    return {
      text: truncateOutboundText(text),
      final:
        message?.final === true ||
        message?.lifecycle === "final" ||
        message?.semantic_lifecycle === "final",
      kind: "assistant_message",
    };
  }

  return null;
}

function sanitizeRuntimeConfig(config = {}) {
  const allowedUsers = Array.isArray(config.allowedUsers)
    ? config.allowedUsers.map((entry) => String(entry))
    : [];
  const botToken = typeof config.botToken === "string" ? config.botToken : "";
  return {
    enabled: config.enabled === true,
    sendToolMessages: config.sendToolMessages === true,
    botToken,
    allowedUsers,
    botTokenConfigured:
      config.botTokenConfigured === true || normalizeString(botToken) !== "",
    allowedUsersConfigured:
      config.allowedUsersConfigured === true || allowedUsers.length > 0,
    allowedUsersAllowAll:
      config.allowedUsersAllowAll === true || allowedUsers.includes("."),
    allowedUsersCount: Number.isInteger(config.allowedUsersCount)
      ? config.allowedUsersCount
      : allowedUsers.length,
  };
}

export class TelegramBridgeManager {
  constructor({
    adapter = new TelegramBotApiAdapter(),
    getSession = () => null,
    getBinding = () => null,
    commitMatrixUserMessage,
    deliverMatrixUserEvent,
    interruptSession = async () => null,
    runTerminalCommand = async () => null,
    routeSlashCommand = null,
    selectAdapter = null,
    readTranscriptMessagesAfter = async () => ({ messages: [], sync: {} }),
    readLatestCommittedSeq = async () => ({ latest_committed_seq: 0 }),
    logger = console,
    autoStartPolling = true,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    longPollTimeoutSeconds = DEFAULT_LONG_POLL_TIMEOUT_SECONDS,
    outboundTurnTimeoutMs = DEFAULT_OUTBOUND_TURN_TIMEOUT_MS,
    setTimeoutFn = globalThis.setTimeout,
    clearTimeoutFn = globalThis.clearTimeout,
  } = {}) {
    if (!commitMatrixUserMessage) {
      throw new Error("TelegramBridgeManager requires commitMatrixUserMessage");
    }
    if (!deliverMatrixUserEvent) {
      throw new Error("TelegramBridgeManager requires deliverMatrixUserEvent");
    }
    this.adapter = adapter;
    this.getSession = getSession;
    this.getBinding = getBinding;
    this.commitMatrixUserMessage = commitMatrixUserMessage;
    this.deliverMatrixUserEvent = deliverMatrixUserEvent;
    this.interruptSession = interruptSession;
    this.runTerminalCommand = runTerminalCommand;
    this.routeSlashCommand = routeSlashCommand;
    this.selectAdapter =
      typeof selectAdapter === "function" ? selectAdapter : null;
    this.readTranscriptMessagesAfter = readTranscriptMessagesAfter;
    this.readLatestCommittedSeq = readLatestCommittedSeq;
    this.logger = logger || {};
    this.autoStartPolling = autoStartPolling === true;
    this.pollIntervalMs = Math.max(Number(pollIntervalMs) || DEFAULT_POLL_INTERVAL_MS, 250);
    this.longPollTimeoutSeconds = Math.max(
      Math.floor(
        Number(longPollTimeoutSeconds) || DEFAULT_LONG_POLL_TIMEOUT_SECONDS
      ),
      1
    );
    this.outboundTurnTimeoutMs = Math.max(
      Number(outboundTurnTimeoutMs) || DEFAULT_OUTBOUND_TURN_TIMEOUT_MS,
      DEFAULT_TYPING_INTERVAL_MS
    );
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.listeners = new Map();
    this.disabledSessions = new Map();
    this.conflictRecoveryTimers = new Map();
  }

  resolveAdapterForSession(session, config) {
    const adapter = this.selectAdapter
      ? this.selectAdapter({ session, config, defaultAdapter: this.adapter })
      : this.adapter;
    if (!adapter || typeof adapter.getBotIdentity !== "function") {
      throw new Error("Telegram bridge adapter is not available");
    }
    return adapter;
  }

  runtimeStatus(sessionId) {
    const state = this.listeners.get(sessionId);
    if (!state) {
      const disabled = this.disabledSessions.get(sessionId);
      if (disabled) {
        const conflict = disabled.reason === TELEGRAM_POLL_CONFLICT_REASON;
        return {
          status: conflict
            ? "telegram_listener_conflict"
            : "telegram_listener_disabled",
          listening: false,
          disabled: true,
          disabled_reason: disabled.reason,
          owner_session_id: disabled.ownerSessionId,
          listener_count: this.listeners.size,
          token_redacted: true,
          allowed_users_redacted: true,
        };
      }
      return {
        status: "telegram_listener_inactive",
        listening: false,
        listener_count: this.listeners.size,
      };
    }
    if (state.pollFailure?.reason === TELEGRAM_POLL_CONFLICT_REASON) {
      return {
        status: "telegram_listener_conflict",
        listening: false,
        disabled: true,
        disabled_reason: TELEGRAM_POLL_CONFLICT_REASON,
        listener_count: this.listeners.size,
        session_id: state.sessionId,
        agent_id: state.agentId,
        adapter_kind: state.adapterKind,
        bot_username_configured: Boolean(state.botIdentity?.username),
        bound_chat: Boolean(state.chatBinding),
        bound_chat_type: state.chatBinding?.chatType || null,
        bound_chat_hash: state.chatBinding?.chatId
          ? stableHash(state.chatBinding.chatId).slice(0, 16)
          : null,
        allowed_users_allow_all: state.allowedUsers.includes("."),
        allowed_users_count: state.allowedUsers.length,
        send_tool_messages: state.sendToolMessages === true,
        latest_transcript_seq: state.latestTranscriptSeq,
        outbound_turn_active: state.outboundTurnActive === true,
        outbound_turn: outboundTurnRuntimeStatus(state.currentOutboundTurn),
        last_outbound_delivery: state.lastOutboundDelivery || null,
        last_outbound_finalization: state.lastOutboundFinalization || null,
        last_outbound_scan: state.lastOutboundScan || null,
        token_redacted: true,
        allowed_users_redacted: true,
      };
    }
    return {
      status: "telegram_listener_active",
      listening: true,
      listener_count: this.listeners.size,
      session_id: state.sessionId,
      agent_id: state.agentId,
      adapter_kind: state.adapterKind,
      bot_username_configured: Boolean(state.botIdentity?.username),
      bound_chat: Boolean(state.chatBinding),
      bound_chat_type: state.chatBinding?.chatType || null,
      bound_chat_hash: state.chatBinding?.chatId
        ? stableHash(state.chatBinding.chatId).slice(0, 16)
        : null,
      allowed_users_allow_all: state.allowedUsers.includes("."),
      allowed_users_count: state.allowedUsers.length,
      send_tool_messages: state.sendToolMessages === true,
      latest_transcript_seq: state.latestTranscriptSeq,
      outbound_turn_active: state.outboundTurnActive === true,
      outbound_turn: outboundTurnRuntimeStatus(state.currentOutboundTurn),
      last_outbound_delivery: state.lastOutboundDelivery || null,
      last_outbound_finalization: state.lastOutboundFinalization || null,
      last_outbound_scan: state.lastOutboundScan || null,
      token_redacted: true,
      allowed_users_redacted: true,
    };
  }

  async ensureSession(session, reason = "session_refresh") {
    if (!session?.id) {
      return { status: "telegram_session_missing", listening: false };
    }
    const config = sanitizeRuntimeConfig(session.telegramConfig || {});
    const binding = this.getBinding(session.id);
    const eligibility = this.sessionEligibility(session, config, binding);
    if (!eligibility.eligible) {
      this.stopSession(session.id, eligibility.reason);
      return {
        status: "telegram_listener_not_started",
        reason: eligibility.reason,
        listening: false,
      };
    }
    const owner = this.activeListenerForDifferentSession(session.id);
    if (owner) {
      const disabled = {
        reason: "telegram_listener_owned_by_another_session",
        ownerSessionId: owner.sessionId,
      };
      this.disabledSessions.set(session.id, disabled);
      return {
        status: "telegram_listener_disabled",
        reason: disabled.reason,
        listening: false,
        disabled: true,
        session_id: session.id,
        owner_session_id: owner.sessionId,
        listener_count: this.listeners.size,
        token_redacted: true,
        allowed_users_redacted: true,
      };
    }
    this.disabledSessions.delete(session.id);
    this.clearConflictRecoveryTimer(session.id);
    const adapter = this.resolveAdapterForSession(session, config);
    const adapterKind = adapter?.kind || "unknown";

    const effectiveKey = stableHash(
      JSON.stringify({
        sessionId: session.id,
        bindingRoom: binding.matrix_room_id,
        tokenHash: stableHash(config.botToken),
        allowedUsers: config.allowedUsers,
        sendToolMessages: config.sendToolMessages,
        adapterKind,
      })
    );
    const existing = this.listeners.get(session.id);
    if (existing?.effectiveKey === effectiveKey) {
      existing.session = session;
      existing.binding = binding;
      existing.reason = reason;
      return {
        status: "telegram_listener_already_active",
        listening: true,
        session_id: session.id,
      };
    }
    this.stopSession(session.id, "telegram_effective_config_changed");

    const botIdentity = await adapter.getBotIdentity({
      botToken: config.botToken,
    });
    const latestSeqResult = await this.readLatestCommittedSeq({ binding });
    const state = {
      session,
      sessionId: session.id,
      agentId: session.agentId || null,
      binding,
      reason,
      effectiveKey,
      adapter,
      adapterKind,
      botToken: config.botToken,
      allowedUsers: [...config.allowedUsers],
      sendToolMessages: config.sendToolMessages === true,
      botIdentity,
      updateOffset: null,
      latestTranscriptSeq:
        Number(latestSeqResult?.latest_committed_seq) > 0
          ? Number(latestSeqResult.latest_committed_seq)
          : 0,
      noEchoEventIds: new Set(),
      chatBinding: null,
      outboundTurnActive: false,
      currentOutboundTurn: null,
      toolOverview: {
        messageId: null,
        entries: new Map(),
      },
      typingIndicator: {
        active: false,
        timer: null,
        fatalError: null,
      },
      pendingTerminalCommands: new Map(),
      timer: null,
      stopped: false,
      processing: false,
      flushingOutbound: false,
      pollFailure: null,
      lastOutboundDelivery: null,
      lastOutboundFinalization: null,
      lastOutboundScan: null,
    };
    try {
      await this.primeUpdateOffset(state);
    } catch (err) {
      if (isTelegramPollConflictError(err)) {
        const disabled = {
          reason: TELEGRAM_POLL_CONFLICT_REASON,
          ownerSessionId: null,
        };
        this.disabledSessions.set(session.id, disabled);
        this.logWarn(
          "Telegram listener conflict; another Oysterun host/session/stack is polling this bot token",
          err
        );
        this.schedulePollConflictRecovery(session);
        return {
          status: "telegram_listener_conflict",
          reason: disabled.reason,
          listening: false,
          disabled: true,
          session_id: session.id,
          listener_count: this.listeners.size,
          token_redacted: true,
          allowed_users_redacted: true,
        };
      }
      throw err;
    }
    this.listeners.set(session.id, state);
    if (this.autoStartPolling && state.adapterKind !== "mock") {
      this.schedulePoll(state, 0);
    }
    return {
      status: "telegram_listener_started",
      listening: true,
      session_id: session.id,
      adapter_kind: state.adapterKind,
      bot_username_configured: Boolean(botIdentity?.username),
    };
  }

  sessionEligibility(session, config, binding) {
    if (session.alive === false) {
      return { eligible: false, reason: "session_not_alive" };
    }
    if (config.enabled !== true) {
      return { eligible: false, reason: "telegram_disabled" };
    }
    if (!config.botTokenConfigured || !normalizeString(config.botToken)) {
      return { eligible: false, reason: "telegram_bot_token_missing" };
    }
    if (!config.allowedUsersConfigured || config.allowedUsers.length === 0) {
      return { eligible: false, reason: "telegram_allowed_users_missing" };
    }
    if (!binding?.matrix_room_id) {
      return { eligible: false, reason: "missing_routec_matrix_binding" };
    }
    return { eligible: true, reason: "eligible" };
  }

  activeListenerForDifferentSession(sessionId) {
    for (const state of this.listeners.values()) {
      if (state.sessionId !== sessionId && !state.stopped) {
        return state;
      }
    }
    return null;
  }

  schedulePoll(state, delayMs = this.pollIntervalMs) {
    if (!state || state.stopped || this.autoStartPolling !== true) return;
    if (state.timer) return;
    state.timer = this.setTimeoutFn(() => {
      state.timer = null;
      void this.pollSession(state.sessionId)
        .catch((err) => this.logWarn("Telegram bridge poll failed", err))
        .finally(() => {
          if (!state.stopped && this.listeners.get(state.sessionId) === state) {
            this.schedulePoll(state, this.pollIntervalMs);
          }
        });
    }, Math.max(Number(delayMs) || 0, 0));
    if (typeof state.timer?.unref === "function") state.timer.unref();
  }

  schedulePollConflictRecovery(session, delayMs = this.pollIntervalMs) {
    const sessionId = normalizeString(session?.id);
    if (!sessionId || this.autoStartPolling !== true) return;
    if (this.conflictRecoveryTimers.has(sessionId)) return;
    const timer = this.setTimeoutFn(() => {
      this.conflictRecoveryTimers.delete(sessionId);
      const currentSession = this.getSession(sessionId) || session;
      void this.ensureSession(
        currentSession,
        "telegram_poll_conflict_recovery"
      ).catch((err) => {
        this.logWarn("Telegram listener conflict recovery failed", err);
      });
    }, Math.max(Number(delayMs) || this.pollIntervalMs, 250));
    if (typeof timer?.unref === "function") timer.unref();
    this.conflictRecoveryTimers.set(sessionId, timer);
  }

  clearConflictRecoveryTimer(sessionId) {
    const normalizedSessionId = normalizeString(sessionId);
    if (!normalizedSessionId) return;
    const timer = this.conflictRecoveryTimers.get(normalizedSessionId);
    if (!timer) return;
    this.clearTimeoutFn(timer);
    this.conflictRecoveryTimers.delete(normalizedSessionId);
  }

  markPollFailure(state, reason, err) {
    const message = normalizeString(err?.message || err);
    const previousReason = state.pollFailure?.reason || "";
    state.pollFailure = {
      reason,
      message,
      at: new Date().toISOString(),
    };
    if (previousReason !== reason) {
      this.logWarn(
        reason === TELEGRAM_POLL_CONFLICT_REASON
          ? "Telegram listener conflict; another Oysterun host/session/stack is polling this bot token"
          : "Telegram bridge poll failed",
        err
      );
    }
  }

  clearPollFailure(state, reason) {
    if (!state.pollFailure) return;
    state.pollFailure = null;
    if (reason) {
      this.logInfo?.(`Telegram listener recovered after ${reason}`);
    }
  }

  stopSession(sessionId, reason = "telegram_listener_stop") {
    const state = this.listeners.get(sessionId);
    this.disabledSessions.delete(sessionId);
    this.clearConflictRecoveryTimer(sessionId);
    if (!state) {
      return { status: "telegram_listener_not_active", session_id: sessionId };
    }
    state.stopped = true;
    if (state.timer) {
      this.clearTimeoutFn(state.timer);
      state.timer = null;
    }
    this.stopTypingIndicator(state, "telegram_listener_stop");
    this.listeners.delete(sessionId);
    for (const [disabledSessionId, disabled] of this.disabledSessions) {
      if (disabled.ownerSessionId === sessionId) {
        this.disabledSessions.delete(disabledSessionId);
      }
    }
    return {
      status: "telegram_listener_stopped",
      session_id: sessionId,
      reason,
      token_redacted: true,
      allowed_users_redacted: true,
    };
  }

  async primeUpdateOffset(state) {
    const updates = await state.adapter.getUpdates({
      botToken: state.botToken,
      offset: null,
      timeoutSeconds: 0,
      limit: 100,
    });
    const maxUpdateId = updates.reduce((max, update) => {
      const updateId = numericUpdateId(update);
      return updateId === null ? max : Math.max(max, updateId);
    }, 0);
    state.updateOffset = maxUpdateId > 0 ? maxUpdateId + 1 : 1;
    return {
      status: "telegram_backlog_skipped",
      next_update_offset: state.updateOffset,
      skipped_count: updates.length,
    };
  }

  async pollSession(sessionId, options = {}) {
    const state = this.listeners.get(sessionId);
    if (!state || state.stopped) {
      return { status: "telegram_listener_not_active", processed: 0 };
    }
    if (state.processing) {
      return { status: "telegram_listener_busy", processed: 0 };
    }
    state.processing = true;
    try {
      const timeoutSeconds =
        Number.isFinite(Number(options?.timeoutSeconds)) &&
        Number(options.timeoutSeconds) >= 0
          ? Number(options.timeoutSeconds)
          : this.longPollTimeoutSeconds;
      let updates;
      try {
        updates = await state.adapter.getUpdates({
          botToken: state.botToken,
          offset: state.updateOffset,
          timeoutSeconds,
          limit: 100,
        });
        this.clearPollFailure(state, TELEGRAM_POLL_CONFLICT_REASON);
      } catch (err) {
        if (isTelegramPollConflictError(err)) {
          this.markPollFailure(state, TELEGRAM_POLL_CONFLICT_REASON, err);
          return {
            status: "telegram_poll_conflict",
            reason: TELEGRAM_POLL_CONFLICT_REASON,
            processed: 0,
            next_update_offset: state.updateOffset,
            token_redacted: true,
            allowed_users_redacted: true,
          };
        }
        throw err;
      }
      let processed = 0;
      for (const update of updates) {
        const updateId = numericUpdateId(update);
        if (updateId === null) continue;
        if (updateId < state.updateOffset) continue;
        await this.handleUpdate(state, update);
        state.updateOffset = updateId + 1;
        processed += 1;
      }
      await this.flushOutboundTranscript(sessionId);
      return {
        status: "telegram_poll_complete",
        processed,
        next_update_offset: state.updateOffset,
      };
    } finally {
      state.processing = false;
    }
  }

  async handleUpdate(state, update) {
    const callback = normalizeTelegramCallback(update);
    if (callback) {
      return this.handleCallbackUpdate(state, callback);
    }
    const message = normalizeTelegramMessage(update);
    if (!message) {
      return { status: "telegram_update_ignored", reason: "no_text_message" };
    }
    if (message.from.isBot) {
      return { status: "telegram_update_ignored", reason: "bot_echo" };
    }
    const botId = state.botIdentity?.id === undefined ? "" : String(state.botIdentity.id);
    if (botId && message.from.id && botId === message.from.id) {
      return { status: "telegram_update_ignored", reason: "bot_echo" };
    }
    const groupGate = passesGroupGate(message, state.botIdentity);
    if (!groupGate.passed) {
      return {
        status: "telegram_update_ignored",
        reason: groupGate.reason,
      };
    }
    const allowedGate = passesAllowedUsersGate(message, state.allowedUsers);
    if (!allowedGate.passed) {
      return {
        status: "telegram_update_rejected",
        reason: allowedGate.reason,
      };
    }
    if (!state.chatBinding) {
      state.chatBinding = {
        chatId: message.chatId,
        chatType: message.chatType,
        boundAtUpdateId: message.updateId,
      };
    } else if (state.chatBinding.chatId !== message.chatId) {
      return {
        status: "telegram_update_ignored",
        reason: "telegram_chat_not_bound_to_session",
      };
    }
    const routedText = stripTelegramBotAddressing(message.text, state.botIdentity);
    const command = classifyTelegramInput(routedText);
    if (!command.text && command.kind !== "interrupt_then_chat") {
      return {
        status: "telegram_update_ignored",
        reason: "empty_routed_text",
      };
    }
    if (command.kind === "interrupt_then_chat") {
      await this.interruptSession({
        session: state.session,
        sessionId: state.sessionId,
        source: "telegram",
      });
      if (!command.text) {
        return {
          status: "telegram_interrupt_only",
          command_kind: command.kind,
        };
      }
      return this.commitAndDeliver(state, message, command.text, {
        commandKind: command.kind,
      });
    }
    if (command.kind === "terminal_command") {
      return this.sendTerminalCommandConfirmation(state, message, command.text);
    }
    if (command.kind === "slash_command" && this.routeSlashCommand) {
      return this.routeSlashCommand({
        session: state.session,
        sessionId: state.sessionId,
        text: command.text,
        source: "telegram",
      });
    }
    return this.commitAndDeliver(state, message, command.text, {
      commandKind: command.kind,
    });
  }

  async handleCallbackUpdate(state, callback) {
    if (callback.from.isBot) {
      return { status: "telegram_update_ignored", reason: "bot_echo" };
    }
    if (!state.chatBinding) {
      return {
        status: "telegram_callback_ignored",
        reason: "telegram_chat_not_bound",
      };
    }
    if (state.chatBinding.chatId !== callback.chatId) {
      return {
        status: "telegram_callback_ignored",
        reason: "telegram_chat_not_bound_to_session",
      };
    }
    const allowedGate = passesAllowedUsersGate(callback, state.allowedUsers);
    if (!allowedGate.passed) {
      return {
        status: "telegram_callback_rejected",
        reason: allowedGate.reason,
      };
    }
    const [action, token] = callback.data.split(":", 2);
    if (
      action !== "telegram_terminal_run" &&
      action !== "telegram_terminal_cancel"
    ) {
      return { status: "telegram_callback_ignored", reason: "unknown_callback" };
    }
    const pending = state.pendingTerminalCommands.get(token);
    if (!pending) {
      return {
        status: "telegram_callback_ignored",
        reason: "terminal_confirmation_not_found",
      };
    }
    state.pendingTerminalCommands.delete(token);
    if (action === "telegram_terminal_cancel") {
      await this.editTelegramText(state, {
        messageId: pending.messageId || callback.messageId,
        text: "🚫 Terminal command cancelled.",
        kind: "terminal_confirmation",
      });
      return {
        status: "telegram_terminal_command_cancelled",
        command_kind: "terminal_command",
      };
    }
    const result = await this.runTerminalCommand({
      session: state.session,
      sessionId: state.sessionId,
      command: pending.command,
      source: "telegram",
    });
    await this.editTelegramText(state, {
      messageId: pending.messageId || callback.messageId,
      text: `✅ Terminal command started:\n\`${pending.command}\``,
      kind: "terminal_confirmation",
    });
    return {
      status: "telegram_terminal_command_started",
      command_kind: "terminal_command",
      terminal_command: result,
      token_redacted: true,
      allowed_users_redacted: true,
    };
  }

  async sendTerminalCommandConfirmation(state, message, command) {
    const normalizedCommand = normalizeString(command);
    if (!normalizedCommand) {
      return {
        status: "telegram_update_ignored",
        reason: "empty_terminal_command",
      };
    }
    const token = stableHash(
      `${state.sessionId}:${message.chatId}:${message.messageId}:${message.updateId}:${normalizedCommand}`
    ).slice(0, 24);
    const replyMarkup = {
      inline_keyboard: [
        [
          {
            text: "Run",
            callback_data: `telegram_terminal_run:${token}`,
          },
          {
            text: "Cancel",
            callback_data: `telegram_terminal_cancel:${token}`,
          },
        ],
      ],
    };
    const sent = await this.sendTelegramText(state, {
      text: `▶️ Run terminal command?\n\`${normalizedCommand}\``,
      kind: "terminal_confirmation",
      replyMarkup,
    });
    state.pendingTerminalCommands.set(token, {
      command: normalizedCommand,
      messageId: sent[0]?.message_id || null,
    });
    return {
      status: "telegram_terminal_command_confirmation_sent",
      command_kind: "terminal_command",
      confirmation_token_redacted: true,
    };
  }

  async commitAndDeliver(state, message, text, { commandKind = "chat" } = {}) {
    const clientRequestId = `telegram_${stableHash(
      `${state.sessionId}:${message.chatId}:${message.messageId}:${message.updateId}`
    ).slice(0, 32)}`;
    const telegramProof = {
      source: "telegram",
      update_id: message.updateId,
      message_id: message.messageId,
      chat_id_hash: stableHash(message.chatId).slice(0, 16),
      from_id_hash: stableHash(message.from.id).slice(0, 16),
      command_kind: commandKind,
      token_redacted: true,
      allowed_users_redacted: true,
    };
    const committed = await this.commitMatrixUserMessage({
      session: state.session,
      binding: state.binding,
      text,
      nickname: "Telegram",
      clientRequestId,
      telegram: telegramProof,
    });
    const eventId =
      normalizeString(committed?.event_id) ||
      normalizeString(committed?.matrix_event_id);
    if (!eventId) {
      throw new Error("Telegram Matrix user event commit did not return event_id");
    }
    state.noEchoEventIds.add(eventId);
    const providerDelivery = await this.deliverMatrixUserEvent({
      session: state.session,
      binding: state.binding,
      eventId,
      txnId: committed?.txn_id || clientRequestId,
      matrixUserId: committed?.matrix_user_id || state.binding?.matrix_user_id,
      text,
      providerText: text,
      nickname: "Telegram",
      telegram: telegramProof,
    });
    this.startOutboundTurn(state, {
      sourceUserEventId: eventId,
      clientRequestId,
    });
    state.toolOverview.messageId = null;
    state.toolOverview.entries = new Map();
    await this.startTypingIndicator(state);
    return {
      status: "telegram_matrix_user_event_delivered",
      command_kind: commandKind,
      event_id: eventId,
      txn_id: committed?.txn_id || clientRequestId,
      provider_delivery: providerDelivery,
      token_redacted: true,
      allowed_users_redacted: true,
    };
  }

  startOutboundTurn(state, { sourceUserEventId, clientRequestId }) {
    state.outboundTurnActive = true;
    state.currentOutboundTurn = {
      sourceUserEventId,
      clientRequestId,
      userEventSeq: null,
      providerTurnId: null,
      latestAssistantMessage: null,
      deliveredAssistantMessageKeys: new Set(),
      deliveredAssistantMessageCount: 0,
      completion: null,
      startedAtMs: Date.now(),
    };
  }

  clearOutboundTurn(state) {
    state.outboundTurnActive = false;
    state.currentOutboundTurn = null;
  }

  recordOutboundFinalization(state, {
    outcome,
    assistant = null,
    completion = null,
    error = null,
  } = {}) {
    state.lastOutboundFinalization = {
      outcome: normalizeString(outcome) || "unknown",
      latest_assistant_message_seq: assistant?.seq ?? null,
      latest_assistant_message_event_id_hash: assistant?.matrixEventId
        ? stableHash(assistant.matrixEventId).slice(0, 16)
        : null,
      delivered_assistant_message_count:
        state.currentOutboundTurn?.deliveredAssistantMessageCount || 0,
      completion_seq: completion?.seq ?? null,
      completion_event_id_hash: completion?.matrixEventId
        ? stableHash(completion.matrixEventId).slice(0, 16)
        : null,
      provider_turn_id_hash: state.currentOutboundTurn?.providerTurnId
        ? stableHash(state.currentOutboundTurn.providerTurnId).slice(0, 16)
        : null,
      error: normalizeString(error)?.slice(0, 240) || null,
      at: new Date().toISOString(),
      token_redacted: true,
      allowed_users_redacted: true,
      chat_id_redacted: true,
    };
  }

  recordOutboundDelivery(state, status) {
    if (!state || !status || typeof status !== "object") return;
    const message = status.message || {};
    state.lastOutboundDelivery = {
      status: normalizeString(status.status) || "unknown",
      kind: normalizeString(status.kind) || null,
      sent_count: Number.isSafeInteger(Number(status.sentCount))
        ? Number(status.sentCount)
        : 0,
      seq: messageSeq(message),
      event_id_hash: matrixMessageEventId(message)
        ? stableHash(matrixMessageEventId(message)).slice(0, 16)
        : null,
      source_user_event_id_hash: transcriptMessageSourceUserEventId(message)
        ? stableHash(transcriptMessageSourceUserEventId(message)).slice(0, 16)
        : null,
      provider_turn_id_hash: transcriptMessageProviderTurnId(message)
        ? stableHash(transcriptMessageProviderTurnId(message)).slice(0, 16)
        : null,
      error: normalizeString(status.error)?.slice(0, 240) || null,
      at: new Date().toISOString(),
      token_redacted: true,
      allowed_users_redacted: true,
      chat_id_redacted: true,
    };
    if (state.lastOutboundDelivery.status === "failed") {
      this.logWarn(
        `Telegram outbound ${state.lastOutboundDelivery.kind || "message"} failed`,
        state.lastOutboundDelivery.error || "unknown error"
      );
    } else {
      this.logInfo(
        `Telegram outbound ${state.lastOutboundDelivery.kind || "message"} sent sent_count=${state.lastOutboundDelivery.sent_count}`
      );
    }
  }

  noteOutboundTurnUserEvent(state, message) {
    const turn = state.currentOutboundTurn;
    if (!turn) return;
    const eventId = matrixMessageEventId(message);
    if (eventId !== turn.sourceUserEventId) return;
    const seq = messageSeq(message);
    if (seq !== null) turn.userEventSeq = seq;
  }

  adoptOutboundTurnProviderId(state, message) {
    const turn = state.currentOutboundTurn;
    if (!turn || turn.providerTurnId) return;
    const providerTurnId = transcriptMessageProviderTurnId(message);
    if (providerTurnId) turn.providerTurnId = providerTurnId;
  }

  rememberAssistantMessage(state, message) {
    const turn = state.currentOutboundTurn;
    const text = normalizeString(message?.text || message?.content);
    if (!turn || !text) return null;
    const completionState = normalizeString(
      message?.provider_completion_state
    );
    if (
      completionState &&
      completionState !== COMPLETE_MESSAGE_PROVIDER_COMPLETION_PENDING_STATE
    ) {
      return turn.latestAssistantMessage;
    }
    const seq = messageSeq(message);
    if (
      turn.latestAssistantMessage?.seq !== null &&
      turn.latestAssistantMessage?.seq !== undefined &&
      seq !== null &&
      seq <= turn.latestAssistantMessage.seq
    ) {
      return turn.latestAssistantMessage;
    }
    turn.latestAssistantMessage = {
      matrixEventId: matrixMessageEventId(message),
      seq,
      text,
      sourceUserEventId: transcriptMessageSourceUserEventId(message),
      providerTurnId: transcriptMessageProviderTurnId(message),
      completionState: completionState || null,
      message,
    };
    return turn.latestAssistantMessage;
  }

  assistantMessageDeliveryKey(message) {
    const eventId = matrixMessageEventId(message);
    if (eventId) return `event:${eventId}`;
    const seq = messageSeq(message);
    if (seq !== null) return `seq:${seq}`;
    throw new Error(
      "Telegram assistant transcript message requires matrix event id or seq"
    );
  }

  rememberOutboundTurnCompletion(state, message) {
    const turn = state.currentOutboundTurn;
    const completion = providerCompletionOutcome(message);
    if (!turn || !completion) return null;
    if (
      turn.completion?.seq !== null &&
      turn.completion?.seq !== undefined &&
      completion.seq !== null &&
      completion.seq <= turn.completion.seq
    ) {
      return turn.completion;
    }
    turn.completion = completion;
    return completion;
  }

  isCurrentOutboundTurnMessage(state, message) {
    const turn = state.currentOutboundTurn;
    if (!turn) return true;
    const seq = messageSeq(message);
    if (turn.userEventSeq !== null && seq !== null && seq <= turn.userEventSeq) {
      return false;
    }
    const sourceUserEventId = transcriptMessageSourceUserEventId(message);
    if (sourceUserEventId && sourceUserEventId === turn.sourceUserEventId) {
      return true;
    }
    const targetUserEventId = transcriptMessageTargetUserEventId(message);
    if (targetUserEventId && targetUserEventId === turn.sourceUserEventId) {
      return true;
    }
    const providerTurnId = transcriptMessageProviderTurnId(message);
    if (
      providerTurnId &&
      turn.providerTurnId &&
      providerTurnId === turn.providerTurnId
    ) {
      return true;
    }
    if (turn.userEventSeq === null) return false;
    if (sourceUserEventId || targetUserEventId || providerTurnId) return false;
    return seq === null || seq > turn.userEventSeq;
  }

  outboundTurnTimedOut(state) {
    const startedAtMs = Number(state?.currentOutboundTurn?.startedAtMs);
    return (
      Number.isFinite(startedAtMs) &&
      Date.now() - startedAtMs > this.outboundTurnTimeoutMs
    );
  }

  expireOutboundTurn(state) {
    const turn = state.currentOutboundTurn;
    this.stopTypingIndicator(state, "telegram_outbound_turn_timeout");
    this.clearOutboundTurn(state);
    if (typeof this.logger?.warn === "function") {
      this.logger.warn(
        `[telegram-bridge] outbound turn timed out: ${JSON.stringify({
          session_id: state.sessionId,
          source_user_event_id: turn?.sourceUserEventId || null,
          provider_turn_id: turn?.providerTurnId || null,
          latest_transcript_seq: state.latestTranscriptSeq,
          token_redacted: true,
          allowed_users_redacted: true,
        })}`
      );
    }
  }

  async clearOutboundPresentation(state) {
    if (state.toolOverview.messageId) {
      await this.deleteTelegramMessage(state, {
        messageId: state.toolOverview.messageId,
        kind: "tool_overview",
      });
      state.toolOverview.messageId = null;
    }
  }

  async finalizeOutboundTurnFromCompletion(state) {
    const turn = state.currentOutboundTurn;
    const completion = turn?.completion;
    if (!state.outboundTurnActive || !turn || !completion) {
      return { sent: 0, finalized: false };
    }

    this.stopTypingIndicator(
      state,
      completion.successful
        ? "provider_completion_seen"
        : "provider_completion_not_successful"
    );

    if (!completion.successful) {
      await this.clearOutboundPresentation(state);
      this.recordOutboundFinalization(state, {
        outcome: "provider_turn_not_successful",
        assistant: turn.latestAssistantMessage,
        completion,
      });
      this.clearOutboundTurn(state);
      return { sent: 0, finalized: true };
    }

    await this.clearOutboundPresentation(state);
    this.recordOutboundFinalization(state, {
      outcome:
        turn.deliveredAssistantMessageCount > 0
          ? "provider_turn_completed_after_assistant_delivery"
          : "provider_turn_completed_without_assistant_message",
      assistant: turn.latestAssistantMessage,
      completion,
    });
    this.clearOutboundTurn(state);
    return { sent: 0, finalized: true };
  }

  async flushOutboundTranscript(sessionId) {
    const state = this.listeners.get(sessionId);
    if (!state || state.stopped || !state.chatBinding) {
      return { status: "telegram_outbound_not_ready", sent: 0 };
    }
    if (state.flushingOutbound) {
      return { status: "telegram_outbound_flush_busy", sent: 0 };
    }
    state.flushingOutbound = true;
    try {
      const result = await this.readTranscriptMessagesAfter({
        binding: state.binding,
        afterSeq: state.latestTranscriptSeq,
        limit: DEFAULT_TRANSCRIPT_LIMIT,
      });
      const messages = Array.isArray(result?.messages) ? result.messages : [];
      let sent = 0;
      const scan = {
        status: "telegram_outbound_flush_scan",
        after_seq: state.latestTranscriptSeq,
        message_count: messages.length,
        sent_count: 0,
        skipped_echo_count: 0,
        skipped_inactive_turn_count: 0,
        skipped_not_current_turn_count: 0,
        assistant_seen_count: 0,
        assistant_sent_count: 0,
        tool_seen_count: 0,
        completion_seen: false,
        completion_successful: null,
        finalization_outcome: null,
        at: new Date().toISOString(),
      };
      for (const message of messages) {
        const eventId = matrixMessageEventId(message);
        if (eventId && state.noEchoEventIds.has(eventId)) {
          this.noteOutboundTurnUserEvent(state, message);
          state.latestTranscriptSeq = Math.max(
            state.latestTranscriptSeq,
            Number(message.seq) || state.latestTranscriptSeq
          );
          scan.skipped_echo_count += 1;
          continue;
        }
        state.latestTranscriptSeq = Math.max(
          state.latestTranscriptSeq,
          Number(message.seq) || state.latestTranscriptSeq
        );
        if (!state.outboundTurnActive) {
          scan.skipped_inactive_turn_count += 1;
          continue;
        }
        if (!this.isCurrentOutboundTurnMessage(state, message)) {
          scan.skipped_not_current_turn_count += 1;
          continue;
        }
        this.adoptOutboundTurnProviderId(state, message);
        if (isProviderCompletionTranscriptMessage(message)) {
          scan.completion_seen = true;
          const completion = this.rememberOutboundTurnCompletion(
            state,
            message
          );
          scan.completion_successful = completion?.successful ?? null;
          continue;
        }
        if (isHiddenInternalTranscriptMessage(message)) continue;
        if (isToolTranscriptMessage(message)) {
          scan.tool_seen_count += 1;
          if (state.sendToolMessages === true) {
            await this.updateToolOverview(state, message);
            sent += 1;
          }
          continue;
        }
        if (isAssistantTranscriptMessage(message)) {
          scan.assistant_seen_count += 1;
          this.rememberAssistantMessage(state, message);
          const assistantDelivery = await this.processAssistantTranscriptMessage(
            state,
            message
          );
          sent += assistantDelivery.sent;
          scan.assistant_sent_count += assistantDelivery.sent;
        }
      }
      if (state.outboundTurnActive && state.currentOutboundTurn?.completion) {
        const finalization = await this.finalizeOutboundTurnFromCompletion(state);
        sent += finalization.sent;
        scan.finalization_outcome =
          state.lastOutboundFinalization?.outcome || null;
      }
      if (Number(result?.sync?.next_after_seq) > state.latestTranscriptSeq) {
        state.latestTranscriptSeq = Number(result.sync.next_after_seq);
      }
      scan.sent_count = sent;
      scan.latest_transcript_seq = state.latestTranscriptSeq;
      state.lastOutboundScan = scan;
      return {
        status: "telegram_outbound_flush_complete",
        sent,
        latest_transcript_seq: state.latestTranscriptSeq,
      };
    } finally {
      state.flushingOutbound = false;
    }
  }

  async processAssistantTranscriptMessage(state, message) {
    const text = normalizeString(message?.text || message?.content);
    if (!text) return { sent: 0 };
    const turn = state.currentOutboundTurn;
    if (!turn) return { sent: 0 };
    const deliveryKey = this.assistantMessageDeliveryKey(message);
    if (turn.deliveredAssistantMessageKeys.has(deliveryKey)) {
      return { sent: 0 };
    }
    try {
      const sent = await this.sendTelegramText(state, {
        text,
        final: false,
        kind: "assistant_message",
      });
      turn.deliveredAssistantMessageKeys.add(deliveryKey);
      turn.deliveredAssistantMessageCount += 1;
      this.recordOutboundDelivery(state, {
        status: "sent",
        kind: "assistant_message",
        sentCount: sent.length,
        message,
      });
      return { sent: sent.length };
    } catch (err) {
      this.recordOutboundDelivery(state, {
        status: "failed",
        kind: "assistant_message",
        sentCount: 0,
        message,
        error: err?.message || String(err),
      });
      throw err;
    }
  }

  async startTypingIndicator(state) {
    if (
      !state ||
      state.stopped ||
      !state.outboundTurnActive ||
      !state.chatBinding ||
      typeof state.adapter?.sendChatAction !== "function"
    ) {
      return { status: "telegram_typing_indicator_not_started" };
    }
    if (state.typingIndicator?.active === true) {
      return { status: "telegram_typing_indicator_already_active" };
    }
    state.typingIndicator = {
      active: true,
      timer: null,
      fatalError: null,
    };
    await this.sendTypingAction(state);
    this.scheduleTypingIndicator(state);
    return { status: "telegram_typing_indicator_started" };
  }

  scheduleTypingIndicator(state) {
    if (!state?.typingIndicator?.active || state.typingIndicator.timer) return;
    if (state.stopped || !state.outboundTurnActive || !state.chatBinding) {
      this.stopTypingIndicator(state, "telegram_outbound_inactive");
      return;
    }
    state.typingIndicator.timer = this.setTimeoutFn(() => {
      state.typingIndicator.timer = null;
      void this.tickTypingIndicator(state);
    }, DEFAULT_TYPING_INTERVAL_MS);
    if (typeof state.typingIndicator.timer?.unref === "function") {
      state.typingIndicator.timer.unref();
    }
  }

  async tickTypingIndicator(state) {
    if (state.stopped || !state.outboundTurnActive || !state.chatBinding) {
      this.stopTypingIndicator(state, "telegram_outbound_inactive");
      return;
    }
    if (this.outboundTurnTimedOut(state)) {
      this.expireOutboundTurn(state);
      return;
    }
    await this.flushOutboundTranscript(state.sessionId);
    if (state.stopped || !state.outboundTurnActive || !state.chatBinding) {
      this.stopTypingIndicator(state, "telegram_outbound_inactive");
      return;
    }
    await this.sendTypingAction(state);
    this.scheduleTypingIndicator(state);
  }

  async sendTypingAction(state) {
    try {
      await state.adapter.sendChatAction({
        botToken: state.botToken,
        chatId: state.chatBinding.chatId,
        action: "typing",
        kind: "assistant_typing",
      });
      return { status: "telegram_typing_indicator_sent" };
    } catch (err) {
      if (isFatalTelegramChatError(err)) {
        if (state.typingIndicator) {
          state.typingIndicator.fatalError = err?.message || String(err);
        }
        this.stopTypingIndicator(state, "telegram_typing_fatal_chat_error");
        return { status: "telegram_typing_indicator_stopped_fatal" };
      }
      this.logWarn("Telegram typing indicator failed", err);
      return { status: "telegram_typing_indicator_failed_nonfatal" };
    }
  }

  stopTypingIndicator(state, reason = "telegram_typing_indicator_stop") {
    if (!state?.typingIndicator) return;
    if (state.typingIndicator.timer) {
      this.clearTimeoutFn(state.typingIndicator.timer);
      state.typingIndicator.timer = null;
    }
    state.typingIndicator.active = false;
    state.typingIndicator.stopReason = reason;
  }

  renderToolOverview(state) {
    const entries = Array.from(state.toolOverview.entries.values());
    if (!entries.length) return "";
    const done = entries.filter((entry) => entry.completed).length;
    const lines = ["⚙️ <b>Tools</b>"];
    for (const entry of entries) {
      const escapedName = escapeTelegramHtml(entry.toolName);
      lines.push(
        entry.completed
          ? `✓ ${escapedName}`
          : `${entry.emoji} ${escapedName}...`
      );
    }
    lines.push(`${done}/${entries.length} complete`);
    return lines.join("\n");
  }

  async updateToolOverview(state, message) {
    const status = buildToolStatus(message);
    const existing = state.toolOverview.entries.get(status.key);
    state.toolOverview.entries.set(status.key, {
      ...(existing || {}),
      ...status,
      completed: status.completed || existing?.completed === true,
    });
    const text = this.renderToolOverview(state);
    if (!text) return null;
    if (state.toolOverview.messageId) {
      return this.editTelegramText(state, {
        messageId: state.toolOverview.messageId,
        text,
        kind: "tool_overview",
        alreadyHtml: true,
      });
    }
    const sent = await this.sendTelegramText(state, {
      text,
      kind: "tool_overview",
      alreadyHtml: true,
    });
    state.toolOverview.messageId = sent[0]?.message_id || null;
    return sent;
  }

  async sendTelegramText(
    state,
    {
      text,
      final = false,
      kind = "message",
      replyMarkup = null,
      messageEffectId = null,
      alreadyHtml = false,
    } = {}
  ) {
    const chunks = splitTelegramText(text);
    const sent = [];
    for (const chunk of chunks) {
      const htmlText = alreadyHtml ? chunk : convertMarkdownToTelegramHtml(chunk);
      try {
        sent.push(
          await state.adapter.sendMessage({
            botToken: state.botToken,
            chatId: state.chatBinding.chatId,
            text: htmlText,
            final,
            parseMode: "HTML",
            replyMarkup,
            messageEffectId,
            kind,
          })
        );
      } catch (err) {
        sent.push(
          await state.adapter.sendMessage({
            botToken: state.botToken,
            chatId: state.chatBinding.chatId,
            text: chunk,
            final,
            replyMarkup,
            messageEffectId,
            kind,
          })
        );
      }
    }
    return sent;
  }

  async editTelegramText(
    state,
    {
      messageId,
      text,
      kind = "message",
      replyMarkup = null,
      alreadyHtml = false,
    } = {}
  ) {
    const normalizedMessageId = Number(messageId);
    if (!Number.isSafeInteger(normalizedMessageId)) {
      return this.sendTelegramText(state, {
        text,
        kind,
        replyMarkup,
        alreadyHtml,
      });
    }
    const chunk = splitTelegramText(text)[0] || "";
    const htmlText = alreadyHtml ? chunk : convertMarkdownToTelegramHtml(chunk);
    if (typeof state.adapter.editMessageText !== "function") {
      return this.sendTelegramText(state, {
        text: chunk,
        kind,
        replyMarkup,
        alreadyHtml,
      });
    }
    try {
      return await state.adapter.editMessageText({
        botToken: state.botToken,
        chatId: state.chatBinding.chatId,
        messageId: normalizedMessageId,
        text: htmlText,
        parseMode: "HTML",
        replyMarkup,
        kind,
      });
    } catch (err) {
      return state.adapter.editMessageText({
        botToken: state.botToken,
        chatId: state.chatBinding.chatId,
        messageId: normalizedMessageId,
        text: chunk,
        replyMarkup,
        kind,
      });
    }
  }

  async deleteTelegramMessage(state, { messageId, kind = "message" } = {}) {
    const normalizedMessageId = Number(messageId);
    if (
      !Number.isSafeInteger(normalizedMessageId) ||
      typeof state.adapter.deleteMessage !== "function"
    ) {
      return false;
    }
    return state.adapter.deleteMessage({
      botToken: state.botToken,
      chatId: state.chatBinding.chatId,
      messageId: normalizedMessageId,
      kind,
    });
  }

  logWarn(message, err) {
    if (typeof this.logger?.warn === "function") {
      this.logger.warn(`[telegram-bridge] ${message}: ${err?.message || err}`);
    }
  }

  logInfo(message) {
    if (typeof this.logger?.info === "function") {
      this.logger.info(`[telegram-bridge] ${message}`);
    }
  }
}

export function createTelegramBridgeManager(options = {}) {
  return new TelegramBridgeManager(options);
}

export const telegramBridgeTestHooks = Object.freeze({
  normalizeTelegramMessage,
  normalizeTelegramCallback,
  stripTelegramBotAddressing,
  passesGroupGate,
  passesAllowedUsersGate,
  classifyTelegramInput,
  formatOutboundTranscriptMessage,
  convertMarkdownToTelegramHtml,
  splitTelegramText,
  formatToolEmoji,
  isHiddenInternalTranscriptMessage,
});
