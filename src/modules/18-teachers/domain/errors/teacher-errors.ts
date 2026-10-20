import { AppError, type ErrorKind } from '../../../00-shared-kernel/public';

export const TeacherErrorCodes = {
  /** The Teacher's personal name must be exactly three parts (shared Identity rule). */
  INVALID_TEACHER_NAME: 'INVALID_TEACHER_NAME',
  TEACHER_NOT_FOUND: 'TEACHER_NOT_FOUND',
  /** The phone already belongs to an account whose stored three-part name is missing or differs. Never merged automatically. */
  TEACHER_IDENTITY_CONFLICT: 'TEACHER_IDENTITY_CONFLICT',
  /** The existing Teacher (or Parent) record of the account belongs to another organization: not reused across organizations in V1. */
  TEACHER_ORGANIZATION_CONFLICT: 'TEACHER_ORGANIZATION_CONFLICT',
  TEACHER_ALREADY_LINKED_TO_SCHOOL: 'TEACHER_ALREADY_LINKED_TO_SCHOOL',
  TEACHER_SCHOOL_LINK_NOT_FOUND: 'TEACHER_SCHOOL_LINK_NOT_FOUND',
  /** Teachers are registered only for an existing ACTIVE school. */
  TEACHER_SCHOOL_NOT_ACTIVE: 'TEACHER_SCHOOL_NOT_ACTIVE',
  /** The existing account is deactivated: it is never reused or re-linked while inactive. */
  TEACHER_ACCOUNT_INACTIVE: 'TEACHER_ACCOUNT_INACTIVE',
  TEACHER_CONCURRENT_MODIFICATION: 'TEACHER_CONCURRENT_MODIFICATION',
  /** The Teacher still has groups in the school: the relationship cannot be removed. */
  TEACHER_HAS_GROUPS_IN_SCHOOL: 'TEACHER_HAS_GROUPS_IN_SCHOOL',
} as const;
export type TeacherErrorCode = (typeof TeacherErrorCodes)[keyof typeof TeacherErrorCodes];

const KIND: Record<TeacherErrorCode, ErrorKind> = {
  INVALID_TEACHER_NAME: 'VALIDATION',
  TEACHER_NOT_FOUND: 'NOT_FOUND',
  TEACHER_IDENTITY_CONFLICT: 'CONFLICT',
  TEACHER_ORGANIZATION_CONFLICT: 'CONFLICT',
  TEACHER_ALREADY_LINKED_TO_SCHOOL: 'CONFLICT',
  TEACHER_SCHOOL_LINK_NOT_FOUND: 'NOT_FOUND',
  TEACHER_SCHOOL_NOT_ACTIVE: 'BUSINESS_RULE',
  TEACHER_ACCOUNT_INACTIVE: 'BUSINESS_RULE',
  TEACHER_CONCURRENT_MODIFICATION: 'CONFLICT',
  TEACHER_HAS_GROUPS_IN_SCHOOL: 'BUSINESS_RULE',
};

export function teacherError(code: TeacherErrorCode): AppError {
  return new AppError(code, KIND[code]);
}
