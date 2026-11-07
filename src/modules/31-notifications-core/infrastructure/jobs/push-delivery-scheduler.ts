import type { PushPassResult } from '../../application/services/push-delivery-processor';

export interface PushDeliveryJob {
  processDue(): Promise<PushPassResult>;
}

export interface PushDeliverySchedulerOptions {
  readonly job: PushDeliveryJob;
  /** How often queued pushes are sent. Default 5 seconds (the same as the outbox). */
  readonly intervalMs?: number;
  readonly onError?: (error: unknown) => void;
  readonly onResult?: (result: PushPassResult) => void;
}

/**
 * In-process runner of the Web Push queue (no Redis), the same pattern as the other schedulers. Work comes from the database queue, so a restart loses nothing; a pass never
 * overlaps the previous one and an error never stops the timer. Started only when Web Push is configured.
 */
export class PushDeliveryScheduler {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private readonly intervalMs: number;

  constructor(private readonly options: PushDeliverySchedulerOptions) {
    this.intervalMs = options.intervalMs ?? 5_000;
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
      const result = await this.options.job.processDue();
      if (result.sent + result.retried + result.failed + result.subscriptionsRemoved > 0) this.options.onResult?.(result);
    } catch (error) {
      this.options.onError?.(error);
    } finally {
      this.running = false;
    }
    return true;
  }
}
