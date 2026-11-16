/**
 * Three-session model (Master Specification §25, approved amendment): an account may have up to THREE concurrent active sessions,
 * for every role. Each active session occupies one slot (1..MAX_ACTIVE_SESSIONS); a revoked session gives its slot back.
 * The same limit is enforced by the database (CHECK on `auth_sessions.slot` and the unique index `(user_id, slot)`), so changing it
 * needs a migration as well as this constant.
 */
export const MAX_ACTIVE_SESSIONS = 3;

/** The slot numbers a session can occupy. */
export const SESSION_SLOTS: readonly number[] = Array.from({ length: MAX_ACTIVE_SESSIONS }, (_, i) => i + 1);

export function isValidSessionSlot(slot: unknown): slot is number {
  return typeof slot === 'number' && Number.isInteger(slot) && slot >= 1 && slot <= MAX_ACTIVE_SESSIONS;
}

/** The lowest slot not used by the given active sessions, or undefined when the account is at the limit. */
export function firstFreeSlot(usedSlots: readonly number[]): number | undefined {
  return SESSION_SLOTS.find((slot) => !usedSlots.includes(slot));
}
