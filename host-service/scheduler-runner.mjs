import { SchedulerService } from "./scheduler-service.mjs";

export class SchedulerRunner {
  constructor({
    service = new SchedulerService(),
    sessionDispatcher,
    intervalMs = 1000,
    clock = () => new Date(),
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    logger = console,
  } = {}) {
    if (!Number.isInteger(intervalMs) || intervalMs < 100) {
      throw new Error("Scheduler runner intervalMs must be an integer >= 100");
    }
    this.service = service;
    this.sessionDispatcher = sessionDispatcher;
    this.intervalMs = intervalMs;
    this.clock = clock;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.logger = logger;
    this.timer = null;
    this.running = false;
    this.tickInFlight = false;
    this.tickCount = 0;
    this.lastTickResult = null;
    this.lastTickError = null;
  }

  start() {
    if (this.running) return this.getLifecycleState();
    this.service.initialize();
    this.running = true;
    this.scheduleNextTick();
    return this.getLifecycleState();
  }

  stop() {
    this.running = false;
    if (this.timer) {
      this.clearTimeoutFn(this.timer);
      this.timer = null;
    }
    return this.getLifecycleState();
  }

  scheduleNextTick() {
    if (!this.running || this.timer) return;
    this.timer = this.setTimeoutFn(async () => {
      this.timer = null;
      try {
        await this.tick();
      } catch {
        // tick() records and logs the error. Background scheduler failures must
        // not escape as process-level unhandled rejections.
      } finally {
        this.scheduleNextTick();
      }
    }, this.intervalMs);
    if (typeof this.timer?.unref === "function") {
      this.timer.unref();
    }
  }

  async tick() {
    if (this.tickInFlight) {
      return {
        skipped: true,
        reason: "scheduler_tick_already_in_flight",
      };
    }
    this.tickInFlight = true;
    try {
      this.tickCount += 1;
      const result = await this.service.drainDueSchedules({
        now: new Date(this.clock()).toISOString(),
        dispatcher: this.sessionDispatcher,
        dispatchOrigin: "host_scheduler_runner_tick",
        dispatchAuthority: "host_scheduler_runner",
      });
      this.lastTickResult = result;
      this.lastTickError = null;
      return result;
    } catch (err) {
      this.lastTickError = err.message || String(err);
      this.logger.error?.("[scheduler-runner] tick failed", err);
      throw err;
    } finally {
      this.tickInFlight = false;
    }
  }

  getLifecycleState() {
    return {
      running: this.running,
      interval_ms: this.intervalMs,
      timer_active: Boolean(this.timer),
      timer_count: this.timer ? 1 : 0,
      per_row_timers: false,
      tick_in_flight: this.tickInFlight,
      tick_count: this.tickCount,
      last_tick_result: this.lastTickResult,
      last_tick_error: this.lastTickError,
      lifecycle_owner: "host_scheduler_runner_single_timer",
    };
  }
}
