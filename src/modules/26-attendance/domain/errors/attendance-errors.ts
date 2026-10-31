import { AppError, type ErrorKind, type ErrorMessageParams } from '../../../00-shared-kernel/public';

export const AttendanceErrorCodes = {
  ATTENDANCE_RECORDS_REQUIRED: 'ATTENDANCE_RECORDS_REQUIRED',
  ATTENDANCE_TOO_MANY_RECORDS: 'ATTENDANCE_TOO_MANY_RECORDS',
  ATTENDANCE_INVALID_RECORD: 'ATTENDANCE_INVALID_RECORD',
  ATTENDANCE_INVALID_STATUS: 'ATTENDANCE_INVALID_STATUS',
  ATTENDANCE_DUPLICATE_STUDENT: 'ATTENDANCE_DUPLICATE_STUDENT',
  /** Changing an existing record needs a non-empty reason. */
  ATTENDANCE_CORRECTION_REASON_REQUIRED: 'ATTENDANCE_CORRECTION_REASON_REQUIRED',
  ATTENDANCE_REASON_TOO_LONG: 'ATTENDANCE_REASON_TOO_LONG',
  /** No attendance for a cancelled session. */
  ATTENDANCE_SESSION_CANCELLED: 'ATTENDANCE_SESSION_CANCELLED',
  /** A student who is not currently assigned to the session's group cannot be recorded. */
  ATTENDANCE_STUDENT_NOT_IN_GROUP: 'ATTENDANCE_STUDENT_NOT_IN_GROUP',
  /** Only the session's Teacher or the School Manager of its school read a session's attendance. */
  ATTENDANCE_READ_NOT_ALLOWED: 'ATTENDANCE_READ_NOT_ALLOWED',
  /** Another request changed the same record at the same time: retry. */
  ATTENDANCE_CONCURRENT_CHANGE: 'ATTENDANCE_CONCURRENT_CHANGE',
} as const;
export type AttendanceErrorCode = (typeof AttendanceErrorCodes)[keyof typeof AttendanceErrorCodes];

const KIND: Record<AttendanceErrorCode, ErrorKind> = {
  ATTENDANCE_RECORDS_REQUIRED: 'VALIDATION',
  ATTENDANCE_TOO_MANY_RECORDS: 'VALIDATION',
  ATTENDANCE_INVALID_RECORD: 'VALIDATION',
  ATTENDANCE_INVALID_STATUS: 'VALIDATION',
  ATTENDANCE_DUPLICATE_STUDENT: 'VALIDATION',
  ATTENDANCE_CORRECTION_REASON_REQUIRED: 'VALIDATION',
  ATTENDANCE_REASON_TOO_LONG: 'VALIDATION',
  ATTENDANCE_SESSION_CANCELLED: 'BUSINESS_RULE',
  ATTENDANCE_STUDENT_NOT_IN_GROUP: 'BUSINESS_RULE',
  ATTENDANCE_READ_NOT_ALLOWED: 'FORBIDDEN',
  ATTENDANCE_CONCURRENT_CHANGE: 'CONFLICT',
};

export function attendanceError(code: AttendanceErrorCode, details?: unknown, params?: ErrorMessageParams): AppError {
  return new AppError(code, KIND[code], details, params);
}
