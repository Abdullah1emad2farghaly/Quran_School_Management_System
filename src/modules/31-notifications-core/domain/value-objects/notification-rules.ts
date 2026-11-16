import type { Locale } from '../../../01-configuration/public';

/** Approved Module 31 decision (Q2): without a configured account language every notification is rendered in Arabic. */
export const DEFAULT_NOTIFICATION_LOCALE: Locale = 'ar';

/** Size limits of a stored notification (technical limits, they match the database columns). */
export const NOTIFICATION_LIMITS = {
  titleMax: 200,
  bodyMax: 2000,
  dataMaxBytes: 4096,
  dedupKeyMax: 191,
  maxRecipientsPerCall: 1000,
  /** Notification type and template key shapes. */
  typePattern: /^[A-Z][A-Z0-9_]{1,63}$/,
  templateKeyPattern: /^[a-z][a-z0-9_.-]{1,99}$/,
} as const;

/** Web Push technical limits. None of them is a business rule. */
export const PUSH_LIMITS = {
  endpointMax: 2048,
  keyMax: 255,
  keyMin: 16,
  /** Protective cap of push subscriptions per account (abuse guard; an account has at most 3 sessions). */
  maxSubscriptionsPerAccount: 10,
  /** A push shows only a short preview; the full text is in the in-app notification. */
  pushBodyMax: 300,
  maxAttempts: 5,
  baseRetryDelayMs: 30_000,
  claimLockMs: 60_000,
  batchSize: 50,
  /** A subscription is removed after this many consecutive deliveries that failed for good. */
  maxConsecutiveFailures: 5,
  failedDeliveryRetentionDays: 7,
  ttlSeconds: 24 * 60 * 60,
} as const;

/** Retry delay after the n-th failed attempt (n >= 1): 30 s, 60 s, 120 s, 240 s (the same shape as the outbox). */
export function pushRetryDelayMs(attempts: number): number {
  return PUSH_LIMITS.baseRetryDelayMs * 2 ** Math.max(0, attempts - 1);
}

/** The text a push shows: title, and the body cut to a short preview. */
export function pushPreview(body: string): string {
  return body.length <= PUSH_LIMITS.pushBodyMax ? body : `${body.slice(0, PUSH_LIMITS.pushBodyMax - 1)}…`;
}
