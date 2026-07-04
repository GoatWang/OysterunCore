import { spawn } from "child_process";
import { EventEmitter } from "events";

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function buildCloudApiUrl(backendUrl, apiPath, stage = "prod") {
  const base = String(backendUrl || "").replace(/\/+$/, "");
  const url = new URL(apiPath, `${base}/`);
  const normalizedStage = normalizeString(stage).toLowerCase() || "prod";
  if (normalizedStage !== "prod") {
    url.searchParams.set("oysterun_stage", normalizedStage);
  }
  return url.toString();
}

/**
 * Manages ngrok tunnel + heartbeat to the Oysterun backend.
 *
 * Starts ngrok as a child process, detects the public URL,
 * reports it to the backend, and sends periodic heartbeats.
 */
export class NgrokAgent extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string} opts.deviceId - Device ID from Oysterun backend
   * @param {string} opts.backendUrl - Oysterun backend URL
   * @param {string} [opts.backendStage] - Cloud stage selector
   * @param {number} opts.localPort - Local service port to tunnel
   * @param {string} [opts.ngrokDomain] - Static ngrok domain (e.g. "foo.ngrok-free.dev")
   * @param {number} [opts.heartbeatInterval] - Heartbeat interval in ms (default 60000)
   * @param {string} [opts.appVersion] - Host app version string
   */
  constructor({ deviceId, backendUrl, backendStage = "prod", localPort, ngrokDomain, heartbeatInterval = 60_000, appVersion, deviceToken }) {
    super();
    this.deviceId = deviceId;
    this.backendUrl = backendUrl;
    this.backendStage = backendStage;
    this.localPort = localPort;
    this.ngrokDomain = ngrokDomain;
    this.heartbeatInterval = heartbeatInterval;
    this.appVersion = appVersion;
    this.deviceToken = deviceToken;

    this.proc = null;
    this.publicUrl = null;
    this._heartbeatTimer = null;
    this._alive = false;
    this._stopping = false;
    this._restartAttempt = 0;
    this._restartTimer = null;
  }

  get alive() {
    return this._alive;
  }

  /**
   * Start ngrok tunnel and begin heartbeat loop.
   */
  start() {
    const args = ["http", String(this.localPort)];

    if (this.ngrokDomain) {
      args.push("--url", this.ngrokDomain);
    }

    // Use --log stdout --log-format json for parseable output
    args.push("--log", "stdout", "--log-format", "json");

    console.log(`[ngrok-agent] Starting: ngrok ${args.join(" ")}`);

    this.proc = spawn("ngrok", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    this._alive = true;

    // Parse JSON log lines from stdout to detect tunnel URL
    let buffer = "";
    this.proc.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        this._handleLogLine(line);
      }
    });

    this.proc.stderr.on("data", (chunk) => {
      const text = chunk.toString().trim();
      if (text) {
        console.error(`[ngrok-agent] stderr: ${text}`);
        this.emit("stderr", text);
      }
    });

    this.proc.on("exit", (code, signal) => {
      this._alive = false;
      this._stopHeartbeat();
      console.log(`[ngrok-agent] Process exited (code=${code}, signal=${signal})`);
      this.emit("exit", code, signal);
      if (!this._stopping) this._scheduleRestart();
    });

    this.proc.on("error", (err) => {
      this._alive = false;
      this._stopHeartbeat();
      console.error(`[ngrok-agent] Process error: ${err.message}`);
      this.emit("error", err);
      if (!this._stopping) this._scheduleRestart();
    });

    // If using a static domain, we already know the public URL
    if (this.ngrokDomain) {
      this.publicUrl = `https://${this.ngrokDomain}`;
      console.log(`[ngrok-agent] Static domain: ${this.publicUrl}`);
      this._onTunnelReady();
    }
  }

  /**
   * Parse ngrok JSON log lines to detect tunnel URL (for non-static domains).
   */
  _handleLogLine(line) {
    try {
      const log = JSON.parse(line);

      // ngrok emits a log with msg="started tunnel" and url=...
      if (log.msg === "started tunnel" && log.url) {
        this.publicUrl = log.url;
        console.log(`[ngrok-agent] Tunnel URL: ${this.publicUrl}`);
        this._onTunnelReady();
      }

      // Also check for the "online" event
      if (log.msg === "online" || log.obj === "tunnels") {
        this.emit("log", log);
      }
    } catch {
      // Not JSON — ignore
    }
  }

  /**
   * Called when tunnel URL is known. Reports to backend and starts heartbeat.
   */
  async _onTunnelReady() {
    this._restartAttempt = 0;
    this.emit("ready", this.publicUrl);

    // Report hostname to backend
    await this._reportRoute();

    // Start heartbeat loop
    this._startHeartbeat();
  }

  /**
   * Report current ngrok hostname to the Oysterun backend.
   */
  async _reportRoute() {
    const hostname = this._extractHostname();
    if (!hostname) return;

    const url = buildCloudApiUrl(
      this.backendUrl,
      `/api/device/${this.deviceId}/route`,
      this.backendStage
    );
    console.log(`[ngrok-agent] Reporting route: ${hostname}`);

    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.deviceToken}`,
        },
        body: JSON.stringify({
          tunnel_provider: "ngrok",
          tunnel_hostname: hostname,
        }),
      });

      if (!resp.ok) {
        const text = await resp.text();
        console.error(`[ngrok-agent] Route report failed (${resp.status}): ${text}`);
        this.emit("route_error", resp.status, text);
      } else {
        console.log(`[ngrok-agent] Route reported successfully`);
        this.emit("route_reported", hostname);
      }
    } catch (err) {
      console.error(`[ngrok-agent] Route report error: ${err.message}`);
      this.emit("route_error", 0, err.message);
    }
  }

  /**
   * Send a heartbeat to the Oysterun backend.
   */
  async _sendHeartbeat() {
    const hostname = this._extractHostname();
    const url = buildCloudApiUrl(
      this.backendUrl,
      `/api/device/${this.deviceId}/heartbeat`,
      this.backendStage
    );

    const body = {
      tunnel_provider: "ngrok",
      tunnel_hostname: hostname,
      status: "online",
      local_service_port: this.localPort,
    };
    if (this.appVersion) {
      body.app_version = this.appVersion;
    }

    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.deviceToken}`,
        },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const text = await resp.text();
        console.error(`[ngrok-agent] Heartbeat failed (${resp.status}): ${text}`);
        this.emit("heartbeat_error", resp.status, text);
      } else {
        this.emit("heartbeat_ok");
      }
    } catch (err) {
      console.error(`[ngrok-agent] Heartbeat error: ${err.message}`);
      this.emit("heartbeat_error", 0, err.message);
    }
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this._heartbeatTimer = setInterval(() => {
      this._sendHeartbeat();
    }, this.heartbeatInterval);
    console.log(`[ngrok-agent] Heartbeat every ${this.heartbeatInterval / 1000}s`);
  }

  _stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  /**
   * Extract hostname from public URL (e.g. "https://foo.ngrok-free.dev" → "foo.ngrok-free.dev")
   */
  _extractHostname() {
    if (!this.publicUrl) return null;
    try {
      return new URL(this.publicUrl).hostname;
    } catch {
      return this.publicUrl;
    }
  }

  /**
   * Stop ngrok tunnel and heartbeat.
   */
  stop() {
    this._stopping = true;
    this._stopHeartbeat();
    if (this._restartTimer) {
      clearTimeout(this._restartTimer);
      this._restartTimer = null;
    }
    if (this.proc && this._alive) {
      this.proc.kill("SIGTERM");
      setTimeout(() => {
        if (this._alive) this.proc.kill("SIGKILL");
      }, 5000);
    }
  }

  /**
   * Same backoff ladder as FrpAgent — 5s/10s/30s/60s — caps noise when
   * ngrok is unreachable while still recovering quickly from one-off crashes.
   */
  _scheduleRestart() {
    if (this._stopping) return;
    if (this._restartTimer) return;
    this._restartAttempt += 1;
    const ladder = [5000, 10000, 30000, 60000];
    const delay = ladder[Math.min(this._restartAttempt - 1, ladder.length - 1)];
    console.log(`[ngrok-agent] Auto-restart in ${delay / 1000}s (attempt ${this._restartAttempt})`);
    this._restartTimer = setTimeout(() => {
      this._restartTimer = null;
      if (this._stopping) return;
      try {
        this.start();
      } catch (err) {
        console.error(`[ngrok-agent] Auto-restart failed: ${err.message}`);
        this._scheduleRestart();
      }
    }, delay);
  }
}
