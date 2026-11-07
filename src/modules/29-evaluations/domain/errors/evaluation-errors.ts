import { AppError, type ErrorKind, type ErrorMessageParams } from '../../../00-shared-kernel/public';

export const EvaluationErrorCodes = {
  EVALUATION_RECORDS_REQUIRED: 'EVALUATION_RECORDS_REQUIRED',
  EVALUATION_TOO_MANY_RECORDS: 'EVALUATION_TOO_MANY_RECORDS',
  EVALUATION_INVALID_RECORD: 'EVALUATION_INVALID_RECORD',
  EVALUATION_DUPLICATE_STUDENT: 'EVALUATION_DUPLICATE_STUDENT',
  EVALUATION_INVALID_CATEGORY: 'EVALUATION_INVALID_CATEGORY',
  EVALUATION_DUPLICATE_CATEGORY: 'EVALUATION_DUPLICATE_CATEGORY',
  EVALUATION_INVALID_SCORE: 'EVALUATION_INVALID_SCORE',
  EVALUATION_INVALID_NOTE: 'EVALUATION_INVALID_NOTE',
  EVALUATION_NOTE_TOO_LONG: 'EVALUATION_NOTE_TOO_LONG',
  /** The note is saved once, with the evaluation, and can never be edited, replaced, added later or deleted. */
  EVALUATION_NOTE_IMMUTABLE: 'EVALUATION_NOTE_IMMUTABLE',
  /** The submitted categories are not the ones available to the student (creation needs exactly the available categories; a change only categories already evaluated). */
  EVALUATION_CATEGORIES_MISMATCH: 'EVALUATION_CATEGORIES_MISMATCH',
  /** The student has neither a Memorization nor a Revision assignment for the session: there is nothing to evaluate. */
  EVALUATION_NO_APPLICABLE_ASSIGNMENT: 'EVALUATION_NO_APPLICABLE_ASSIGNMENT',
  /** A student marked ABSENT cannot receive an evaluation for the session. */
  EVALUATION_STUDENT_ABSENT: 'EVALUATION_STUDENT_ABSENT',
  /** A student who is not currently assigned to the session's group is outside the eligible roster. */
  EVALUATION_STUDENT_NOT_IN_GROUP: 'EVALUATION_STUDENT_NOT_IN_GROUP',
  /** After the session ended only MISSING evaluations can be recorded: an evaluation that already exists can no longer be touched. */
  EVALUATION_GRACE_CREATE_ONLY: 'EVALUATION_GRACE_CREATE_ONLY',
  /** The write window (the session plus the 15-minute grace period) is closed for good. */
  EVALUATION_WRITE_WINDOW_CLOSED: 'EVALUATION_WRITE_WINDOW_CLOSED',
  /** No evaluation for a cancelled session. */
  EVALUATION_SESSION_CANCELLED: 'EVALUATION_SESSION_CANCELLED',
  /** Only the session's Teacher or the School Manager of its school read a session's evaluations. */
  EVALUATION_READ_NOT_ALLOWED: 'EVALUATION_READ_NOT_ALLOWED',
  /** Another request changed the same evaluation at the same time: retry. */
  EVALUATION_CONCURRENT_CHANGE: 'EVALUATION_CONCURRENT_CHANGE',
} as const;
export type EvaluationErrorCode = (typeof EvaluationErrorCodes)[keyof typeof EvaluationErrorCodes];

const KIND: Record<EvaluationErrorCode, ErrorKind> = {
  EVALUATION_RECORDS_REQUIRED: 'VALIDATION',
  EVALUATION_TOO_MANY_RECORDS: 'VALIDATION',
  EVALUATION_INVALID_RECORD: 'VALIDATION',
  EVALUATION_DUPLICATE_STUDENT: 'VALIDATION',
  EVALUATION_INVALID_CATEGORY: 'VALIDATION',
  EVALUATION_DUPLICATE_CATEGORY: 'VALIDATION',
  EVALUATION_INVALID_SCORE: 'VALIDATION',
  EVALUATION_INVALID_NOTE: 'VALIDATION',
  EVALUATION_NOTE_TOO_LONG: 'VALIDATION',
  EVALUATION_NOTE_IMMUTABLE: 'BUSINESS_RULE',
  EVALUATION_CATEGORIES_MISMATCH: 'BUSINESS_RULE',
  EVALUATION_NO_APPLICABLE_ASSIGNMENT: 'BUSINESS_RULE',
  EVALUATION_STUDENT_ABSENT: 'BUSINESS_RULE',
  EVALUATION_STUDENT_NOT_IN_GROUP: 'BUSINESS_RULE',
  EVALUATION_GRACE_CREATE_ONLY: 'BUSINESS_RULE',
  EVALUATION_WRITE_WINDOW_CLOSED: 'BUSINESS_RULE',
  EVALUATION_SESSION_CANCELLED: 'BUSINESS_RULE',
  EVALUATION_READ_NOT_ALLOWED: 'FORBIDDEN',
  EVALUATION_CONCURRENT_CHANGE: 'CONFLICT',
};

export function evaluationError(code: EvaluationErrorCode, details?: unknown, params?: ErrorMessageParams): AppError {
  return new AppError(code, KIND[code], details, params);
}
