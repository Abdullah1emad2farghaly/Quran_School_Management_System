import { AggregateRoot, newUuid, type Clock } from '../../../00-shared-kernel/public';
import { createDomainEvent } from '../../../06-domain-events-outbox/public';
import { attendanceError } from '../errors/attendance-errors';
import { ATTENDANCE_AGGREGATE_TYPE, AttendanceEventTypes, type AttendanceEventPayload } from '../events/attendance-events';
import { MAX_REASON_LENGTH, type ActorRole, type AttendanceStatus, type SubjectType } from '../value-objects/attendance-status';

export interface AttendanceRecordSnapshot {
  readonly id: string;
  readonly sessionId: string;
  readonly schoolId: string;
  readonly groupId: string;
  readonly subjectType: SubjectType;
  /** The Student id, or the Teacher id for the Teacher's own attendance. */
  readonly subjectId: string;
  readonly status: AttendanceStatus;
  /** Snapshot of the session at the time of recording (so a student's attendance can be listed by date without reading sessions). */
  readonly occurrenceDate: string;
  readonly scheduledStart: Date;
  readonly recordedBy: string;
  readonly recordedByRole: ActorRole;
  readonly recordedAt: Date;
  readonly updatedBy: string;
  readonly updatedByRole: ActorRole;
  readonly updatedAt: Date;
}

/** One entry of the append-only correction history: never updated, never deleted. */
export interface AttendanceCorrection {
  readonly id: string;
  readonly recordId: string;
  readonly sessionId: string;
  readonly subjectType: SubjectType;
  readonly subjectId: string;
  readonly previousStatus: AttendanceStatus;
  readonly newStatus: AttendanceStatus;
  readonly reason: string;
  readonly changedBy: string;
  readonly changedByRole: ActorRole;
  readonly changedAt: Date;
}

/** The reason of a correction: required (non-blank), at most 500 characters, trimmed. */
export function normalizeCorrectionReason(reason: unknown): string {
  const text = typeof reason === 'string' ? reason.trim() : '';
  if (text === '') throw attendanceError('ATTENDANCE_CORRECTION_REASON_REQUIRED');
  if (text.length > MAX_REASON_LENGTH) throw attendanceError('ATTENDANCE_REASON_TOO_LONG', { max: MAX_REASON_LENGTH });
  return text;
}

/**
 * The attendance of one subject (a Student or the Teacher) for one session (Master Specification §51): PRESENT or ABSENT, unique per (session, subject).
 * The first marking needs no reason. Changing the status of an existing record is a CORRECTION: it needs a non-empty reason, keeps the previous value in the
 * append-only history and publishes AttendanceCorrected. Re-sending the same status changes nothing and publishes nothing. A record is never deleted.
 */
export class AttendanceRecord extends AggregateRoot<string> {
  private constructor(private state: AttendanceRecordSnapshot) {
    super(state.id);
  }

  static record(input: {
    sessionId: string; schoolId: string; groupId: string; subjectType: SubjectType; subjectId: string; status: AttendanceStatus; occurrenceDate: string; scheduledStart: Date;
    actorUserId: string; actorRole: ActorRole; clock: Clock;
  }): AttendanceRecord {
    const now = input.clock.now();
    const record = new AttendanceRecord({
      id: newUuid(), sessionId: input.sessionId, schoolId: input.schoolId, groupId: input.groupId, subjectType: input.subjectType, subjectId: input.subjectId, status: input.status,
      occurrenceDate: input.occurrenceDate, scheduledStart: input.scheduledStart, recordedBy: input.actorUserId, recordedByRole: input.actorRole, recordedAt: now,
      updatedBy: input.actorUserId, updatedByRole: input.actorRole, updatedAt: now,
    });
    record.publish(AttendanceEventTypes.RECORDED, input.clock);
    return record;
  }

  static rehydrate(snapshot: AttendanceRecordSnapshot): AttendanceRecord {
    return new AttendanceRecord(snapshot);
  }

  get snapshot(): AttendanceRecordSnapshot {
    return this.state;
  }

  /** Returns the history entry of the change, or undefined when the status is the same (nothing changes, nothing is published, no reason is needed). */
  correct(input: { status: AttendanceStatus; reason: unknown; actorUserId: string; actorRole: ActorRole; clock: Clock }): AttendanceCorrection | undefined {
    if (input.status === this.state.status) return undefined;
    const reason = normalizeCorrectionReason(input.reason);
    const now = input.clock.now();
    const entry: AttendanceCorrection = {
      id: newUuid(), recordId: this.state.id, sessionId: this.state.sessionId, subjectType: this.state.subjectType, subjectId: this.state.subjectId,
      previousStatus: this.state.status, newStatus: input.status, reason, changedBy: input.actorUserId, changedByRole: input.actorRole, changedAt: now,
    };
    this.state = { ...this.state, status: input.status, updatedBy: input.actorUserId, updatedByRole: input.actorRole, updatedAt: now };
    this.publish(AttendanceEventTypes.CORRECTED, input.clock, { previousStatus: entry.previousStatus, reason });
    return entry;
  }

  private publish(eventType: (typeof AttendanceEventTypes)[keyof typeof AttendanceEventTypes], clock: Clock, extra: { previousStatus?: string; reason?: string } = {}): void {
    const s = this.state;
    this.addDomainEvent(
      createDomainEvent<AttendanceEventPayload>(
        {
          eventType,
          aggregateType: ATTENDANCE_AGGREGATE_TYPE,
          aggregateId: s.id,
          payload: { recordId: s.id, sessionId: s.sessionId, schoolId: s.schoolId, groupId: s.groupId, subjectType: s.subjectType, subjectId: s.subjectId, status: s.status, actorUserId: s.updatedBy, actorRole: s.updatedByRole, ...extra },
        },
        clock,
      ),
    );
  }
}
