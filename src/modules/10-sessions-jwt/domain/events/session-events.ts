/**
 * Public event contracts of Module 10. Named "AuthSession..." so they never collide with the
 * teaching-session events of Module 24. Payloads carry ids and the reason only: never tokens or hashes.
 */
export const SessionEventTypes = {
  AUTH_SESSION_STARTED: 'AuthSessionStarted',
  AUTH_SESSION_REVOKED: 'AuthSessionRevoked',
} as const;
export type SessionEventType = (typeof SessionEventTypes)[keyof typeof SessionEventTypes];

export const AUTH_SESSION_AGGREGATE_TYPE = 'AuthSession';

export interface AuthSessionEventPayload {
  readonly sessionId: string;
  readonly userId: string;
  /** Present on AuthSessionRevoked. */
  readonly reason?: string;
}
