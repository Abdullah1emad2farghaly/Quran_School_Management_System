import { AggregateRoot, newUuid, type Clock } from '../../../00-shared-kernel/public';
import { createDomainEvent } from '../../../06-domain-events-outbox/public';
import { sessionError } from '../errors/session-errors';
import {
  AUTH_SESSION_AGGREGATE_TYPE,
  SessionEventTypes,
  type AuthSessionEventPayload,
} from '../events/session-events';
import { isValidSessionSlot } from '../value-objects/session-policy';
import type { SessionRevokeReason } from '../value-objects/session-revoke-reason';
import { normalizeDeviceLabel } from '../services/device-label';

export interface AuthSessionSnapshot {
  readonly id: string;
  readonly userId: string;
  readonly createdAt: Date;
  readonly revokedAt: Date | null;
  readonly revokedReason: SessionRevokeReason | null;
  /** The slot (1..3) this ACTIVE session occupies; null once the session is revoked, which frees the slot. */
  readonly slot: number | null;
  /** Safe, human-readable device description derived from the User-Agent at login (for "My devices"); never the raw header. */
  readonly deviceLabel: string | null;
  /** Optimistic-lock counter, incremented by the repository on every update. */
  readonly version: number;
}

/**
 * One login session of a User (Master Specification §25, three-session amendment). A user has up to THREE active sessions, each in its own
 * slot; a new login never revokes another session. Sessions are never deleted, so the history is preserved.
 */
export class AuthSession extends AggregateRoot<string> {
  private constructor(private state: AuthSessionSnapshot) {
    super(state.id);
  }

  static start(input: { userId: string; slot: number; deviceLabel?: string | null; clock: Clock; id?: string }): AuthSession {
    if (!isValidSessionSlot(input.slot)) throw new RangeError('A session slot must be an integer from 1 to the maximum number of active sessions.');
    const session = new AuthSession({
      id: input.id ?? newUuid(),
      userId: input.userId,
      createdAt: input.clock.now(),
      revokedAt: null,
      revokedReason: null,
      slot: input.slot,
      deviceLabel: normalizeDeviceLabel(input.deviceLabel),
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
  get slot(): number | null {
    return this.state.slot;
  }
  get deviceLabel(): string | null {
    return this.state.deviceLabel;
  }
  get version(): number {
    return this.state.version;
  }
  get isActive(): boolean {
    return this.state.revokedAt === null;
  }

  revoke(reason: SessionRevokeReason, clock: Clock): void {
    if (!this.isActive) throw sessionError('SESSION_REVOKED');
    this.state = { ...this.state, revokedAt: clock.now(), revokedReason: reason, slot: null };
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
