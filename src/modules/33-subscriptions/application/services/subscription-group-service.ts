import { SystemClock, buildPageResult, type Clock, type PageRequest, type PageResult, type TransactionContext, type UnitOfWork } from '../../../00-shared-kernel/public';
import type { SchoolLookup } from '../../../16-schools/public';
import { subscriptionError } from '../../domain/errors/subscription-errors';
import { currentBillingMonth, isBillingMonth } from '../../domain/value-objects/billing-month';
import type { GroupStudentSubscriptionDto, GroupSubscriptionSummaryDto } from '../dto/subscription-dto';
import type { SchoolGroupRoster } from '../ports/school-group-roster';
import type { SubscriptionRepository } from '../ports/subscription-repository';

export interface SubscriptionGroupServiceDeps {
  readonly subscriptions: SubscriptionRepository;
  readonly groups: SchoolGroupRoster;
  readonly schools: Pick<SchoolLookup, 'findById'>;
  readonly unitOfWork: UnitOfWork;
  readonly clock?: Clock;
}

/**
 * Group-based subscription reads (approved Module 33 enhancement). Read-only: it changes nothing and creates no group data.
 * It does not authorize its callers: the routes use the Authorization Engine (`subscriptions.group.list`, school scope) first. It does verify that a group belongs to the SCHOOL in the
 * request, so a group id of another school or organization is `SUBSCRIPTION_GROUP_NOT_FOUND` whoever asks (existence is never revealed).
 *
 * Group relationships are exactly those of Module 20 (current assignment: ONE group per student at a time; only ACTIVE groups; ARCHIVED students are unassigned; INACTIVE students keep
 * the assignment): "regular/active students of a group" = the students currently assigned to the ACTIVE group whose Student status is ACTIVE, each counted once. The subscription of a
 * student for the month is the real record of Module 33 (`student + month`): statuses are never inferred. Each read runs in ONE transaction (one consistent snapshot).
 */
export class SubscriptionGroupService {
  private readonly subscriptions: SubscriptionRepository;
  private readonly groups: SchoolGroupRoster;
  private readonly schools: SubscriptionGroupServiceDeps['schools'];
  private readonly unitOfWork: UnitOfWork;
  private readonly clock: Clock;

  constructor(deps: SubscriptionGroupServiceDeps) {
    this.subscriptions = deps.subscriptions;
    this.groups = deps.groups;
    this.schools = deps.schools;
    this.unitOfWork = deps.unitOfWork;
    this.clock = deps.clock ?? new SystemClock();
  }

  /** The ACTIVE groups of a school with the statistics of `month` (default: the current Africa/Cairo month), sorted by name, paginated. */
  listGroupSummaries(schoolId: string, input: { readonly month?: string; readonly direction?: 'asc' | 'desc'; readonly page: PageRequest }, tx?: TransactionContext): Promise<PageResult<GroupSubscriptionSummaryDto>> {
    return this.read(tx, async (t) => {
      const month = this.resolveMonth(input.month);
      await this.requireActiveSchool(schoolId, t);
      const groups = await this.groups.listActiveGroups(schoolId, t);
      const membership = await Promise.all(groups.map(async (g) => ({ group: g, students: await this.groups.listActiveStudentsOfGroup(g.id, t) })));
      const everyone = [...new Set(membership.flatMap((m) => m.students.map((s) => s.studentId)))];
      const bySubscription = new Map((await this.subscriptions.listByStudentsMonth(everyone, month, t)).map((s) => [s.snapshot.studentId, s.snapshot.status] as const));
      const subscriptionsCreated = (await this.subscriptions.findBatchBySchoolMonth(schoolId, month, t)) !== undefined;

      const summaries: GroupSubscriptionSummaryDto[] = membership.map(({ group, students }) => {
        const ids = [...new Set(students.map((s) => s.studentId))]; // a student is counted ONCE per group
        let paid = 0;
        let unpaid = 0;
        let waived = 0;
        let without = 0;
        for (const id of ids) {
          const status = bySubscription.get(id);
          if (status === 'PAID') paid += 1;
          else if (status === 'UNPAID') unpaid += 1;
          else if (status === 'WAIVED') waived += 1;
          else without += 1;
        }
        return { groupId: group.id, groupName: group.name, month, subscriptionsCreated, paidStudents: paid, unpaidStudents: unpaid, waivedStudents: waived, withoutSubscription: without, totalStudents: ids.length };
      });
      const sign = input.direction === 'desc' ? -1 : 1;
      summaries.sort((a, b) => sign * compareText(a.groupName, b.groupName) || (a.groupId < b.groupId ? -1 : 1));
      const start = (input.page.page - 1) * input.page.pageSize;
      return buildPageResult(summaries.slice(start, start + input.page.pageSize), summaries.length, input.page);
    });
  }

  /** Every regular/active student of ONE group with their subscription status for `month`, sorted by name, through standard pagination (default 20, maximum 100). */
  listGroupStudents(schoolId: string, groupId: string, input: { readonly month?: string; readonly direction?: 'asc' | 'desc'; readonly page: PageRequest }, tx?: TransactionContext): Promise<PageResult<GroupStudentSubscriptionDto>> {
    return this.read(tx, async (t) => {
      const month = this.resolveMonth(input.month);
      await this.requireActiveSchool(schoolId, t);
      const group = await this.groups.findActiveGroup(groupId, t);
      if (!group || group.schoolId !== schoolId) throw subscriptionError('SUBSCRIPTION_GROUP_NOT_FOUND');
      const students = [...new Map((await this.groups.listActiveStudentsOfGroup(group.id, t)).map((s) => [s.studentId, s] as const)).values()]; // each student once
      const sign = input.direction === 'desc' ? -1 : 1;
      students.sort((a, b) => sign * compareText(a.fullName, b.fullName) || (a.studentId < b.studentId ? -1 : 1));
      const start = (input.page.page - 1) * input.page.pageSize;
      const slice = students.slice(start, start + input.page.pageSize);
      const records = new Map((await this.subscriptions.listByStudentsMonth(slice.map((s) => s.studentId), month, t)).map((s) => [s.snapshot.studentId, s.snapshot] as const));
      const items: GroupStudentSubscriptionDto[] = slice.map((s) => {
        const record = records.get(s.studentId);
        return { studentId: s.studentId, studentName: s.fullName, month, subscriptionId: record?.id ?? null, status: record?.status ?? null, hasSubscription: record !== undefined };
      });
      return buildPageResult(items, students.length, input.page);
    });
  }

  private resolveMonth(month: string | undefined): string {
    if (month === undefined) return currentBillingMonth(this.clock.now());
    if (!isBillingMonth(month)) throw subscriptionError('INVALID_SUBSCRIPTION_MONTH');
    return month;
  }

  private async requireActiveSchool(schoolId: string, t: TransactionContext): Promise<void> {
    const school = await this.schools.findById(schoolId, t);
    if (!school || school.status !== 'ACTIVE') throw subscriptionError('SUBSCRIPTION_SCHOOL_NOT_ACTIVE');
  }

  private read<T>(tx: TransactionContext | undefined, work: (tx: TransactionContext) => Promise<T>): Promise<T> {
    return tx ? work(tx) : this.unitOfWork.run(work);
  }
}

/** Names compare by Unicode code points after NFC (deterministic; the same order on every server). */
const compareText = (a: string, b: string): number => {
  const x = a.normalize('NFC');
  const y = b.normalize('NFC');
  return x < y ? -1 : x > y ? 1 : 0;
};
