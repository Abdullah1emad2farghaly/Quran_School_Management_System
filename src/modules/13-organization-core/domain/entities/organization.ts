import { AggregateRoot, newUuid, type Clock } from '../../../00-shared-kernel/public';
import { createDomainEvent } from '../../../06-domain-events-outbox/public';
import {
  ORGANIZATION_AGGREGATE_TYPE,
  OrganizationEventTypes,
  type OrganizationEventPayload,
} from '../events/organization-events';
import { isOrganizationCode } from '../value-objects/organization-code';
import { normalizeOrganizationName } from '../value-objects/organization-name';
import { isOrganizationStatus, type OrganizationStatus } from '../value-objects/organization-status';

export interface OrganizationSnapshot {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly status: OrganizationStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * The Main Organization (V1: exactly one). Only the approved business fields: id, code, name, status.
 * Not deleted, and no status transitions are defined yet.
 */
export class Organization extends AggregateRoot<string> {
  private constructor(private readonly state: OrganizationSnapshot) {
    super(state.id);
  }

  static create(input: { name: string; code: string; clock: Clock; id?: string }): Organization {
    if (!isOrganizationCode(input.code)) throw new RangeError('Invalid organization code');
    const now = input.clock.now();
    const organization = new Organization({
      id: input.id ?? newUuid(),
      code: input.code,
      name: normalizeOrganizationName(input.name),
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    });
    organization.addDomainEvent(
      createDomainEvent<OrganizationEventPayload>(
        {
          eventType: OrganizationEventTypes.ORGANIZATION_CREATED,
          aggregateType: ORGANIZATION_AGGREGATE_TYPE,
          aggregateId: organization.id,
          payload: { organizationId: organization.id, code: organization.code },
        },
        input.clock,
      ),
    );
    return organization;
  }

  /** Loads a stored organization; stored data that breaks the invariants is rejected, never trusted. */
  static rehydrate(snapshot: OrganizationSnapshot): Organization {
    if (!isOrganizationCode(snapshot.code) || !isOrganizationStatus(snapshot.status)) throw new Error('Corrupt organization record');
    return new Organization(snapshot);
  }

  get code(): string {
    return this.state.code;
  }
  get name(): string {
    return this.state.name;
  }
  get status(): OrganizationStatus {
    return this.state.status;
  }
  get createdAt(): Date {
    return this.state.createdAt;
  }
  get updatedAt(): Date {
    return this.state.updatedAt;
  }
}
