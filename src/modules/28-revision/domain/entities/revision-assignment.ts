import { AggregateRoot, newUuid, type Clock } from '../../../00-shared-kernel/public';
import { createDomainEvent } from '../../../06-domain-events-outbox/public';
import { REVISION_ASSIGNMENT_AGGREGATE_TYPE, RevisionEventTypes, type RevisionAssignmentEventPayload } from '../events/revision-events';
import { GROUP_SUBJECT_KEY, type AssignmentAction, type AssignmentStatus, type RevisionRange } from '../value-objects/revision-range';

export interface RevisionAssignmentSnapshot {
  readonly id: string;
  readonly schoolId: string;
  readonly groupId: string;
  /** null = the ONE shared assignment of a GROUP-mode group. */
  readonly studentId: string | null;
  /** The (current) session during which the Teacher defined this assignment for the NEXT actual session. */
  readonly definedInSessionId: string;
  readonly definedByTeacherId: string;
  readonly definedByUserId: string;
  readonly range: RevisionRange;
  readonly status: AssignmentStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** One entry of the append-only history of assignment changes (made only while the defining session is in progress): never updated, never deleted. */
export interface AssignmentHistoryEntry {
  readonly id: string;
  readonly assignmentId: string;
  readonly sessionId: string;
  readonly action: AssignmentAction;
  readonly previousRange: RevisionRange | null;
  readonly newRange: RevisionRange | null;
  readonly changedBy: string;
  readonly changedAt: Date;
}

export const subjectKeyOf = (studentId: string | null): string => studentId ?? GROUP_SUBJECT_KEY;

/**
 * The revision assignment of the NEXT session (Master Specification §49, approved Module 28 decisions). It is attached to the group (shared) or to one student
 * (INDIVIDUAL group), NOT to a session id: it stays available for the next actual session, so a cancelled, rescheduled or Teacher-absent target session never discards
 * it. It can be modified or cancelled only while the defining session is IN_PROGRESS (the service checks that); after that it is final. Never deleted.
 */
export class RevisionAssignment extends AggregateRoot<string> {
  private constructor(private state: RevisionAssignmentSnapshot) {
    super(state.id);
  }

  static define(input: {
    schoolId: string; groupId: string; studentId: string | null; definedInSessionId: string; teacherId: string; actorUserId: string; range: RevisionRange; clock: Clock;
  }): { assignment: RevisionAssignment; history: AssignmentHistoryEntry } {
    const now = input.clock.now();
    const assignment = new RevisionAssignment({
      id: newUuid(), schoolId: input.schoolId, groupId: input.groupId, studentId: input.studentId, definedInSessionId: input.definedInSessionId, definedByTeacherId: input.teacherId,
      definedByUserId: input.actorUserId, range: input.range, status: 'ACTIVE', createdAt: now, updatedAt: now,
    });
    assignment.publish(RevisionEventTypes.ASSIGNMENT_DEFINED, input.clock);
    return { assignment, history: assignment.entry('DEFINED', null, input.range, input.actorUserId, now) };
  }

  static rehydrate(snapshot: RevisionAssignmentSnapshot): RevisionAssignment {
    return new RevisionAssignment(snapshot);
  }

  get snapshot(): RevisionAssignmentSnapshot {
    return this.state;
  }

  modify(input: { range: RevisionRange; actorUserId: string; clock: Clock }): AssignmentHistoryEntry {
    const now = input.clock.now();
    const entry = this.entry('MODIFIED', this.state.range, input.range, input.actorUserId, now);
    this.state = { ...this.state, range: input.range, updatedAt: now };
    this.publish(RevisionEventTypes.ASSIGNMENT_MODIFIED, input.clock, input.actorUserId);
    return entry;
  }

  cancel(input: { actorUserId: string; clock: Clock }): AssignmentHistoryEntry {
    const now = input.clock.now();
    const entry = this.entry('CANCELLED', this.state.range, null, input.actorUserId, now);
    this.state = { ...this.state, status: 'CANCELLED', updatedAt: now };
    this.publish(RevisionEventTypes.ASSIGNMENT_CANCELLED, input.clock, input.actorUserId);
    return entry;
  }

  private entry(action: AssignmentAction, previous: RevisionRange | null, next: RevisionRange | null, actor: string, at: Date): AssignmentHistoryEntry {
    return { id: newUuid(), assignmentId: this.state.id, sessionId: this.state.definedInSessionId, action, previousRange: previous, newRange: next, changedBy: actor, changedAt: at };
  }

  private publish(eventType: (typeof RevisionEventTypes)[keyof typeof RevisionEventTypes], clock: Clock, actor?: string): void {
    const s = this.state;
    this.addDomainEvent(
      createDomainEvent<RevisionAssignmentEventPayload>(
        {
          eventType, aggregateType: REVISION_ASSIGNMENT_AGGREGATE_TYPE, aggregateId: s.id,
          payload: { assignmentId: s.id, schoolId: s.schoolId, groupId: s.groupId, studentId: s.studentId, definedInSessionId: s.definedInSessionId, actorUserId: actor ?? s.definedByUserId },
        },
        clock,
      ),
    );
  }
}
