/** Why a session ended. Kept in the history; `REFRESH_TOKEN_REUSE` marks a security violation. */
export const SESSION_REVOKE_REASONS = [
  'LOGIN_REPLACED', // LEGACY: produced only by the former one-session model; kept so historical rows stay valid. A new login never revokes a session any more.
  'LOGOUT',
  'LOGOUT_ALL',
  'USER_DEACTIVATED',
  'PASSWORD_RESET', // used by Module 11
  'REFRESH_TOKEN_REUSE',
  'SESSION_EXPIRED', // the session's refresh token expired (30 days without a refresh)
  'DEVICE_REVOKED', // the user revoked this session from "My devices"
  'PASSWORD_CHANGED', // the user changed their password from another session: every OTHER session is revoked
] as const;
export type SessionRevokeReason = (typeof SESSION_REVOKE_REASONS)[number];
