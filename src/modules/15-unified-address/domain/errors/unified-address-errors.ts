import { AppError, type ErrorKind, type FieldError } from '../../../00-shared-kernel/public';

export const UnifiedAddressErrorCodes = {
  /**
   * Malformed Parent Address: not text, a control character, longer than 200 characters, a Village without a
   * Center/City, an empty or surplus component in the raw text (`A//C`, `A/B/`, `/A`, more than three parts).
   */
  INVALID_PARENT_ADDRESS: 'INVALID_PARENT_ADDRESS',
  /** No registered Governorate with this id (or, for raw text, with exactly this name) in the organization's country. */
  PARENT_ADDRESS_GOVERNORATE_NOT_FOUND: 'PARENT_ADDRESS_GOVERNORATE_NOT_FOUND',
  /** Rejected when creating or changing a Parent Address; stored (historical) addresses stay readable. */
  PARENT_ADDRESS_GOVERNORATE_INACTIVE: 'PARENT_ADDRESS_GOVERNORATE_INACTIVE',
  /** The Governorate does not belong to the Main Organization's country. */
  PARENT_ADDRESS_COUNTRY_MISMATCH: 'PARENT_ADDRESS_COUNTRY_MISMATCH',
  /** The organization's governorate does not belong to the country chosen for the organization. */
  ORGANIZATION_ADDRESS_COUNTRY_MISMATCH: 'ORGANIZATION_ADDRESS_COUNTRY_MISMATCH',
} as const;
export type UnifiedAddressErrorCode = (typeof UnifiedAddressErrorCodes)[keyof typeof UnifiedAddressErrorCodes];

const KIND: Record<UnifiedAddressErrorCode, ErrorKind> = {
  INVALID_PARENT_ADDRESS: 'VALIDATION',
  PARENT_ADDRESS_GOVERNORATE_NOT_FOUND: 'VALIDATION',
  PARENT_ADDRESS_GOVERNORATE_INACTIVE: 'VALIDATION',
  PARENT_ADDRESS_COUNTRY_MISMATCH: 'VALIDATION',
  ORGANIZATION_ADDRESS_COUNTRY_MISMATCH: 'VALIDATION',
};

export type ParentAddressField = 'address' | 'organization' | 'country' | 'governorate' | 'center' | 'village';

/** `field` (when known) is returned as a client-safe field error; submitted values are never included. */
export function unifiedAddressError(code: UnifiedAddressErrorCode, field?: ParentAddressField): AppError {
  const details: FieldError[] | undefined = field ? [{ field, code }] : undefined;
  return new AppError(code, KIND[code], details);
}
