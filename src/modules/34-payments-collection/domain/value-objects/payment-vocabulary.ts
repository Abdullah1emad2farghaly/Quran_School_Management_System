/**
 * Payment vocabulary (Master Specification §60). The payment method is CASH ONLY in V1: it is a closed list of one, so nothing else can ever be stored or accepted.
 * A payment is SUCCESSFUL until it is REVERSED; a reversed payment is kept forever (a successful payment is never hard-deleted) and a subscription can be paid again afterwards
 * by a NEW payment row.
 */
export const PAYMENT_METHODS = ['CASH'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const isPaymentMethod = (value: unknown): value is PaymentMethod => typeof value === 'string' && (PAYMENT_METHODS as readonly string[]).includes(value);

export const PAYMENT_STATUSES = ['SUCCESSFUL', 'REVERSED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** A reversal needs a non-empty reason (§60); this is its maximum length after trimming. */
export const REVERSAL_REASON_MAX_LENGTH = 500;
