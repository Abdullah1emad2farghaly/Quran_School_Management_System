/** Why a session ended. Kept in the history; `REFRESH_TOKEN_REUSE` marks a security violation. */
export const SESSION_REVOKE_REASONS = [
  'LOGIN_REPLACED', // a newer login replaced it (only one active session per user)
  'LOGOUT',
  'LOGOUT_ALL',
  'USER_DEACTIVATED',
  'PASSWORD_RESET', // used by Module 11
  'REFRESH_TOKEN_REUSE',
] as const;
export type SessionRevokeReason = (typeof SESSION_REVOKE_REASONS)[number];
