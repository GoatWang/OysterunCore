import { createHash } from "crypto";
import { TelegramBotApiAdapter } from "./telegram-adapter.mjs";

const DEFAULT_POLL_INTERVAL_MS = 2500;
const DEFAULT_LONG_POLL_TIMEOUT_SECONDS = 25;
const DEFAULT_TYPING_INTERVAL_MS = 4000;
const DEFAULT_TRANSCRIPT_LIMIT = 50;
const MAX_TELEGRAM_OUTBOUND_LENGTH = 3500;
const TELEGRAM_MESSAGE_EFFECTS = Object.freeze({
  CONFETTI: "5046509860389126442",
  THUMBS_UP: "5107584321108051014",
  THUMBS_DOWN: "5104858069142078462",
});

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
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

function convertMarkdownToTelegramHtml(text) {
  let source = normalizeString(text);
  if (!source) return "";
  const codeBlocks = [];
  source = source.replace(/```([\s\S]*?)```/g, (_match, code) => {
    const placeholder = `\u0000CB${codeBlocks.length}\u0000`;
    codeBlocks.push(`<pre><code>${escapeTelegramHtml(code.trim())}</code></pre>`);
    return placeholder;
  });
  const inlineCodes = [];
  source = source.replace(/`([^`\n]+)`/g, (_match, code) => {
    const placeholder = `\u0000IC${inlineCodes.length}\u0000`;
    inlineCodes.push(`<code>${escapeTelegramHtml(code)}</code>`);
    return placeholder;
  });
  let html = escapeTelegramHtml(source);
  html = html.replace(
    /\[([^\]\n]+)\]\(([^)\s]+)\)/g,
    (_match, label, href) =>
      `<a href="${escapeTelegramHtml(href)}">${label}</a>`
  );
  html = html.replace(/^######\s+(.+)$/gm, "<b>$1</b>");
  html = html.replace(/^#####\s+(.+)$/gm, "<b>$1</b>");
  html = html.replace(/^####\s+(.+)$/gm, "<b>$1</b>");
  html = html.replace(/^###\s+(.+)$/gm, "<b>$1</b>");
  html = html.replace(/^##\s+(.+)$/gm, "<b>$1</b>");
  html = html.replace(/^#\s+(.+)$/gm, "<b>$1</b>");
  html = html.replace(/\*\*([^*\n][\s\S]*?[^*\n])\*\*/g, "<b>$1</b>");
  html = html.replace(/__([^_\n][\s\S]*?[^_\n])__/g, "<b>$1</b>");
  html = html.replace(/(^|[^\*])\*([^*\n]+)\*/g, "$1<i>$2</i>");
  html = html.replace(/(^|[^_])_([^_\n]+)_/g, "$1<i>$2</i>");
  html = html.replace(/^&gt;\s?(.+)$/gm, "<blockquote>$1</blockquote>");
  codeBlocks.forEach((block, index) => {
    html = html.replaceAll(`\u0000CB${index}\u0000`, block);
  });
  inlineCodes.forEach((code, index) => {
    html = html.replaceAll(`\u0000IC${index}\u0000`, code);
  });
  return html;
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

function isFinalAssistantTranscriptMessage(message) {
  return (
    message?.final === true ||
    message?.lifecycle === "final" ||
    message?.semantic_lifecycle === "final"
  );
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
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.listeners = new Map();
    this.disabledSessions = new Map();
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
        return {
          status: "telegram_listener_disabled",
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
    return {
      status: "telegram_listener_active",
      listening: true,
      listener_count: this.listeners.size,
      session_id: state.sessionId,
      agent_id: state.agentId,
      adapter_kind: state.adapterKind,
      bot_username_configured: Boolean(state.botIdentity?.username),
      bound_chat: Boolean(state.chatBinding),
      allowed_users_allow_all: state.allowedUsers.includes("."),
      allowed_users_count: state.allowedUsers.length,
      send_tool_messages: state.sendToolMessages === true,
      latest_transcript_seq: state.latestTranscriptSeq,
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
      assistantTelegramMessageId: null,
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
    };
    await this.primeUpdateOffset(state);
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

  stopSession(sessionId, reason = "telegram_listener_stop") {
    const state = this.listeners.get(sessionId);
    this.disabledSessions.delete(sessionId);
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
      const updates = await state.adapter.getUpdates({
        botToken: state.botToken,
        offset: state.updateOffset,
        timeoutSeconds,
        limit: 100,
      });
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
    state.outboundTurnActive = true;
    state.assistantTelegramMessageId = null;
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

  async flushOutboundTranscript(sessionId) {
    const state = this.listeners.get(sessionId);
    if (!state || state.stopped || !state.chatBinding) {
      return { status: "telegram_outbound_not_ready", sent: 0 };
    }
    const result = await this.readTranscriptMessagesAfter({
      binding: state.binding,
      afterSeq: state.latestTranscriptSeq,
      limit: DEFAULT_TRANSCRIPT_LIMIT,
    });
    const messages = Array.isArray(result?.messages) ? result.messages : [];
    let sent = 0;
    for (const message of messages) {
      const eventId = matrixMessageEventId(message);
      if (eventId && state.noEchoEventIds.has(eventId)) {
        state.latestTranscriptSeq = Math.max(
          state.latestTranscriptSeq,
          Number(message.seq) || state.latestTranscriptSeq
        );
        continue;
      }
      state.latestTranscriptSeq = Math.max(
        state.latestTranscriptSeq,
        Number(message.seq) || state.latestTranscriptSeq
      );
      if (isHiddenInternalTranscriptMessage(message)) continue;
      if (!state.outboundTurnActive) continue;
      if (isToolTranscriptMessage(message)) {
        if (state.sendToolMessages === true) {
          await this.updateToolOverview(state, message);
          sent += 1;
        }
        continue;
      }
      if (isAssistantTranscriptMessage(message)) {
        const result = await this.processAssistantTranscriptMessage(state, message);
        sent += result.sent;
      }
    }
    if (Number(result?.sync?.next_after_seq) > state.latestTranscriptSeq) {
      state.latestTranscriptSeq = Number(result.sync.next_after_seq);
    }
    return {
      status: "telegram_outbound_flush_complete",
      sent,
      latest_transcript_seq: state.latestTranscriptSeq,
    };
  }

  async processAssistantTranscriptMessage(state, message) {
    const text = normalizeString(message?.text || message?.content);
    if (!text) return { sent: 0 };
    const final = isFinalAssistantTranscriptMessage(message);
    if (final) {
      this.stopTypingIndicator(state, "assistant_final");
      if (state.toolOverview.messageId) {
        await this.deleteTelegramMessage(state, {
          messageId: state.toolOverview.messageId,
          kind: "tool_overview",
        });
        state.toolOverview.messageId = null;
      }
      if (state.assistantTelegramMessageId) {
        await this.deleteTelegramMessage(state, {
          messageId: state.assistantTelegramMessageId,
          kind: "assistant_progress",
        });
        state.assistantTelegramMessageId = null;
      }
      await this.sendTelegramText(state, {
        text,
        final: true,
        kind: "assistant_final",
        messageEffectId: telegramEffectFor(
          state.chatBinding?.chatType,
          "CONFETTI"
        ),
      });
      state.outboundTurnActive = false;
      return { sent: 1 };
    }
    if (state.assistantTelegramMessageId) {
      await this.editTelegramText(state, {
        messageId: state.assistantTelegramMessageId,
        text,
        kind: "assistant_progress",
      });
      return { sent: 1 };
    }
    const sent = await this.sendTelegramText(state, {
      text,
      final: false,
      kind: "assistant_progress",
    });
    state.assistantTelegramMessageId = sent[0]?.message_id || null;
    return { sent: sent.length };
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
  formatToolEmoji,
  isHiddenInternalTranscriptMessage,
});
