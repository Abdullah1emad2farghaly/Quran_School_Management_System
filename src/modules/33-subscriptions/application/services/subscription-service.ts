import { SystemClock, buildPageResult, type Clock, type PageRequest, type PageResult, type TransactionContext, type UnitOfWork } from '../../../00-shared-kernel/public';
import type { OutboxService } from '../../../06-domain-events-outbox/public';
import type { SchoolLookup } from '../../../16-schools/public';
import { Subscription } from '../../domain/entities/subscription';
import { SubscriptionBatch } from '../../domain/entities/subscription-batch';
import { subscriptionError } from '../../domain/errors/subscription-errors';
import { currentBillingMonth, isBillingMonth } from '../../domain/value-objects/billing-month';
import { type SubscriptionStatus } from '../../domain/value-objects/subscription-status';
import { toBatchDto, toSubscriptionDto, type BulkCreationResultDto, type SubscriptionBatchDto, type SubscriptionDto, type SubscriptionScopeDto, type SubscriptionViewDto } from '../dto/subscription-dto';
import type { StudentSubscriptionReportQuery, StudentSubscriptionReportRow, SubscriptionRepository, SubscriptionStatusCount, SubscriptionStatusCountQuery } from '../ports/subscription-repository';
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
 *  - it NEVER changes PAID <-> UNPAID: Module 34 (Payments & Collection) exclusively owns those transitions and reaches them only through `SubscriptionPaymentTransitions` (the Oldest-Unpaid
 *    Rule §59 is enforced there). This service stores and reads the status and owns creation and WAIVED.
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

  /** Read-only aggregate for reports (Module 38): subscriptions per school, billing month and status. The caller (the report) has already proven the schools lie inside the requester's scope. */
  countStatusesForReport(query: SubscriptionStatusCountQuery, tx?: TransactionContext): Promise<SubscriptionStatusCount[]> {
    return this.subscriptions.countByStatus(query, tx);
  }

  /**
   * Read-only, for the Student report (Module 38): one student's subscriptions, oldest month first, with the status RECORDED NOW (the report must not present it as a historical snapshot).
   * The caller (the report) has already proven the student lies inside the requester's scope AND that the requester may see subscriptions (Organization Manager or School Manager only);
   * this method adds no permission and exposes nothing over HTTP.
   */
  listStudentSubscriptionsForReport(query: StudentSubscriptionReportQuery, tx?: TransactionContext): Promise<StudentSubscriptionReportRow[]> {
    return this.subscriptions.listForStudentReport(query, tx);
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

/** What other modules (Module 32 notification rules, Module 34 payments, reports) depend on: read-only. PAID <-> UNPAID transitions are NOT here (see `SubscriptionPaymentTransitions`). */
export type SubscriptionLookup = Pick<SubscriptionService, 'findById' | 'findScopeById' | 'findBatchById' | 'listOfBatch' | 'listUnpaidOfSchoolMonth' | 'countStatusesForReport'>;
