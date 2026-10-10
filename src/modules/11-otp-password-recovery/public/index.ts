// Public contract of Module 11 (OTP & Password Recovery): forgot password with an OTP (§26).
// The real OTP delivery provider is plugged in through the OtpSender port; none is chosen yet.
export {
  PasswordRecoveryService,
  type PasswordRecoveryServiceDeps,
  type RequestRecoveryResult,
  type VerifyOtpResult,
} from '../application/services/password-recovery-service';
export type {
  RecoveryRepository,
  RecoveryCrypto,
  RecoverySecrets,
  OtpSender,
  OtpMessage,
  BackgroundRunner,
} from '../application/ports/recovery-ports';
export {
  OTP_LENGTH,
  OTP_TTL_SECONDS,
  MAX_WRONG_ATTEMPTS,
  RESET_TOKEN_TTL_SECONDS,
  HOUR_WINDOW_SECONDS,
  MAX_OTP_REQUESTS_PER_PHONE_PER_HOUR,
  PHONE_IP_WINDOW_SECONDS,
  MAX_OTP_REQUESTS_PER_PHONE_IP_PER_WINDOW,
} from '../domain/value-objects/recovery-policy';
export { evaluateRateLimit, type RateLimitDecision, type RecoveryRequestRecord } from '../domain/services/rate-limit-policy';
export { RecoveryErrorCodes, recoveryError, rateLimitedError, type RecoveryErrorCode } from '../domain/errors/recovery-errors';
export {
  RecoveryEventTypes,
  PASSWORD_RECOVERY_AGGREGATE_TYPE,
  type RecoveryEventType,
  type PasswordResetCompletedPayload,
} from '../domain/events/recovery-events';
export { RECOVERY_ERROR_MESSAGES } from '../application/services/recovery-error-messages';
export { HmacRecoveryCrypto, CryptoRecoverySecrets } from '../infrastructure/security/hmac-recovery-crypto';
export {
  DisabledOtpSender,
  InMemoryOtpSender,
  DevFileOtpSender,
  OtpDeliveryNotConfiguredError,
  createLoggingBackgroundRunner,
} from '../infrastructure/senders/otp-senders';
export { InMemoryRecoveryRepository } from '../infrastructure/services/in-memory-recovery-repository';
export { SequelizeRecoveryRepository } from '../infrastructure/persistence/sequelize/repositories/sequelize-recovery-repository';
export { createRecoveryRouter, type RecoveryRouterDeps } from '../presentation/http/recovery.routes';
