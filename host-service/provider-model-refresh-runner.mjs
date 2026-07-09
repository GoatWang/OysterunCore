import { appendFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import {
  CLAUDE_ACP_RUNNER_PACKAGE,
  CLAUDE_ACP_RUNNER_VERSION,
  discoverClaudeAcpProviderModels,
} from "./claude-acp-model-discovery.mjs";
import { getConfigDir, readConfig } from "./config.mjs";
import { discoverCodexProviderModels } from "./codex-model-discovery.mjs";
import {
  PROVIDER_MODEL_REFRESH_INTERVAL_MS,
  readProviderModelParams,
  writeProviderModelParams,
} from "./provider-model-params.mjs";
import {
  createProviderUnavailableError,
  getConfiguredProviderCommand,
  isProviderCommandAvailable,
  requireProvider,
} from "./provider-registry.mjs";

const DEFAULT_STARTUP_DELAY_MS = 5 * 60 * 1000;
const MAX_ERROR_LENGTH = 500;
const PROVIDER_MODEL_REFRESH_OPERATION_LOG_NAME =
  "provider_model_refresh.jsonl";
const PRODUCT_PROVIDER_REFRESH_IDS = Object.freeze(["claude", "codex"]);

function truncateError(err) {
  const message = err?.message || String(err);
  return message.length > MAX_ERROR_LENGTH
    ? `${message.slice(0, MAX_ERROR_LENGTH)}...`
    : message;
}

function sanitizeOperationLogError(err) {
  return truncateError(err)
    .replace(/\b(token|password|credential|secret|api[_-]?key)(\s*[=:]\s*)[^\s,;]+/gi, "$1$2<redacted>")
    .replace(/(?:\/[^\s'",;:]+)+/g, "<path_redacted>");
}

function operationLogTimestamp(nowMs) {
  return new Date(nowMs).toISOString();
}

function durationMs(startedMs, finishedMs) {
  return Math.max(0, finishedMs - startedMs);
}

export function getProviderModelRefreshOperationLogPath(
  configDir = getConfigDir()
) {
  return join(
    configDir,
    "operation_logs",
    PROVIDER_MODEL_REFRESH_OPERATION_LOG_NAME
  );
}

function appendProviderModelRefreshOperationLog(row, options = {}) {
  const configDir = options.configDir || getConfigDir();
  const logPath =
    options.operationLogPath ||
    getProviderModelRefreshOperationLogPath(configDir);
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, `${JSON.stringify(row)}\n`, "utf-8");
  return logPath;
}

function parseTime(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function normalizeRefreshProviderId(providerId) {
  if (providerId === undefined || providerId === null) return null;
  const normalized = String(providerId).trim().toLowerCase();
  if (!PRODUCT_PROVIDER_REFRESH_IDS.includes(normalized)) {
    throw new Error(`Unsupported provider model refresh provider: ${providerId}`);
  }
  return normalized;
}

function providerRefreshTimestamp(params, providerId) {
  const providerModels = params?.provider_models?.[providerId] || {};
  const providerRuntime = params?.provider_runtime?.[providerId] || {};
  return (
    parseTime(providerModels.refreshed_at) ||
    parseTime(providerModels.last_success_at) ||
    parseTime(providerRuntime.last_success_at) ||
    parseTime(providerRuntime.last_attempt_at) ||
    null
  );
}

function providerNextRefreshAt(params, providerId, refreshIntervalMs) {
  const lastRefreshMs = providerRefreshTimestamp(params, providerId);
  if (!lastRefreshMs) return null;
  return new Date(lastRefreshMs + refreshIntervalMs).toISOString();
}

function isProviderRefreshDue(params, providerId, nowMs, refreshIntervalMs) {
  const lastRefreshMs = providerRefreshTimestamp(params, providerId);
  return !lastRefreshMs || nowMs - lastRefreshMs >= refreshIntervalMs;
}

export class ProviderModelRefreshRunner {
  constructor(options = {}) {
    this.configDir = options.configDir || null;
    this.backgroundRefreshEnabled =
      options.backgroundRefreshEnabled === undefined
        ? true
        : options.backgroundRefreshEnabled === true;
    this.backgroundRefreshSource =
      typeof options.backgroundRefreshSource === "string" &&
      options.backgroundRefreshSource.trim()
        ? options.backgroundRefreshSource.trim()
        : "constructor";
    this.backgroundRefreshDisabledReason =
      typeof options.backgroundRefreshDisabledReason === "string" &&
      options.backgroundRefreshDisabledReason.trim()
        ? options.backgroundRefreshDisabledReason.trim()
        : "background_provider_model_refresh_disabled";
    this.readConfigFn = options.readConfigFn || readConfig;
    this.readParamsFn = options.readParamsFn || readProviderModelParams;
    this.writeParamsFn = options.writeParamsFn || writeProviderModelParams;
    this.appendOperationLogFn =
      options.appendOperationLogFn || appendProviderModelRefreshOperationLog;
    this.getConfiguredProviderCommandFn =
      options.getConfiguredProviderCommandFn || getConfiguredProviderCommand;
    this.isProviderCommandAvailableFn =
      options.isProviderCommandAvailableFn || isProviderCommandAvailable;
    this.createProviderUnavailableErrorFn =
      options.createProviderUnavailableErrorFn || createProviderUnavailableError;
    this.discoverCodexProviderModelsFn =
      options.discoverCodexProviderModelsFn || discoverCodexProviderModels;
    this.discoverClaudeAcpProviderModelsFn =
      options.discoverClaudeAcpProviderModelsFn ||
      discoverClaudeAcpProviderModels;
    this.setTimeoutFn = options.setTimeoutFn || setTimeout;
    this.clearTimeoutFn = options.clearTimeoutFn || clearTimeout;
    this.nowFn = options.nowFn || Date.now;
    this.startupDelayMs = Number.isInteger(options.startupDelayMs)
      ? options.startupDelayMs
      : DEFAULT_STARTUP_DELAY_MS;
    this.refreshIntervalMs = Number.isInteger(options.refreshIntervalMs)
      ? options.refreshIntervalMs
      : PROVIDER_MODEL_REFRESH_INTERVAL_MS;
    this.logger = options.logger || console;
    this.timer = null;
    this.started = false;
    this.running = false;
  }

  start() {
    if (!this.backgroundRefreshEnabled) {
      return {
        status: "disabled",
        reason: this.backgroundRefreshDisabledReason,
        explicit_refresh_available: true,
      };
    }
    if (this.started) {
      return { status: "already_started" };
    }
    this.started = true;
    this.scheduleNext({ startup: true });
    return { status: "started" };
  }

  stop() {
    this.started = false;
    if (this.timer) {
      this.clearTimeoutFn(this.timer);
      this.timer = null;
    }
  }

  computeNextDelay({ startup = false } = {}) {
    if (startup) {
      return Math.max(0, this.startupDelayMs);
    }
    try {
      const result = this.readParamsFn({ configDir: this.configDir });
      const nowMs = this.nowFn();
      const nextRefreshTimes = PRODUCT_PROVIDER_REFRESH_IDS.map((providerId) =>
        providerRefreshTimestamp(result.params, providerId)
      )
        .filter((timeMs) => Number.isFinite(timeMs))
        .map((timeMs) => timeMs + this.refreshIntervalMs);
      if (nextRefreshTimes.length < PRODUCT_PROVIDER_REFRESH_IDS.length) {
        return 0;
      }
      const dueNow = nextRefreshTimes.some((timeMs) => timeMs <= nowMs);
      if (dueNow) return 0;
      return Math.max(0, Math.min(...nextRefreshTimes) - nowMs);
    } catch {
      // Bad params should not create a timer storm; use the normal interval.
    }
    return Math.max(0, this.refreshIntervalMs);
  }

  getProviderRefreshStatus(providerId) {
    const provider = normalizeRefreshProviderId(providerId);
    const result = this.readParamsFn({ configDir: this.configDir });
    const refreshedAtMs = providerRefreshTimestamp(result.params, provider);
    return {
      provider,
      refreshed_at: refreshedAtMs
        ? new Date(refreshedAtMs).toISOString()
        : null,
      next_refresh_at: providerNextRefreshAt(
        result.params,
        provider,
        this.refreshIntervalMs
      ),
      refresh_due:
        isProviderRefreshDue(
          result.params,
          provider,
          this.nowFn(),
          this.refreshIntervalMs
        ) === true,
      scheduling_authority: "provider_last_refresh_plus_interval",
    };
  }

  getAllProviderRefreshStatus() {
    try {
      return PRODUCT_PROVIDER_REFRESH_IDS.map((providerId) =>
        this.getProviderRefreshStatus(providerId)
      );
    } catch {
      return PRODUCT_PROVIDER_REFRESH_IDS.map((providerId) => ({
        provider: providerId,
        refreshed_at: null,
        next_refresh_at: null,
        refresh_due: true,
        scheduling_authority: "provider_last_refresh_plus_interval",
      }));
    }
  }

  getTargetProviderIds({ provider = null, force = true } = {}) {
    const normalizedProvider = normalizeRefreshProviderId(provider);
    const providerIds = normalizedProvider
      ? [normalizedProvider]
      : [...PRODUCT_PROVIDER_REFRESH_IDS];
    if (force) return providerIds;
    try {
      const result = this.readParamsFn({ configDir: this.configDir });
      const nowMs = this.nowFn();
      return providerIds.filter((providerId) =>
        isProviderRefreshDue(
          result.params,
          providerId,
          nowMs,
          this.refreshIntervalMs
        )
      );
    } catch {
      return providerIds;
    }
  }

  assertProviderAvailable(config, providerId) {
    requireProvider(providerId, { config });
    const configuredCommand = this.getConfiguredProviderCommandFn(
      config,
      providerId
    );
    const commandAvailable = this.isProviderCommandAvailableFn(
      config,
      providerId
    );
    if (commandAvailable === true) {
      return {
        provider: providerId,
        command_available: true,
        configured_command_present: Boolean(configuredCommand),
      };
    }
    throw this.createProviderUnavailableErrorFn(providerId, {
      config,
      command: configuredCommand,
    });
  }

  buildProviderSpecs(config, attemptedAt) {
    const providerSpecs = [
      {
        provider: "claude",
        discover: () =>
          this.discoverClaudeAcpProviderModelsFn({
            config,
            configDir: this.configDir,
          }),
        buildUnavailablePatch: (err) => ({
          provider_runtime: {
            claude: {
              runner_available: false,
              runner_source: "managed_host_dependency",
              runner_package: CLAUDE_ACP_RUNNER_PACKAGE,
              runner_version: CLAUDE_ACP_RUNNER_VERSION,
              claude_cli_available: false,
              auth_compatibility_source: "claude_cli",
              acp_config_discovery_supported: false,
              probe_status: "skipped",
              refresh_skip_reason: "provider_unavailable",
              last_attempt_at: attemptedAt,
              last_error: sanitizeOperationLogError(err),
            },
          },
        }),
        buildSuccessPatch: (discovery) => ({
          provider_models: {
            claude: {
              source: "claude_acp_config_options",
              refreshed_at: attemptedAt,
              models: discovery.models,
            },
          },
          provider_runtime: {
            claude: {
              runner_available: discovery.runner_available === true,
              runner_source: discovery.runner_source || "managed_host_dependency",
              runner_package:
                discovery.runner_package || CLAUDE_ACP_RUNNER_PACKAGE,
              runner_version:
                discovery.runner_version || CLAUDE_ACP_RUNNER_VERSION,
              claude_cli_available: discovery.claude_cli_available === true,
              auth_compatibility_source:
                discovery.auth_compatibility_source || "claude_cli",
              acp_config_discovery_supported:
                discovery.acp_config_discovery_supported === true,
              config_options_count: Number.isInteger(
                discovery.config_options_count
              )
                ? discovery.config_options_count
                : 0,
              model_config_id: discovery.model_config_id || null,
              probe_status: "success",
              refresh_skip_reason: null,
              last_attempt_at: attemptedAt,
              last_success_at: attemptedAt,
              last_error: null,
            },
          },
        }),
        buildErrorPatch: (err) => ({
          provider_runtime: {
            claude: {
              runner_available: err?.details?.runner_available === true,
              runner_source: "managed_host_dependency",
              runner_package: CLAUDE_ACP_RUNNER_PACKAGE,
              runner_version: CLAUDE_ACP_RUNNER_VERSION,
              claude_cli_available:
                err?.code === "claude_cli_auth_command_unavailable"
                  ? false
                  : err?.details?.claude_cli_available === true,
              auth_compatibility_source: "claude_cli",
              acp_config_discovery_supported: false,
              probe_status: "error",
              refresh_skip_reason: null,
              last_attempt_at: attemptedAt,
              last_error: sanitizeOperationLogError(err),
            },
          },
        }),
      },
      {
        provider: "codex",
        discover: () =>
          this.discoverCodexProviderModelsFn({
            config,
            configDir: this.configDir,
          }),
        buildUnavailablePatch: (err) => ({
          provider_runtime: {
            codex: {
              command_available: false,
              configured_command_source: "config",
              app_server_discovery_supported: false,
              probe_status: "skipped",
              refresh_skip_reason: "provider_unavailable",
              last_attempt_at: attemptedAt,
              last_error: sanitizeOperationLogError(err),
            },
          },
        }),
        buildSuccessPatch: (discovery) => ({
          provider_models: {
            codex: {
              source: "codex_app_server_model_list",
              refreshed_at: attemptedAt,
              models: discovery.models,
            },
          },
          provider_runtime: {
            codex: {
              command_available: discovery.command_available === true,
              configured_command_source: "config",
              app_server_discovery_supported:
                discovery.app_server_discovery_supported === true,
              probe_status: "success",
              refresh_skip_reason: null,
              last_attempt_at: attemptedAt,
              last_success_at: attemptedAt,
              last_error: null,
            },
          },
        }),
        buildErrorPatch: (err) => ({
          provider_runtime: {
            codex: {
              command_available: false,
              configured_command_source: "config",
              app_server_discovery_supported: false,
              probe_status: "error",
              refresh_skip_reason: null,
              last_attempt_at: attemptedAt,
              last_error: sanitizeOperationLogError(err),
            },
          },
        }),
      },
    ];
    return new Map(providerSpecs.map((spec) => [spec.provider, spec]));
  }

  applyPatch(aggregatePatch, patch) {
    Object.assign(
      aggregatePatch.provider_models,
      patch.provider_models || {}
    );
    Object.assign(
      aggregatePatch.provider_runtime,
      patch.provider_runtime || {}
    );
  }

  buildOverallStatus(outcomes) {
    if (!outcomes.length) {
      return { status: "skipped", reason: "refresh_not_due" };
    }
    if (outcomes.some((outcome) => outcome.status === "error")) {
      return { status: "error", reason: null };
    }
    if (outcomes.some((outcome) => outcome.status === "success")) {
      return { status: "refreshed", reason: null };
    }
    return { status: "skipped", reason: "all_providers_unavailable" };
  }

  async refreshProvider(providerId, options = {}) {
    return this.runOnce({
      ...options,
      provider: providerId,
      source: options.source || "manual_session_setup",
      force: options.force !== false,
    });
  }

  async refreshSelectedProvider(providerId, options = {}) {
    return this.refreshProvider(providerId, options);
  }

  async refreshProviderCatalog(providerId, options = {}) {
    return this.refreshProvider(providerId, options);
  }

  async runProviderRefresh(providerId, options = {}) {
    return this.refreshProvider(providerId, options);
  }

  async runOnce(options = {}) {
    const targetProvider = normalizeRefreshProviderId(options.provider);
    const force = options.force !== false;
    const refreshSource =
      typeof options.source === "string" && options.source.trim()
        ? options.source.trim()
        : targetProvider
        ? "manual"
        : "explicit";
    const startedMs = this.nowFn();
    const startedAt = operationLogTimestamp(startedMs);
    if (this.running) {
      const finishedMs = this.nowFn();
      this.appendOperationLogFn(
        {
          schema_version: 1,
          operation: "provider_model_refresh",
          provider: targetProvider || "all",
          status: "skipped",
          reason: "refresh_already_running",
          source: refreshSource,
          started_at: startedAt,
          finished_at: operationLogTimestamp(finishedMs),
          duration_ms: durationMs(startedMs, finishedMs),
        },
        { configDir: this.configDir || getConfigDir() }
      );
      return { status: "skipped", reason: "refresh_already_running" };
    }
    this.running = true;
    const attemptedAt = startedAt;
    try {
      const config = this.readConfigFn();
      const targetProviders = this.getTargetProviderIds({
        provider: targetProvider,
        force,
      });
      if (targetProviders.length === 0) {
        return {
          status: "skipped",
          reason: "refresh_not_due",
          providers: [],
        };
      }
      const nextRefreshAt = new Date(
        this.nowFn() + this.refreshIntervalMs
      ).toISOString();
      const aggregatePatch = {
        provider_models: {},
        provider_runtime: {},
        refresh: {
          last_attempt_at: attemptedAt,
          next_refresh_at: nextRefreshAt,
          scheduling_authority: "provider_last_refresh_plus_interval",
        },
      };
      const specs = this.buildProviderSpecs(config, attemptedAt);
      const outcomes = [];
      for (const providerId of targetProviders) {
        const spec = specs.get(providerId);
        const providerStartedMs = this.nowFn();
        try {
          this.assertProviderAvailable(config, providerId);
        } catch (err) {
          const patch = spec.buildUnavailablePatch(err);
          this.applyPatch(aggregatePatch, patch);
          outcomes.push({
            provider: spec.provider,
            status: "skipped",
            reason: "provider_unavailable",
            model_count: 0,
            error: err,
            started_ms: providerStartedMs,
          });
          continue;
        }
        try {
          const discovery = await spec.discover();
          const patch = spec.buildSuccessPatch(discovery);
          this.applyPatch(aggregatePatch, patch);
          outcomes.push({
            provider: spec.provider,
            status: "success",
            model_count: Array.isArray(discovery.models)
              ? discovery.models.length
              : 0,
            config_options_count: Number.isInteger(
              discovery.config_options_count
            )
              ? discovery.config_options_count
              : null,
            started_ms: providerStartedMs,
          });
        } catch (err) {
          const patch = spec.buildErrorPatch(err);
          this.applyPatch(aggregatePatch, patch);
          outcomes.push({
            provider: spec.provider,
            status: "error",
            model_count: 0,
            error: err,
            started_ms: providerStartedMs,
          });
        }
      }
      const overall = this.buildOverallStatus(outcomes);
      if (overall.status === "refreshed") {
        aggregatePatch.refresh.last_success_at = attemptedAt;
      }
      const writeResult = this.writeParamsFn(aggregatePatch, {
        configDir: this.configDir,
      });
      const finishedMs = this.nowFn();
      for (const outcome of outcomes) {
        this.appendOperationLogFn(
          {
            schema_version: 1,
            operation: "provider_model_refresh",
            provider: outcome.provider,
            status: outcome.status,
            reason: outcome.reason || null,
            source: refreshSource,
            started_at: attemptedAt,
            finished_at: operationLogTimestamp(finishedMs),
            duration_ms: durationMs(outcome.started_ms, finishedMs),
            model_count: outcome.model_count,
            config_options_count: outcome.config_options_count ?? null,
            last_success_at:
              outcome.status === "success" ? attemptedAt : undefined,
            next_refresh_at: nextRefreshAt,
            scheduling_authority: "provider_last_refresh_plus_interval",
            params_path: writeResult.path,
            error:
              outcome.status === "success"
                ? null
                : sanitizeOperationLogError(outcome.error),
          },
          { configDir: this.configDir || getConfigDir() }
        );
      }
      for (const outcome of outcomes.filter(
        (entry) => entry.status === "error"
      )) {
        if (this.logger?.warn) {
          this.logger.warn(
            `[provider-model-refresh] ${outcome.provider} model refresh failed: ${truncateError(
              outcome.error
            )}`
          );
        }
      }
      return {
        status: overall.status,
        reason: overall.reason,
        params: writeResult.params,
        params_path: writeResult.path,
        provider: targetProvider,
        source: refreshSource,
        providers: outcomes.map((outcome) => ({
          provider: outcome.provider,
          status: outcome.status,
          reason: outcome.reason || null,
          model_count: outcome.model_count,
          error:
            outcome.status === "success"
              ? null
              : truncateError(outcome.error),
        })),
      };
    } finally {
      this.running = false;
    }
  }

  getStatus() {
    return {
      background_refresh_enabled: this.backgroundRefreshEnabled === true,
      background_refresh_source: this.backgroundRefreshSource,
      background_refresh_disabled_reason:
        this.backgroundRefreshEnabled === true
          ? null
          : this.backgroundRefreshDisabledReason,
      background_refresh_started: this.started === true,
      background_refresh_timer_active: Boolean(this.timer),
      explicit_refresh_available: true,
      refresh_running: this.running === true,
      startup_delay_ms: this.startupDelayMs,
      refresh_interval_ms: this.refreshIntervalMs,
      scheduling_authority: "provider_last_refresh_plus_interval",
      providers: this.getAllProviderRefreshStatus(),
    };
  }

  scheduleNext(options = {}) {
    if (!this.started || this.timer) return;
    const delayMs = this.computeNextDelay(options);
    this.timer = this.setTimeoutFn(async () => {
      this.timer = null;
      try {
        await this.runOnce({ source: "background", force: false });
      } finally {
        this.scheduleNext();
      }
    }, delayMs);
    if (typeof this.timer?.unref === "function") {
      this.timer.unref();
    }
  }

}
