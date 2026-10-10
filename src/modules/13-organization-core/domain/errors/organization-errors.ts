import { AppError, type ErrorKind } from '../../../00-shared-kernel/public';

export const OrganizationErrorCodes = {
  INVALID_ORGANIZATION_NAME: 'INVALID_ORGANIZATION_NAME',
  /** V1 allows exactly one Main Organization (or the code is taken). Raised by the database guard on a concurrent create. */
  ORGANIZATION_ALREADY_EXISTS: 'ORGANIZATION_ALREADY_EXISTS',
  ORGANIZATION_NOT_FOUND: 'ORGANIZATION_NOT_FOUND',
} as const;
export type OrganizationErrorCode = (typeof OrganizationErrorCodes)[keyof typeof OrganizationErrorCodes];

const KIND: Record<OrganizationErrorCode, ErrorKind> = {
  INVALID_ORGANIZATION_NAME: 'VALIDATION',
  ORGANIZATION_ALREADY_EXISTS: 'CONFLICT',
  ORGANIZATION_NOT_FOUND: 'NOT_FOUND',
};

export function organizationError(code: OrganizationErrorCode): AppError {
  return new AppError(code, KIND[code]);
}
