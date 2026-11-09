/**
 * The approved statuses of a subscription (Master Specification §58): the system tracks only paid, unpaid and waived.
 *   UNPAID --markPaid--> PAID      (only through the Module 33 `markPaid` contract that Module 34 calls; never over HTTP)
 *   UNPAID --waive-----> WAIVED    (School Manager only: a Subscription Collector cannot waive in V1, §61)
 * PAID and WAIVED are final in V1 (a payment reversal belongs to Module 34 and is not part of this module).
 */
export const SUBSCRIPTION_STATUSES = ['PAID', 'UNPAID', 'WAIVED'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const isSubscriptionStatus = (value: unknown): value is SubscriptionStatus => typeof value === 'string' && (SUBSCRIPTION_STATUSES as readonly string[]).includes(value);

/** A month that no longer blocks a newer month (Master Specification §59). */
export const isSettled = (status: SubscriptionStatus): boolean => status === 'PAID' || status === 'WAIVED';
