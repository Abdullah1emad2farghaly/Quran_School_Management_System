import type { TransactionContext } from '../../../00-shared-kernel/public';
import type { PasswordRecovery } from '../../domain/entities/password-recovery';
import type { RecoveryRequestRecord } from '../../domain/services/rate-limit-policy';

export interface RecoveryRepository {
  // --- rate limiting -------------------------------------------------------------------------------
  /**
   * Takes an exclusive, transaction-long lock for this phone (creating its lock row if needed). Every request for the
   * same phone is serialized behind it, so the rolling-window counts below cannot be raced past the limits.
   */
  lockPhone(phoneKey: string, now: Date, tx: TransactionContext): Promise<void>;
  /** Requests of this phone made after `since`. Call only after `lockPhone`. */
  listRequestsSince(phoneKey: string, since: Date, tx: TransactionContext): Promise<RecoveryRequestRecord[]>;
  recordRequest(phoneKey: string, ipKey: string, now: Date, tx: TransactionContext): Promise<void>;

  // --- recoveries ----------------------------------------------------------------------------------
  /** The user's live (PENDING/VERIFIED) recoveries, locked for the rest of the transaction. */
  lockLiveByUser(userId: string, tx: TransactionContext): Promise<PasswordRecovery[]>;
  /** Plain read: only to discover the id; re-read with `lock` before deciding. */
  findByResetTokenHash(resetTokenHash: string, tx: TransactionContext): Promise<PasswordRecovery | undefined>;
  lock(id: string, tx: TransactionContext): Promise<PasswordRecovery | undefined>;
  /** Throws RECOVERY_CONCURRENT_MODIFICATION if the user already has a live recovery (unique-index guard). */
  insert(recovery: PasswordRecovery, tx: TransactionContext): Promise<void>;
  /** Optimistic lock on `recovery.version`. Throws RECOVERY_CONCURRENT_MODIFICATION when stale. */
  update(recovery: PasswordRecovery, tx: TransactionContext): Promise<void>;
  /** Housekeeping: deletes closed/expired rows and old request-log rows older than `before`. Returns rows removed. */
  purgeOlderThan(before: Date): Promise<number>;
}

/** Keyed hashing for everything stored. The OTP, the reset token, phones and IPs are never stored in the clear. */
export interface RecoveryCrypto {
  hashOtp(recoveryId: string, otp: string): string;
  hashResetToken(token: string): string;
  phoneKey(phone: string): string;
  ipKey(ip: string): string;
  /** Constant-time comparison of two hashes. */
  safeEqual(a: string, b: string): boolean;
}

export interface RecoverySecrets {
  /** Uniformly random 6-digit OTP (leading zeros kept). */
  generateOtp(): string;
  /** 256-bit random single-use token. */
  generateResetToken(): string;
}

export interface OtpMessage {
  readonly phone: string;
  readonly otp: string;
  readonly expiresInSeconds: number;
}

/**
 * Delivers an OTP to a phone. The real provider is configurable and chosen later; implementations must never log the OTP.
 * Delivery runs AFTER the business transaction and in the background, so a failure (or its absence for unknown accounts)
 * is never visible to the caller.
 */
export interface OtpSender {
  send(message: OtpMessage): Promise<void>;
}

/** Runs delivery without making the response wait for it (so timing does not reveal whether an account exists). */
export type BackgroundRunner = (task: () => Promise<void>) => void;
