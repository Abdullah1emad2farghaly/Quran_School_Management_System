import { AggregateRoot, newUuid, type Clock } from '../../../00-shared-kernel/public';
import { createDomainEvent } from '../../../06-domain-events-outbox/public';
import { PASSWORD_RECOVERY_AGGREGATE_TYPE, RecoveryEventTypes, type PasswordResetCompletedPayload } from '../events/recovery-events';
import { MAX_WRONG_ATTEMPTS, OTP_TTL_SECONDS, RESET_TOKEN_TTL_SECONDS } from '../value-objects/recovery-policy';
import { LIVE_STATUSES, type RecoveryStatus } from '../value-objects/recovery-status';

export interface PasswordRecoverySnapshot {
  readonly id: string;
  readonly userId: string;
  /** Keyed hash bound to this recovery id. The OTP itself is never stored. */
  readonly otpHash: string;
  readonly attempts: number;
  readonly otpExpiresAt: Date;
  readonly status: RecoveryStatus;
  /** Keyed hash of the single-use reset token (set when the OTP is verified). The token is never stored. */
  readonly resetTokenHash: string | null;
  readonly resetTokenExpiresAt: Date | null;
  readonly createdAt: Date;
  readonly verifiedAt: Date | null;
  readonly closedAt: Date | null;
  /** Optimistic-lock counter, incremented by the repository on every update. */
  readonly version: number;
}

/**
 * One password-recovery attempt for a user: an OTP, then (after verification) a single-use reset token.
 * A user has at most ONE live (PENDING or VERIFIED) recovery; a new request supersedes the previous one.
 */
export class PasswordRecovery extends AggregateRoot<string> {
  private constructor(private state: PasswordRecoverySnapshot) {
    super(state.id);
  }

  static issue(input: { id: string; userId: string; otpHash: string; clock: Clock }): PasswordRecovery {
    const now = input.clock.now();
    return new PasswordRecovery({
      id: input.id,
      userId: input.userId,
      otpHash: input.otpHash,
      attempts: 0,
      otpExpiresAt: new Date(now.getTime() + OTP_TTL_SECONDS * 1000),
      status: 'PENDING',
      resetTokenHash: null,
      resetTokenExpiresAt: null,
      createdAt: now,
      verifiedAt: null,
      closedAt: null,
      version: 1,
    });
  }

  static newId(): string {
    return newUuid();
  }

  static rehydrate(snapshot: PasswordRecoverySnapshot): PasswordRecovery {
    return new PasswordRecovery(snapshot);
  }

  get userId(): string {
    return this.state.userId;
  }
  get otpHash(): string {
    return this.state.otpHash;
  }
  get attempts(): number {
    return this.state.attempts;
  }
  get otpExpiresAt(): Date {
    return this.state.otpExpiresAt;
  }
  get status(): RecoveryStatus {
    return this.state.status;
  }
  get resetTokenHash(): string | null {
    return this.state.resetTokenHash;
  }
  get resetTokenExpiresAt(): Date | null {
    return this.state.resetTokenExpiresAt;
  }
  get createdAt(): Date {
    return this.state.createdAt;
  }
  get verifiedAt(): Date | null {
    return this.state.verifiedAt;
  }
  get closedAt(): Date | null {
    return this.state.closedAt;
  }
  get version(): number {
    return this.state.version;
  }
  /** PENDING or VERIFIED. At most one per user (unique index). */
  get isLive(): boolean {
    return LIVE_STATUSES.includes(this.state.status);
  }

  /** The OTP can still be tried: pending, not expired, attempts left. */
  isOtpUsable(now: Date): boolean {
    return this.state.status === 'PENDING' && now.getTime() < this.state.otpExpiresAt.getTime() && this.state.attempts < MAX_WRONG_ATTEMPTS;
  }

  /** The reset token can still be used: verified, not expired. */
  isResetTokenUsable(now: Date): boolean {
    return (
      this.state.status === 'VERIFIED' &&
      this.state.resetTokenExpiresAt !== null &&
      now.getTime() < this.state.resetTokenExpiresAt.getTime()
    );
  }

  /** A wrong OTP. The 5th wrong attempt invalidates the OTP (a new one must be requested). */
  registerWrongAttempt(clock: Clock): void {
    const attempts = this.state.attempts + 1;
    this.state = { ...this.state, attempts };
    if (attempts >= MAX_WRONG_ATTEMPTS) this.close('LOCKED', clock.now());
  }

  /** The OTP matched: it can never be used again; a single-use reset token (hash) takes over. */
  markVerified(resetTokenHash: string, clock: Clock): void {
    const now = clock.now();
    this.state = {
      ...this.state,
      status: 'VERIFIED',
      resetTokenHash,
      resetTokenExpiresAt: new Date(now.getTime() + RESET_TOKEN_TTL_SECONDS * 1000),
      verifiedAt: now,
    };
  }

  /** The password was reset with the token. Single use: the recovery is closed. */
  consume(clock: Clock): void {
    this.close('CONSUMED', clock.now());
    this.addDomainEvent(
      createDomainEvent<PasswordResetCompletedPayload>(
        {
          eventType: RecoveryEventTypes.PASSWORD_RESET_COMPLETED,
          aggregateType: PASSWORD_RECOVERY_AGGREGATE_TYPE,
          aggregateId: this.id,
          payload: { recoveryId: this.id, userId: this.state.userId },
        },
        clock,
      ),
    );
  }

  /** Replaced by a newer OTP, or no longer usable. */
  supersede(clock: Clock): void {
    this.close('SUPERSEDED', clock.now());
  }

  private close(status: 'CONSUMED' | 'SUPERSEDED' | 'LOCKED', at: Date): void {
    this.state = { ...this.state, status, closedAt: at };
  }
}
