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
 * transitions: UNPAID -> PAID, UNPAID -> WAIVED and, in the current month only, PAID -> UNPAID (WAIVED is final in V1).
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

  /**
   * PAID -> UNPAID, only during the subscription's own calendar month (`currentMonth`, Africa/Cairo, taken from the server clock by the caller). Checks in this order:
   *  1. the month is not the current one (a past month, or an impossible future one) -> SUBSCRIPTION_MONTH_NOT_CURRENT, whatever the status;
   *  2. already UNPAID -> SUBSCRIPTION_ALREADY_UNPAID (an unnecessary transition);
   *  3. any other status (WAIVED) -> SUBSCRIPTION_NOT_PAID.
   * The paid audit columns are cleared (the database CHECK requires an UNPAID row to have none); the history of who paid and who reverted lives in the outbox events
   * `SubscriptionPaid` and `SubscriptionMarkedUnpaid`. This is a status correction, NOT the payment reversal workflow of Module 34, and it never publishes `SubscriptionPaid`.
   */
  markUnpaid(actorId: string, currentMonth: string, clock: Clock): void {
    if (this.state.month !== currentMonth) throw subscriptionError('SUBSCRIPTION_MONTH_NOT_CURRENT');
    if (this.state.status === 'UNPAID') throw subscriptionError('SUBSCRIPTION_ALREADY_UNPAID');
    if (this.state.status !== 'PAID') throw subscriptionError('SUBSCRIPTION_NOT_PAID');
    this.state = { ...this.state, status: 'UNPAID', paidAt: null, paidBy: null, updatedAt: clock.now() };
    this.record(SubscriptionEventTypes.SUBSCRIPTION_MARKED_UNPAID, actorId, clock);
  }

  /** UNPAID -> WAIVED. */
  waive(actorId: string, clock: Clock): void {
    if (this.state.status !== 'UNPAID') throw subscriptionError('SUBSCRIPTION_NOT_UNPAID');
    const now = clock.now();
    this.state = { ...this.state, status: 'WAIVED', waivedAt: now, waivedBy: actorId, updatedAt: now };
    this.record(SubscriptionEventTypes.SUBSCRIPTION_WAIVED, actorId, clock);
  }

  private record(eventType: typeof SubscriptionEventTypes.SUBSCRIPTION_CREATED | typeof SubscriptionEventTypes.SUBSCRIPTION_PAID | typeof SubscriptionEventTypes.SUBSCRIPTION_WAIVED | typeof SubscriptionEventTypes.SUBSCRIPTION_MARKED_UNPAID, actorId: string, clock: Clock): void {
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
