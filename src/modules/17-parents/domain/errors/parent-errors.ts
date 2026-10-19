import { AppError, type ErrorKind } from '../../../00-shared-kernel/public';

export const ParentErrorCodes = {
  /** The Parent's personal name must be exactly three parts (shared Identity rule). */
  INVALID_PARENT_NAME: 'INVALID_PARENT_NAME',
  /** The address must be given EITHER as the raw `Governorate / Center or City / Village` text OR as structured fields, never both or neither. */
  PARENT_ADDRESS_REQUIRED: 'PARENT_ADDRESS_REQUIRED',
  /** A parent update must change something (V1: the address). */
  PARENT_UPDATE_EMPTY: 'PARENT_UPDATE_EMPTY',
  PARENT_NOT_FOUND: 'PARENT_NOT_FOUND',
  /** The phone already belongs to an account whose identity does not match, or cannot be established reliably. Never merged automatically. */
  PARENT_IDENTITY_CONFLICT: 'PARENT_IDENTITY_CONFLICT',
  /** The existing Parent account belongs to another organization: a Parent is never reused across organizations in V1. */
  PARENT_ORGANIZATION_CONFLICT: 'PARENT_ORGANIZATION_CONFLICT',
  PARENT_ALREADY_LINKED_TO_SCHOOL: 'PARENT_ALREADY_LINKED_TO_SCHOOL',
  PARENT_SCHOOL_LINK_NOT_FOUND: 'PARENT_SCHOOL_LINK_NOT_FOUND',
  /** Parents are registered only for an existing ACTIVE school. */
  PARENT_SCHOOL_NOT_ACTIVE: 'PARENT_SCHOOL_NOT_ACTIVE',
  /** The existing account is deactivated: it is never reused or re-linked while inactive. */
  PARENT_ACCOUNT_INACTIVE: 'PARENT_ACCOUNT_INACTIVE',
  PARENT_CONCURRENT_MODIFICATION: 'PARENT_CONCURRENT_MODIFICATION',
  /** The Parent still has students in the school: the relationship cannot be removed. */
  PARENT_HAS_STUDENTS_IN_SCHOOL: 'PARENT_HAS_STUDENTS_IN_SCHOOL',
} as const;
export type ParentErrorCode = (typeof ParentErrorCodes)[keyof typeof ParentErrorCodes];

const KIND: Record<ParentErrorCode, ErrorKind> = {
  INVALID_PARENT_NAME: 'VALIDATION',
  PARENT_ADDRESS_REQUIRED: 'VALIDATION',
  PARENT_UPDATE_EMPTY: 'VALIDATION',
  PARENT_NOT_FOUND: 'NOT_FOUND',
  PARENT_IDENTITY_CONFLICT: 'CONFLICT',
  PARENT_ORGANIZATION_CONFLICT: 'CONFLICT',
  PARENT_ALREADY_LINKED_TO_SCHOOL: 'CONFLICT',
  PARENT_SCHOOL_LINK_NOT_FOUND: 'NOT_FOUND',
  PARENT_SCHOOL_NOT_ACTIVE: 'BUSINESS_RULE',
  PARENT_ACCOUNT_INACTIVE: 'BUSINESS_RULE',
  PARENT_CONCURRENT_MODIFICATION: 'CONFLICT',
  PARENT_HAS_STUDENTS_IN_SCHOOL: 'BUSINESS_RULE',
};

export function parentError(code: ParentErrorCode): AppError {
  return new AppError(code, KIND[code]);
}
