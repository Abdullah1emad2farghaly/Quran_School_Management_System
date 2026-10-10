import { newUuid, type Clock } from '../../../00-shared-kernel/public';
import { REFRESH_TOKEN_TTL_SECONDS } from '../value-objects/token-policy';

export interface RefreshTokenSnapshot {
  readonly id: string;
  readonly sessionId: string;
  readonly userId: string;
  /** Keyed hash of the token. The raw token is never stored. */
  readonly tokenHash: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  /** Set when this token was rotated into a newer one. Presenting a rotated token again is REUSE. */
  readonly replacedById: string | null;
  readonly version: number;
}

/**
 * A refresh token of a session (hashed, expiring, revocable, rotated; §25). Exactly one token per active
 * session is current. Old tokens stay in the table so reuse can be detected.
 */
export class RefreshTokenRecord {
  private constructor(private state: RefreshTokenSnapshot) {}

  static issue(input: { sessionId: string; userId: string; tokenHash: string; clock: Clock; id?: string }): RefreshTokenRecord {
    const issuedAt = input.clock.now();
    return new RefreshTokenRecord({
      id: input.id ?? newUuid(),
      sessionId: input.sessionId,
      userId: input.userId,
      tokenHash: input.tokenHash,
      issuedAt,
      expiresAt: new Date(issuedAt.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000),
      revokedAt: null,
      replacedById: null,
      version: 1,
    });
  }

  static rehydrate(snapshot: RefreshTokenSnapshot): RefreshTokenRecord {
    return new RefreshTokenRecord(snapshot);
  }

  get id(): string {
    return this.state.id;
  }
  get sessionId(): string {
    return this.state.sessionId;
  }
  get userId(): string {
    return this.state.userId;
  }
  get tokenHash(): string {
    return this.state.tokenHash;
  }
  get issuedAt(): Date {
    return this.state.issuedAt;
  }
  get expiresAt(): Date {
    return this.state.expiresAt;
  }
  get revokedAt(): Date | null {
    return this.state.revokedAt;
  }
  get replacedById(): string | null {
    return this.state.replacedById;
  }
  get version(): number {
    return this.state.version;
  }
  get isRevoked(): boolean {
    return this.state.revokedAt !== null;
  }
  /** True when this token was already exchanged for a newer one (using it again is a reuse attack). */
  get wasRotated(): boolean {
    return this.state.replacedById !== null;
  }
  isExpired(now: Date): boolean {
    return now.getTime() >= this.state.expiresAt.getTime();
  }

  /** `replacedById` is set only by rotation; revoking with the session leaves it null. */
  revoke(now: Date, replacedById: string | null = null): void {
    if (this.isRevoked) return;
    this.state = { ...this.state, revokedAt: now, replacedById };
  }
}
