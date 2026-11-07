import { AppError, type ErrorKind } from '../../../00-shared-kernel/public';

export const NotificationErrorCodes = {
  /** The push subscription sent by the browser is not valid (endpoint or keys). */
  INVALID_PUSH_SUBSCRIPTION: 'INVALID_PUSH_SUBSCRIPTION',
  /** Web Push is not configured on this server (no VAPID keys): in-app notifications still work. */
  PUSH_NOT_CONFIGURED: 'PUSH_NOT_CONFIGURED',
  /** The account already has the maximum number of push subscriptions (protective cap). */
  PUSH_SUBSCRIPTION_LIMIT_REACHED: 'PUSH_SUBSCRIPTION_LIMIT_REACHED',
} as const;
export type NotificationErrorCode = (typeof NotificationErrorCodes)[keyof typeof NotificationErrorCodes];

const KIND: Record<NotificationErrorCode, ErrorKind> = {
  INVALID_PUSH_SUBSCRIPTION: 'VALIDATION',
  PUSH_NOT_CONFIGURED: 'BUSINESS_RULE',
  PUSH_SUBSCRIPTION_LIMIT_REACHED: 'BUSINESS_RULE',
};

export function notificationError(code: NotificationErrorCode, details?: unknown): AppError {
  return new AppError(code, KIND[code], details);
}

/** A programming error of the CALLER module (unknown template, bad parameters): never a user error, reported as an internal error. */
export class NotificationDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotificationDefinitionError';
  }
}
