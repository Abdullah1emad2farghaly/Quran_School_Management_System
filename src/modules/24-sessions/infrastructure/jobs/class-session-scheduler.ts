import type { Logger } from '../../../05-logging-request-context/public';

export interface ClassSessionSchedulerOptions {
  readonly intervalMs?: number;
}

/**
 * Polls on an interval and runs one cycle of the session job (reconcile retired slots, generate sessions that reached their 15-minute threshold, advance
 * sessions at their start and end). The database is the source of truth; this only decides WHEN to look, so a session appears at most one interval late.
 * Ticks never overlap and `stop()` waits for the cycle in flight. The job never invents business behavior: it only runs `ClassSessionService.runCycle`.
 */
export class ClassSessionScheduler {
  private timer: NodeJS.Timeout | undefined;
  private current: Promise<void> | undefined;
  private stopped = true;
  private lastError: { message: string; at: number } | undefined;
  private readonly intervalMs: number;

  constructor(
    private readonly job: { runCycle(): Promise<{ failed: number }> },
    private readonly logger: Logger,
    options: ClassSessionSchedulerOptions = {},
  ) {
    this.intervalMs = options.intervalMs ?? 15_000;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await this.current;
  }

  /** Runs one cycle now. Returns immediately if a cycle is already running. */
  async runOnce(): Promise<void> {
    if (this.current) return this.current;
    this.current = this.tick().finally(() => {
      this.current = undefined;
    });
    return this.current;
  }

  private schedule(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.runOnce().finally(() => this.schedule());
    }, this.intervalMs);
    this.timer.unref();
  }

  private async tick(): Promise<void> {
    try {
      const result = await this.job.runCycle();
      if (result.failed > 0) this.logger.warn('class session cycle finished with failures (retried at the next cycle)', { failed: result.failed });
      this.lastError = undefined;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const now = Date.now();
      if (!this.lastError || this.lastError.message !== message || now - this.lastError.at >= 60_000) {
        this.logger.error('class session cycle failed', { err: error });
        this.lastError = { message, at: now };
      }
    }
  }
}
