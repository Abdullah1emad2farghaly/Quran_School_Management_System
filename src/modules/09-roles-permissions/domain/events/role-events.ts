/**
 * Public event contracts of Module 09. Module 10 (sessions) can use them to refresh a user's
 * roles. Payloads carry ids and the role code only.
 */
export const RoleEventTypes = {
  ROLE_ASSIGNED: 'RoleAssigned',
  ROLE_REVOKED: 'RoleRevoked',
} as const;
export type RoleEventType = (typeof RoleEventTypes)[keyof typeof RoleEventTypes];

export const ROLE_ASSIGNMENT_AGGREGATE_TYPE = 'RoleAssignment';

export interface RoleEventPayload {
  readonly assignmentId: string;
  readonly userId: string;
  readonly roleCode: string;
}
