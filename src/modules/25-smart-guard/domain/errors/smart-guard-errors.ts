import { AppError, type ErrorKind, type ErrorMessageParams } from '../../../00-shared-kernel/public';

/**
 * Why Smart Guard refuses a protected Teacher action (Master Specification §50). Every refusal is final for that attempt: there is no IP, manual-location or
 * postal fallback. Codes are stable and language independent; the messages are Arabic and English.
 */
export const SmartGuardErrorCodes = {
  /** The caller is not the Teacher assigned to the session. */
  SMART_GUARD_NOT_SESSION_TEACHER: 'SMART_GUARD_NOT_SESSION_TEACHER',
  /** Now is outside the protected window: session start - 15 minutes through the session end (inclusive). */
  SMART_GUARD_OUTSIDE_SESSION_WINDOW: 'SMART_GUARD_OUTSIDE_SESSION_WINDOW',
  /** The GPS reading is unavailable, denied or missing (none was sent). */
  SMART_GUARD_GPS_REQUIRED: 'SMART_GUARD_GPS_REQUIRED',
  /** The GPS reading is not a valid fix (not numbers, out of range, accuracy not positive). */
  SMART_GUARD_GPS_INVALID: 'SMART_GUARD_GPS_INVALID',
  /** The Teacher is farther than 50 metres from the school's official GPS. */
  SMART_GUARD_OUTSIDE_SCHOOL_GEOFENCE: 'SMART_GUARD_OUTSIDE_SCHOOL_GEOFENCE',
  /** The reported GPS accuracy is worse than 20 metres. */
  SMART_GUARD_GPS_ACCURACY_TOO_LOW: 'SMART_GUARD_GPS_ACCURACY_TOO_LOW',
  /** The session is cancelled. */
  SMART_GUARD_SESSION_CANCELLED: 'SMART_GUARD_SESSION_CANCELLED',
  /** The school of the session does not exist or is not ACTIVE. */
  SMART_GUARD_SCHOOL_NOT_ACTIVE: 'SMART_GUARD_SCHOOL_NOT_ACTIVE',
} as const;
export type SmartGuardErrorCode = (typeof SmartGuardErrorCodes)[keyof typeof SmartGuardErrorCodes];

const KIND: Record<SmartGuardErrorCode, ErrorKind> = {
  SMART_GUARD_NOT_SESSION_TEACHER: 'FORBIDDEN',
  SMART_GUARD_OUTSIDE_SESSION_WINDOW: 'BUSINESS_RULE',
  SMART_GUARD_GPS_REQUIRED: 'VALIDATION',
  SMART_GUARD_GPS_INVALID: 'VALIDATION',
  SMART_GUARD_OUTSIDE_SCHOOL_GEOFENCE: 'BUSINESS_RULE',
  SMART_GUARD_GPS_ACCURACY_TOO_LOW: 'BUSINESS_RULE',
  SMART_GUARD_SESSION_CANCELLED: 'BUSINESS_RULE',
  SMART_GUARD_SCHOOL_NOT_ACTIVE: 'BUSINESS_RULE',
};

/** `details` is client-safe data; `params` fills the placeholders of the localized message (e.g. {maxMeters}). */
export function smartGuardError(code: SmartGuardErrorCode, details?: unknown, params?: ErrorMessageParams): AppError {
  return new AppError(code, KIND[code], details, params);
}
