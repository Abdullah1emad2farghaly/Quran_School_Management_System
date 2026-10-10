/**
 * Public event contracts of Module 13. Payloads carry identifiers only; consumers load the organization
 * through the public OrganizationService contract.
 *  - OrganizationCreated: emitted once, in the same transaction that inserts the organization.
 */
export const OrganizationEventTypes = {
  ORGANIZATION_CREATED: 'OrganizationCreated',
} as const;
export type OrganizationEventType = (typeof OrganizationEventTypes)[keyof typeof OrganizationEventTypes];

export const ORGANIZATION_AGGREGATE_TYPE = 'Organization';

export interface OrganizationEventPayload {
  readonly organizationId: string;
  readonly code: string;
}
