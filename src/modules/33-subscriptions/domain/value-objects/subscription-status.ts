/**
 * The approved statuses of a subscription (Master Specification §58): the system tracks only paid, unpaid and waived. Module 33 stores and exposes them.
 *   UNPAID <-> PAID   ONLY through Module 34's payment workflow (record / reverse), via `SubscriptionPaymentTransitions` (Oldest-Unpaid Rule §59 enforced there)
 *   UNPAID --waive--> WAIVED   (School Manager only, owned by Module 33: not a payment transaction; a Subscription Collector cannot waive in V1, §61)
 * WAIVED is final in V1.
 */
export const SUBSCRIPTION_STATUSES = ['PAID', 'UNPAID', 'WAIVED'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const isSubscriptionStatus = (value: unknown): value is SubscriptionStatus => typeof value === 'string' && (SUBSCRIPTION_STATUSES as readonly string[]).includes(value);

/** A month that no longer blocks a newer month (Master Specification §59). */
export const isSettled = (status: SubscriptionStatus): boolean => status === 'PAID' || status === 'WAIVED';
