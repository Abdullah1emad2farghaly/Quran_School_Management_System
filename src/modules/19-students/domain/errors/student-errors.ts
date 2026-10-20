import { AppError, type ErrorKind } from '../../../00-shared-kernel/public';

export const StudentErrorCodes = {
  /** The Student's name must have at least three parts (Master Specification §37). */
  INVALID_STUDENT_NAME: 'INVALID_STUDENT_NAME',
  /** The second and third parts of the Student's name must be the Parent's first and second names (§37). */
  STUDENT_NAME_PARENT_MISMATCH: 'STUDENT_NAME_PARENT_MISMATCH',
  /** The National ID must be exactly 14 digits (§38). */
  INVALID_STUDENT_NATIONAL_ID: 'INVALID_STUDENT_NATIONAL_ID',
  INVALID_STUDENT_JOIN_DATE: 'INVALID_STUDENT_JOIN_DATE',
  INVALID_STUDENT_REASON: 'INVALID_STUDENT_REASON',
  /** A student update must change something (V1: the name and/or the join date). */
  STUDENT_UPDATE_EMPTY: 'STUDENT_UPDATE_EMPTY',
  STUDENT_NOT_FOUND: 'STUDENT_NOT_FOUND',
  /** Students are registered only in an existing ACTIVE school (and reactivated only while their school is ACTIVE). */
  STUDENT_SCHOOL_NOT_ACTIVE: 'STUDENT_SCHOOL_NOT_ACTIVE',
  /** The Parent does not exist, belongs to another organization, or is not actively linked to the school. One code, so nothing is revealed about other organizations. */
  STUDENT_PARENT_NOT_LINKED_TO_SCHOOL: 'STUDENT_PARENT_NOT_LINKED_TO_SCHOOL',
  /** The National ID is unique across the whole system (every organization, school and status). The error never says who holds it. */
  STUDENT_NATIONAL_ID_CONFLICT: 'STUDENT_NATIONAL_ID_CONFLICT',
  STUDENT_INVALID_STATUS_TRANSITION: 'STUDENT_INVALID_STATUS_TRANSITION',
  /** An ARCHIVED student is read-only (V1: archiving is final). */
  STUDENT_ARCHIVED: 'STUDENT_ARCHIVED',
  STUDENT_CONCURRENT_MODIFICATION: 'STUDENT_CONCURRENT_MODIFICATION',
} as const;
export type StudentErrorCode = (typeof StudentErrorCodes)[keyof typeof StudentErrorCodes];

const KIND: Record<StudentErrorCode, ErrorKind> = {
  INVALID_STUDENT_NAME: 'VALIDATION',
  STUDENT_NAME_PARENT_MISMATCH: 'BUSINESS_RULE',
  INVALID_STUDENT_NATIONAL_ID: 'VALIDATION',
  INVALID_STUDENT_JOIN_DATE: 'VALIDATION',
  INVALID_STUDENT_REASON: 'VALIDATION',
  STUDENT_UPDATE_EMPTY: 'VALIDATION',
  STUDENT_NOT_FOUND: 'NOT_FOUND',
  STUDENT_SCHOOL_NOT_ACTIVE: 'BUSINESS_RULE',
  STUDENT_PARENT_NOT_LINKED_TO_SCHOOL: 'BUSINESS_RULE',
  STUDENT_NATIONAL_ID_CONFLICT: 'CONFLICT',
  STUDENT_INVALID_STATUS_TRANSITION: 'BUSINESS_RULE',
  STUDENT_ARCHIVED: 'BUSINESS_RULE',
  STUDENT_CONCURRENT_MODIFICATION: 'CONFLICT',
};

export function studentError(code: StudentErrorCode): AppError {
  return new AppError(code, KIND[code]);
}
