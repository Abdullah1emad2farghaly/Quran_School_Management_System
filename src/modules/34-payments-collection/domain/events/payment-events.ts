/**
 * Payment domain events (outbox, same transaction as the change). Payloads carry identifiers, the month, the method and (for a reversal) the reason ONLY: no names, phones or amounts
 * (no amount is stored in V1).
 *  - PaymentRecorded: a SUCCESSFUL cash payment of a subscription was recorded (the subscription became PAID in the same transaction; Module 33 publishes the `SubscriptionPaid` state event,
 *    state event). `PaymentRecorded` is the ONLY trigger of the Parent's payment-recorded notification (Modules 31/32 consume it; the Collector is never notified of an individual payment;
 *    Module 34 creates no notification itself).
 *  - PaymentReversed: a payment was reversed with a reason (the subscription became UNPAID in the same transaction). Carries `previousStatus` / `status` (audit before/after) and `reason`.
 */
export const PaymentEventTypes = {
  PAYMENT_RECORDED: 'PaymentRecorded',
  PAYMENT_REVERSED: 'PaymentReversed',
} as const;
export type PaymentEventType = (typeof PaymentEventTypes)[keyof typeof PaymentEventTypes];

export const PAYMENT_AGGREGATE_TYPE = 'Payment';

export interface PaymentRecordedPayload {
  readonly paymentId: string;
  readonly subscriptionId: string;
  readonly studentId: string;
  readonly schoolId: string;
  readonly organizationId: string;
  /** `YYYY-MM` (Africa/Cairo) of the paid subscription. */
  readonly month: string;
  readonly method: 'CASH';
  readonly actorId: string;
}

export interface PaymentReversedPayload extends PaymentRecordedPayload {
  readonly previousStatus: 'SUCCESSFUL';
  readonly status: 'REVERSED';
  readonly reason: string;
}
