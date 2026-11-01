import { AggregateRoot, newUuid, type Clock } from '../../../00-shared-kernel/public';
import { createDomainEvent } from '../../../06-domain-events-outbox/public';
import { MEMORIZATION_ASSIGNMENT_AGGREGATE_TYPE, MemorizationEventTypes, type MemorizationAssignmentEventPayload } from '../events/memorization-events';
import { GROUP_SUBJECT_KEY, type AssignmentAction, type AssignmentStatus, type MemorizationRange } from '../value-objects/memorization-range';

export interface MemorizationAssignmentSnapshot {
  readonly id: string;
  readonly schoolId: string;
  readonly groupId: string;
  /** null = the ONE shared assignment of a GROUP-mode group. */
  readonly studentId: string | null;
  /** The (current) session during which the Teacher defined this assignment for the NEXT actual session. */
  readonly definedInSessionId: string;
  readonly definedByTeacherId: string;
  readonly definedByUserId: string;
  readonly range: MemorizationRange;
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
  readonly previousRange: MemorizationRange | null;
  readonly newRange: MemorizationRange | null;
  readonly changedBy: string;
  readonly changedAt: Date;
}

export const subjectKeyOf = (studentId: string | null): string => studentId ?? GROUP_SUBJECT_KEY;

/**
 * The memorization assignment of the NEXT session (Master Specification §48, approved Module 27 decisions). It is attached to the group (shared) or to one student
 * (INDIVIDUAL group), NOT to a session id: it stays available for the next actual session, so a cancelled, rescheduled or Teacher-absent target session never discards
 * it. It can be modified or cancelled only while the defining session is IN_PROGRESS (the service checks that); after that it is final. Never deleted.
 */
export class MemorizationAssignment extends AggregateRoot<string> {
  private constructor(private state: MemorizationAssignmentSnapshot) {
    super(state.id);
  }

  static define(input: {
    schoolId: string; groupId: string; studentId: string | null; definedInSessionId: string; teacherId: string; actorUserId: string; range: MemorizationRange; clock: Clock;
  }): { assignment: MemorizationAssignment; history: AssignmentHistoryEntry } {
    const now = input.clock.now();
    const assignment = new MemorizationAssignment({
      id: newUuid(), schoolId: input.schoolId, groupId: input.groupId, studentId: input.studentId, definedInSessionId: input.definedInSessionId, definedByTeacherId: input.teacherId,
      definedByUserId: input.actorUserId, range: input.range, status: 'ACTIVE', createdAt: now, updatedAt: now,
    });
    assignment.publish(MemorizationEventTypes.ASSIGNMENT_DEFINED, input.clock);
    return { assignment, history: assignment.entry('DEFINED', null, input.range, input.actorUserId, now) };
  }

  static rehydrate(snapshot: MemorizationAssignmentSnapshot): MemorizationAssignment {
    return new MemorizationAssignment(snapshot);
  }

  get snapshot(): MemorizationAssignmentSnapshot {
    return this.state;
  }

  modify(input: { range: MemorizationRange; actorUserId: string; clock: Clock }): AssignmentHistoryEntry {
    const now = input.clock.now();
    const entry = this.entry('MODIFIED', this.state.range, input.range, input.actorUserId, now);
    this.state = { ...this.state, range: input.range, updatedAt: now };
    this.publish(MemorizationEventTypes.ASSIGNMENT_MODIFIED, input.clock, input.actorUserId);
    return entry;
  }

  cancel(input: { actorUserId: string; clock: Clock }): AssignmentHistoryEntry {
    const now = input.clock.now();
    const entry = this.entry('CANCELLED', this.state.range, null, input.actorUserId, now);
    this.state = { ...this.state, status: 'CANCELLED', updatedAt: now };
    this.publish(MemorizationEventTypes.ASSIGNMENT_CANCELLED, input.clock, input.actorUserId);
    return entry;
  }

  private entry(action: AssignmentAction, previous: MemorizationRange | null, next: MemorizationRange | null, actor: string, at: Date): AssignmentHistoryEntry {
    return { id: newUuid(), assignmentId: this.state.id, sessionId: this.state.definedInSessionId, action, previousRange: previous, newRange: next, changedBy: actor, changedAt: at };
  }

  private publish(eventType: (typeof MemorizationEventTypes)[keyof typeof MemorizationEventTypes], clock: Clock, actor?: string): void {
    const s = this.state;
    this.addDomainEvent(
      createDomainEvent<MemorizationAssignmentEventPayload>(
        {
          eventType, aggregateType: MEMORIZATION_ASSIGNMENT_AGGREGATE_TYPE, aggregateId: s.id,
          payload: { assignmentId: s.id, schoolId: s.schoolId, groupId: s.groupId, studentId: s.studentId, definedInSessionId: s.definedInSessionId, actorUserId: actor ?? s.definedByUserId },
        },
        clock,
      ),
    );
  }
}
