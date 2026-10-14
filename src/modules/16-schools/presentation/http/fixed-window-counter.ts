export interface FixedWindowCounterOptions {
  readonly maxRequests: number;
  readonly windowMs: number;
  /** Injectable clock (milliseconds) for tests. */
  readonly now?: () => number;
}

export interface CounterDecision {
  readonly allowed: boolean;
  /** Seconds until the window of this key ends (only meaningful when not allowed). */
  readonly retryAfterSeconds: number;
}

/**
 * A small in-memory fixed-window request counter (per key, per process). The project has no generic limiter (the
 * recovery limiter is tied to its own tables), so public school submissions use this. Counts are lost on restart and are
 * not shared between processes: it slows abuse, it is not a security boundary. Expired windows are pruned.
 */
export class FixedWindowCounter {
  private readonly windows = new Map<string, { start: number; count: number }>();
  private readonly now: () => number;

  constructor(private readonly options: FixedWindowCounterOptions) {
    if (options.maxRequests < 1 || options.windowMs < 1) throw new RangeError('Invalid rate limit options');
    this.now = options.now ?? Date.now;
  }

  hit(key: string): CounterDecision {
    const now = this.now();
    this.prune(now);
    const current = this.windows.get(key);
    if (!current || now - current.start >= this.options.windowMs) {
      this.windows.set(key, { start: now, count: 1 });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (current.count >= this.options.maxRequests) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((current.start + this.options.windowMs - now) / 1000)) };
    }
    current.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  private prune(now: number): void {
    if (this.windows.size < 1000) return;
    for (const [key, w] of this.windows) if (now - w.start >= this.options.windowMs) this.windows.delete(key);
  }
}
