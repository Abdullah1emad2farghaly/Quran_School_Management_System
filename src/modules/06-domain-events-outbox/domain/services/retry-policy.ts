export interface RetryPolicy {
  /** Total delivery attempts before a message is marked dead. */
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 5,
  baseDelayMs: 30_000,
  maxDelayMs: 3_600_000,
};

/** Exponential backoff after the Nth failed attempt (1-based): base, 2×base, 4×base… capped. */
export function computeRetryDelayMs(failedAttempts: number, policy: RetryPolicy = DEFAULT_RETRY_POLICY): number {
  const exponent = Math.max(0, failedAttempts - 1);
  return Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** exponent);
}
