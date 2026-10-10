import {
  HOUR_WINDOW_SECONDS,
  MAX_OTP_REQUESTS_PER_PHONE_IP_PER_WINDOW,
  MAX_OTP_REQUESTS_PER_PHONE_PER_HOUR,
  PHONE_IP_WINDOW_SECONDS,
} from '../value-objects/recovery-policy';

export interface RecoveryRequestRecord {
  readonly requestedAt: Date;
  /** Keyed hash of the client IP (the raw IP is not stored). */
  readonly ipKey: string;
}

export type RateLimitDecision = { readonly allowed: true } | { readonly allowed: false; readonly retryAfterSeconds: number };

/**
 * Seconds until a slot frees up in a rolling window, or 0 when the window still has room.
 * `requests` must be the requests of the window, oldest first.
 */
function waitFor(requests: readonly RecoveryRequestRecord[], limit: number, windowSeconds: number, now: Date): number {
  if (requests.length < limit) return 0;
  const blocking = requests[requests.length - limit]!; // once this one leaves the window there is room again
  const freesAt = blocking.requestedAt.getTime() + windowSeconds * 1000;
  return Math.max(1, Math.ceil((freesAt - now.getTime()) / 1000));
}

/**
 * Decides whether one more OTP request is allowed (§26 + approved clarifications):
 *  - max 4 per phone in a rolling hour (the first OTP + 3 resends), whatever the IP;
 *  - max 5 per phone/IP combination in a rolling 15 minutes.
 * EVERY request counts, whether or not the account exists, so the limits (and the 429 answers) never reveal
 * whether an account exists. `history` may contain any rows of the phone; they are filtered here.
 */
export function evaluateRateLimit(history: readonly RecoveryRequestRecord[], ipKey: string, now: Date): RateLimitDecision {
  const sorted = [...history].sort((a, b) => a.requestedAt.getTime() - b.requestedAt.getTime());
  const inWindow = (seconds: number) => sorted.filter((r) => r.requestedAt.getTime() > now.getTime() - seconds * 1000);

  const hourWait = waitFor(inWindow(HOUR_WINDOW_SECONDS), MAX_OTP_REQUESTS_PER_PHONE_PER_HOUR, HOUR_WINDOW_SECONDS, now);
  const pairWait = waitFor(
    inWindow(PHONE_IP_WINDOW_SECONDS).filter((r) => r.ipKey === ipKey),
    MAX_OTP_REQUESTS_PER_PHONE_IP_PER_WINDOW,
    PHONE_IP_WINDOW_SECONDS,
    now,
  );
  const wait = Math.max(hourWait, pairWait);
  return wait === 0 ? { allowed: true } : { allowed: false, retryAfterSeconds: wait };
}
