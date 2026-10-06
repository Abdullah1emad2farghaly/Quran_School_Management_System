/** Foundation error codes only. Business modules add their own stable codes. */
export const ErrorCodes = {
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  INVALID_JSON: 'INVALID_JSON',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  CORS_NOT_ALLOWED: 'CORS_NOT_ALLOWED',
  INVALID_IDENTIFIER: 'INVALID_IDENTIFIER',
  INVALID_DATE: 'INVALID_DATE',
} as const;
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
