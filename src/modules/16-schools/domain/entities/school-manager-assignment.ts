import { AggregateRoot, newUuid, type Clock } from '../../../00-shared-kernel/public';
import { createDomainEvent } from '../../../06-domain-events-outbox/public';
import { SCHOOL_MANAGER_AGGREGATE_TYPE, SchoolEventTypes, type SchoolManagerEventPayload } from '../events/school-events';

export const SCHOOL_MANAGER_SOURCES = ['APPROVAL', 'ASSIGNMENT'] as const;
export type SchoolManagerSource = (typeof SCHOOL_MANAGER_SOURCES)[number];

export interface SchoolManagerAssignmentSnapshot {
  readonly id: string;
  readonly schoolId: string;
  readonly userId: string;
  readonly source: SchoolManagerSource;
  readonly assignedAt: Date;
  /** The organization manager who approved the school (APPROVAL) or made the assignment (ASSIGNMENT). */
  readonly assignedBy: string;
  readonly revokedAt: Date | null;
  readonly revokedBy: string | null;
  readonly version: number;
}

/**
 * A school-scoped manager link with history (same pattern as Module 09 role assignments: never deleted,
 * assignedAt/assignedBy/revokedAt/revokedBy). At most ONE active link per school (enforced here and by the database);
 * one user may hold several links (one per school they manage). This link, not the SCHOOL_MANAGER role alone,
 * is what ties a manager to a school.
 */
export class SchoolManagerAssignment extends AggregateRoot<string> {
  private constructor(private state: SchoolManagerAssignmentSnapshot) {
    super(state.id);
  }

  static assign(input: { schoolId: string; userId: string; source: SchoolManagerSource; assignedBy: string; clock: Clock; id?: string }): SchoolManagerAssignment {
    const assignment = new SchoolManagerAssignment({
      id: input.id ?? newUuid(),
      schoolId: input.schoolId,
      userId: input.userId,
      source: input.source,
      assignedAt: input.clock.now(),
      assignedBy: input.assignedBy,
      revokedAt: null,
      revokedBy: null,
      version: 1,
    });
    assignment.record(SchoolEventTypes.SCHOOL_MANAGER_ASSIGNED, input.assignedBy, input.clock);
    return assignment;
  }

  static rehydrate(snapshot: SchoolManagerAssignmentSnapshot): SchoolManagerAssignment {
    return new SchoolManagerAssignment(snapshot);
  }

  revoke(revokedBy: string, clock: Clock): void {
    if (this.state.revokedAt !== null) throw new Error('Assignment already revoked');
    this.state = { ...this.state, revokedAt: clock.now(), revokedBy };
    this.record(SchoolEventTypes.SCHOOL_MANAGER_REVOKED, revokedBy, clock);
  }

  private record(eventType: typeof SchoolEventTypes.SCHOOL_MANAGER_ASSIGNED | typeof SchoolEventTypes.SCHOOL_MANAGER_REVOKED, actorId: string, clock: Clock): void {
    this.addDomainEvent(
      createDomainEvent<SchoolManagerEventPayload>(
        {
          eventType,
          aggregateType: SCHOOL_MANAGER_AGGREGATE_TYPE,
          aggregateId: this.id,
          payload: { assignmentId: this.id, schoolId: this.state.schoolId, userId: this.state.userId, actorId },
        },
        clock,
      ),
    );
  }

  get snapshot(): SchoolManagerAssignmentSnapshot {
    return this.state;
  }
  get schoolId(): string {
    return this.state.schoolId;
  }
  get userId(): string {
    return this.state.userId;
  }
  get isActive(): boolean {
    return this.state.revokedAt === null;
  }
  get version(): number {
    return this.state.version;
  }
}
