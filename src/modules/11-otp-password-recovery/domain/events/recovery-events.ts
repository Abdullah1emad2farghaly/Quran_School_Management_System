/** Payloads carry ids only: never the OTP, the reset token, the password or a hash. */
export const RecoveryEventTypes = {
  PASSWORD_RESET_COMPLETED: 'PasswordResetCompleted',
} as const;
export type RecoveryEventType = (typeof RecoveryEventTypes)[keyof typeof RecoveryEventTypes];

export const PASSWORD_RECOVERY_AGGREGATE_TYPE = 'PasswordRecovery';

export interface PasswordResetCompletedPayload {
  readonly recoveryId: string;
  readonly userId: string;
}
