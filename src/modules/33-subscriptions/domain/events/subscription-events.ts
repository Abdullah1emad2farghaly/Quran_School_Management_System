/**
 * Subscription domain events (outbox, same transaction as the change). Payloads carry identifiers ONLY: no names, phones or amounts.
 *  - SubscriptionsCreated:  a successful BULK creation for a school and month (`batchId` identifies the run; the subscriptions are read through the public contract).
 *  - SubscriptionCreated:   ONE individual subscription created after the bulk creation (a student who joined later).
 *  - SubscriptionPaid:      a subscription moved UNPAID -> PAID through the `markPaid` contract.
 *  - SubscriptionWaived:    a subscription moved UNPAID -> WAIVED by the School Manager.
 *  - SubscriptionMarkedUnpaid: a PAID subscription of the CURRENT month was changed back to UNPAID (history only: no module notifies anyone about it, and it is NOT `SubscriptionPaid`).
 *  - CollectorSchoolLinked / CollectorSchoolLinkRemoved: the Subscription Collector-to-School relationship (with history).
 */
export const SubscriptionEventTypes = {
  SUBSCRIPTIONS_CREATED: 'SubscriptionsCreated',
  SUBSCRIPTION_CREATED: 'SubscriptionCreated',
  SUBSCRIPTION_PAID: 'SubscriptionPaid',
  SUBSCRIPTION_WAIVED: 'SubscriptionWaived',
  SUBSCRIPTION_MARKED_UNPAID: 'SubscriptionMarkedUnpaid',
  COLLECTOR_SCHOOL_LINKED: 'CollectorSchoolLinked',
  COLLECTOR_SCHOOL_LINK_REMOVED: 'CollectorSchoolLinkRemoved',
} as const;
export type SubscriptionEventType = (typeof SubscriptionEventTypes)[keyof typeof SubscriptionEventTypes];

export const SUBSCRIPTION_AGGREGATE_TYPE = 'Subscription';
export const SUBSCRIPTION_BATCH_AGGREGATE_TYPE = 'SubscriptionBatch';
export const COLLECTOR_SCHOOL_LINK_AGGREGATE_TYPE = 'CollectorSchoolLink';

export interface SubscriptionBatchEventPayload {
  readonly batchId: string;
  readonly schoolId: string;
  readonly organizationId: string;
  /** `YYYY-MM` (Africa/Cairo). */
  readonly month: string;
  readonly count: number;
  readonly actorId: string;
}

export interface SubscriptionEventPayload {
  readonly subscriptionId: string;
  readonly studentId: string;
  readonly schoolId: string;
  readonly organizationId: string;
  readonly month: string;
  readonly actorId: string;
}

export interface CollectorSchoolLinkEventPayload {
  readonly linkId: string;
  readonly userId: string;
  readonly schoolId: string;
  readonly organizationId: string;
  readonly actorId: string;
}
