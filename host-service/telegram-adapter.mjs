const TELEGRAM_API_BASE_URL = "https://api.telegram.org";
const DEFAULT_TELEGRAM_LONG_POLL_TIMEOUT_SECONDS = 25;

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requireBotToken(botToken) {
  const token = normalizeString(botToken);
  if (!token) {
    throw new Error("Telegram bot token is required");
  }
  return token;
}

function telegramApiUrl(botToken, method) {
  return `${TELEGRAM_API_BASE_URL}/bot${encodeURIComponent(
    requireBotToken(botToken)
  )}/${method}`;
}

async function readTelegramJsonResponse(response, method) {
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok || body?.ok !== true) {
    const description =
      normalizeString(body?.description) || `Telegram ${method} failed`;
    throw new Error(description);
  }
  return body.result;
}

export class TelegramBotApiAdapter {
  constructor({ fetchImpl = globalThis.fetch } = {}) {
    if (typeof fetchImpl !== "function") {
      throw new Error("TelegramBotApiAdapter requires fetch");
    }
    this.kind = "real";
    this.fetchImpl = fetchImpl;
  }

  async getBotIdentity({ botToken }) {
    const response = await this.fetchImpl(telegramApiUrl(botToken, "getMe"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const result = await readTelegramJsonResponse(response, "getMe");
    return {
      id: result?.id === undefined ? null : String(result.id),
      username: normalizeString(result?.username),
    };
  }

  async getUpdates({
    botToken,
    offset = null,
    timeoutSeconds = DEFAULT_TELEGRAM_LONG_POLL_TIMEOUT_SECONDS,
    limit = 100,
    signal = null,
  }) {
    const body = {
      timeout: Math.max(0, Number(timeoutSeconds) || 0),
      limit: Math.min(Math.max(Number(limit) || 100, 1), 100),
      allowed_updates: ["message", "callback_query"],
    };
    if (Number.isInteger(offset) && offset > 0) {
      body.offset = offset;
    }
    const response = await this.fetchImpl(
      telegramApiUrl(botToken, "getUpdates"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      }
    );
    const result = await readTelegramJsonResponse(response, "getUpdates");
    return Array.isArray(result) ? result : [];
  }

  async sendMessage({
    botToken,
    chatId,
    text,
    replyToMessageId = null,
    parseMode = null,
    replyMarkup = null,
    messageEffectId = null,
  }) {
    const chat = normalizeString(chatId);
    const bodyText = normalizeString(text);
    if (!chat || !bodyText) {
      throw new Error("Telegram sendMessage requires chatId and text");
    }
    const body = {
      chat_id: chat,
      text: bodyText,
      disable_web_page_preview: true,
    };
    if (replyToMessageId !== null && replyToMessageId !== undefined) {
      body.reply_to_message_id = replyToMessageId;
    }
    const parseModeValue = normalizeString(parseMode);
    if (parseModeValue) body.parse_mode = parseModeValue;
    if (replyMarkup && typeof replyMarkup === "object") {
      body.reply_markup = replyMarkup;
    }
    const effect = normalizeString(messageEffectId);
    if (effect) body.message_effect_id = effect;
    const response = await this.fetchImpl(
      telegramApiUrl(botToken, "sendMessage"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    return readTelegramJsonResponse(response, "sendMessage");
  }

  async editMessageText({
    botToken,
    chatId,
    messageId,
    text,
    parseMode = null,
    replyMarkup = null,
  }) {
    const chat = normalizeString(chatId);
    const resolvedMessageId = Number(messageId);
    const bodyText = normalizeString(text);
    if (!chat || !Number.isSafeInteger(resolvedMessageId) || !bodyText) {
      throw new Error("Telegram editMessageText requires chatId, messageId, and text");
    }
    const body = {
      chat_id: chat,
      message_id: resolvedMessageId,
      text: bodyText,
      disable_web_page_preview: true,
    };
    const parseModeValue = normalizeString(parseMode);
    if (parseModeValue) body.parse_mode = parseModeValue;
    if (replyMarkup && typeof replyMarkup === "object") {
      body.reply_markup = replyMarkup;
    }
    const response = await this.fetchImpl(
      telegramApiUrl(botToken, "editMessageText"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    return readTelegramJsonResponse(response, "editMessageText");
  }

  async deleteMessage({ botToken, chatId, messageId }) {
    const chat = normalizeString(chatId);
    const resolvedMessageId = Number(messageId);
    if (!chat || !Number.isSafeInteger(resolvedMessageId)) {
      throw new Error("Telegram deleteMessage requires chatId and messageId");
    }
    const response = await this.fetchImpl(
      telegramApiUrl(botToken, "deleteMessage"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chat,
          message_id: resolvedMessageId,
        }),
      }
    );
    return readTelegramJsonResponse(response, "deleteMessage");
  }

  async sendChatAction({ botToken, chatId, action }) {
    const chat = normalizeString(chatId);
    const actionName = normalizeString(action);
    if (!chat || !actionName) {
      throw new Error("Telegram sendChatAction requires chatId and action");
    }
    const response = await this.fetchImpl(
      telegramApiUrl(botToken, "sendChatAction"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chat,
          action: actionName,
        }),
      }
    );
    return readTelegramJsonResponse(response, "sendChatAction");
  }
}

export class TelegramMockAdapter {
  constructor({
    botIdentity = { id: "9001", username: "oysterun_test_bot" },
  } = {}) {
    this.kind = "mock";
    this.botIdentity = {
      id: botIdentity?.id === undefined ? "9001" : String(botIdentity.id),
      username: normalizeString(botIdentity?.username) || "oysterun_test_bot",
    };
    this.updates = [];
    this.operations = [];
    this.nextMessageId = 1;
  }

  queueUpdate(update) {
    if (!update || typeof update !== "object") {
      throw new Error("Mock Telegram update must be an object");
    }
    this.updates.push(JSON.parse(JSON.stringify(update)));
  }

  queueMessage({
    updateId,
    chatId,
    chatType = "private",
    text,
    fromId = "12345",
    username = "owner",
    messageId = null,
    replyToBot = false,
    memberCount = null,
  }) {
    const resolvedMessageId =
      messageId === null || messageId === undefined
        ? Number(updateId) || this.updates.length + 1
        : messageId;
    const message = {
      message_id: resolvedMessageId,
      chat: {
        id: chatId,
        type: chatType,
      },
      from: {
        id: fromId,
        username,
        is_bot: false,
      },
      text,
    };
    if (Number.isInteger(memberCount)) {
      message.chat.member_count = memberCount;
    }
    if (replyToBot) {
      message.reply_to_message = {
        message_id: resolvedMessageId - 1,
        from: {
          id: this.botIdentity.id,
          username: this.botIdentity.username,
          is_bot: true,
        },
      };
    }
    this.queueUpdate({
      update_id: updateId,
      message,
    });
  }

  queueCallback({
    updateId,
    callbackId = null,
    chatId,
    data,
    fromId = "12345",
    username = "owner",
    messageId = null,
  }) {
    const resolvedMessageId =
      messageId === null || messageId === undefined
        ? Number(updateId) || this.updates.length + 1
        : messageId;
    this.queueUpdate({
      update_id: updateId,
      callback_query: {
        id:
          callbackId === null || callbackId === undefined
            ? `callback-${updateId}`
            : String(callbackId),
        from: {
          id: fromId,
          username,
          is_bot: false,
        },
        message: {
          message_id: resolvedMessageId,
          chat: {
            id: chatId,
            type: "private",
          },
        },
        data,
      },
    });
  }

  async getBotIdentity() {
    return { ...this.botIdentity };
  }

  async getUpdates({ offset = null, limit = 100 } = {}) {
    const minOffset = Number.isInteger(offset) && offset > 0 ? offset : 0;
    return this.updates
      .filter((update) => Number(update.update_id) >= minOffset)
      .slice(0, Math.min(Math.max(Number(limit) || 100, 1), 100))
      .map((update) => JSON.parse(JSON.stringify(update)));
  }

  async sendMessage({
    chatId,
    text,
    replyToMessageId = null,
    final = false,
    parseMode = null,
    replyMarkup = null,
    messageEffectId = null,
    kind = "message",
  }) {
    const record = {
      operation: "sendMessage",
      message_id: this.nextMessageId++,
      chat_id: chatId === undefined || chatId === null ? null : String(chatId),
      text: normalizeString(text) || "",
      reply_to_message_id: replyToMessageId,
      final: final === true,
      parse_mode: normalizeString(parseMode),
      reply_markup: replyMarkup ? JSON.parse(JSON.stringify(replyMarkup)) : null,
      message_effect_id: normalizeString(messageEffectId),
      kind: normalizeString(kind) || "message",
    };
    this.operations.push(record);
    return {
      message_id: record.message_id,
      chat: { id: record.chat_id },
      text: record.text,
    };
  }

  async editMessageText({
    chatId,
    messageId,
    text,
    parseMode = null,
    replyMarkup = null,
    kind = "message",
  }) {
    const record = {
      operation: "editMessageText",
      message_id: Number(messageId),
      chat_id: chatId === undefined || chatId === null ? null : String(chatId),
      text: normalizeString(text) || "",
      parse_mode: normalizeString(parseMode),
      reply_markup: replyMarkup ? JSON.parse(JSON.stringify(replyMarkup)) : null,
      kind: normalizeString(kind) || "message",
    };
    this.operations.push(record);
    return {
      message_id: record.message_id,
      chat: { id: record.chat_id },
      text: record.text,
    };
  }

  async deleteMessage({ chatId, messageId, kind = "message" }) {
    const record = {
      operation: "deleteMessage",
      message_id: Number(messageId),
      chat_id: chatId === undefined || chatId === null ? null : String(chatId),
      kind: normalizeString(kind) || "message",
    };
    this.operations.push(record);
    return true;
  }

  async sendChatAction({ chatId, action, kind = "assistant_typing" }) {
    const record = {
      operation: "sendChatAction",
      chat_id: chatId === undefined || chatId === null ? null : String(chatId),
      action: normalizeString(action) || "",
      kind: normalizeString(kind) || "assistant_typing",
    };
    this.operations.push(record);
    return true;
  }

  getSentMessages() {
    return this.operations.map((entry) => ({ ...entry }));
  }

  clear() {
    this.updates = [];
    this.operations = [];
    this.nextMessageId = 1;
  }
}

export function createTelegramBotApiAdapter(options = {}) {
  return new TelegramBotApiAdapter(options);
}

export function createTelegramMockAdapter(options = {}) {
  return new TelegramMockAdapter(options);
}
