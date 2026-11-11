import { SystemClock, buildPageResult, type Clock, type PageRequest, type PageResult, type TransactionContext, type UnitOfWork } from '../../../00-shared-kernel/public';
import type { OutboxService } from '../../../06-domain-events-outbox/public';
import type { SchoolLookup } from '../../../16-schools/public';
import { Subscription } from '../../domain/entities/subscription';
import { SubscriptionBatch } from '../../domain/entities/subscription-batch';
import { subscriptionError } from '../../domain/errors/subscription-errors';
import { currentBillingMonth, isBillingMonth } from '../../domain/value-objects/billing-month';
import { isSettled, type SubscriptionStatus } from '../../domain/value-objects/subscription-status';
import { toBatchDto, toSubscriptionDto, type BulkCreationResultDto, type SubscriptionBatchDto, type SubscriptionDto, type SubscriptionScopeDto, type SubscriptionViewDto } from '../dto/subscription-dto';
import type { SubscriptionRepository } from '../ports/subscription-repository';
import type { StudentRoster } from '../ports/student-roster';

export interface ListSubscriptionsInput {
  readonly schoolId: string;
  readonly month?: string;
  readonly status?: readonly SubscriptionStatus[];
  readonly studentId?: string;
  readonly direction?: 'asc' | 'desc';
  readonly page: PageRequest;
}

export interface SubscriptionServiceDeps {
  readonly subscriptions: SubscriptionRepository;
  readonly roster: StudentRoster;
  readonly schools: Pick<SchoolLookup, 'findById'>;
  readonly unitOfWork: UnitOfWork;
  readonly outbox: OutboxService;
  readonly clock?: Clock;
}

/**
 * Public application contract of Module 33 (Subscriptions), Master Specification §58-§61 and the approved Module 33 decisions.
 *
 * It does NOT authorize its callers: routes use the Authorization Engine (`subscriptions.*` permissions) first. What it enforces itself:
 *  - a subscription is exactly Student + Month + Status (PAID / UNPAID / WAIVED): no fee, proration or enrollment-date rule exists anywhere;
 *  - the MONTH is never chosen by the caller: it is the current month in Africa/Cairo, taken from the server clock;
 *  - BULK creation (School Manager or the school's Collector) creates one UNPAID subscription for every ACTIVE student of the school, once per (school, month). The unique
 *    (school, month) batch row is the concurrency guard: of two simultaneous runs exactly one wins and the other is told the month was already created (nothing is duplicated);
 *  - INDIVIDUAL creation (a student who joined after the bulk run) needs that bulk run to exist for the month and refuses a second subscription for the same Student + Month;
 *  - WAIVING is UNPAID -> WAIVED (the route lets only the School Manager do it: a Collector cannot waive in V1);
 *  - `markPaid` is the contract Module 34 (Payments & Collection) calls when a payment is recorded. It applies the Oldest-Unpaid Rule (§59) exactly: a newer month cannot be paid
 *    until every OLDER month of the student is PAID or WAIVED (a month the student has no subscription for does not count). It is not exposed over HTTP.
 * Every write is one transaction together with its outbox events.
 */
export class SubscriptionService {
  private readonly subscriptions: SubscriptionRepository;
  private readonly roster: StudentRoster;
  private readonly schools: SubscriptionServiceDeps['schools'];
  private readonly unitOfWork: UnitOfWork;
  private readonly outbox: OutboxService;
  private readonly clock: Clock;

  constructor(deps: SubscriptionServiceDeps) {
    this.subscriptions = deps.subscriptions;
    this.roster = deps.roster;
    this.schools = deps.schools;
    this.unitOfWork = deps.unitOfWork;
    this.outbox = deps.outbox;
    this.clock = deps.clock ?? new SystemClock();
  }

  // ---------------------------------------------------------------------------------------------- creation

  /** Bulk creation for the CURRENT Africa/Cairo month. Refuses (nothing is created) when the school already has that month. */
  createMonthlySubscriptions(schoolId: string, actorId: string, tx?: TransactionContext): Promise<BulkCreationResultDto> {
    return this.inTransaction(tx, async (t) => {
      const school = await this.schools.findById(schoolId, t);
      if (!school || school.status !== 'ACTIVE') throw subscriptionError('SUBSCRIPTION_SCHOOL_NOT_ACTIVE');
      const month = currentBillingMonth(this.clock.now());
      if (await this.subscriptions.findBatchBySchoolMonth(school.id, month, t)) throw subscriptionError('SUBSCRIPTIONS_ALREADY_CREATED_FOR_MONTH');

      const studentIds = await this.roster.listActiveStudentIds(school.id, t);
      if (studentIds.length === 0) throw subscriptionError('SUBSCRIPTION_NO_ACTIVE_STUDENTS');

      // The batch row first: its unique (school, month) key makes a concurrent second run wait for this transaction and then fail with ALREADY_CREATED.
      const batch = SubscriptionBatch.record({ schoolId: school.id, organizationId: school.organizationId, month, count: studentIds.length, createdBy: actorId, clock: this.clock });
      await this.subscriptions.insertBatch(batch, t);
      const created = studentIds.map((studentId) => Subscription.openInBatch({ studentId, schoolId: school.id, organizationId: school.organizationId, month, createdBy: actorId, batchId: batch.id, clock: this.clock }));
      await this.subscriptions.insertMany(created, t);
      await this.outbox.publishFrom(batch, t);
      const s = batch.snapshot;
      return { batchId: s.id, schoolId: s.schoolId, month: s.month, count: s.count, createdAt: s.createdAt };
    });
  }

  /** ONE subscription for the current month for a student of `schoolId` (a student who joined after the bulk run). Duplicate-protected. */
  createIndividualSubscription(schoolId: string, studentId: string, actorId: string, tx?: TransactionContext): Promise<SubscriptionDto> {
    return this.inTransaction(tx, async (t) => {
      const school = await this.schools.findById(schoolId, t);
      if (!school || school.status !== 'ACTIVE') throw subscriptionError('SUBSCRIPTION_SCHOOL_NOT_ACTIVE');
      const student = await this.roster.find(studentId, t);
      if (!student) throw subscriptionError('SUBSCRIPTION_STUDENT_NOT_FOUND');
      if (student.schoolId !== school.id) throw subscriptionError('SUBSCRIPTION_STUDENT_NOT_IN_SCHOOL');
      if (student.status !== 'ACTIVE') throw subscriptionError('SUBSCRIPTION_STUDENT_NOT_ACTIVE');
      const month = currentBillingMonth(this.clock.now());
      if (!(await this.subscriptions.findBatchBySchoolMonth(school.id, month, t))) throw subscriptionError('SUBSCRIPTIONS_NOT_CREATED_FOR_MONTH');
      if (await this.subscriptions.findByStudentMonth(student.id, month, t)) throw subscriptionError('SUBSCRIPTION_ALREADY_EXISTS');

      const subscription = Subscription.openIndividually({ studentId: student.id, schoolId: school.id, organizationId: school.organizationId, month, createdBy: actorId, clock: this.clock });
      await this.subscriptions.insert(subscription, t); // the unique (student, month) index is the final guard under concurrency
      await this.outbox.publishFrom(subscription, t);
      return toSubscriptionDto(subscription);
    });
  }

  // ---------------------------------------------------------------------------------------------- status changes

  /** UNPAID -> WAIVED. The caller (the route) has already proven the actor is the School Manager of the subscription's school. */
  waiveSubscription(subscriptionId: string, actorId: string, tx?: TransactionContext): Promise<SubscriptionDto> {
    return this.inTransaction(tx, async (t) => {
      const subscription = await this.subscriptions.lockById(subscriptionId, t);
      if (!subscription) throw subscriptionError('SUBSCRIPTION_NOT_FOUND');
      subscription.waive(actorId, this.clock);
      await this.subscriptions.update(subscription, t);
      await this.outbox.publishFrom(subscription, t);
      return toSubscriptionDto(subscription);
    });
  }

  /**
   * UNPAID -> PAID: the contract Module 34 calls when a payment is successfully recorded (pass its `tx` to make the payment and the status change ONE transaction).
   * Nothing here collects money. THE OLDEST-UNPAID RULE (Master Specification §59, applied exactly): the student's subscriptions are locked, and the payment is refused with
   * OLDER_UNPAID_SUBSCRIPTIONS_EXIST while ANY older month of the same student is neither PAID nor WAIVED. A newer month does not block an older one. Already PAID is
   * SUBSCRIPTION_ALREADY_PAID (one successful payment per subscription, §60); WAIVED is SUBSCRIPTION_NOT_UNPAID. Publishes `SubscriptionPaid` in the same transaction.
   */
  markPaid(subscriptionId: string, actorId: string, tx?: TransactionContext): Promise<SubscriptionDto> {
    return this.inTransaction(tx, async (t) => {
      const probe = await this.subscriptions.findById(subscriptionId, t);
      if (!probe) throw subscriptionError('SUBSCRIPTION_NOT_FOUND');
      const all = await this.subscriptions.lockAllOfStudent(probe.snapshot.studentId, t);
      const target = all.find((s) => s.id === subscriptionId);
      if (!target) throw subscriptionError('SUBSCRIPTION_NOT_FOUND');
      if (target.status === 'PAID') throw subscriptionError('SUBSCRIPTION_ALREADY_PAID');
      if (target.status !== 'UNPAID') throw subscriptionError('SUBSCRIPTION_NOT_UNPAID');
      if (all.some((other) => other.month < target.month && !isSettled(other.status))) throw subscriptionError('OLDER_UNPAID_SUBSCRIPTIONS_EXIST');
      target.markPaid(actorId, this.clock);
      await this.subscriptions.update(target, t);
      await this.outbox.publishFrom(target, t);
      return toSubscriptionDto(target);
    });
  }

  /**
   * PAID -> UNPAID (approved enhancement), ONLY for the subscription's own calendar month: the current Africa/Cairo month is taken from the server clock INSIDE the transaction, and a subscription of
   * any other month is refused whatever its status (SUBSCRIPTION_MONTH_NOT_CURRENT). Then: already UNPAID -> SUBSCRIPTION_ALREADY_UNPAID; WAIVED -> SUBSCRIPTION_NOT_PAID.
   *
   * THE OLDEST-UNPAID RULE (§59, "a newer month cannot be paid until all older months are PAID or WAIVED") IS PRESERVED: the student's subscriptions are locked exactly like `markPaid`, so the
   * two are serialized; the changed month is by construction the NEWEST month the student can have (months are only ever created for the current Africa/Cairo month), so no newer PAID month can be
   * left behind an unpaid one. This is also enforced, not merely assumed: if any NEWER month of the student is PAID the change is refused (NEWER_PAID_SUBSCRIPTIONS_EXIST).
   * It publishes `SubscriptionMarkedUnpaid` (never `SubscriptionPaid`) in the same transaction. It is a status correction, not the payment reversal workflow that belongs to Module 34.
   */
  markUnpaid(subscriptionId: string, actorId: string, tx?: TransactionContext): Promise<SubscriptionDto> {
    return this.inTransaction(tx, async (t) => {
      const probe = await this.subscriptions.findById(subscriptionId, t);
      if (!probe) throw subscriptionError('SUBSCRIPTION_NOT_FOUND');
      const all = await this.subscriptions.lockAllOfStudent(probe.snapshot.studentId, t);
      const target = all.find((s) => s.id === subscriptionId);
      if (!target) throw subscriptionError('SUBSCRIPTION_NOT_FOUND');
      const currentMonth = currentBillingMonth(this.clock.now());
      target.markUnpaid(actorId, currentMonth, this.clock); // month, then status, checks (the entity refuses before anything changes)
      if (all.some((other) => other.month > target.month && other.status === 'PAID')) throw subscriptionError('NEWER_PAID_SUBSCRIPTIONS_EXIST');
      await this.subscriptions.update(target, t);
      await this.outbox.publishFrom(target, t);
      return toSubscriptionDto(target);
    });
  }

  // ---------------------------------------------------------------------------------------------- reads

  async getSubscription(subscriptionId: string, tx?: TransactionContext): Promise<SubscriptionViewDto> {
    const subscription = await this.subscriptions.findById(subscriptionId, tx);
    if (!subscription) throw subscriptionError('SUBSCRIPTION_NOT_FOUND');
    return (await this.withStudentNames([subscription], tx))[0]!;
  }

  /** The subscriptions of a school (the route has already proven the caller may read that school). Newest month first by default. */
  async listSubscriptionsOfSchool(input: ListSubscriptionsInput, tx?: TransactionContext): Promise<PageResult<SubscriptionViewDto>> {
    if (input.month !== undefined && !isBillingMonth(input.month)) throw subscriptionError('INVALID_SUBSCRIPTION_MONTH');
    const { items, total } = await this.subscriptions.list(
      { schoolId: input.schoolId, ...(input.month !== undefined ? { month: input.month } : {}), ...(input.status ? { status: input.status } : {}), ...(input.studentId ? { studentId: input.studentId } : {}), direction: input.direction ?? 'desc', page: input.page },
      tx,
    );
    return buildPageResult(await this.withStudentNames(items, tx), total, input.page);
  }

  /** The current month (Africa/Cairo) the next bulk creation would use. */
  currentMonth(): string {
    return currentBillingMonth(this.clock.now());
  }

  // ---------------------------------------------------------------------------------------------- SubscriptionLookup (read-only contract for other modules)

  async findById(subscriptionId: string, tx?: TransactionContext): Promise<SubscriptionDto | undefined> {
    const subscription = await this.subscriptions.findById(subscriptionId, tx);
    return subscription ? toSubscriptionDto(subscription) : undefined;
  }

  /** What the Authorization Engine resolver needs, read from the server. */
  async findScopeById(subscriptionId: string, tx?: TransactionContext): Promise<SubscriptionScopeDto | undefined> {
    const subscription = await this.subscriptions.findById(subscriptionId, tx);
    if (!subscription) return undefined;
    const s = subscription.snapshot;
    return { id: s.id, schoolId: s.schoolId, organizationId: s.organizationId, studentId: s.studentId };
  }

  /** The bulk run (school and month) a `SubscriptionsCreated` event refers to. */
  async findBatchById(batchId: string, tx?: TransactionContext): Promise<SubscriptionBatchDto | undefined> {
    const batch = await this.subscriptions.findBatchById(batchId, tx);
    return batch ? toBatchDto(batch) : undefined;
  }

  /** The subscriptions a bulk run created (any status: the reminders re-check the CURRENT status themselves). */
  async listOfBatch(batchId: string, tx?: TransactionContext): Promise<SubscriptionDto[]> {
    return (await this.subscriptions.listByBatch(batchId, tx)).map(toSubscriptionDto);
  }

  /** The subscriptions of the school and month that are UNPAID right now (PAID and WAIVED are never included). */
  async listUnpaidOfSchoolMonth(schoolId: string, month: string, tx?: TransactionContext): Promise<SubscriptionDto[]> {
    return (await this.subscriptions.listUnpaidOfSchoolMonth(schoolId, month, tx)).map(toSubscriptionDto);
  }

  /** The student's name comes from the Students module (public contract); a student that cannot be read shows no name rather than failing the list. */
  private async withStudentNames(items: readonly Subscription[], tx?: TransactionContext): Promise<SubscriptionViewDto[]> {
    const names = new Map<string, string | null>();
    for (const id of new Set(items.map((i) => i.snapshot.studentId))) names.set(id, (await this.roster.find(id, tx))?.fullName ?? null);
    return items.map((i) => ({ ...toSubscriptionDto(i), studentName: names.get(i.snapshot.studentId) ?? null }));
  }

  private inTransaction<T>(tx: TransactionContext | undefined, work: (tx: TransactionContext) => Promise<T>): Promise<T> {
    return tx ? work(tx) : this.unitOfWork.run(work);
  }
}

/** What other modules (Module 32 notification rules, Module 34 payments, reports) depend on. `markPaid` is the Module 34 contract; everything else is read-only. */
export type SubscriptionLookup = Pick<SubscriptionService, 'findById' | 'findScopeById' | 'findBatchById' | 'listOfBatch' | 'listUnpaidOfSchoolMonth'>;
export type SubscriptionPayments = Pick<SubscriptionService, 'markPaid'>;
