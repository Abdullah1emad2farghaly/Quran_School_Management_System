import { AppError, type ErrorKind } from '../../../00-shared-kernel/public';

export const AuthorizationErrorCodes = {
  /** The one client-facing denial. The reason is never revealed to the client. */
  ACCESS_DENIED: 'ACCESS_DENIED',
  MAIN_ADMIN_ALREADY_EXISTS: 'MAIN_ADMIN_ALREADY_EXISTS',
  /** A programming/setup mistake (invalid policy, duplicate resolver, missing bootstrap lock row...). Never client data. */
  AUTHORIZATION_CONFIGURATION_ERROR: 'AUTHORIZATION_CONFIGURATION_ERROR',
} as const;
export type AuthorizationErrorCode = (typeof AuthorizationErrorCodes)[keyof typeof AuthorizationErrorCodes];

const KIND: Record<AuthorizationErrorCode, ErrorKind> = {
  ACCESS_DENIED: 'FORBIDDEN',
  MAIN_ADMIN_ALREADY_EXISTS: 'CONFLICT',
  AUTHORIZATION_CONFIGURATION_ERROR: 'INTERNAL',
};

export function authorizationError(code: AuthorizationErrorCode, details?: unknown): AppError {
  return new AppError(code, KIND[code], details);
}

/** For setup mistakes. `detail` names the problem for the developer (it is hidden from API clients by the error handler). */
export function authorizationConfigError(detail: string): AppError {
  return authorizationError('AUTHORIZATION_CONFIGURATION_ERROR', { detail });
}
