import { AppError, type ErrorKind } from '../../../00-shared-kernel/public';

export const PaymentErrorCodes = {
  PAYMENT_NOT_FOUND: 'PAYMENT_NOT_FOUND',
  /** The subscription already has a SUCCESSFUL payment (one successful payment per subscription, §60). The unique index is the final guard under concurrency. */
  PAYMENT_ALREADY_RECORDED: 'PAYMENT_ALREADY_RECORDED',
  /** The payment was already reversed: a reversal happens once and its reason, actor and time are never overwritten. */
  PAYMENT_ALREADY_REVERSED: 'PAYMENT_ALREADY_REVERSED',
  /** §60: a reversal requires a reason. */
  PAYMENT_REVERSAL_REASON_REQUIRED: 'PAYMENT_REVERSAL_REASON_REQUIRED',
  PAYMENT_REVERSAL_REASON_TOO_LONG: 'PAYMENT_REVERSAL_REASON_TOO_LONG',
  /** §60: CASH ONLY. */
  PAYMENT_METHOD_NOT_ALLOWED: 'PAYMENT_METHOD_NOT_ALLOWED',
  INVALID_PAYMENT_MONTH: 'INVALID_PAYMENT_MONTH',
  PAYMENT_CONCURRENT_MODIFICATION: 'PAYMENT_CONCURRENT_MODIFICATION',
} as const;
export type PaymentErrorCode = (typeof PaymentErrorCodes)[keyof typeof PaymentErrorCodes];

const KIND: Record<PaymentErrorCode, ErrorKind> = {
  PAYMENT_NOT_FOUND: 'NOT_FOUND',
  PAYMENT_ALREADY_RECORDED: 'CONFLICT',
  PAYMENT_ALREADY_REVERSED: 'CONFLICT',
  PAYMENT_REVERSAL_REASON_REQUIRED: 'VALIDATION',
  PAYMENT_REVERSAL_REASON_TOO_LONG: 'VALIDATION',
  PAYMENT_METHOD_NOT_ALLOWED: 'VALIDATION',
  INVALID_PAYMENT_MONTH: 'VALIDATION',
  PAYMENT_CONCURRENT_MODIFICATION: 'CONFLICT',
};

export function paymentError(code: PaymentErrorCode): AppError {
  return new AppError(code, KIND[code]);
}
