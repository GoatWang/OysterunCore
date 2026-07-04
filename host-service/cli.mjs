#!/usr/bin/env node

/**
 * Interactive CLI for the Oysterun host service.
 *
 * Connects to the running host service and provides a REPL
 * for managing sessions, sending messages, and watching output.
 *
 * Usage:
 *   node cli.mjs                          # Connect to localhost:8802 (production)
 *   node cli.mjs --port 9902              # Connect to localhost:9902 (staging)
 *   node cli.mjs --url https://foo.ngrok-free.dev  # Remote via ngrok
 *
 * Commands:
 *   /start <agent_id> [folder]  Start a session
 *   /send <agent_id> <text>     Send a message
 *   /stop <agent_id>            Graceful stop
 *   /kill <agent_id>            Force kill
 *   /status <agent_id>          Check session status
 *   /list                       List all sessions
 *   /health                     Health check
 *   /watch <agent_id>           Subscribe to WebSocket stream
 *   /unwatch                    Disconnect WebSocket
 *   /help                       Show commands
 *   /quit                       Exit
 *
 *   <text>                      Send to the watched agent (if /watch is active)
 */

import { createInterface } from "readline";
import { WebSocket } from "ws";
import { PRODUCTION_HOST_PORT, STAGING_HOST_PORT } from "./config.mjs";

// ── Config ───────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { port: PRODUCTION_HOST_PORT, url: null, nickname: "CLI", token: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--port" && args[i + 1]) opts.port = parseInt(args[++i], 10);
    else if (args[i] === "--url" && args[i + 1]) opts.url = args[++i];
    else if (args[i] === "--nickname" && args[i + 1]) opts.nickname = args[++i];
    else if (args[i] === "--token" && args[i + 1]) opts.token = args[++i];
  }
  return opts;
}

const opts = parseArgs();
const BASE = opts.url || `http://localhost:${opts.port}`;
const WS_BASE = opts.url
  ? opts.url.replace(/^http/, "ws")
  : `ws://localhost:${opts.port}`;

// ── State ────────────────────────────────────────────────────

let ws = null;
let watchingAgent = null;

// ── HTTP Helpers ─────────────────────────────────────────────

async function api(method, path, body) {
  const url = `${BASE}${path}`;
  const headers = { "Content-Type": "application/json" };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const init = { method, headers };
  if (body) init.body = JSON.stringify(body);

  const resp = await fetch(url, init);
  const data = await resp.json();
  return { status: resp.status, data };
}

// ── Message Formatter ────────────────────────────────────────

function formatRuntimePayload(payload) {
  if (payload.type === "status") {
    return `\x1b[36m[status]\x1b[0m ${payload.active ? "active" : "idle"}${payload.provider ? ` | provider=${payload.provider}` : ""}`;
  }

  if (payload.type !== "event" || !payload.event) {
    return null;
  }

  return formatRuntimeEvent(payload.event);
}

function formatRuntimeEvent(event) {
  switch (event.type) {
    case "session.started":
      return `\x1b[32m● Session started\x1b[0m (${event.sessionId})`;
    case "session.ready":
      return `\x1b[36m[system]\x1b[0m Session ready | model=${event.model || "?"} | ${event.tools?.length || 0} tools`;
    case "session.notice":
      return `\x1b[36m[system]\x1b[0m ${event.subtype || "notice"}`;
    case "session.exit":
      return `\x1b[31m● Session exited\x1b[0m (code=${event.code})`;
    case "runtime.error":
      return `\x1b[31m● Error:\x1b[0m ${event.error}`;
    case "stderr":
      return `\x1b[33m[stderr]\x1b[0m ${event.text}`;
    case "message.user":
      return `\x1b[34m[${event.nickname || "User"}]\x1b[0m ${event.text}`;
    case "message.assistant":
      return event.text ? `\x1b[37m${event.text}\x1b[0m` : null;
    case "tool.call": {
      const inputPreview = JSON.stringify(event.input).slice(0, 100);
      return `\x1b[35m[tool]\x1b[0m ${event.name}(${inputPreview})`;
    }
    case "tool.result": {
      const raw = typeof event.content === "string"
        ? event.content
        : JSON.stringify(event.content);
      const preview = (raw || "").slice(0, 200);
      return `\x1b[34m[tool_result]\x1b[0m ${preview}${raw?.length > 200 ? "..." : ""}`;
    }
    case "turn.completed": {
      const usage = event.usage || {};
      const tokens = usage.total_tokens || usage.input_tokens || "?";
      const duration = event.duration_ms ? `${(event.duration_ms / 1000).toFixed(1)}s` : "?";
      const turns = event.turns || "?";
      return `\x1b[32m[done]\x1b[0m ${turns} turns | ${tokens} tokens | ${duration}`;
    }
    default:
      return null;
  }
}

// ── WebSocket ────────────────────────────────────────────────

function connectWebSocket(agentId) {
  disconnectWebSocket();

  const wsUrl = opts.token
    ? `${WS_BASE}/session/stream?agent_id=${agentId}&token=${opts.token}`
    : `${WS_BASE}/session/stream?agent_id=${agentId}`;
  ws = new WebSocket(wsUrl);
  watchingAgent = agentId;

  ws.on("open", () => {
    console.log(`\x1b[32m● Watching agent: ${agentId}\x1b[0m`);
    console.log(`  (Type messages directly, or use /send. /unwatch to disconnect)\n`);
    rl.prompt();
  });

  ws.on("message", (raw) => {
    const payload = JSON.parse(raw.toString());

    // Stream assistant deltas without newline for typing effect
    if (payload.type === "event" && payload.event?.type === "message.assistant" && payload.event.delta) {
      const text = payload.event.text;
      if (text) {
        process.stdout.write(text);
        return;
      }
    }

    const formatted = formatRuntimePayload(payload);
    if (formatted) {
      // Clear prompt line, print message, re-prompt
      process.stdout.write("\r\x1b[K");
      console.log(formatted);
      rl.prompt();
    }
  });

  ws.on("close", () => {
    if (watchingAgent === agentId) {
      console.log(`\x1b[33m● WebSocket disconnected from ${agentId}\x1b[0m`);
      watchingAgent = null;
      ws = null;
      rl.prompt();
    }
  });

  ws.on("error", (err) => {
    console.error(`\x1b[31m● WebSocket error: ${err.message}\x1b[0m`);
  });
}

function disconnectWebSocket() {
  if (ws) {
    ws.close();
    ws = null;
    watchingAgent = null;
  }
}

// ── Commands ─────────────────────────────────────────────────

async function handleCommand(input) {
  const parts = input.split(/\s+/);
  const cmd = parts[0].toLowerCase();

  try {
    switch (cmd) {
      case "/help":
        console.log(`
  \x1b[1mOysterun Host Service CLI\x1b[0m

  \x1b[1mSession Management:\x1b[0m
    /start <agent_id> [folder]     Start a session
    /stop <agent_id>               Graceful stop (close stdin)
    /kill <agent_id>               Force kill (SIGTERM → SIGKILL)
    /status <agent_id>             Check session status
    /list                          List all active sessions

  \x1b[1mChat:\x1b[0m
    /send <agent_id> <text>        Send a message to an agent
    /watch <agent_id>              Subscribe to live output via WebSocket
    /unwatch                       Disconnect WebSocket
    <text>                         Send to watched agent (when /watch active)

  \x1b[1mServer:\x1b[0m
    /health                        Health check
    /quit                          Exit CLI

  \x1b[1mOptions:\x1b[0m
    --port <port>                  Host service port (default ${PRODUCTION_HOST_PORT}; staging ${STAGING_HOST_PORT})
    --url <url>                    Full URL (for ngrok)
    --nickname <name>              Chat nickname (default "CLI")
`);
        break;

      case "/start": {
        const agentId = parts[1];
        const folder = parts[2];
        if (!agentId) {
          console.log("  Usage: /start <agent_id> [folder]");
          break;
        }
        const body = {
          agent_id: agentId,
        };
        if (folder) body.agent_folder = folder;
        const { status, data } = await api("POST", "/session/start", body);
        if (status === 200) {
          console.log(`  \x1b[32m✓\x1b[0m Started | session_id=${data.session_id} | alive=${data.alive} | ready=${data.ready}`);
        } else {
          console.log(`  \x1b[31m✗\x1b[0m ${data.error}`);
        }
        break;
      }

      case "/send": {
        const agentId = parts[1];
        const text = parts.slice(2).join(" ");
        if (!agentId || !text) {
          console.log("  Usage: /send <agent_id> <text>");
          break;
        }
        const { status, data } = await api("POST", "/session/send", {
          agent_id: agentId,
          nickname: opts.nickname,
          text,
        });
        if (status === 200) {
          console.log(`  \x1b[32m→\x1b[0m Sent to ${agentId}`);
        } else {
          console.log(`  \x1b[31m✗\x1b[0m ${data.error}`);
        }
        break;
      }

      case "/stop": {
        const agentId = parts[1];
        if (!agentId) {
          console.log("  Usage: /stop <agent_id>");
          break;
        }
        const { status, data } = await api("POST", "/session/stop", {
          agent_id: agentId,
        });
        if (status === 200) {
          console.log(`  \x1b[32m✓\x1b[0m ${data.status}`);
        } else {
          console.log(`  \x1b[31m✗\x1b[0m ${data.error}`);
        }
        break;
      }

      case "/kill": {
        const agentId = parts[1];
        if (!agentId) {
          console.log("  Usage: /kill <agent_id>");
          break;
        }
        const { status, data } = await api("POST", "/session/stop", {
          agent_id: agentId,
          force: true,
        });
        if (status === 200) {
          console.log(`  \x1b[32m✓\x1b[0m ${data.status}`);
        } else {
          console.log(`  \x1b[31m✗\x1b[0m ${data.error}`);
        }
        break;
      }

      case "/status": {
        const agentId = parts[1];
        if (!agentId) {
          console.log("  Usage: /status <agent_id>");
          break;
        }
        const { data } = await api("GET", `/session/status?agent_id=${agentId}`);
        if (data.active) {
          console.log(`  \x1b[32m●\x1b[0m ${agentId} | session=${data.session_id} | alive=${data.alive} | ready=${data.ready}`);
        } else {
          console.log(`  \x1b[90m○\x1b[0m ${agentId} | no active session`);
        }
        break;
      }

      case "/list": {
        const { data } = await api("GET", "/sessions");
        if (data.sessions.length === 0) {
          console.log("  No active sessions.");
        } else {
          console.log("  Active sessions:");
          for (const s of data.sessions) {
            const marker = s.agentId === watchingAgent ? " \x1b[36m← watching\x1b[0m" : "";
            console.log(`    ${s.agentId} | ${s.sessionId.slice(0, 8)}... | ${s.cwd} | alive=${s.alive}${marker}`);
          }
        }
        break;
      }

      case "/health": {
        const { data } = await api("GET", "/health");
        console.log(`  status=${data.status} | sessions=${data.sessions} | device=${data.device_id || "none"}`);
        if (data.ngrok) {
          console.log(`  ngrok: alive=${data.ngrok.alive} | url=${data.ngrok.publicUrl}`);
        }
        break;
      }

      case "/watch": {
        const agentId = parts[1];
        if (!agentId) {
          console.log("  Usage: /watch <agent_id>");
          break;
        }
        connectWebSocket(agentId);
        return; // Don't prompt — ws.on("open") will
      }

      case "/unwatch": {
        if (!watchingAgent) {
          console.log("  Not watching any agent.");
          break;
        }
        const prev = watchingAgent;
        disconnectWebSocket();
        console.log(`  Unwatched ${prev}`);
        break;
      }

      case "/quit":
      case "/exit":
        disconnectWebSocket();
        console.log("  Bye.");
        process.exit(0);

      default:
        console.log(`  Unknown command: ${cmd}. Type /help for commands.`);
    }
  } catch (err) {
    if (err.cause?.code === "ECONNREFUSED") {
      console.log(`  \x1b[31m✗\x1b[0m Cannot connect to ${BASE} — is the host service running?`);
    } else {
      console.log(`  \x1b[31m✗\x1b[0m ${err.message}`);
    }
  }

  rl.prompt();
}

// ── REPL ─────────────────────────────────────────────────────

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "oyster> ",
});

console.log(`\x1b[1mOysterun Host Service CLI\x1b[0m`);
console.log(`  Server: ${BASE}`);
console.log(`  Nickname: ${opts.nickname}`);
if (!opts.token) console.log(`  \x1b[33mWARNING: No --token provided. Auth-protected endpoints will fail.\x1b[0m`);
console.log(`  Type /help for commands.\n`);

rl.prompt();

rl.on("line", async (line) => {
  const input = line.trim();
  if (!input) {
    rl.prompt();
    return;
  }

  if (input.startsWith("/")) {
    await handleCommand(input);
    return;
  }

  // Default: send to watched agent
  if (watchingAgent) {
    try {
      // Send via WebSocket if connected
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "send",
          text: input,
          nickname: opts.nickname,
          user_id: `cli-${opts.nickname.toLowerCase()}`,
        }));
        console.log(`  \x1b[32m→\x1b[0m [${opts.nickname}]: ${input}`);
      } else {
        // Fallback to HTTP
        await api("POST", "/session/send", {
          agent_id: watchingAgent,
          nickname: opts.nickname,
          text: input,
        });
        console.log(`  \x1b[32m→\x1b[0m [${opts.nickname}]: ${input}`);
      }
    } catch (err) {
      console.log(`  \x1b[31m✗\x1b[0m ${err.message}`);
    }
  } else {
    console.log("  No agent watched. Use /watch <agent_id> first, or /send <agent_id> <text>.");
  }

  rl.prompt();
});

rl.on("close", () => {
  disconnectWebSocket();
  process.exit(0);
});

process.on("SIGINT", () => {
  disconnectWebSocket();
  process.exit(0);
});
