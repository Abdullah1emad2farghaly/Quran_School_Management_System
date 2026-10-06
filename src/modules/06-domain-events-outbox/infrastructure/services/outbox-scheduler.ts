import type { Logger } from '../../../05-logging-request-context/public';
import type { ProcessResult } from '../../application/services/outbox-processor';

export interface OutboxSchedulerOptions {
  readonly intervalMs?: number;
  /** Safety cap on back-to-back batches per tick. */
  readonly maxBatchesPerTick?: number;
}

/**
 * Polls the outbox on an interval (no Redis required). The database is the
 * source of truth; this only decides WHEN to look. Ticks never overlap, and
 * `stop()` waits for the batch in flight. A BullMQ-based trigger can replace
 * this later without changing the processor or the store.
 */
export class OutboxScheduler {
  private timer: NodeJS.Timeout | undefined;
  private current: Promise<void> | undefined;
  private stopped = true;
  private stopRequested = false;
  private lastError: { message: string; at: number } | undefined;
  private readonly intervalMs: number;
  private readonly maxBatches: number;

  constructor(
    private readonly processor: { processBatch(): Promise<ProcessResult> },
    private readonly logger: Logger,
    options: OutboxSchedulerOptions = {},
  ) {
    this.intervalMs = options.intervalMs ?? 5000;
    this.maxBatches = options.maxBatchesPerTick ?? 50;
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.stopRequested = false;
    this.schedule();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.stopRequested = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await this.current;
  }

  /** Runs one tick now. Returns immediately if a tick is already running. */
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
      for (let i = 0; i < this.maxBatches && !this.stopRequested; i++) {
        const result = await this.processor.processBatch();
        if (result.claimed === 0) break;
      }
      this.lastError = undefined;
    } catch (error) {
      // Avoid flooding logs when a problem persists (e.g. DB down, table not migrated yet).
      const message = error instanceof Error ? error.message : String(error);
      const now = Date.now();
      if (!this.lastError || this.lastError.message !== message || now - this.lastError.at >= 60_000) {
        this.logger.error('outbox processing failed', { err: error });
        this.lastError = { message, at: now };
      }
    }
  }
}
