/**
 * The approved statuses of a subscription (Master Specification §58): the system tracks only paid, unpaid and waived.
 *   UNPAID --markPaid--> PAID      (through the Module 33 `markPaid` contract, which Module 34 will also call; exposed over HTTP by the approved enhancement)
 *   UNPAID --waive-----> WAIVED    (School Manager only: a Subscription Collector cannot waive in V1, §61)
 *   PAID --markUnpaid--> UNPAID    (ONLY while the subscription's month is the current Africa/Cairo month; a past month is never changed back)
 * WAIVED is final in V1. The payment reversal workflow (reason, audit) belongs to Module 34 and is not part of this module.
 */
export const SUBSCRIPTION_STATUSES = ['PAID', 'UNPAID', 'WAIVED'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const isSubscriptionStatus = (value: unknown): value is SubscriptionStatus => typeof value === 'string' && (SUBSCRIPTION_STATUSES as readonly string[]).includes(value);

/** A month that no longer blocks a newer month (Master Specification §59). */
export const isSettled = (status: SubscriptionStatus): boolean => status === 'PAID' || status === 'WAIVED';
