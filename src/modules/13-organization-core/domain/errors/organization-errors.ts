import { AppError, type ErrorKind } from '../../../00-shared-kernel/public';

export const OrganizationErrorCodes = {
  INVALID_ORGANIZATION_NAME: 'INVALID_ORGANIZATION_NAME',
  /** V1 allows exactly one Main Organization (or the code is taken). Raised by the database guard on a concurrent create. */
  ORGANIZATION_ALREADY_EXISTS: 'ORGANIZATION_ALREADY_EXISTS',
  ORGANIZATION_NOT_FOUND: 'ORGANIZATION_NOT_FOUND',
  /** V1: the Main Organization's country is immutable once assigned; a different country is rejected. */
  ORGANIZATION_COUNTRY_ALREADY_SET: 'ORGANIZATION_COUNTRY_ALREADY_SET',
  /** The Main Organization has no country yet (run `npm run bootstrap:organization`). Country-dependent rules fail closed. */
  ORGANIZATION_COUNTRY_NOT_SET: 'ORGANIZATION_COUNTRY_NOT_SET',
  /** Not a country primary key (UUID), or no such country (foreign key). A country CODE such as CNT-000001 is not accepted. */
  ORGANIZATION_COUNTRY_INVALID: 'ORGANIZATION_COUNTRY_INVALID',
  /** Organization names are unique across the whole system (database unique index; case/accent-insensitive collation). */
  ORGANIZATION_NAME_ALREADY_EXISTS: 'ORGANIZATION_NAME_ALREADY_EXISTS',
  /** The organization's own address is incomplete or inconsistent (governorate required; a village needs a center). */
  INVALID_ORGANIZATION_ADDRESS: 'INVALID_ORGANIZATION_ADDRESS',
} as const;
export type OrganizationErrorCode = (typeof OrganizationErrorCodes)[keyof typeof OrganizationErrorCodes];

const KIND: Record<OrganizationErrorCode, ErrorKind> = {
  INVALID_ORGANIZATION_NAME: 'VALIDATION',
  ORGANIZATION_ALREADY_EXISTS: 'CONFLICT',
  ORGANIZATION_NOT_FOUND: 'NOT_FOUND',
  ORGANIZATION_COUNTRY_ALREADY_SET: 'CONFLICT',
  ORGANIZATION_COUNTRY_NOT_SET: 'BUSINESS_RULE',
  ORGANIZATION_COUNTRY_INVALID: 'VALIDATION',
  ORGANIZATION_NAME_ALREADY_EXISTS: 'CONFLICT',
  INVALID_ORGANIZATION_ADDRESS: 'VALIDATION',
};

export function organizationError(code: OrganizationErrorCode): AppError {
  return new AppError(code, KIND[code]);
}
