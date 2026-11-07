/** The pass the scheduler runs (implemented by `SessionService.expireSessions`). */
export interface SessionExpiryJob {
  expireSessions(): Promise<{ expired: number; failed: number }>;
}

export interface SessionExpirySchedulerOptions {
  readonly job: SessionExpiryJob;
  /** How often expired sessions are looked for. Default 5 minutes (a lightweight pass: one indexed query when nothing is due). */
  readonly intervalMs?: number;
  readonly onError?: (error: unknown) => void;
  /** Called after a pass that expired or failed on at least one session (for logging). */
  readonly onResult?: (result: { expired: number; failed: number }) => void;
}

/**
 * In-process runner of the periodic session cleanup (no Redis), the same pattern as the exam and class-session schedulers. Each pass works from the
 * STORED refresh-token expiry times and is idempotent, so a restart or a late pass loses nothing: the next pass catches up. A pass never overlaps
 * the previous one and an error never stops the timer. The login also cleans up expired sessions of the account being evaluated.
 */
export class SessionExpiryScheduler {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private readonly intervalMs: number;

  constructor(private readonly options: SessionExpirySchedulerOptions) {
    this.intervalMs = options.intervalMs ?? 5 * 60_000;
  }

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** One pass now. Returns false when a pass was already running (nothing runs twice at once). */
  async tick(): Promise<boolean> {
    if (this.running) return false;
    this.running = true;
    try {
      const result = await this.options.job.expireSessions();
      if (result.expired > 0 || result.failed > 0) this.options.onResult?.(result);
    } catch (error) {
      this.options.onError?.(error);
    } finally {
      this.running = false;
    }
    return true;
  }
}
