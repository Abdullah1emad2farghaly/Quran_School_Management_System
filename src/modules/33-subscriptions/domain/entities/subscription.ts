import { AggregateRoot, newUuid, type Clock } from '../../../00-shared-kernel/public';
import { createDomainEvent } from '../../../06-domain-events-outbox/public';
import { subscriptionError } from '../errors/subscription-errors';
import { SubscriptionEventTypes, SUBSCRIPTION_AGGREGATE_TYPE, type SubscriptionEventPayload } from '../events/subscription-events';
import type { SubscriptionStatus } from '../value-objects/subscription-status';

export interface SubscriptionSnapshot {
  readonly id: string;
  readonly studentId: string;
  /** The student's school at creation time (history: a later school change never rewrites it). */
  readonly schoolId: string;
  readonly organizationId: string;
  /** `YYYY-MM` in Africa/Cairo. */
  readonly month: string;
  readonly status: SubscriptionStatus;
  /** The bulk run that created it; null for an individual subscription. */
  readonly batchId: string | null;
  readonly createdBy: string;
  readonly createdAt: Date;
  readonly paidAt: Date | null;
  readonly paidBy: string | null;
  readonly waivedAt: Date | null;
  readonly waivedBy: string | null;
  readonly updatedAt: Date;
  /** Optimistic-lock counter, incremented by the repository on every update. */
  readonly version: number;
}

interface OpenInput {
  readonly studentId: string;
  readonly schoolId: string;
  readonly organizationId: string;
  readonly month: string;
  readonly createdBy: string;
  readonly clock: Clock;
  readonly id?: string;
}

/**
 * A subscription is exactly Student + Month + Status (Master Specification §58, approved Module 33 decisions): no amount, no proration, no dates of enrollment.
 * A new subscription is always UNPAID. The Oldest-Unpaid Rule (§59) needs the student's other months, so the SERVICE checks it under a lock; this entity only guards its own
 * transitions: UNPAID -> PAID and UNPAID -> WAIVED (PAID and WAIVED are final in V1).
 */
export class Subscription extends AggregateRoot<string> {
  private constructor(private state: SubscriptionSnapshot) {
    super(state.id);
  }

  /** Part of a bulk run: no event of its own (the run publishes ONE `SubscriptionsCreated`). */
  static openInBatch(input: OpenInput & { batchId: string }): Subscription {
    return Subscription.create(input, input.batchId);
  }

  /** An individual subscription (a student who joined after the bulk creation): publishes `SubscriptionCreated`. */
  static openIndividually(input: OpenInput): Subscription {
    const subscription = Subscription.create(input, null);
    subscription.record(SubscriptionEventTypes.SUBSCRIPTION_CREATED, input.createdBy, input.clock);
    return subscription;
  }

  private static create(input: OpenInput, batchId: string | null): Subscription {
    const now = input.clock.now();
    return new Subscription({
      id: input.id ?? newUuid(),
      studentId: input.studentId,
      schoolId: input.schoolId,
      organizationId: input.organizationId,
      month: input.month,
      status: 'UNPAID',
      batchId,
      createdBy: input.createdBy,
      createdAt: now,
      paidAt: null,
      paidBy: null,
      waivedAt: null,
      waivedBy: null,
      updatedAt: now,
      version: 1,
    });
  }

  static rehydrate(snapshot: SubscriptionSnapshot): Subscription {
    return new Subscription(snapshot);
  }

  get snapshot(): SubscriptionSnapshot {
    return this.state;
  }
  get status(): SubscriptionStatus {
    return this.state.status;
  }
  get month(): string {
    return this.state.month;
  }

  /** UNPAID -> PAID. A second payment of the same subscription is refused (one successful payment per subscription, §60). */
  markPaid(actorId: string, clock: Clock): void {
    if (this.state.status === 'PAID') throw subscriptionError('SUBSCRIPTION_ALREADY_PAID');
    if (this.state.status !== 'UNPAID') throw subscriptionError('SUBSCRIPTION_NOT_UNPAID');
    const now = clock.now();
    this.state = { ...this.state, status: 'PAID', paidAt: now, paidBy: actorId, updatedAt: now };
    this.record(SubscriptionEventTypes.SUBSCRIPTION_PAID, actorId, clock);
  }

  /** UNPAID -> WAIVED. */
  waive(actorId: string, clock: Clock): void {
    if (this.state.status !== 'UNPAID') throw subscriptionError('SUBSCRIPTION_NOT_UNPAID');
    const now = clock.now();
    this.state = { ...this.state, status: 'WAIVED', waivedAt: now, waivedBy: actorId, updatedAt: now };
    this.record(SubscriptionEventTypes.SUBSCRIPTION_WAIVED, actorId, clock);
  }

  private record(eventType: typeof SubscriptionEventTypes.SUBSCRIPTION_CREATED | typeof SubscriptionEventTypes.SUBSCRIPTION_PAID | typeof SubscriptionEventTypes.SUBSCRIPTION_WAIVED, actorId: string, clock: Clock): void {
    this.addDomainEvent(
      createDomainEvent<SubscriptionEventPayload>(
        {
          eventType,
          aggregateType: SUBSCRIPTION_AGGREGATE_TYPE,
          aggregateId: this.id,
          payload: { subscriptionId: this.id, studentId: this.state.studentId, schoolId: this.state.schoolId, organizationId: this.state.organizationId, month: this.state.month, actorId },
        },
        clock,
      ),
    );
  }
}
