import { AggregateRoot, newUuid, type Clock } from '../../../00-shared-kernel/public';
import { createDomainEvent } from '../../../06-domain-events-outbox/public';
import { classSessionError } from '../errors/session-errors';
import { CLASS_SESSION_AGGREGATE_TYPE, SessionEventTypes, type SessionEventPayload, type SessionEventType } from '../events/session-events';
import { MAX_CANCEL_REASON_LENGTH, type CancelSource, type SessionStatus, type SlotRetirementReason } from '../value-objects/session-status';

export interface ClassSessionSnapshot {
  readonly id: string;
  readonly schoolId: string;
  readonly groupId: string;
  readonly teacherId: string;
  /** The schedule slot (Module 23) this occurrence comes from. Slots are immutable, so slot + date identify one occurrence. */
  readonly slotId: string;
  /** The occurrence's calendar date in the business zone (Africa/Cairo), `YYYY-MM-DD`. */
  readonly occurrenceDate: string;
  /** Derived from the slot: UTC instants. */
  readonly scheduledStart: Date;
  readonly scheduledEnd: Date;
  readonly status: SessionStatus;
  readonly createdAt: Date;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly cancelledAt: Date | null;
  /** The Teacher's user id; null when the system cancelled. */
  readonly cancelledBy: string | null;
  readonly cancelSource: CancelSource | null;
  readonly cancelReason: string | null;
  readonly slotRetireReason: SlotRetirementReason | null;
}

export type SessionTransition = 'STARTED' | 'COMPLETED';

/**
 * One occurrence of a group's schedule slot (Master Specification §45): it belongs to a School, a Group, a Teacher, a schedule slot and a date/time, and its
 * time is derived from the slot. Created OPEN by the system 15 minutes before its start (never earlier, never ad hoc); the system moves it to IN_PROGRESS at its
 * start and to COMPLETED at its end; it can be CANCELLED (by its Teacher with a reason, or by the system when its slot was retired before the start).
 * A session is never deleted, and a COMPLETED or CANCELLED session never changes again (a cancellation keeps its original reason and source).
 */
export class ClassSession extends AggregateRoot<string> {
  private constructor(private state: ClassSessionSnapshot) {
    super(state.id);
  }

  static open(input: {
    schoolId: string; groupId: string; teacherId: string; slotId: string; occurrenceDate: string; scheduledStart: Date; scheduledEnd: Date; clock: Clock; id?: string;
  }): ClassSession {
    const session = new ClassSession({
      id: input.id ?? newUuid(),
      schoolId: input.schoolId,
      groupId: input.groupId,
      teacherId: input.teacherId,
      slotId: input.slotId,
      occurrenceDate: input.occurrenceDate,
      scheduledStart: input.scheduledStart,
      scheduledEnd: input.scheduledEnd,
      status: 'OPEN',
      createdAt: input.clock.now(),
      startedAt: null,
      completedAt: null,
      cancelledAt: null,
      cancelledBy: null,
      cancelSource: null,
      cancelReason: null,
      slotRetireReason: null,
    });
    session.record(SessionEventTypes.CREATED, input.clock);
    return session;
  }

  static rehydrate(snapshot: ClassSessionSnapshot): ClassSession {
    return new ClassSession(snapshot);
  }

  get snapshot(): ClassSessionSnapshot {
    return this.state;
  }
  get status(): SessionStatus {
    return this.state.status;
  }

  /**
   * The automatic transitions that are due at `clock.now()`: OPEN -> IN_PROGRESS at the scheduled start, IN_PROGRESS -> COMPLETED at the scheduled end.
   * If both are due (the system was down) the session still passes through IN_PROGRESS. Returns the transitions applied (empty when nothing is due).
   * Nobody triggers these by hand. Completion is purely a matter of time: it creates, checks and changes NO educational record.
   */
  advance(clock: Clock): SessionTransition[] {
    const now = clock.now();
    const applied: SessionTransition[] = [];
    if (this.state.status === 'OPEN' && now >= this.state.scheduledStart) {
      this.state = { ...this.state, status: 'IN_PROGRESS', startedAt: now };
      this.record(SessionEventTypes.STARTED, clock);
      applied.push('STARTED');
    }
    if (this.state.status === 'IN_PROGRESS' && now >= this.state.scheduledEnd) {
      this.state = { ...this.state, status: 'COMPLETED', completedAt: now };
      this.record(SessionEventTypes.COMPLETED, clock);
      applied.push('COMPLETED');
    }
    return applied;
  }

  /**
   * Cancellation by the assigned Teacher: needs a non-empty reason; records who, when and why. Only an OPEN or IN_PROGRESS session can be cancelled: a
   * COMPLETED session cannot, and an already CANCELLED one keeps its original cancellation (reason and source).
   */
  cancelByTeacher(input: { teacherId: string; actorUserId: string; reason: unknown; clock: Clock }): void {
    if (input.teacherId !== this.state.teacherId) throw classSessionError('CLASS_SESSION_NOT_ASSIGNED_TEACHER');
    const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    if (reason === '') throw classSessionError('CLASS_SESSION_CANCEL_REASON_REQUIRED');
    if (reason.length > MAX_CANCEL_REASON_LENGTH) throw classSessionError('CLASS_SESSION_CANCEL_REASON_TOO_LONG', { max: MAX_CANCEL_REASON_LENGTH });
    if (this.state.status !== 'OPEN' && this.state.status !== 'IN_PROGRESS' && this.state.status !== 'SCHEDULED') {
      throw classSessionError('CLASS_SESSION_NOT_CANCELLABLE', { status: this.state.status });
    }
    this.state = { ...this.state, status: 'CANCELLED', cancelledAt: input.clock.now(), cancelledBy: input.actorUserId, cancelSource: 'TEACHER', cancelReason: reason, slotRetireReason: null };
    this.record(SessionEventTypes.CANCELLED, input.clock);
  }

  /**
   * The system cancels the session because its schedule slot was retired, but ONLY when it is still OPEN and the slot was retired BEFORE the session's start.
   * After the start, after completion and after any earlier cancellation (a Teacher's reason and source are preserved) it changes nothing and returns false.
   */
  cancelBecauseSlotRetired(input: { reason: SlotRetirementReason; retiredAt: Date; clock: Clock }): boolean {
    if (this.state.status !== 'OPEN' || input.retiredAt >= this.state.scheduledStart) return false;
    this.state = { ...this.state, status: 'CANCELLED', cancelledAt: input.clock.now(), cancelledBy: null, cancelSource: 'SCHEDULE_SLOT_RETIRED', cancelReason: null, slotRetireReason: input.reason };
    this.record(SessionEventTypes.CANCELLED, input.clock);
    return true;
  }

  private record(eventType: SessionEventType, clock: Clock): void {
    const s = this.state;
    this.addDomainEvent(
      createDomainEvent<SessionEventPayload>(
        {
          eventType,
          aggregateType: CLASS_SESSION_AGGREGATE_TYPE,
          aggregateId: this.id,
          payload: {
            sessionId: s.id,
            schoolId: s.schoolId,
            groupId: s.groupId,
            teacherId: s.teacherId,
            slotId: s.slotId,
            occurrenceDate: s.occurrenceDate,
            scheduledStart: s.scheduledStart.toISOString(),
            scheduledEnd: s.scheduledEnd.toISOString(),
            status: s.status,
            ...(eventType === SessionEventTypes.CANCELLED ? { cancelSource: s.cancelSource, actorId: s.cancelledBy, reason: s.cancelReason, slotRetireReason: s.slotRetireReason } : {}),
          },
        },
        clock,
      ),
    );
  }
}
