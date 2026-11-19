import { AggregateRoot, newUuid, type Clock } from '../../../00-shared-kernel/public';
import { createDomainEvent } from '../../../06-domain-events-outbox/public';
import { paymentError } from '../errors/payment-errors';
import { PAYMENT_AGGREGATE_TYPE, PaymentEventTypes, type PaymentRecordedPayload, type PaymentReversedPayload } from '../events/payment-events';
import { REVERSAL_REASON_MAX_LENGTH, type PaymentMethod, type PaymentStatus } from '../value-objects/payment-vocabulary';

export interface PaymentSnapshot {
  readonly id: string;
  /** Payment belongs to Student + School + Subscription (§60). */
  readonly subscriptionId: string;
  readonly studentId: string;
  /** The subscription's school (history: a later school change never rewrites it). */
  readonly schoolId: string;
  readonly organizationId: string;
  /** `YYYY-MM` (Africa/Cairo) of the subscription, copied at recording time (a subscription's month never changes). */
  readonly month: string;
  readonly method: PaymentMethod;
  readonly status: PaymentStatus;
  readonly recordedBy: string;
  readonly recordedAt: Date;
  readonly reversedBy: string | null;
  readonly reversedAt: Date | null;
  readonly reversalReason: string | null;
  readonly updatedAt: Date;
  /** Optimistic-lock counter, incremented by the repository on every update. */
  readonly version: number;
}

interface RecordInput {
  readonly subscriptionId: string;
  readonly studentId: string;
  readonly schoolId: string;
  readonly organizationId: string;
  readonly month: string;
  readonly recordedBy: string;
  readonly clock: Clock;
  readonly id?: string;
}

/**
 * A cash payment of ONE subscription (Master Specification §60-§61). No amount is stored (the amount is determined outside the system, §58). SUCCESSFUL -> REVERSED is the only
 * transition; a reversal requires a reason, the actor and the time, and is final (a reversed payment is never edited again and never deleted). Nothing here deletes anything.
 */
export class Payment extends AggregateRoot<string> {
  private constructor(private state: PaymentSnapshot) {
    super(state.id);
  }

  static record(input: RecordInput): Payment {
    const now = input.clock.now();
    const payment = new Payment({
      id: input.id ?? newUuid(),
      subscriptionId: input.subscriptionId,
      studentId: input.studentId,
      schoolId: input.schoolId,
      organizationId: input.organizationId,
      month: input.month,
      method: 'CASH',
      status: 'SUCCESSFUL',
      recordedBy: input.recordedBy,
      recordedAt: now,
      reversedBy: null,
      reversedAt: null,
      reversalReason: null,
      updatedAt: now,
      version: 1,
    });
    payment.addDomainEvent(
      createDomainEvent<PaymentRecordedPayload>(
        { eventType: PaymentEventTypes.PAYMENT_RECORDED, aggregateType: PAYMENT_AGGREGATE_TYPE, aggregateId: payment.id, payload: payment.basePayload(input.recordedBy) },
        input.clock,
      ),
    );
    return payment;
  }

  static rehydrate(snapshot: PaymentSnapshot): Payment {
    return new Payment(snapshot);
  }

  get snapshot(): PaymentSnapshot {
    return this.state;
  }
  get status(): PaymentStatus {
    return this.state.status;
  }

  /** SUCCESSFUL -> REVERSED with a mandatory reason (trimmed, 1..500 characters). A second reversal is refused and changes nothing. */
  reverse(actorId: string, reason: unknown, clock: Clock): void {
    if (this.state.status === 'REVERSED') throw paymentError('PAYMENT_ALREADY_REVERSED');
    const trimmed = typeof reason === 'string' ? reason.trim() : '';
    if (trimmed === '') throw paymentError('PAYMENT_REVERSAL_REASON_REQUIRED');
    if (trimmed.length > REVERSAL_REASON_MAX_LENGTH) throw paymentError('PAYMENT_REVERSAL_REASON_TOO_LONG');
    const now = clock.now();
    this.state = { ...this.state, status: 'REVERSED', reversedBy: actorId, reversedAt: now, reversalReason: trimmed, updatedAt: now };
    this.addDomainEvent(
      createDomainEvent<PaymentReversedPayload>(
        {
          eventType: PaymentEventTypes.PAYMENT_REVERSED,
          aggregateType: PAYMENT_AGGREGATE_TYPE,
          aggregateId: this.id,
          payload: { ...this.basePayload(actorId), previousStatus: 'SUCCESSFUL', status: 'REVERSED', reason: trimmed },
        },
        clock,
      ),
    );
  }

  private basePayload(actorId: string): PaymentRecordedPayload {
    const s = this.state;
    return { paymentId: this.id, subscriptionId: s.subscriptionId, studentId: s.studentId, schoolId: s.schoolId, organizationId: s.organizationId, month: s.month, method: 'CASH', actorId };
  }
}
