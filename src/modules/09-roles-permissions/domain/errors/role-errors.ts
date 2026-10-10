import { AppError, type ErrorKind } from '../../../00-shared-kernel/public';

export const RoleErrorCodes = {
  INVALID_ROLE: 'INVALID_ROLE',
  ROLE_NOT_ASSIGNABLE: 'ROLE_NOT_ASSIGNABLE',
  ROLE_ALREADY_ASSIGNED: 'ROLE_ALREADY_ASSIGNED',
  ROLE_ASSIGNMENT_NOT_FOUND: 'ROLE_ASSIGNMENT_NOT_FOUND',
  LAST_ACTIVE_ROLE: 'LAST_ACTIVE_ROLE',
  ROLE_CONCURRENT_MODIFICATION: 'ROLE_CONCURRENT_MODIFICATION',
  // Configuration errors raised at startup by the permission registry (never shown to end users).
  INVALID_PERMISSION_CODE: 'INVALID_PERMISSION_CODE',
  PERMISSION_ALREADY_REGISTERED: 'PERMISSION_ALREADY_REGISTERED',
  INVALID_PERMISSION_GRANT: 'INVALID_PERMISSION_GRANT',
} as const;
export type RoleErrorCode = (typeof RoleErrorCodes)[keyof typeof RoleErrorCodes];

const KIND: Record<RoleErrorCode, ErrorKind> = {
  INVALID_ROLE: 'VALIDATION',
  ROLE_NOT_ASSIGNABLE: 'BUSINESS_RULE',
  ROLE_ALREADY_ASSIGNED: 'CONFLICT',
  ROLE_ASSIGNMENT_NOT_FOUND: 'NOT_FOUND',
  LAST_ACTIVE_ROLE: 'BUSINESS_RULE',
  ROLE_CONCURRENT_MODIFICATION: 'CONFLICT',
  INVALID_PERMISSION_CODE: 'INTERNAL',
  PERMISSION_ALREADY_REGISTERED: 'INTERNAL',
  INVALID_PERMISSION_GRANT: 'INTERNAL',
};

export function roleError(code: RoleErrorCode, params?: Record<string, string | number>): AppError {
  return new AppError(code, KIND[code], undefined, params);
}
