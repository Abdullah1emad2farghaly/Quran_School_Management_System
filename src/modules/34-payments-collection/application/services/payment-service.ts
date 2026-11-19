import { AppError, SystemClock, newUuid, buildPageResult, type Clock, type PageRequest, type PageResult, type TransactionContext, type UnitOfWork } from '../../../00-shared-kernel/public';
import type { OutboxService } from '../../../06-domain-events-outbox/public';
import { isBillingMonth, type SubscriptionPayments } from '../../../33-subscriptions/public';
import { Payment } from '../../domain/entities/payment';
import { paymentError } from '../../domain/errors/payment-errors';
import { isPaymentMethod, type PaymentStatus } from '../../domain/value-objects/payment-vocabulary';
import { toPaymentDto, type PaymentDto, type PaymentScopeDto } from '../dto/payment-dto';
import type { PaymentRepository, PaymentStatusCount, PaymentStatusCountQuery } from '../ports/payment-repository';

export interface PaymentServiceDeps {
  readonly payments: PaymentRepository;
  /** Module 33's controlled internal contract (`applyPaymentRecorded` / `applyPaymentReversed`): the only way a subscription moves between UNPAID and PAID (Oldest-Unpaid Rule §59 lives there). */
  readonly subscriptions: SubscriptionPayments;
  readonly unitOfWork: UnitOfWork;
  readonly outbox: OutboxService;
  readonly clock?: Clock;
}

export interface ListPaymentsInput {
  readonly schoolId: string;
  readonly month?: string;
  readonly status?: readonly PaymentStatus[];
  readonly studentId?: string;
  readonly subscriptionId?: string;
  readonly direction?: 'asc' | 'desc';
  readonly page: PageRequest;
}

/**
 * Application contract of Module 34 (Payments & Collection), Master Specification §60-§61.
 *
 * It does NOT authorize its callers: the routes use the Authorization Engine (`payments.*` permissions) first. What it enforces itself:
 *  - CASH ONLY: a payment has no other method and stores NO amount (the amount is determined outside the system, §58);
 *  - Module 34 OWNS the whole payment lifecycle (record, validate, reverse, audit, events); Module 33 only stores the status and offers the controlled transition contract below;
 *  - recording a payment is ONE transaction: the new payment row (Student + School + Subscription) with its `PaymentRecorded` event (the only trigger of the Parent's payment-recorded
 *    notification) and Module 33's `applyPaymentRecorded` (UNPAID -> PAID with the Oldest-Unpaid Rule §59). If either fails nothing is kept;
 *  - ONE successful payment per subscription: Module 33 refuses an already PAID subscription and a unique index refuses a second SUCCESSFUL row under concurrency;
 *  - a payment is NEVER hard-deleted: there is no delete anywhere;
 *  - REVERSAL needs a reason, the actor and the time (stored on the payment, kept forever) and is audited (`PaymentReversed`). It is ONE transaction with Module 33's `applyPaymentReversed`
 *    (PAID -> UNPAID, refused while a NEWER month of the student is PAID so §59 is never broken). A payment can be reversed only once and is never deleted. A subscription that is ALREADY UNPAID
 *    (legacy data: it was un-paid by the removed Module 33 `mark-unpaid` correction after this payment was recorded) does not block closing the stale payment. A reversed payment stays as history;
 *    the subscription can be paid again by a NEW payment.
 */
export class PaymentService {
  private readonly payments: PaymentRepository;
  private readonly subscriptions: SubscriptionPayments;
  private readonly unitOfWork: UnitOfWork;
  private readonly outbox: OutboxService;
  private readonly clock: Clock;

  constructor(deps: PaymentServiceDeps) {
    this.payments = deps.payments;
    this.subscriptions = deps.subscriptions;
    this.unitOfWork = deps.unitOfWork;
    this.outbox = deps.outbox;
    this.clock = deps.clock ?? new SystemClock();
  }

  /**
   * Records the cash payment of a subscription. `method` is optional for callers and, when given, must be CASH. The caller (the route) has already proven the actor is the School Manager or
   * the school's Subscription Collector of the subscription's school.
   */
  async recordPayment(subscriptionId: string, actorId: string, method?: unknown, tx?: TransactionContext): Promise<PaymentDto> {
    if (method !== undefined && !isPaymentMethod(method)) throw paymentError('PAYMENT_METHOD_NOT_ALLOWED');
    return this.inTransaction(tx, async (t) => {
      // The payment id is fixed first so the status transition is attributable to this payment. Module 33 then changes the status: SUBSCRIPTION_NOT_FOUND / SUBSCRIPTION_ALREADY_PAID /
      // SUBSCRIPTION_NOT_UNPAID / OLDER_UNPAID_SUBSCRIPTIONS_EXIST leave nothing behind (same transaction).
      const paymentId = newUuid();
      const subscription = await this.subscriptions.applyPaymentRecorded({ subscriptionId, paymentId, actorId }, t);
      const payment = Payment.record({
        id: paymentId,
        subscriptionId: subscription.id,
        studentId: subscription.studentId,
        schoolId: subscription.schoolId,
        organizationId: subscription.organizationId,
        month: subscription.month,
        recordedBy: actorId,
        clock: this.clock,
      });
      await this.payments.insert(payment, t); // the unique (subscription, active) index is the final guard under concurrency
      await this.outbox.publishFrom(payment, t);
      return toPaymentDto(payment);
    });
  }

  /** Reverses a SUCCESSFUL payment with a mandatory reason; the subscription goes back to UNPAID in the same transaction. */
  reversePayment(paymentId: string, reason: unknown, actorId: string, tx?: TransactionContext): Promise<PaymentDto> {
    return this.inTransaction(tx, async (t) => {
      const payment = await this.payments.lockById(paymentId, t);
      if (!payment) throw paymentError('PAYMENT_NOT_FOUND');
      payment.reverse(actorId, reason, this.clock); // already reversed / reason checks first: nothing has changed yet
      try {
        await this.subscriptions.applyPaymentReversed({ subscriptionId: payment.snapshot.subscriptionId, paymentId: payment.id, actorId }, t);
      } catch (error) {
        // The subscription is ALREADY UNPAID (legacy data: the removed Module 33 `mark-unpaid` correction ran after this payment was recorded): the status is already what the reversal
        // wants, so the stale SUCCESSFUL row can still be closed with its reason, actor and time (audited). Every other refusal (a newer month is PAID, WAIVED...) stands.
        if (!(error instanceof AppError) || error.code !== 'SUBSCRIPTION_ALREADY_UNPAID') throw error;
      }
      await this.payments.update(payment, t);
      await this.outbox.publishFrom(payment, t);
      return toPaymentDto(payment);
    });
  }

  async getPayment(paymentId: string, tx?: TransactionContext): Promise<PaymentDto> {
    const payment = await this.payments.findById(paymentId, tx);
    if (!payment) throw paymentError('PAYMENT_NOT_FOUND');
    return toPaymentDto(payment);
  }

  async listPaymentsOfSchool(input: ListPaymentsInput, tx?: TransactionContext): Promise<PageResult<PaymentDto>> {
    if (input.month !== undefined && !isBillingMonth(input.month)) throw paymentError('INVALID_PAYMENT_MONTH');
    const { items, total } = await this.payments.list(
      {
        schoolId: input.schoolId,
        ...(input.month !== undefined ? { month: input.month } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.studentId ? { studentId: input.studentId } : {}),
        ...(input.subscriptionId ? { subscriptionId: input.subscriptionId } : {}),
        direction: input.direction ?? 'desc',
        page: input.page,
      },
      tx,
    );
    return buildPageResult(items.map(toPaymentDto), total, input.page);
  }

  /** Read-only aggregate for reports (Module 38): payments per school, billing month and status. The caller (the report) has already proven the schools lie inside the requester's scope. */
  countPaymentsForReport(query: PaymentStatusCountQuery, tx?: TransactionContext): Promise<PaymentStatusCount[]> {
    return this.payments.countByStatus(query, tx);
  }

  /** What the authorization scope resolver needs: the payment's school (loaded from the server, never from the request). */
  async findScopeById(paymentId: string, tx?: TransactionContext): Promise<PaymentScopeDto | undefined> {
    const payment = await this.payments.findById(paymentId, tx);
    if (!payment) return undefined;
    const s = payment.snapshot;
    return { id: s.id, schoolId: s.schoolId, organizationId: s.organizationId };
  }

  private inTransaction<T>(tx: TransactionContext | undefined, work: (tx: TransactionContext) => Promise<T>): Promise<T> {
    return tx ? work(tx) : this.unitOfWork.run(work);
  }
}

/** What other modules (reports, audit) may depend on: read-only. */
export type PaymentLookup = Pick<PaymentService, 'getPayment' | 'listPaymentsOfSchool' | 'findScopeById' | 'countPaymentsForReport'>;
