/** Approved statuses. No transition operations exist yet: none are defined by the specification. */
export const ORGANIZATION_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type OrganizationStatus = (typeof ORGANIZATION_STATUSES)[number];

export function isOrganizationStatus(value: unknown): value is OrganizationStatus {
  return typeof value === 'string' && (ORGANIZATION_STATUSES as readonly string[]).includes(value);
}
