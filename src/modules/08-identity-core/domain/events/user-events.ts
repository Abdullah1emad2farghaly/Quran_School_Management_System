/**
 * Public event contracts of Module 08. Payloads NEVER contain passwords, hashes or phone
 * numbers; consumers that need more load the user through the public IdentityService.
 *  - UserDeactivated: Module 10 revokes the user's active sessions when it receives this.
 */
export const IdentityEventTypes = {
  USER_CREATED: 'UserCreated',
  USER_DEACTIVATED: 'UserDeactivated',
  USER_ACTIVATED: 'UserActivated',
  USER_PASSWORD_CHANGED: 'UserPasswordChanged',
} as const;
export type IdentityEventType = (typeof IdentityEventTypes)[keyof typeof IdentityEventTypes];

export const USER_AGGREGATE_TYPE = 'User';

export interface UserEventPayload {
  readonly userId: string;
}
