/**
 * PENDING    OTP issued, not yet verified
 * VERIFIED   OTP verified, a single-use reset token was issued
 * CONSUMED   the password was reset with the token
 * SUPERSEDED replaced by a newer OTP (resend) or no longer usable (account became inactive)
 * LOCKED     5 wrong OTP attempts: a new OTP must be requested
 */
export const RECOVERY_STATUSES = ['PENDING', 'VERIFIED', 'CONSUMED', 'SUPERSEDED', 'LOCKED'] as const;
export type RecoveryStatus = (typeof RECOVERY_STATUSES)[number];
export const LIVE_STATUSES: readonly RecoveryStatus[] = ['PENDING', 'VERIFIED'];
