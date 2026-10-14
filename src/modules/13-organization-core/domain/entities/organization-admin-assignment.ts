import { AggregateRoot, newUuid, type Clock } from '../../../00-shared-kernel/public';
import { createDomainEvent } from '../../../06-domain-events-outbox/public';
import { ORGANIZATION_ADMIN_AGGREGATE_TYPE, OrganizationEventTypes, type OrganizationAdminAssignedPayload } from '../events/organization-events';

export interface OrganizationAdminAssignmentSnapshot {
  readonly id: string;
  readonly organizationId: string;
  readonly userId: string;
  /** The name typed at registration (IAM has no name field). */
  readonly name: string | null;
  readonly assignedAt: Date;
  /** The acting user; null when the administrator registered the organization themselves. */
  readonly assignedBy: string | null;
  readonly revokedAt: Date | null;
  readonly revokedBy: string | null;
  readonly version: number;
}

/**
 * The organization scope of the MAIN_ADMIN role: this user administers THIS organization (and no other through this link).
 * Module 09 role assignments carry no scope; this link, not the role alone, is what ties a Main Admin to an organization.
 * History is kept (assigned/revoked), rows are never deleted. At most one active link per organization and user.
 */
export class OrganizationAdminAssignment extends AggregateRoot<string> {
  private constructor(private readonly state: OrganizationAdminAssignmentSnapshot) {
    super(state.id);
  }

  static assign(input: { organizationId: string; userId: string; name?: string | null; assignedBy: string | null; clock: Clock; id?: string }): OrganizationAdminAssignment {
    const assignment = new OrganizationAdminAssignment({
      id: input.id ?? newUuid(),
      organizationId: input.organizationId,
      userId: input.userId,
      name: input.name ?? null,
      assignedAt: input.clock.now(),
      assignedBy: input.assignedBy,
      revokedAt: null,
      revokedBy: null,
      version: 1,
    });
    assignment.addDomainEvent(
      createDomainEvent<OrganizationAdminAssignedPayload>(
        {
          eventType: OrganizationEventTypes.ORGANIZATION_ADMIN_ASSIGNED,
          aggregateType: ORGANIZATION_ADMIN_AGGREGATE_TYPE,
          aggregateId: assignment.id,
          payload: { assignmentId: assignment.id, organizationId: input.organizationId, userId: input.userId },
        },
        input.clock,
      ),
    );
    return assignment;
  }

  static rehydrate(snapshot: OrganizationAdminAssignmentSnapshot): OrganizationAdminAssignment {
    return new OrganizationAdminAssignment(snapshot);
  }

  get snapshot(): OrganizationAdminAssignmentSnapshot {
    return this.state;
  }
  get organizationId(): string {
    return this.state.organizationId;
  }
  get userId(): string {
    return this.state.userId;
  }
  get isActive(): boolean {
    return this.state.revokedAt === null;
  }
}
