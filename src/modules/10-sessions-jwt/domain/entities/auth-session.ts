import { AggregateRoot, newUuid, type Clock } from '../../../00-shared-kernel/public';
import { createDomainEvent } from '../../../06-domain-events-outbox/public';
import { sessionError } from '../errors/session-errors';
import {
  AUTH_SESSION_AGGREGATE_TYPE,
  SessionEventTypes,
  type AuthSessionEventPayload,
} from '../events/session-events';
import type { SessionRevokeReason } from '../value-objects/session-revoke-reason';

export interface AuthSessionSnapshot {
  readonly id: string;
  readonly userId: string;
  readonly createdAt: Date;
  readonly revokedAt: Date | null;
  readonly revokedReason: SessionRevokeReason | null;
  /** Optimistic-lock counter, incremented by the repository on every update. */
  readonly version: number;
}

/**
 * One login session of a User (Master Specification §25). A user has at most ONE active session;
 * a new login revokes the previous one. Sessions are never deleted, so the history is preserved.
 */
export class AuthSession extends AggregateRoot<string> {
  private constructor(private state: AuthSessionSnapshot) {
    super(state.id);
  }

  static start(input: { userId: string; clock: Clock; id?: string }): AuthSession {
    const session = new AuthSession({
      id: input.id ?? newUuid(),
      userId: input.userId,
      createdAt: input.clock.now(),
      revokedAt: null,
      revokedReason: null,
      version: 1,
    });
    session.record(SessionEventTypes.AUTH_SESSION_STARTED, input.clock);
    return session;
  }

  static rehydrate(snapshot: AuthSessionSnapshot): AuthSession {
    return new AuthSession(snapshot);
  }

  get userId(): string {
    return this.state.userId;
  }
  get createdAt(): Date {
    return this.state.createdAt;
  }
  get revokedAt(): Date | null {
    return this.state.revokedAt;
  }
  get revokedReason(): SessionRevokeReason | null {
    return this.state.revokedReason;
  }
  get version(): number {
    return this.state.version;
  }
  get isActive(): boolean {
    return this.state.revokedAt === null;
  }

  revoke(reason: SessionRevokeReason, clock: Clock): void {
    if (!this.isActive) throw sessionError('SESSION_REVOKED');
    this.state = { ...this.state, revokedAt: clock.now(), revokedReason: reason };
    this.record(SessionEventTypes.AUTH_SESSION_REVOKED, clock, reason);
  }

  private record(eventType: string, clock: Clock, reason?: SessionRevokeReason): void {
    this.addDomainEvent(
      createDomainEvent<AuthSessionEventPayload>(
        {
          eventType,
          aggregateType: AUTH_SESSION_AGGREGATE_TYPE,
          aggregateId: this.id,
          payload: { sessionId: this.id, userId: this.state.userId, ...(reason ? { reason } : {}) },
        },
        clock,
      ),
    );
  }
}
