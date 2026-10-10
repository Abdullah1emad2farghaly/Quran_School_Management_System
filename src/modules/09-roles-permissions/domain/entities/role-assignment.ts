import { AggregateRoot, newUuid, type Clock } from '../../../00-shared-kernel/public';
import { createDomainEvent } from '../../../06-domain-events-outbox/public';
import { roleError } from '../errors/role-errors';
import { RoleEventTypes, ROLE_ASSIGNMENT_AGGREGATE_TYPE, type RoleEventPayload } from '../events/role-events';
import { isAssignableRole, isRoleCode, type RoleCode } from '../value-objects/role-code';

export interface RoleAssignmentSnapshot {
  readonly id: string;
  readonly userId: string;
  readonly roleCode: RoleCode;
  readonly assignedAt: Date;
  /** `null` means the system itself (for example the first Main Admin created by a setup script). */
  readonly assignedBy: string | null;
  readonly revokedAt: Date | null;
  readonly revokedBy: string | null;
  /** Optimistic-lock counter, incremented by the repository on every update. */
  readonly version: number;
}

/**
 * One row of role history (Master Specification §19): who got which role, when, and from whom,
 * and when/by whom it was revoked. Assignments are never deleted; re-assigning a revoked role
 * creates a NEW assignment so the earlier period stays in the history.
 */
export class RoleAssignment extends AggregateRoot<string> {
  private constructor(private state: RoleAssignmentSnapshot) {
    super(state.id);
  }

  static assign(input: { userId: string; roleCode: RoleCode; assignedBy: string | null; clock: Clock; id?: string }): RoleAssignment {
    if (!isRoleCode(input.roleCode)) throw roleError('INVALID_ROLE');
    if (!isAssignableRole(input.roleCode)) throw roleError('ROLE_NOT_ASSIGNABLE');
    const assignment = new RoleAssignment({
      id: input.id ?? newUuid(),
      userId: input.userId,
      roleCode: input.roleCode,
      assignedAt: input.clock.now(),
      assignedBy: input.assignedBy,
      revokedAt: null,
      revokedBy: null,
      version: 1,
    });
    assignment.record(RoleEventTypes.ROLE_ASSIGNED, input.clock);
    return assignment;
  }

  static rehydrate(snapshot: RoleAssignmentSnapshot): RoleAssignment {
    return new RoleAssignment(snapshot);
  }

  get userId(): string {
    return this.state.userId;
  }
  get roleCode(): RoleCode {
    return this.state.roleCode;
  }
  get assignedAt(): Date {
    return this.state.assignedAt;
  }
  get assignedBy(): string | null {
    return this.state.assignedBy;
  }
  get revokedAt(): Date | null {
    return this.state.revokedAt;
  }
  get revokedBy(): string | null {
    return this.state.revokedBy;
  }
  get version(): number {
    return this.state.version;
  }
  get isActive(): boolean {
    return this.state.revokedAt === null;
  }

  revoke(revokedBy: string | null, clock: Clock): void {
    if (!this.isActive) throw roleError('ROLE_ASSIGNMENT_NOT_FOUND');
    this.state = { ...this.state, revokedAt: clock.now(), revokedBy };
    this.record(RoleEventTypes.ROLE_REVOKED, clock);
  }

  private record(eventType: string, clock: Clock): void {
    this.addDomainEvent(
      createDomainEvent<RoleEventPayload>(
        {
          eventType,
          aggregateType: ROLE_ASSIGNMENT_AGGREGATE_TYPE,
          aggregateId: this.id,
          payload: { assignmentId: this.id, userId: this.state.userId, roleCode: this.state.roleCode },
        },
        clock,
      ),
    );
  }
}
