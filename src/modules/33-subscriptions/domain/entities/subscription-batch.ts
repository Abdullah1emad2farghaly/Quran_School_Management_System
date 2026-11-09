import { AggregateRoot, newUuid, type Clock } from '../../../00-shared-kernel/public';
import { createDomainEvent } from '../../../06-domain-events-outbox/public';
import { SubscriptionEventTypes, SUBSCRIPTION_BATCH_AGGREGATE_TYPE, type SubscriptionBatchEventPayload } from '../events/subscription-events';

export interface SubscriptionBatchSnapshot {
  readonly id: string;
  readonly schoolId: string;
  readonly organizationId: string;
  /** `YYYY-MM` (Africa/Cairo). One batch per (school, month), enforced by a unique index. */
  readonly month: string;
  readonly createdBy: string;
  readonly createdAt: Date;
  /** How many subscriptions the run created. */
  readonly count: number;
}

/**
 * The record that the monthly BULK creation of a school was done for a month. Its unique (school, month) key is the concurrency guard of the bulk operation
 * (two simultaneous runs: exactly one wins) and the single source of the answer "the subscriptions of this month have already been created".
 */
export class SubscriptionBatch extends AggregateRoot<string> {
  private constructor(private readonly state: SubscriptionBatchSnapshot) {
    super(state.id);
  }

  static record(input: { schoolId: string; organizationId: string; month: string; count: number; createdBy: string; clock: Clock; id?: string }): SubscriptionBatch {
    const batch = new SubscriptionBatch({
      id: input.id ?? newUuid(),
      schoolId: input.schoolId,
      organizationId: input.organizationId,
      month: input.month,
      createdBy: input.createdBy,
      createdAt: input.clock.now(),
      count: input.count,
    });
    batch.addDomainEvent(
      createDomainEvent<SubscriptionBatchEventPayload>(
        {
          eventType: SubscriptionEventTypes.SUBSCRIPTIONS_CREATED,
          aggregateType: SUBSCRIPTION_BATCH_AGGREGATE_TYPE,
          aggregateId: batch.id,
          payload: { batchId: batch.id, schoolId: input.schoolId, organizationId: input.organizationId, month: input.month, count: input.count, actorId: input.createdBy },
        },
        input.clock,
      ),
    );
    return batch;
  }

  static rehydrate(snapshot: SubscriptionBatchSnapshot): SubscriptionBatch {
    return new SubscriptionBatch(snapshot);
  }

  get snapshot(): SubscriptionBatchSnapshot {
    return this.state;
  }
}
