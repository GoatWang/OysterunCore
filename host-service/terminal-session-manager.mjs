import { execFile } from "child_process";
import { randomUUID } from "crypto";
import { mkdirSync, rmSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const TMUX_COMMAND = process.env.OYSTERUN_TMUX_COMMAND || "tmux";
const TERMINAL_STATE_RUNNING = "running";
const TERMINAL_STATE_EXITED = "exited";
const TERMINAL_STATE_CLOSED = "closed";
const TERMINAL_STATE_FAILED = "failed";
const CAPTURE_START_LINE = "-240";
const DEFAULT_STARTUP_WAIT_MS = 120;
const SAFE_TMUX_KEY_PATTERN = /^[A-Za-z0-9_-]+$/;
const URL_CHAR_PATTERN = /[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]/;
// OAuth URLs are the main wrapped-link case in the Host terminal, and tmux can preserve
// wrap whitespace while the terminal viewport drops the leading characters of the next param.
const WRAPPED_URL_QUERY_PARAM_NAMES = [
  "audience",
  "client_id",
  "code",
  "code_challenge",
  "code_challenge_method",
  "code_verifier",
  "login_hint",
  "nonce",
  "prompt",
  "redirect_uri",
  "resource",
  "response_type",
  "scope",
  "state",
];

function runExecFile(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeTerminalText(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .replace(/\u0008/g, "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
}

function isUrlChar(char) {
  return URL_CHAR_PATTERN.test(char);
}

function isClaudeOAuthAuthorizeUrl(url) {
  return /^https?:\/\/claude\.com\/(?:cai|csi)\/oauth\/authorize(?:[/?#]|$)/.test(url);
}

function resolveWrappedQueryParamName(name) {
  if (WRAPPED_URL_QUERY_PARAM_NAMES.includes(name)) {
    return name;
  }
  const matches = WRAPPED_URL_QUERY_PARAM_NAMES.filter((candidate) => candidate.endsWith(name));
  return matches.length === 1 ? matches[0] : "";
}

function getCurrentWrappedQueryParamTail(currentUrl) {
  const queryIndex = currentUrl.indexOf("?");
  const fragmentIndex = currentUrl.indexOf("#");
  if (queryIndex === -1 || (fragmentIndex !== -1 && fragmentIndex < queryIndex)) {
    return null;
  }
  const delimiterIndex = Math.max(currentUrl.lastIndexOf("&"), currentUrl.lastIndexOf("?"));
  const tailStart = delimiterIndex + 1;
  const tail = currentUrl.slice(tailStart);
  if (!tail || tail.includes("=") || !/^[A-Za-z_][A-Za-z0-9_.~-]*$/.test(tail)) {
    return null;
  }
  return {
    tail,
    tailStart,
  };
}

function repairWrappedQueryContinuation(currentUrl, rawChunk) {
  const queryIndex = currentUrl.indexOf("?");
  const fragmentIndex = currentUrl.indexOf("#");
  if (queryIndex === -1 || (fragmentIndex !== -1 && fragmentIndex < queryIndex)) {
    return "";
  }
  const ampIndex = rawChunk.indexOf("&");
  const equalIndex = rawChunk.indexOf("=");
  if (equalIndex <= 0 || (ampIndex !== -1 && ampIndex < equalIndex)) {
    return "";
  }
  const rawParamName = rawChunk.slice(0, equalIndex);
  if (!/^[A-Za-z_][A-Za-z0-9_.~-]*$/.test(rawParamName)) {
    return "";
  }
  const currentParamTail = getCurrentWrappedQueryParamTail(currentUrl);
  if (currentParamTail) {
    const mergedParamName = resolveWrappedQueryParamName(`${currentParamTail.tail}${rawParamName}`);
    if (mergedParamName) {
      return `${currentUrl.slice(0, currentParamTail.tailStart)}${mergedParamName}${rawChunk.slice(equalIndex)}`;
    }
  }
  const repairedParamName = resolveWrappedQueryParamName(rawParamName);
  if (!repairedParamName) {
    return "";
  }
  if (currentUrl.endsWith("?") || currentUrl.endsWith("&")) {
    return `${currentUrl}${repairedParamName}${rawChunk.slice(equalIndex)}`;
  }
  return `${currentUrl}&${repairedParamName}${rawChunk.slice(equalIndex)}`;
}

function maybeJoinWrappedUrlChunk(currentUrl, rawChunk, sawNewline, newlineCount) {
  if (newlineCount >= 2 && isClaudeOAuthAuthorizeUrl(currentUrl)) {
    return "";
  }
  const repairedUrl = repairWrappedQueryContinuation(currentUrl, rawChunk);
  if (repairedUrl) {
    return repairedUrl;
  }
  if (sawNewline) {
    return `${currentUrl}${rawChunk}`;
  }
  if (/^[&#/?%=]/.test(rawChunk) || /[&/#?%=]/.test(rawChunk)) {
    return `${currentUrl}${rawChunk}`;
  }
  return "";
}

export function extractWrappedUrls(text) {
  const input = sanitizeTerminalText(text);
  const urls = [];
  let index = 0;
  while (index < input.length) {
    const httpIndex = input.indexOf("http", index);
    if (httpIndex === -1) break;
    if (!(input.startsWith("http://", httpIndex) || input.startsWith("https://", httpIndex))) {
      index = httpIndex + 4;
      continue;
    }
    let cursor = httpIndex;
    let url = "";
    while (cursor < input.length) {
      const char = input[cursor];
      if (isUrlChar(char)) {
        url += char;
        cursor += 1;
        continue;
      }
      if (!/\s/.test(char)) {
        break;
      }
      let whitespaceCursor = cursor;
      let sawNewline = false;
      let newlineCount = 0;
      while (whitespaceCursor < input.length && /\s/.test(input[whitespaceCursor])) {
        if (input[whitespaceCursor] === "\n") {
          sawNewline = true;
          newlineCount += 1;
        }
        whitespaceCursor += 1;
      }
      if (whitespaceCursor >= input.length || !isUrlChar(input[whitespaceCursor])) {
        break;
      }
      let chunkCursor = whitespaceCursor;
      let rawChunk = "";
      while (chunkCursor < input.length && isUrlChar(input[chunkCursor])) {
        rawChunk += input[chunkCursor];
        chunkCursor += 1;
      }
      const nextUrl = maybeJoinWrappedUrlChunk(url, rawChunk, sawNewline, newlineCount);
      if (!nextUrl) {
        break;
      }
      url = nextUrl;
      cursor = chunkCursor;
    }
    if (url) {
      urls.push(url);
    }
    index = cursor;
  }
  return [...new Set(urls)];
}

function serializeTerminalSession(session) {
  if (!session) return null;
  return {
    terminal_id: session.id,
    state: session.state,
    owner_id: session.ownerId,
    cwd: session.cwd,
    started_at: session.startedAt,
    updated_at: session.updatedAt,
    finished_at: session.finishedAt,
    exit_code: session.exitCode,
    pane_text: session.paneText,
    extracted_links: [...session.extractedLinks],
    error: session.error || "",
  };
}

function buildSocketPath(id) {
  const socketRoot = join(homedir(), ".otx");
  mkdirSync(socketRoot, { recursive: true });
  return join(socketRoot, `${id.slice(0, 8)}.sock`);
}

function areStringArraysEqual(left, right) {
  if (left === right) return true;
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function normalizeTmuxKey(rawKey) {
  const normalized = typeof rawKey === "string" ? rawKey.trim() : "";
  if (!normalized) {
    throw new Error("key required");
  }
  const lower = normalized.toLowerCase();
  if (lower === "up") return "Up";
  if (lower === "down") return "Down";
  if (lower === "left") return "Left";
  if (lower === "right") return "Right";
  if (lower === "esc" || lower === "escape") return "Escape";
  if (lower === "enter" || lower === "return") return "C-m";
  if (lower === "ctrl_c" || lower === "ctrl-c" || lower === "c-c") return "C-c";
  if (!SAFE_TMUX_KEY_PATTERN.test(normalized)) {
    throw new Error(`Unsupported tmux key: ${normalized}`);
  }
  return normalized;
}

export class TerminalSessionManager {
  constructor(options = {}) {
    this.execFileFn = typeof options.execFileFn === "function" ? options.execFileFn : runExecFile;
    this.sleepFn = typeof options.sleepFn === "function" ? options.sleepFn : sleep;
    this.tmuxCommand = options.tmuxCommand || TMUX_COMMAND;
    this.shellPath = options.shellPath || process.env.SHELL || "/bin/zsh";
    this.sessions = new Map();
    this.activeSessionIdsByOwner = new Map();
  }

  snapshotHostRestartState() {
    return {
      replay_policy: "never_replay_terminal_commands",
      sessions: [...this.sessions.values()]
        .filter((session) => session.state === TERMINAL_STATE_RUNNING)
        .map((session) => ({
          ...serializeTerminalSession(session),
          restart_restore_policy: "mark_interrupted_after_host_restart",
          command_replay: false,
        })),
    };
  }

  markHostRestartInterrupted({ restartId = null, interruptedAt = null } = {}) {
    const timestamp = interruptedAt || new Date().toISOString();
    const interrupted = [];
    for (const session of this.sessions.values()) {
      if (session.state !== TERMINAL_STATE_RUNNING) continue;
      session.state = TERMINAL_STATE_FAILED;
      session.error =
        "Host restarted during terminal session; command was interrupted and will not be replayed.";
      session.finishedAt = timestamp;
      session.updatedAt = timestamp;
      this.activeSessionIdsByOwner.delete(session.ownerId);
      interrupted.push({
        terminal_id: session.id,
        owner_id: session.ownerId,
        restart_id: restartId,
        command_replay: false,
      });
    }
    return { interrupted, interrupted_at: timestamp };
  }

  async runTmux(session, args) {
    // `-f /dev/null` tells tmux to ignore the user's ~/.tmux.conf when it
    // spawns the server. Oysterun's tmux server is already isolated by
    // socket (`-S session.socketPath`), but without `-f` the user's
    // config (e.g. `set -g base-index 1`) still applied and collided
    // with hardcoded target assumptions further down (`${name}:0.0`).
    // Passing `-f /dev/null` on every call is harmless for attach-side
    // client commands; it only matters at server-spawn time.
    return this.execFileFn(this.tmuxCommand, ["-f", "/dev/null", "-S", session.socketPath, ...args]);
  }

  async createSession(ownerId, cwd) {
    const id = randomUUID();
    const session = {
      id,
      ownerId,
      cwd,
      socketPath: buildSocketPath(id),
      sessionName: `oysterm-${id.slice(0, 8)}`,
      target: null,
      state: TERMINAL_STATE_RUNNING,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      finishedAt: null,
      exitCode: null,
      paneText: "",
      extractedLinks: [],
      error: "",
    };
    session.target = `${session.sessionName}:0.0`;
    await this.runTmux(session, [
      "new-session",
      "-d",
      "-s",
      session.sessionName,
      "-c",
      session.cwd,
      this.shellPath,
      "-l",
    ]);
    await this.runTmux(session, ["set-option", "-t", session.sessionName, "remain-on-exit", "on"]);
    await this.runTmux(session, ["set-option", "-t", session.sessionName, "history-limit", "2000"]);
    await this.sleepFn(DEFAULT_STARTUP_WAIT_MS);
    return session;
  }

  async startSession(ownerId, cwd, options = {}) {
    if (!ownerId) {
      throw new Error("ownerId required");
    }
    const restart = options.restart === true;
    const activeId = this.activeSessionIdsByOwner.get(ownerId);
    if (activeId) {
      const activeSession = this.sessions.get(activeId);
      if (activeSession && activeSession.state !== TERMINAL_STATE_CLOSED && activeSession.state !== TERMINAL_STATE_FAILED) {
        if (restart) {
          await this.closeSession(activeSession.id, ownerId);
        } else {
          await this.refreshSession(activeSession.id, ownerId);
          return serializeTerminalSession(activeSession);
        }
      }
    }

    const session = await this.createSession(ownerId, cwd);
    this.sessions.set(session.id, session);
    this.activeSessionIdsByOwner.set(ownerId, session.id);
    await this.refreshSession(session.id, ownerId);
    return serializeTerminalSession(session);
  }

  getSessionRecord(sessionId, ownerId) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    if (ownerId && session.ownerId !== ownerId) {
      throw new Error("Terminal session does not belong to this user");
    }
    return session;
  }

  async refreshSession(sessionId, ownerId) {
    const session = this.getSessionRecord(sessionId, ownerId);
    if (!session) return null;
    if (session.state === TERMINAL_STATE_CLOSED || session.state === TERMINAL_STATE_FAILED) {
      return serializeTerminalSession(session);
    }
    try {
      const [{ stdout: paneText }, { stdout: paneState }] = await Promise.all([
        this.runTmux(session, ["capture-pane", "-p", "-J", "-t", session.target, "-S", CAPTURE_START_LINE]),
        this.runTmux(session, ["list-panes", "-t", session.target, "-F", "#{pane_dead} #{pane_dead_status}"]),
      ]);
      const nextPaneText = sanitizeTerminalText(paneText).trimEnd();
      const nextExtractedLinks = extractWrappedUrls(nextPaneText);
      const [paneDeadFlag, paneStatus] = String(paneState || "").trim().split(/\s+/, 2);
      const nextState = paneDeadFlag === "1" ? TERMINAL_STATE_EXITED : TERMINAL_STATE_RUNNING;
      const nextExitCode = nextState === TERMINAL_STATE_EXITED && Number.isInteger(Number(paneStatus))
        ? Number(paneStatus)
        : null;
      const nextFinishedAt = nextState === TERMINAL_STATE_EXITED
        ? (session.finishedAt || new Date().toISOString())
        : null;
      const didChange = (
        session.paneText !== nextPaneText
        || !areStringArraysEqual(session.extractedLinks, nextExtractedLinks)
        || session.state !== nextState
        || session.exitCode !== nextExitCode
        || session.finishedAt !== nextFinishedAt
        || session.error
      );
      session.paneText = nextPaneText;
      session.extractedLinks = nextExtractedLinks;
      if (paneDeadFlag === "1") {
        session.state = TERMINAL_STATE_EXITED;
        session.exitCode = nextExitCode;
        session.finishedAt = nextFinishedAt;
      } else {
        session.state = TERMINAL_STATE_RUNNING;
        session.exitCode = null;
        session.finishedAt = null;
      }
      session.error = "";
      if (didChange) {
        session.updatedAt = new Date().toISOString();
      }
      return serializeTerminalSession(session);
    } catch (error) {
      session.state = TERMINAL_STATE_FAILED;
      session.error = String(error?.stderr || error?.stdout || error?.message || "tmux command failed").trim();
      session.finishedAt = session.finishedAt || new Date().toISOString();
      session.updatedAt = new Date().toISOString();
      this.activeSessionIdsByOwner.delete(session.ownerId);
      return serializeTerminalSession(session);
    }
  }

  async sendText(sessionId, ownerId, text, options = {}) {
    const session = this.getSessionRecord(sessionId, ownerId);
    if (!session) return null;
    const normalizedText = typeof text === "string" ? text : "";
    if (!normalizedText) {
      throw new Error("text required");
    }
    if (session.state !== TERMINAL_STATE_RUNNING) {
      throw new Error("Terminal session is not running");
    }
    await this.runTmux(session, ["send-keys", "-t", session.target, "-l", normalizedText]);
    if (options.pressEnter === true) {
      await this.runTmux(session, ["send-keys", "-t", session.target, "C-m"]);
      await this.sleepFn(40);
    }
    return this.refreshSession(sessionId, ownerId);
  }

  async sendKey(sessionId, ownerId, rawKey) {
    const session = this.getSessionRecord(sessionId, ownerId);
    if (!session) return null;
    if (session.state !== TERMINAL_STATE_RUNNING) {
      throw new Error("Terminal session is not running");
    }
    const tmuxKey = normalizeTmuxKey(rawKey);
    await this.runTmux(session, ["send-keys", "-t", session.target, tmuxKey]);
    await this.sleepFn(40);
    return this.refreshSession(sessionId, ownerId);
  }

  async closeSession(sessionId, ownerId) {
    const session = this.getSessionRecord(sessionId, ownerId);
    if (!session) return null;
    if (session.state !== TERMINAL_STATE_CLOSED) {
      try {
        await this.runTmux(session, ["kill-session", "-t", session.sessionName]);
      } catch {
        // Ignore missing tmux session here; the local record still needs cleanup.
      }
    }
    rmSync(session.socketPath, { force: true });
    session.state = TERMINAL_STATE_CLOSED;
    session.finishedAt = session.finishedAt || new Date().toISOString();
    session.updatedAt = new Date().toISOString();
    this.activeSessionIdsByOwner.delete(session.ownerId);
    return serializeTerminalSession(session);
  }
}
