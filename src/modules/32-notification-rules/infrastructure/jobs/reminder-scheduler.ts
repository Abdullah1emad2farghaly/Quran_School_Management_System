import type { ReminderPassResult } from '../../application/services/reminder-processor';

export interface ReminderJob {
  processDue(): Promise<ReminderPassResult>;
}

export interface ReminderSchedulerOptions {
  readonly job: ReminderJob;
  /** How often due reminders are looked for. Default 10 seconds. */
  readonly intervalMs?: number;
  readonly onError?: (error: unknown) => void;
  readonly onResult?: (result: ReminderPassResult) => void;
}

/**
 * In-process runner of the time-driven reminders (no Redis; the same pattern as the other schedulers). The work lives in the database (`notification_reminders`, due-based), so a
 * restart or an outage loses nothing: the first pass after the scheduler resumes picks up every reminder that became due in the meantime. A pass never overlaps the previous one
 * and an error never stops the timer.
 */
export class ReminderScheduler {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private readonly intervalMs: number;

  constructor(private readonly options: ReminderSchedulerOptions) {
    this.intervalMs = options.intervalMs ?? 10_000;
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

  /** One pass now. Returns false when a pass was already running. */
  async tick(): Promise<boolean> {
    if (this.running) return false;
    this.running = true;
    try {
      const r = await this.options.job.processDue();
      if (r.sent + r.suppressed + r.postponed + r.retried + r.failed > 0) this.options.onResult?.(r);
    } catch (error) {
      this.options.onError?.(error);
    } finally {
      this.running = false;
    }
    return true;
  }
}
