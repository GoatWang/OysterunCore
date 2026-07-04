import { spawn } from "child_process";
import { createHash } from "crypto";
import { EventEmitter } from "events";
import { promises as fs } from "fs";
import path from "path";
import os from "os";

// Pinned frp version. Do NOT auto-bump on upstream release; bumping requires
// re-running the mirror script + updating the SHA256 sums below.
const FRP_VERSION = "0.68.1";

// Mirror of frp release tarballs on Oysterun-controlled DO Spaces.
// Primary source for auto-download; GitHub release is fallback.
//
// Threat model:
//   - GitHub release dropped / fatedier/frp project gone -> mirror still serves
//   - Mirror tampered -> SHA256 verify catches it
//   - Both gone -> we still have the binary in ~/.oysterun/frp/frpc from
//     previous successful download (caches forever once installed)
//
// Re-mirroring is release-maintainer tooling; update URLs and SHA256 sums together.
const FRP_MIRROR = {
  darwin_arm64: {
    sha256: "55ed076c7e17b8907e02d4da141426cb2dbc17b4f560be179fc5878caf021640",
    mirrorUrl: "https://voieechcontent.sgp1.digitaloceanspaces.com/oysterun/frp/0.68.1/frp_0.68.1_darwin_arm64.tar.gz",
  },
  darwin_amd64: {
    sha256: "41a3b1a21f60b92021764bad923f9e76168a65afc282456609f3b0f2cbed4abf",
    mirrorUrl: "https://voieechcontent.sgp1.digitaloceanspaces.com/oysterun/frp/0.68.1/frp_0.68.1_darwin_amd64.tar.gz",
  },
  linux_amd64: {
    sha256: "4a4e88987d39561e1b3b3b23d0ede48a457eebf76a87231999957e870f5f02b6",
    mirrorUrl: "https://voieechcontent.sgp1.digitaloceanspaces.com/oysterun/frp/0.68.1/frp_0.68.1_linux_amd64.tar.gz",
  },
  linux_arm64: {
    sha256: "e7ad15b0cfe4cf0125df4217778b66cb4426179270967b59900ecb2362d8cd01",
    mirrorUrl: "https://voieechcontent.sgp1.digitaloceanspaces.com/oysterun/frp/0.68.1/frp_0.68.1_linux_arm64.tar.gz",
  },
};

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
 * Manages frpc tunnel + heartbeat to the Oysterun backend.
 *
 * Spawns `frpc -c <toml>` as a child process, writes the toml from the
 * credentials supplied by Cloud, detects when the proxy registers
 * successfully on frps, reports its public hostname to the backend, and
 * sends periodic heartbeats.
 *
 * Same EventEmitter contract as NgrokAgent so server.mjs can swap them
 * via tunnel-agent-factory.mjs.
 */
export class FrpAgent extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string} opts.deviceId
   * @param {string} opts.backendUrl
   * @param {string} [opts.backendStage]
   * @param {number} opts.localPort
   * @param {string} opts.frpServerAddr      - frps host (e.g. "127.0.0.1" or DO Droplet IP)
   * @param {number} opts.frpServerPort      - frps control port (default 7000 prod, 7100 PoC)
   * @param {string} opts.frpToken           - per-device token, validated by Cloud HTTP plugin
   * @param {string} opts.frpSubdomain       - subdomain on subdomainHost (e.g. "abc12def")
   * @param {string} opts.frpSubdomainHost   - apex (e.g. "oysterun.com" prod / "local.test" PoC)
   * @param {number} [opts.heartbeatInterval]
   * @param {string} [opts.appVersion]
   * @param {string} opts.deviceToken
   * @param {string} [opts.configDir]        - override default ~/.oysterun/frp
   */
  constructor({
    deviceId,
    backendUrl,
    backendStage = "prod",
    localPort,
    frpServerAddr,
    frpServerPort,
    frpToken,
    frpSubdomain,
    frpSubdomainHost,
    heartbeatInterval = 60_000,
    appVersion,
    deviceToken,
    configDir,
  }) {
    super();
    this.deviceId = deviceId;
    this.backendUrl = backendUrl;
    this.backendStage = backendStage;
    this.localPort = localPort;
    this.frpServerAddr = frpServerAddr;
    this.frpServerPort = frpServerPort;
    this.frpToken = frpToken;
    this.frpSubdomain = frpSubdomain;
    this.frpSubdomainHost = frpSubdomainHost;
    this.heartbeatInterval = heartbeatInterval;
    this.appVersion = appVersion;
    this.deviceToken = deviceToken;
    this.configDir = configDir || path.join(os.homedir(), ".oysterun", "frp");

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
   * Write frpc.toml to configDir with mode 0600, then spawn frpc.
   */
  async start() {
    await this._writeConfig();

    const frpcPath = await this._ensureFrpcBinary();
    const configPath = path.join(this.configDir, "frpc.toml");
    console.log(`[frp-agent] Starting: ${frpcPath} -c ${configPath}`);

    this.proc = spawn(frpcPath, ["-c", configPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    this._alive = true;

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
        console.error(`[frp-agent] stderr: ${text}`);
        this.emit("stderr", text);
      }
    });

    this.proc.on("exit", (code, signal) => {
      this._alive = false;
      this._stopHeartbeat();
      console.log(`[frp-agent] Process exited (code=${code}, signal=${signal})`);
      this.emit("exit", code, signal);
      if (!this._stopping) this._scheduleRestart();
    });

    this.proc.on("error", (err) => {
      this._alive = false;
      this._stopHeartbeat();
      console.error(`[frp-agent] Process error: ${err.message}`);
      this.emit("error", err);
      if (!this._stopping) this._scheduleRestart();
    });
  }

  /**
   * Schedule auto-restart after frpc child crashes. Backoff ladder
   * 5s/10s/30s/60s caps the noise when frps is unreachable, but still
   * recovers within 5s for a one-off crash.
   */
  _scheduleRestart() {
    if (this._stopping) return;
    if (this._restartTimer) return;
    this._restartAttempt += 1;
    const ladder = [5000, 10000, 30000, 60000];
    const delay = ladder[Math.min(this._restartAttempt - 1, ladder.length - 1)];
    console.log(`[frp-agent] Auto-restart in ${delay / 1000}s (attempt ${this._restartAttempt})`);
    this._restartTimer = setTimeout(() => {
      this._restartTimer = null;
      if (this._stopping) return;
      this.start().catch((err) => {
        console.error(`[frp-agent] Auto-restart failed: ${err.message}`);
        this._scheduleRestart();
      });
    }, delay);
  }

  /**
   * Locate or download the frpc binary.
   *
   * Resolution order:
   *   1. OYSTERUN_FRPC_PATH env var (escape hatch for dev / non-standard installs)
   *   2. /opt/homebrew/bin/frpc       (brew on Apple Silicon)
   *   3. /usr/local/bin/frpc          (brew on Intel / system-wide)
   *   4. ~/.oysterun/frp/frpc         (Oysterun-managed, from previous auto-download)
   *   5. download from GitHub release (fallback)
   *
   * The fallback ensures owners who don't have `brew install frpc` still
   * get a working tunnel without manual setup.
   *
   * @returns {Promise<string>} absolute path to executable frpc
   */
  async _ensureFrpcBinary() {
    if (process.env.OYSTERUN_FRPC_PATH && await this._isExecutable(process.env.OYSTERUN_FRPC_PATH)) {
      return process.env.OYSTERUN_FRPC_PATH;
    }

    const candidates = [
      "/opt/homebrew/bin/frpc",
      "/usr/local/bin/frpc",
      path.join(os.homedir(), ".oysterun", "frp", "frpc"),
    ];
    for (const candidate of candidates) {
      if (await this._isExecutable(candidate)) {
        return candidate;
      }
    }

    return await this._downloadFrpcBinary();
  }

  /**
   * Download frpc tarball from Oysterun mirror (preferred) or GitHub
   * release (fallback). Verify SHA256 against pinned hash before extract.
   * Install to ~/.oysterun/frp/frpc with mode 0755.
   *
   * Supported platforms:
   *   - darwin / arm64 (Apple Silicon)
   *   - darwin / x64   (Intel Mac)
   *   - linux / amd64  (Droplet, future host-service-on-Linux)
   *   - linux / arm64  (future)
   */
  async _downloadFrpcBinary() {
    const platform = process.platform;
    const arch = process.arch === "arm64" ? "arm64" : "amd64";
    const platformKey = `${platform}_${arch}`;
    const meta = FRP_MIRROR[platformKey];
    if (!meta) {
      throw new Error(
        `[frp-agent] auto-download not supported for platform=${platformKey}. ` +
          `Set OYSTERUN_FRPC_PATH to an existing binary.`,
      );
    }

    const tarballName = `frp_${FRP_VERSION}_${platform}_${arch}.tar.gz`;
    const githubUrl = `https://github.com/fatedier/frp/releases/download/v${FRP_VERSION}/${tarballName}`;

    const oysterunFrpDir = path.join(os.homedir(), ".oysterun", "frp");
    const dstBinary = path.join(oysterunFrpDir, "frpc");
    await fs.mkdir(oysterunFrpDir, { recursive: true, mode: 0o700 });

    const tmpTarball = path.join("/tmp", `oysterun-frp-${process.pid}-${tarballName}`);
    const tmpExtractDir = path.join("/tmp", `oysterun-frp-${process.pid}-${FRP_VERSION}`);

    // Try mirror first (Oysterun-controlled, won't disappear on upstream
    // abandon), GitHub release is fallback.
    const sources = [
      { label: "mirror", url: meta.mirrorUrl },
      { label: "github", url: githubUrl },
    ];

    let downloaded = false;
    let lastError = null;
    for (const src of sources) {
      try {
        console.log(`[frp-agent] downloading frpc from ${src.label}: ${src.url}`);
        const resp = await fetch(src.url);
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
        }
        const buffer = Buffer.from(await resp.arrayBuffer());
        const actualSha = createHash("sha256").update(buffer).digest("hex");
        if (actualSha !== meta.sha256) {
          throw new Error(
            `SHA256 mismatch from ${src.label}: expected ${meta.sha256}, got ${actualSha}`,
          );
        }
        await fs.writeFile(tmpTarball, buffer);
        console.log(`[frp-agent] downloaded + SHA256 verified from ${src.label}`);
        downloaded = true;
        break;
      } catch (err) {
        console.warn(`[frp-agent] ${src.label} download failed: ${err.message}`);
        lastError = err;
      }
    }
    if (!downloaded) {
      throw new Error(`[frp-agent] all download sources failed; last error: ${lastError?.message}`);
    }

    await fs.mkdir(tmpExtractDir, { recursive: true });
    await new Promise((resolve, reject) => {
      const tar = spawn("tar", ["xzf", tmpTarball, "-C", tmpExtractDir]);
      tar.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`tar xzf failed code=${code}`))));
      tar.on("error", reject);
    });

    const extractedBinary = path.join(tmpExtractDir, `frp_${FRP_VERSION}_${platform}_${arch}`, "frpc");
    await fs.copyFile(extractedBinary, dstBinary);
    await fs.chmod(dstBinary, 0o755);

    await fs.rm(tmpTarball, { force: true }).catch(() => {});
    await fs.rm(tmpExtractDir, { recursive: true, force: true }).catch(() => {});

    console.log(`[frp-agent] frpc installed at ${dstBinary}`);
    return dstBinary;
  }

  async _isExecutable(filePath) {
    try {
      await fs.access(filePath, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Write frpc.toml with the credentials from Cloud. Mode 0600 so other
   * users on this Mac mini cannot read the token.
   */
  async _writeConfig() {
    await fs.mkdir(this.configDir, { recursive: true, mode: 0o700 });

    const toml = this._renderToml();
    const configPath = path.join(this.configDir, "frpc.toml");
    await fs.writeFile(configPath, toml, { mode: 0o600 });

    console.log(`[frp-agent] Wrote ${configPath} (mode 0600)`);
  }

  /**
   * Build the frpc.toml content. All values are controlled by Cloud (token,
   * subdomain) or by host config (server addr/port, local port), so plain
   * string templating is sufficient — no untrusted input is interpolated.
   */
  _renderToml() {
    const proxyName = `oysterun-host-${this.deviceId}`;
    return [
      `serverAddr = "${this.frpServerAddr}"`,
      `serverPort = ${this.frpServerPort}`,
      ``,
      `auth.method = "token"`,
      `auth.token = "${this.frpToken}"`,
      ``,
      `[[proxies]]`,
      `name = "${proxyName}"`,
      `type = "http"`,
      `subdomain = "${this.frpSubdomain}"`,
      `localIP = "127.0.0.1"`,
      `localPort = ${this.localPort}`,
      ``,
      // The tunnel is always fronted by the Droplet's Caddy over TLS, so
      // traffic reaching the Host via frp is https. frp (unlike the old ngrok
      // edge) does not set X-Forwarded-Proto, which left the Host computing an
      // http:// origin and breaking Route C's same-origin chat bootstrap check.
      // Inject it here to restore the scheme the browser actually used.
      `[proxies.requestHeaders.set]`,
      `"x-forwarded-proto" = "https"`,
      ``,
    ].join("\n");
  }

  /**
   * Parse frpc log lines. frpc emits human-readable text logs by default
   * (no JSON mode in 0.68 like ngrok has), so match key phrases observed
   * in Sprint 2.A:
   *   "login to server success"     -> control connection up
   *   "start proxy success"         -> proxy registered, tunnel reachable
   *   "login to server failed"      -> auth/token rejected
   */
  _handleLogLine(line) {
    if (line.includes("login to server success")) {
      console.log(`[frp-agent] Control connection up`);
      this.emit("control_up");
    }

    if (line.includes("start proxy success")) {
      this.publicUrl = `https://${this.frpSubdomain}.${this.frpSubdomainHost}`;
      console.log(`[frp-agent] Tunnel ready: ${this.publicUrl}`);
      this._onTunnelReady();
    }

    if (line.includes("login to server failed") || line.includes("authentication failed")) {
      console.error(`[frp-agent] Authentication failed: ${line}`);
      this.emit("auth_failed", line);
    }

    this.emit("log", line);
  }

  async _onTunnelReady() {
    this._restartAttempt = 0;
    this.emit("ready", this.publicUrl);
    await this._reportRoute();
    this._startHeartbeat();
  }

  /**
   * Report current public hostname to the backend after the tunnel comes
   * up. Uses generic provider-agnostic body fields so the same endpoint
   * accepts both NgrokAgent and FrpAgent.
   */
  async _reportRoute() {
    const hostname = this._extractHostname();
    if (!hostname) return;

    const url = buildCloudApiUrl(
      this.backendUrl,
      `/api/device/${this.deviceId}/route`,
      this.backendStage
    );
    console.log(`[frp-agent] Reporting route: ${hostname}`);

    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.deviceToken}`,
        },
        body: JSON.stringify({
          tunnel_provider: "frp",
          tunnel_hostname: hostname,
        }),
      });

      if (!resp.ok) {
        const text = await resp.text();
        console.error(`[frp-agent] Route report failed (${resp.status}): ${text}`);
        this.emit("route_error", resp.status, text);
      } else {
        console.log(`[frp-agent] Route reported successfully`);
        this.emit("route_reported", hostname);
      }
    } catch (err) {
      console.error(`[frp-agent] Route report error: ${err.message}`);
      this.emit("route_error", 0, err.message);
    }
  }

  async _sendHeartbeat() {
    const hostname = this._extractHostname();
    const url = buildCloudApiUrl(
      this.backendUrl,
      `/api/device/${this.deviceId}/heartbeat`,
      this.backendStage
    );

    const body = {
      tunnel_provider: "frp",
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
        console.error(`[frp-agent] Heartbeat failed (${resp.status}): ${text}`);
        this.emit("heartbeat_error", resp.status, text);
      } else {
        this.emit("heartbeat_ok");
      }
    } catch (err) {
      console.error(`[frp-agent] Heartbeat error: ${err.message}`);
      this.emit("heartbeat_error", 0, err.message);
    }
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this._heartbeatTimer = setInterval(() => {
      this._sendHeartbeat();
    }, this.heartbeatInterval);
    console.log(`[frp-agent] Heartbeat every ${this.heartbeatInterval / 1000}s`);
  }

  _stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  _extractHostname() {
    if (!this.publicUrl) return null;
    try {
      return new URL(this.publicUrl).hostname;
    } catch {
      return this.publicUrl;
    }
  }

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
}
