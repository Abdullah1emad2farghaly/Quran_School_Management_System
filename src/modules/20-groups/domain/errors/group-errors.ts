import { AppError, type ErrorKind } from '../../../00-shared-kernel/public';

export const GroupErrorCodes = {
  INVALID_GROUP_NAME: 'INVALID_GROUP_NAME',
  INVALID_GROUP_LEARNING_MODE: 'INVALID_GROUP_LEARNING_MODE',
  INVALID_GROUP_PROGRESSION: 'INVALID_GROUP_PROGRESSION',
  INVALID_GROUP_STARTING_SURAH: 'INVALID_GROUP_STARTING_SURAH',
  INVALID_GROUP_REASON: 'INVALID_GROUP_REASON',
  GROUP_UPDATE_EMPTY: 'GROUP_UPDATE_EMPTY',
  GROUP_NOT_FOUND: 'GROUP_NOT_FOUND',
  /** Groups are created only in an existing ACTIVE school. */
  GROUP_SCHOOL_NOT_ACTIVE: 'GROUP_SCHOOL_NOT_ACTIVE',
  /** The group name is unique among the ACTIVE groups of the same school (an ARCHIVED group's name is free again). */
  GROUP_NAME_CONFLICT: 'GROUP_NAME_CONFLICT',
  /** An ARCHIVED group is read-only and final. */
  GROUP_ARCHIVED: 'GROUP_ARCHIVED',
  /** The Teacher does not exist, belongs to another organization, or is not actively linked to the group's school (one neutral code). */
  GROUP_TEACHER_NOT_LINKED_TO_SCHOOL: 'GROUP_TEACHER_NOT_LINKED_TO_SCHOOL',
  GROUP_HAS_NO_TEACHER: 'GROUP_HAS_NO_TEACHER',
  /** The Student does not exist or is not a student of the group's school (one neutral code). */
  GROUP_STUDENT_NOT_IN_SCHOOL: 'GROUP_STUDENT_NOT_IN_SCHOOL',
  /** Only an ACTIVE student can be assigned to a group. */
  GROUP_STUDENT_NOT_ACTIVE: 'GROUP_STUDENT_NOT_ACTIVE',
  /** A student is in ONE group at a time (§36/§39): move or unassign first. */
  GROUP_STUDENT_ALREADY_ASSIGNED: 'GROUP_STUDENT_ALREADY_ASSIGNED',
  GROUP_STUDENT_NOT_ASSIGNED: 'GROUP_STUDENT_NOT_ASSIGNED',
  /** The target of a move is the same group, does not exist, belongs to another school, or is ARCHIVED (one neutral code). */
  GROUP_MOVE_TARGET_INVALID: 'GROUP_MOVE_TARGET_INVALID',
  GROUP_CONCURRENT_MODIFICATION: 'GROUP_CONCURRENT_MODIFICATION',
} as const;
export type GroupErrorCode = (typeof GroupErrorCodes)[keyof typeof GroupErrorCodes];

const KIND: Record<GroupErrorCode, ErrorKind> = {
  INVALID_GROUP_NAME: 'VALIDATION',
  INVALID_GROUP_LEARNING_MODE: 'VALIDATION',
  INVALID_GROUP_PROGRESSION: 'VALIDATION',
  INVALID_GROUP_STARTING_SURAH: 'VALIDATION',
  INVALID_GROUP_REASON: 'VALIDATION',
  GROUP_UPDATE_EMPTY: 'VALIDATION',
  GROUP_NOT_FOUND: 'NOT_FOUND',
  GROUP_SCHOOL_NOT_ACTIVE: 'BUSINESS_RULE',
  GROUP_NAME_CONFLICT: 'CONFLICT',
  GROUP_ARCHIVED: 'BUSINESS_RULE',
  GROUP_TEACHER_NOT_LINKED_TO_SCHOOL: 'BUSINESS_RULE',
  GROUP_HAS_NO_TEACHER: 'BUSINESS_RULE',
  GROUP_STUDENT_NOT_IN_SCHOOL: 'BUSINESS_RULE',
  GROUP_STUDENT_NOT_ACTIVE: 'BUSINESS_RULE',
  GROUP_STUDENT_ALREADY_ASSIGNED: 'CONFLICT',
  GROUP_STUDENT_NOT_ASSIGNED: 'NOT_FOUND',
  GROUP_MOVE_TARGET_INVALID: 'BUSINESS_RULE',
  GROUP_CONCURRENT_MODIFICATION: 'CONFLICT',
};

export function groupError(code: GroupErrorCode): AppError {
  return new AppError(code, KIND[code]);
}
