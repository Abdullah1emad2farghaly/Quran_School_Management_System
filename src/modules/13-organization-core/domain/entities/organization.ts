import { AggregateRoot, isUuid, newUuid, type Clock } from '../../../00-shared-kernel/public';
import { createDomainEvent } from '../../../06-domain-events-outbox/public';
import { organizationError } from '../errors/organization-errors';
import {
  ORGANIZATION_AGGREGATE_TYPE,
  OrganizationEventTypes,
  type OrganizationCountryAssignedPayload,
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
  /** `countries.id` (primary key), `null` until assigned. */
  readonly countryId: string | null;
  /** The organization's OWN address (governorate required for every new organization; null only for organizations created before addresses existed). */
  readonly governorateId: string | null;
  /** Free text (never a registered node): the center or city name. */
  readonly centerName: string | null;
  /** Free text; a village never exists without a center. */
  readonly villageName: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * The Main Organization (V1: exactly one). Approved business fields: id, code, name, status and the country.
 * Not deleted, and no status transitions are defined yet.
 * The country is IMMUTABLE once assigned (V1): `assignCountry` is the only way to set it.
 */
export class Organization extends AggregateRoot<string> {
  private constructor(private state: OrganizationSnapshot) {
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
      countryId: null,
      governorateId: null,
      centerName: null,
      villageName: null,
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

  /**
   * A new organization with its required country and its own address (the geographic relationships are validated by the
   * caller against Geography: the governorate/center/village must belong to this country). Starts ACTIVE (the existing
   * lifecycle: ACTIVE/INACTIVE only, no approval step is specified). The country is immutable once set.
   */
  static register(input: {
    name: string;
    code: string;
    countryId: unknown;
    governorateId: unknown;
    /** Free text, already normalized by the caller (Module 15 address rules); null/omitted when missing. */
    centerName?: unknown;
    villageName?: unknown;
    clock: Clock;
    id?: string;
  }): Organization {
    if (!isOrganizationCode(input.code)) throw new RangeError('Invalid organization code');
    const name = normalizeOrganizationName(input.name);
    if (!isUuid(input.countryId)) throw organizationError('ORGANIZATION_COUNTRY_INVALID');
    const centerName = input.centerName ?? null;
    const villageName = input.villageName ?? null;
    const isText = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
    if (!isUuid(input.governorateId) || (centerName !== null && !isText(centerName)) || (villageName !== null && !isText(villageName)) || (villageName !== null && centerName === null)) {
      throw organizationError('INVALID_ORGANIZATION_ADDRESS');
    }
    const now = input.clock.now();
    const organization = new Organization({
      id: input.id ?? newUuid(),
      code: input.code,
      name,
      status: 'ACTIVE',
      countryId: input.countryId,
      governorateId: input.governorateId,
      centerName: centerName as string | null,
      villageName: villageName as string | null,
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
    if (snapshot.countryId !== null && !isUuid(snapshot.countryId)) throw new Error('Corrupt organization record');
    return new Organization(snapshot);
  }

  /**
   * Assigns the country (`countries.id`, a UUID: a country code such as CNT-000001 is NOT accepted).
   * - no country yet: sets it, records `OrganizationCountryAssigned`, returns true;
   * - the same country again: idempotent, nothing changes and no event is recorded, returns false;
   * - a different country: rejected (ORGANIZATION_COUNTRY_ALREADY_SET), nothing changes.
   */
  assignCountry(countryId: unknown, clock: Clock): boolean {
    if (!isUuid(countryId)) throw organizationError('ORGANIZATION_COUNTRY_INVALID');
    if (this.state.countryId !== null) {
      if (this.state.countryId.toLowerCase() === countryId.toLowerCase()) return false;
      throw organizationError('ORGANIZATION_COUNTRY_ALREADY_SET');
    }
    this.state = { ...this.state, countryId, updatedAt: clock.now() };
    this.addDomainEvent(
      createDomainEvent<OrganizationCountryAssignedPayload>(
        {
          eventType: OrganizationEventTypes.ORGANIZATION_COUNTRY_ASSIGNED,
          aggregateType: ORGANIZATION_AGGREGATE_TYPE,
          aggregateId: this.id,
          payload: { organizationId: this.id, countryId },
        },
        clock,
      ),
    );
    return true;
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
  get countryId(): string | null {
    return this.state.countryId;
  }
  get governorateId(): string | null {
    return this.state.governorateId;
  }
  get centerName(): string | null {
    return this.state.centerName;
  }
  get villageName(): string | null {
    return this.state.villageName;
  }
  get createdAt(): Date {
    return this.state.createdAt;
  }
  get updatedAt(): Date {
    return this.state.updatedAt;
  }
}
