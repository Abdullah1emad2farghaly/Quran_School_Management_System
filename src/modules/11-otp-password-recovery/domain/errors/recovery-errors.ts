import { AppError, type ErrorKind } from '../../../00-shared-kernel/public';

export const RecoveryErrorCodes = {
  /** Wrong, expired, used, locked OR unknown account: always the same answer (no account enumeration). */
  OTP_INVALID: 'OTP_INVALID',
  RESET_TOKEN_INVALID: 'RESET_TOKEN_INVALID',
  RATE_LIMITED: 'RATE_LIMITED',
  RECOVERY_CONCURRENT_MODIFICATION: 'RECOVERY_CONCURRENT_MODIFICATION',
} as const;
export type RecoveryErrorCode = (typeof RecoveryErrorCodes)[keyof typeof RecoveryErrorCodes];

const KIND: Record<RecoveryErrorCode, ErrorKind> = {
  OTP_INVALID: 'VALIDATION',
  RESET_TOKEN_INVALID: 'VALIDATION',
  RATE_LIMITED: 'RATE_LIMITED',
  RECOVERY_CONCURRENT_MODIFICATION: 'CONFLICT',
};

export function recoveryError(code: RecoveryErrorCode): AppError {
  return new AppError(code, KIND[code]);
}

/** 429. `retryAfterSeconds` is client-safe and becomes the Retry-After header. */
export function rateLimitedError(retryAfterSeconds: number): AppError {
  return new AppError(RecoveryErrorCodes.RATE_LIMITED, 'RATE_LIMITED', { retryAfterSeconds });
}
