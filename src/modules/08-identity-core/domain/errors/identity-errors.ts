import { AppError, type ErrorKind } from '../../../00-shared-kernel/public';

export const IdentityErrorCodes = {
  INVALID_PHONE_NUMBER: 'INVALID_PHONE_NUMBER',
  INVALID_PASSWORD: 'INVALID_PASSWORD',
  USER_PHONE_ALREADY_EXISTS: 'USER_PHONE_ALREADY_EXISTS',
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  USER_ALREADY_ACTIVE: 'USER_ALREADY_ACTIVE',
  USER_ALREADY_INACTIVE: 'USER_ALREADY_INACTIVE',
  USER_CONCURRENT_MODIFICATION: 'USER_CONCURRENT_MODIFICATION',
} as const;
export type IdentityErrorCode = (typeof IdentityErrorCodes)[keyof typeof IdentityErrorCodes];

const KIND: Record<IdentityErrorCode, ErrorKind> = {
  INVALID_PHONE_NUMBER: 'VALIDATION',
  INVALID_PASSWORD: 'VALIDATION',
  USER_PHONE_ALREADY_EXISTS: 'CONFLICT',
  USER_NOT_FOUND: 'NOT_FOUND',
  USER_ALREADY_ACTIVE: 'BUSINESS_RULE',
  USER_ALREADY_INACTIVE: 'BUSINESS_RULE',
  USER_CONCURRENT_MODIFICATION: 'CONFLICT',
};

export function identityError(code: IdentityErrorCode, params?: Record<string, string | number>): AppError {
  return new AppError(code, KIND[code], undefined, params);
}
