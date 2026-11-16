import { AggregateRoot, newUuid, type Clock } from '../../../00-shared-kernel/public';
import { createDomainEvent } from '../../../06-domain-events-outbox/public';
import { REVISION_RECORD_AGGREGATE_TYPE, RevisionEventTypes, type RevisionRecordEventPayload } from '../events/revision-events';
import { revisionError } from '../errors/revision-errors';
import { MAX_REASON_LENGTH, sameQuranRange, type RevisionRange } from '../value-objects/revision-range';

export interface RevisionRecordSnapshot {
  readonly id: string;
  readonly sessionId: string;
  readonly schoolId: string;
  readonly groupId: string;
  readonly studentId: string;
  /** The scheduled assignment this record was evaluated against (the one in effect for the student when it was recorded); null when nothing was scheduled. */
  readonly assignmentId: string | null;
  /** The range the student actually revised. */
  readonly range: RevisionRange;
  /** true: the range is exactly the assigned range (fulfilment). false: a different range (NOT fulfilment). null: no scheduled assignment. Computed by the system, never sent by a client. */
  readonly matchesAssignment: boolean | null;
  readonly recordedBy: string;
  readonly recordedAt: Date;
  readonly updatedBy: string;
  readonly updatedAt: Date;
}

/** One entry of the append-only correction history: the ORIGINAL (previous) value and the new one. Never updated, never deleted. */
export interface RevisionCorrection {
  readonly id: string;
  readonly recordId: string;
  readonly sessionId: string;
  readonly studentId: string;
  readonly previousRange: RevisionRange;
  readonly newRange: RevisionRange;
  readonly previousMatches: boolean | null;
  readonly newMatches: boolean | null;
  readonly reason: string | null;
  readonly changedBy: string;
  readonly changedAt: Date;
}

/** The optional reason of a correction: trimmed, at most 500 characters; blank = none. */
export function normalizeOptionalReason(reason: unknown): string | null {
  if (reason === undefined || reason === null) return null;
  if (typeof reason !== 'string') throw revisionError('REVISION_INVALID_RECORD');
  const text = reason.trim();
  if (text.length > MAX_REASON_LENGTH) throw revisionError('REVISION_REASON_TOO_LONG', { max: MAX_REASON_LENGTH }, { max: MAX_REASON_LENGTH });
  return text === '' ? null : text;
}

/**
 * One revision record of a student for a session (Master Specification §49). Every record is independent: overlapping ranges, repeated verses and several records
 * for the same student in the same session are all valid. A record is never deleted. Only the session's Teacher may correct it, only while that session is in progress
 * (the service checks that); the original value is kept in the append-only history, so nothing is silently overwritten.
 */
export class RevisionRecord extends AggregateRoot<string> {
  private constructor(private state: RevisionRecordSnapshot) {
    super(state.id);
  }

  static record(input: {
    sessionId: string; schoolId: string; groupId: string; studentId: string; assignmentId: string | null; range: RevisionRange; matchesAssignment: boolean | null; actorUserId: string; clock: Clock;
  }): RevisionRecord {
    const now = input.clock.now();
    const record = new RevisionRecord({
      id: newUuid(), sessionId: input.sessionId, schoolId: input.schoolId, groupId: input.groupId, studentId: input.studentId, assignmentId: input.assignmentId, range: input.range,
      matchesAssignment: input.matchesAssignment, recordedBy: input.actorUserId, recordedAt: now, updatedBy: input.actorUserId, updatedAt: now,
    });
    record.publish(RevisionEventTypes.RECORDED, input.clock);
    return record;
  }

  static rehydrate(snapshot: RevisionRecordSnapshot): RevisionRecord {
    return new RevisionRecord(snapshot);
  }

  get snapshot(): RevisionRecordSnapshot {
    return this.state;
  }

  /** Returns the history entry, or undefined when the corrected range covers exactly the same ayahs (nothing changes, nothing is published). */
  correct(input: { range: RevisionRange; matchesAssignment: boolean | null; reason: unknown; actorUserId: string; clock: Clock }): RevisionCorrection | undefined {
    if (sameQuranRange(input.range, this.state.range)) return undefined;
    const reason = normalizeOptionalReason(input.reason);
    const now = input.clock.now();
    const entry: RevisionCorrection = {
      id: newUuid(), recordId: this.state.id, sessionId: this.state.sessionId, studentId: this.state.studentId, previousRange: this.state.range, newRange: input.range,
      previousMatches: this.state.matchesAssignment, newMatches: input.matchesAssignment, reason, changedBy: input.actorUserId, changedAt: now,
    };
    this.state = { ...this.state, range: input.range, matchesAssignment: input.matchesAssignment, updatedBy: input.actorUserId, updatedAt: now };
    this.publish(RevisionEventTypes.RECORD_CORRECTED, input.clock);
    return entry;
  }

  private publish(eventType: (typeof RevisionEventTypes)[keyof typeof RevisionEventTypes], clock: Clock): void {
    const s = this.state;
    this.addDomainEvent(
      createDomainEvent<RevisionRecordEventPayload>(
        {
          eventType, aggregateType: REVISION_RECORD_AGGREGATE_TYPE, aggregateId: s.id,
          payload: { recordId: s.id, sessionId: s.sessionId, schoolId: s.schoolId, groupId: s.groupId, studentId: s.studentId, assignmentId: s.assignmentId, matchesAssignment: s.matchesAssignment, actorUserId: s.updatedBy },
        },
        clock,
      ),
    );
  }
}
