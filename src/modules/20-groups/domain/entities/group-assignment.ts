import { AggregateRoot, newUuid, type Clock } from '../../../00-shared-kernel/public';
import { createDomainEvent } from '../../../06-domain-events-outbox/public';
import { GROUP_ASSIGNMENT_AGGREGATE_TYPE, GroupEventTypes, type GroupEventPayload } from '../events/group-events';

export const ASSIGNMENT_END_REASONS = ['MANUAL', 'MOVED', 'GROUP_ARCHIVED', 'STUDENT_ARCHIVED'] as const;
export type AssignmentEndReason = (typeof ASSIGNMENT_END_REASONS)[number];

export interface GroupAssignmentSnapshot {
  readonly id: string;
  readonly groupId: string;
  readonly studentId: string;
  /** Denormalized (the group's school and organization) for events and reads; the student must belong to the same school. */
  readonly schoolId: string;
  readonly organizationId: string;
  readonly assignedAt: Date;
  readonly assignedBy: string;
  readonly unassignedAt: Date | null;
  /** null when the system ended it (the student was archived) or while it is still current. */
  readonly unassignedBy: string | null;
  readonly endReason: AssignmentEndReason | null;
}

/**
 * One period of a student in one group (Master Specification §36/§39/§68): the assignment history is never rewritten, a move ends one period
 * and starts another. `isCurrent` is true while `unassignedAt` is null. A student has at most ONE current assignment (unique index).
 */
export class GroupAssignment extends AggregateRoot<string> {
  private constructor(private state: GroupAssignmentSnapshot) {
    super(state.id);
  }

  static start(input: { groupId: string; studentId: string; schoolId: string; organizationId: string; assignedBy: string; clock: Clock }): GroupAssignment {
    const a = new GroupAssignment({
      id: newUuid(),
      groupId: input.groupId,
      studentId: input.studentId,
      schoolId: input.schoolId,
      organizationId: input.organizationId,
      assignedAt: input.clock.now(),
      assignedBy: input.assignedBy,
      unassignedAt: null,
      unassignedBy: null,
      endReason: null,
    });
    a.recordEvent(GroupEventTypes.GROUP_STUDENT_ASSIGNED, input.assignedBy, input.clock);
    return a;
  }

  static rehydrate(snapshot: GroupAssignmentSnapshot): GroupAssignment {
    return new GroupAssignment(snapshot);
  }

  get snapshot(): GroupAssignmentSnapshot {
    return this.state;
  }
  get isCurrent(): boolean {
    return this.state.unassignedAt === null;
  }

  /** Ends the period. `actorId` is null when the system ends it (the student was archived). Ending an ended period is a no-op returning false. */
  end(reason: AssignmentEndReason, actorId: string | null, clock: Clock): boolean {
    if (!this.isCurrent) return false;
    this.state = { ...this.state, unassignedAt: clock.now(), unassignedBy: actorId, endReason: reason };
    this.recordEvent(GroupEventTypes.GROUP_STUDENT_UNASSIGNED, actorId, clock, { reason });
    return true;
  }

  private recordEvent(eventType: (typeof GroupEventTypes)[keyof typeof GroupEventTypes], actorId: string | null, clock: Clock, extra: Partial<GroupEventPayload> = {}): void {
    this.addDomainEvent(
      createDomainEvent<GroupEventPayload>(
        {
          eventType,
          aggregateType: GROUP_ASSIGNMENT_AGGREGATE_TYPE,
          aggregateId: this.id,
          payload: { groupId: this.state.groupId, schoolId: this.state.schoolId, organizationId: this.state.organizationId, actorId, studentId: this.state.studentId, ...extra },
        },
        clock,
      ),
    );
  }
}
