import { AppError, type ErrorKind } from '../../../00-shared-kernel/public';

export const SessionErrorCodes = {
  AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCOUNT_INACTIVE: 'ACCOUNT_INACTIVE',
  ACCESS_TOKEN_INVALID: 'ACCESS_TOKEN_INVALID',
  ACCESS_TOKEN_EXPIRED: 'ACCESS_TOKEN_EXPIRED',
  SESSION_REVOKED: 'SESSION_REVOKED',
  REFRESH_TOKEN_INVALID: 'REFRESH_TOKEN_INVALID',
  REFRESH_TOKEN_EXPIRED: 'REFRESH_TOKEN_EXPIRED',
  REFRESH_TOKEN_REUSED: 'REFRESH_TOKEN_REUSED',
  SESSION_CONCURRENT_MODIFICATION: 'SESSION_CONCURRENT_MODIFICATION',
  /** The account already has the maximum number of active sessions (3); the user must log out of one device first. Nothing is revoked automatically. */
  SESSION_LIMIT_REACHED: 'SESSION_LIMIT_REACHED',
  /** "My devices": no active session of the caller's account has this id (unknown, another account's or already ended: all the same answer). */
  SESSION_NOT_FOUND: 'SESSION_NOT_FOUND',
  /** The account still has an initial password that must be changed first: only the password change and logout are allowed. */
  PASSWORD_CHANGE_REQUIRED: 'PASSWORD_CHANGE_REQUIRED',
  /** The current password given to the password change is wrong. */
  CURRENT_PASSWORD_INCORRECT: 'CURRENT_PASSWORD_INCORRECT',
  /** `POST /auth/switch-role`: the account does not hold the requested role (never assigned, or already revoked). */
  ROLE_NOT_ASSIGNED: 'ROLE_NOT_ASSIGNED',
  /** The new password equals the current one, so nothing would change. */
  NEW_PASSWORD_SAME_AS_CURRENT: 'NEW_PASSWORD_SAME_AS_CURRENT',
} as const;
export type SessionErrorCode = (typeof SessionErrorCodes)[keyof typeof SessionErrorCodes];

const KIND: Record<SessionErrorCode, ErrorKind> = {
  AUTHENTICATION_REQUIRED: 'UNAUTHENTICATED',
  INVALID_CREDENTIALS: 'UNAUTHENTICATED',
  ACCOUNT_INACTIVE: 'FORBIDDEN',
  ACCESS_TOKEN_INVALID: 'UNAUTHENTICATED',
  ACCESS_TOKEN_EXPIRED: 'UNAUTHENTICATED',
  SESSION_REVOKED: 'UNAUTHENTICATED',
  REFRESH_TOKEN_INVALID: 'UNAUTHENTICATED',
  REFRESH_TOKEN_EXPIRED: 'UNAUTHENTICATED',
  REFRESH_TOKEN_REUSED: 'UNAUTHENTICATED',
  SESSION_CONCURRENT_MODIFICATION: 'CONFLICT',
  SESSION_LIMIT_REACHED: 'BUSINESS_RULE',
  SESSION_NOT_FOUND: 'NOT_FOUND',
  PASSWORD_CHANGE_REQUIRED: 'FORBIDDEN',
  CURRENT_PASSWORD_INCORRECT: 'VALIDATION',
  NEW_PASSWORD_SAME_AS_CURRENT: 'BUSINESS_RULE',
  ROLE_NOT_ASSIGNED: 'FORBIDDEN',
};

export function sessionError(code: SessionErrorCode, details?: unknown): AppError {
  return new AppError(code, KIND[code], details);
}
