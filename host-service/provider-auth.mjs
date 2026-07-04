import { execFile, spawn } from "child_process";
import { randomUUID } from "crypto";
import { readConfig } from "./config.mjs";
import { getConfiguredProviderCommand, isConfiguredCommandAvailable, requireProvider } from "./provider-registry.mjs";

const PROVIDER_AUTH_UNSUPPORTED_STATE = "unsupported";
const PROVIDER_AUTH_UNKNOWN_STATE = "unknown";
const PROVIDER_AUTH_REQUIRED_STATE = "required";
const PROVIDER_AUTH_AUTHENTICATED_STATE = "authenticated";
const PROVIDER_AUTH_JOB_RUNNING_STATE = "running";
const PROVIDER_AUTH_JOB_COMPLETED_STATE = "completed";
const PROVIDER_AUTH_JOB_FAILED_STATE = "failed";
const PROVIDER_AUTH_JOB_CANCELED_STATE = "canceled";
const PROVIDER_AUTH_OUTPUT_LIMIT = 24_000;
const PROVIDER_AUTH_URL_REGEX = /https?:\/\/[^\s)]+/i;
const ANSI_ESCAPE_REGEX = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const CONTROL_CHAR_REGEX = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

function buildUnsupportedStatus(providerId) {
  return {
    provider: providerId,
    supported: false,
    canStartLogin: false,
    state: PROVIDER_AUTH_UNSUPPORTED_STATE,
    message: `Provider "${providerId}" does not expose an Oysterun-managed auth flow.`,
    authMethod: null,
    apiProvider: null,
    checkedAt: new Date().toISOString(),
    commandAvailable: null,
  };
}

function sanitizeAuthOutput(text) {
  return String(text || "")
    .replace(ANSI_ESCAPE_REGEX, "")
    .replace(/\r/g, "")
    .replace(/\u0008/g, "")
    .replace(CONTROL_CHAR_REGEX, "");
}

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

function buildClaudeLoginSpawn(command) {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  return {
    command,
    args: ["auth", "login", "--console"],
    options: {
      stdio: ["pipe", "pipe", "pipe"],
      env,
    },
  };
}

function buildAuthCheckUnknownStatus(providerId, commandAvailable, error) {
  const providerLabel = requireProvider(providerId, {
    config: readConfig(),
  }).label;
  const details = sanitizeAuthOutput([
    error?.stdout || "",
    error?.stderr || "",
    error?.message || "",
  ].filter(Boolean).join("\n")).trim();
  return {
    provider: providerId,
    supported: true,
    canStartLogin: providerId === "claude" && commandAvailable === true,
    state: PROVIDER_AUTH_UNKNOWN_STATE,
    message: details
      ? `Could not determine ${providerLabel} auth state: ${details}`
      : `Could not determine ${providerLabel} auth state.`,
    authMethod: null,
    apiProvider: null,
    checkedAt: new Date().toISOString(),
    commandAvailable,
  };
}

function normalizeClaudeAuthStatus(rawStatus, commandAvailable) {
  const loggedIn = rawStatus?.loggedIn === true;
  return {
    provider: "claude",
    supported: true,
    canStartLogin: commandAvailable === true,
    state: loggedIn ? PROVIDER_AUTH_AUTHENTICATED_STATE : PROVIDER_AUTH_REQUIRED_STATE,
    message: loggedIn
      ? "Claude is connected on this Host."
      : "Claude is not connected on this Host. Connect Claude before starting a session.",
    authMethod: typeof rawStatus?.authMethod === "string" && rawStatus.authMethod.trim()
      ? rawStatus.authMethod.trim()
      : null,
    apiProvider: typeof rawStatus?.apiProvider === "string" && rawStatus.apiProvider.trim()
      ? rawStatus.apiProvider.trim()
      : null,
    checkedAt: new Date().toISOString(),
    commandAvailable,
  };
}

export function serializeProviderAuthStatus(status) {
  return {
    provider: status.provider,
    supported: status.supported === true,
    can_start_login: status.canStartLogin === true,
    state: status.state || PROVIDER_AUTH_UNKNOWN_STATE,
    message: status.message || "",
    auth_method: status.authMethod || null,
    api_provider: status.apiProvider || null,
    checked_at: status.checkedAt || null,
    command_available: typeof status.commandAvailable === "boolean" ? status.commandAvailable : null,
  };
}

function serializeProviderAuthJob(job) {
  if (!job) return null;
  return {
    job_id: job.id,
    provider: job.provider,
    state: job.state,
    started_at: job.startedAt,
    updated_at: job.updatedAt,
    finished_at: job.finishedAt,
    exit_code: job.exitCode,
    output_text: job.outputText,
    output_truncated: job.outputTruncated === true,
    login_url: job.loginUrl || null,
    error: job.error || "",
  };
}

export class ProviderAuthManager {
  constructor(options = {}) {
    this.getCurrentConfig = typeof options.getCurrentConfig === "function" ? options.getCurrentConfig : readConfig;
    this.jobs = new Map();
    this.activeJobsByProvider = new Map();
    this.execFileFn = typeof options.execFileFn === "function" ? options.execFileFn : runExecFile;
    this.spawnFn = typeof options.spawnFn === "function" ? options.spawnFn : spawn;
  }

  getStaticProviderAuth(providerId) {
    const provider = requireProvider(providerId, {
      config: this.getCurrentConfig(),
    });
    return {
      supported: provider.auth?.supported === true,
      canStartLogin: provider.auth?.startLoginSupported === true,
    };
  }

  async getStatus(providerId, config = this.getCurrentConfig()) {
    const provider = requireProvider(providerId, { config });
    if (provider.auth?.supported !== true) {
      return buildUnsupportedStatus(providerId);
    }
    const configuredCommand = getConfiguredProviderCommand(config, providerId);
    const commandAvailable = isConfiguredCommandAvailable(configuredCommand);
    if (!commandAvailable) {
      return {
        provider: providerId,
        supported: true,
        canStartLogin: false,
        state: PROVIDER_AUTH_UNKNOWN_STATE,
        message: `Provider "${provider.label}" is unavailable because the configured command could not be resolved.`,
        authMethod: null,
        apiProvider: null,
        checkedAt: new Date().toISOString(),
        commandAvailable: false,
      };
    }

    if (providerId === "claude") {
      try {
        const env = { ...process.env };
        delete env.CLAUDECODE;
        const { stdout } = await this.execFileFn(configuredCommand, ["auth", "status"], { env });
        const parsed = JSON.parse(sanitizeAuthOutput(stdout).trim() || "{}");
        return normalizeClaudeAuthStatus(parsed, true);
      } catch (error) {
        return buildAuthCheckUnknownStatus(providerId, true, error);
      }
    }

    return buildUnsupportedStatus(providerId);
  }

  getJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) return null;
    return serializeProviderAuthJob(job);
  }

  async waitForInitialJobOutput(job, timeoutMs = 750) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (
        job.outputText.trim()
        || job.loginUrl
        || job.state !== PROVIDER_AUTH_JOB_RUNNING_STATE
      ) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  async startLogin(providerId, config = this.getCurrentConfig()) {
    const provider = requireProvider(providerId);
    if (provider.auth?.supported !== true || provider.auth?.startLoginSupported !== true) {
      const status = await this.getStatus(providerId, config);
      return {
        status,
        job: null,
      };
    }

    const currentStatus = await this.getStatus(providerId, config);
    if (currentStatus.state === PROVIDER_AUTH_AUTHENTICATED_STATE) {
      return {
        status: currentStatus,
        job: null,
      };
    }

    const activeJobId = this.activeJobsByProvider.get(providerId);
    if (activeJobId) {
      const activeJob = this.jobs.get(activeJobId);
      if (activeJob && activeJob.state === PROVIDER_AUTH_JOB_RUNNING_STATE) {
        return {
          status: currentStatus,
          job: serializeProviderAuthJob(activeJob),
        };
      }
      this.activeJobsByProvider.delete(providerId);
    }

    const configuredCommand = getConfiguredProviderCommand(config, providerId);
    if (!isConfiguredCommandAvailable(configuredCommand)) {
      return {
        status: await this.getStatus(providerId, config),
        job: null,
      };
    }

    const descriptor = buildClaudeLoginSpawn(configuredCommand);
    const proc = this.spawnFn(descriptor.command, descriptor.args, descriptor.options);
    const job = {
      id: randomUUID(),
      provider: providerId,
      state: PROVIDER_AUTH_JOB_RUNNING_STATE,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      finishedAt: null,
      exitCode: null,
      outputText: "",
      outputTruncated: false,
      loginUrl: null,
      error: "",
      canceled: false,
      proc,
    };
    this.jobs.set(job.id, job);
    this.activeJobsByProvider.set(providerId, job.id);

    const appendOutput = (chunk) => {
      const text = sanitizeAuthOutput(chunk);
      if (!text) return;
      const nextText = job.outputText + text;
      if (nextText.length > PROVIDER_AUTH_OUTPUT_LIMIT) {
        job.outputText = nextText.slice(-PROVIDER_AUTH_OUTPUT_LIMIT);
        job.outputTruncated = true;
      } else {
        job.outputText = nextText;
      }
      if (!job.loginUrl) {
        const matchedUrl = job.outputText.match(PROVIDER_AUTH_URL_REGEX);
        if (matchedUrl) {
          job.loginUrl = matchedUrl[0];
        }
      }
      job.updatedAt = new Date().toISOString();
    };

    proc.stdout?.on("data", (chunk) => appendOutput(chunk.toString()));
    proc.stderr?.on("data", (chunk) => appendOutput(chunk.toString()));
    proc.on("error", (error) => {
      job.state = PROVIDER_AUTH_JOB_FAILED_STATE;
      job.error = error.message;
      job.finishedAt = new Date().toISOString();
      job.updatedAt = job.finishedAt;
      this.activeJobsByProvider.delete(providerId);
    });
    proc.on("exit", (code) => {
      job.exitCode = Number.isInteger(code) ? code : null;
      job.finishedAt = new Date().toISOString();
      job.updatedAt = job.finishedAt;
      if (job.canceled === true) {
        job.state = PROVIDER_AUTH_JOB_CANCELED_STATE;
      } else if (code === 0) {
        job.state = PROVIDER_AUTH_JOB_COMPLETED_STATE;
      } else {
        job.state = PROVIDER_AUTH_JOB_FAILED_STATE;
        if (!job.error) {
          job.error = code === null ? "Login process exited unexpectedly." : `Login process exited with code ${code}.`;
        }
      }
      this.activeJobsByProvider.delete(providerId);
    });

    await this.waitForInitialJobOutput(job);

    return {
      status: currentStatus,
      job: serializeProviderAuthJob(job),
    };
  }

  cancelJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) {
      return null;
    }
    if (job.state !== PROVIDER_AUTH_JOB_RUNNING_STATE) {
      return serializeProviderAuthJob(job);
    }
    job.canceled = true;
    job.state = PROVIDER_AUTH_JOB_CANCELED_STATE;
    job.updatedAt = new Date().toISOString();
    job.proc.kill("SIGTERM");
    return serializeProviderAuthJob(job);
  }

  sendInput(jobId, text) {
    const job = this.jobs.get(jobId);
    if (!job) {
      return null;
    }
    if (job.state !== PROVIDER_AUTH_JOB_RUNNING_STATE) {
      return serializeProviderAuthJob(job);
    }
    const normalizedText = typeof text === "string" ? text.replace(/\r\n/g, "\n").trim() : "";
    if (!normalizedText) {
      throw new Error("input_text must be a non-empty string");
    }
    if (!job.proc.stdin || job.proc.stdin.writable !== true) {
      throw new Error("Provider auth job does not accept input");
    }
    job.proc.stdin.write(`${normalizedText}\n`);
    job.updatedAt = new Date().toISOString();
    return serializeProviderAuthJob(job);
  }
}
