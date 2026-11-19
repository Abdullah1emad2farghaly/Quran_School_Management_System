import { SystemClock, isUuid, type Clock, type TransactionContext } from '../../../00-shared-kernel/public';
import type { OutboxService } from '../../../06-domain-events-outbox/public';
import { subscriptionError } from '../../domain/errors/subscription-errors';
import { isSettled } from '../../domain/value-objects/subscription-status';
import { toSubscriptionDto, type SubscriptionDto } from '../dto/subscription-dto';
import type { SubscriptionRepository } from '../ports/subscription-repository';

export interface SubscriptionPaymentTransitionsDeps {
  readonly subscriptions: SubscriptionRepository;
  readonly outbox: OutboxService;
  readonly clock?: Clock;
}

/** Identifies the Module 34 payment that causes a transition. The payment row is written in the SAME transaction (`tx`), so this id is always a real, auditable payment of Module 34. */
export interface PaymentTransitionInput {
  readonly subscriptionId: string;
  readonly paymentId: string;
  readonly actorId: string;
}

/**
 * THE ONLY way a subscription moves between UNPAID and PAID (approved decision: Module 34 exclusively owns PAID <-> UNPAID; Module 33 stores and exposes the status).
 *
 * It is a controlled internal contract, never an HTTP operation, and it is deliberately NOT part of `SubscriptionService` / `SubscriptionLookup`, so no module that only
 * receives those can change a payment status. It is composed once and handed to Module 34's payment workflow only. Two guards make it unusable as a general status update:
 *  - a transaction (`tx`) is REQUIRED: the transition can only run inside the payment transaction of Module 34, never standalone (the payment row and the status change commit or fail together);
 *  - a Module 34 `paymentId` is REQUIRED (a UUID) and travels with the transition so the status change is always attributable to one payment.
 *
 * Rules enforced here (Master Specification §59-§60, approved Module 33/34 decisions):
 *  - `applyPaymentRecorded`: UNPAID -> PAID. The student's subscriptions are locked first (concurrent payments of one student are serialized). Already PAID is SUBSCRIPTION_ALREADY_PAID
 *    (no duplicate payment), WAIVED is SUBSCRIPTION_NOT_UNPAID, and an older month that is neither PAID nor WAIVED refuses it (OLDER_UNPAID_SUBSCRIPTIONS_EXIST: the Oldest-Unpaid Rule).
 *  - `applyPaymentReversed`: PAID -> UNPAID, with NO current-month restriction. It is refused while a NEWER month of the student is PAID (NEWER_PAID_SUBSCRIPTIONS_EXIST) so an older month never
 *    becomes UNPAID behind a PAID newer one (the Oldest-Unpaid Rule after a reversal). Already UNPAID is SUBSCRIPTION_ALREADY_UNPAID; WAIVED is SUBSCRIPTION_NOT_PAID.
 * Both publish the subscription's state event in the same transaction (`SubscriptionPaid` / `SubscriptionMarkedUnpaid`). WAIVED is NOT handled here: it stays in `SubscriptionService.waiveSubscription`.
 */
export class SubscriptionPaymentTransitions {
  private readonly subscriptions: SubscriptionRepository;
  private readonly outbox: OutboxService;
  private readonly clock: Clock;

  constructor(deps: SubscriptionPaymentTransitionsDeps) {
    this.subscriptions = deps.subscriptions;
    this.outbox = deps.outbox;
    this.clock = deps.clock ?? new SystemClock();
  }

  async applyPaymentRecorded(input: PaymentTransitionInput, tx: TransactionContext): Promise<SubscriptionDto> {
    this.assertWorkflow(input, tx);
    const { target, all } = await this.lockTarget(input.subscriptionId, tx);
    if (target.status === 'PAID') throw subscriptionError('SUBSCRIPTION_ALREADY_PAID');
    if (target.status !== 'UNPAID') throw subscriptionError('SUBSCRIPTION_NOT_UNPAID');
    if (all.some((other) => other.month < target.month && !isSettled(other.status))) throw subscriptionError('OLDER_UNPAID_SUBSCRIPTIONS_EXIST');
    target.markPaid(input.actorId, this.clock);
    await this.subscriptions.update(target, tx);
    await this.outbox.publishFrom(target, tx);
    return toSubscriptionDto(target);
  }

  async applyPaymentReversed(input: PaymentTransitionInput, tx: TransactionContext): Promise<SubscriptionDto> {
    this.assertWorkflow(input, tx);
    const { target, all } = await this.lockTarget(input.subscriptionId, tx);
    if (target.status === 'UNPAID') throw subscriptionError('SUBSCRIPTION_ALREADY_UNPAID');
    if (target.status !== 'PAID') throw subscriptionError('SUBSCRIPTION_NOT_PAID');
    if (all.some((other) => other.month > target.month && other.status === 'PAID')) throw subscriptionError('NEWER_PAID_SUBSCRIPTIONS_EXIST');
    target.revertPayment(input.actorId, this.clock);
    await this.subscriptions.update(target, tx);
    await this.outbox.publishFrom(target, tx);
    return toSubscriptionDto(target);
  }

  /** Refuses anything that is not a payment-workflow call: a missing transaction or a payment id that is not a UUID. */
  private assertWorkflow(input: PaymentTransitionInput, tx: TransactionContext | undefined): void {
    if (!tx || !isUuid(input.paymentId)) throw subscriptionError('SUBSCRIPTION_TRANSITION_NOT_ALLOWED');
  }

  private async lockTarget(subscriptionId: string, tx: TransactionContext) {
    const probe = await this.subscriptions.findById(subscriptionId, tx);
    if (!probe) throw subscriptionError('SUBSCRIPTION_NOT_FOUND');
    const all = await this.subscriptions.lockAllOfStudent(probe.snapshot.studentId, tx);
    const target = all.find((s) => s.id === subscriptionId);
    if (!target) throw subscriptionError('SUBSCRIPTION_NOT_FOUND');
    return { target, all };
  }
}

/** What Module 34's payment workflow receives; nothing else in the system is given this contract. */
export type SubscriptionPayments = Pick<SubscriptionPaymentTransitions, 'applyPaymentRecorded' | 'applyPaymentReversed'>;
