import { AppError, type ErrorKind } from '../../../00-shared-kernel/public';

export const ClassSessionErrorCodes = {
  /** The session does not exist (or is not in the group named in the path: one neutral code). */
  CLASS_SESSION_NOT_FOUND: 'CLASS_SESSION_NOT_FOUND',
  /** A cancellation needs a non-empty reason. */
  CLASS_SESSION_CANCEL_REASON_REQUIRED: 'CLASS_SESSION_CANCEL_REASON_REQUIRED',
  CLASS_SESSION_CANCEL_REASON_TOO_LONG: 'CLASS_SESSION_CANCEL_REASON_TOO_LONG',
  /** A COMPLETED or already CANCELLED session cannot be cancelled (the original cancellation is kept). */
  CLASS_SESSION_NOT_CANCELLABLE: 'CLASS_SESSION_NOT_CANCELLABLE',
  /** Only the Teacher assigned to the session may cancel it. */
  CLASS_SESSION_NOT_ASSIGNED_TEACHER: 'CLASS_SESSION_NOT_ASSIGNED_TEACHER',
} as const;
export type ClassSessionErrorCode = (typeof ClassSessionErrorCodes)[keyof typeof ClassSessionErrorCodes];

const KIND: Record<ClassSessionErrorCode, ErrorKind> = {
  CLASS_SESSION_NOT_FOUND: 'NOT_FOUND',
  CLASS_SESSION_CANCEL_REASON_REQUIRED: 'VALIDATION',
  CLASS_SESSION_CANCEL_REASON_TOO_LONG: 'VALIDATION',
  CLASS_SESSION_NOT_CANCELLABLE: 'CONFLICT',
  CLASS_SESSION_NOT_ASSIGNED_TEACHER: 'FORBIDDEN',
};

export function classSessionError(code: ClassSessionErrorCode, details?: unknown): AppError {
  return new AppError(code, KIND[code], details);
}
