/**
 * Public event contracts of Module 13. Payloads carry identifiers only; consumers load the organization
 * through the public OrganizationService contract.
 *  - OrganizationCreated: emitted once, in the same transaction that inserts the organization.
 *  - OrganizationCountryAssigned: emitted once, in the same transaction that sets the (immutable) country. Never on a
 *    repeated assignment of the same country.
 */
export const OrganizationEventTypes = {
  ORGANIZATION_CREATED: 'OrganizationCreated',
  ORGANIZATION_COUNTRY_ASSIGNED: 'OrganizationCountryAssigned',
  ORGANIZATION_ADMIN_ASSIGNED: 'OrganizationAdminAssigned',
} as const;
export type OrganizationEventType = (typeof OrganizationEventTypes)[keyof typeof OrganizationEventTypes];

export const ORGANIZATION_AGGREGATE_TYPE = 'Organization';

export interface OrganizationEventPayload {
  readonly organizationId: string;
  readonly code: string;
}

/** Identifiers only (`countryId` is the primary key of the countries row, not its code). */
export interface OrganizationCountryAssignedPayload {
  readonly organizationId: string;
  readonly countryId: string;
}

export const ORGANIZATION_ADMIN_AGGREGATE_TYPE = 'OrganizationAdminAssignment';

/** Identifiers only: which user was linked as administrator (organization scope of the MAIN_ADMIN role) of which organization. */
export interface OrganizationAdminAssignedPayload {
  readonly assignmentId: string;
  readonly organizationId: string;
  readonly userId: string;
}
