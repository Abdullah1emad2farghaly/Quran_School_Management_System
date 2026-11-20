import { SystemClock, type Clock } from '../../../00-shared-kernel/public';
import { ReportPeriodService, ReportScopeResolver, authorizeRequestedIds, reportError, restrictToScope, type ReportRequester } from '../../../37-reports-core/public';
import type { AttendanceReportQuery } from '../../../26-attendance/public';
import type { AttendanceCounts, AttendanceReport, AttendanceReportRequest, AttendanceReportRow } from '../dto/attendance-report';
import type { PaymentReport, PaymentReportRequest, PaymentReportRow, PaymentReportTotals } from '../dto/payment-report';
import type { AttendanceReportSources } from '../ports/attendance-report-sources';
import type { PaymentReportSources } from '../ports/payment-report-sources';

export interface ReportServiceDeps {
  readonly scopes: ReportScopeResolver;
  readonly periods: ReportPeriodService;
  readonly payments: PaymentReportSources;
  readonly attendance: AttendanceReportSources;
  readonly clock?: Clock;
}

const monthOf = (date: string | null): string | undefined => (date === null ? undefined : date.slice(0, 7));

/**
 * The report catalog (Master Specification §68). Slice 1 holds the PAYMENT and ATTENDANCE reports. Every report follows the same chain, in this order, with NOTHING read before it succeeds:
 *   1. `ReportScopeResolver.authorize`: the role may run this report type AND has a current, non-empty scope (REPORT_NOT_ALLOWED otherwise);
 *   2. the period is resolved by Module 37 (§66);
 *   3. the requested filters are checked against the scope (`restrictToScope` / `authorizeRequestedIds`: REPORT_SCOPE_FORBIDDEN, never revealing whether an id exists);
 *   4. only then is data read, through the owning modules' public contracts.
 * The requester always comes from the verified session, never from the request.
 */
export class ReportService {
  private readonly clock: Clock;

  constructor(private readonly deps: ReportServiceDeps) {
    this.clock = deps.clock ?? new SystemClock();
  }

  /**
   * PAYMENT report: subscription statuses and payments per school and billing month (cash only, no amount).
   * A billing month is included when it lies inside the period (months of the period's first and last business dates, inclusive); ACROSS_TIME has no bounds.
   * Available to the Organization Manager (their organizations' schools), the School Manager (their schools) and the Subscription Collector (their currently linked schools).
   */
  async paymentReport(requester: ReportRequester, request: PaymentReportRequest): Promise<PaymentReport> {
    const scope = await this.deps.scopes.authorize(requester, 'PAYMENT');
    const period = this.deps.periods.resolvePeriod(request.period);
    const targets = restrictToScope(scope, request.schoolId !== undefined ? { schoolIds: [request.schoolId] } : {});

    let schoolIds: string[];
    if (scope.kind === 'ORGANIZATIONS') {
      const ofOrganizations = await this.deps.payments.schoolIdsOfOrganizations(targets.allowedIds);
      schoolIds = authorizeRequestedIds(targets.mustBeContained.schoolIds, ofOrganizations);
    } else if (scope.kind === 'SCHOOLS') {
      schoolIds = [...targets.allowedIds];
    } else {
      throw reportError('REPORT_NOT_ALLOWED');
    }

    const fromMonth = monthOf(period.startDate);
    const toMonth = monthOf(period.endDate);
    const bounds = { schoolIds, ...(fromMonth !== undefined ? { fromMonth } : {}), ...(toMonth !== undefined ? { toMonth } : {}) };
    const [subscriptionCounts, paymentCounts, names] = await Promise.all([
      this.deps.payments.subscriptionCounts(bounds),
      this.deps.payments.paymentCounts(bounds),
      this.deps.payments.schoolNames(schoolIds),
    ]);

    const rows = new Map<string, { schoolId: string; month: string; paid: number; unpaid: number; waived: number; paymentsRecorded: number; paymentsReversed: number }>();
    const rowOf = (schoolId: string, month: string) => {
      const key = `${schoolId}|${month}`;
      let row = rows.get(key);
      if (!row) {
        row = { schoolId, month, paid: 0, unpaid: 0, waived: 0, paymentsRecorded: 0, paymentsReversed: 0 };
        rows.set(key, row);
      }
      return row;
    };
    for (const c of subscriptionCounts) {
      const row = rowOf(c.schoolId, c.month);
      if (c.status === 'PAID') row.paid += c.count;
      else if (c.status === 'UNPAID') row.unpaid += c.count;
      else row.waived += c.count;
    }
    for (const c of paymentCounts) {
      const row = rowOf(c.schoolId, c.month);
      if (c.status === 'SUCCESSFUL') row.paymentsRecorded += c.count;
      else row.paymentsReversed += c.count;
    }

    const ordered: PaymentReportRow[] = [...rows.values()]
      .map((r) => ({ ...r, schoolName: names.get(r.schoolId) ?? null, subscriptions: r.paid + r.unpaid + r.waived }))
      .sort((a, b) => {
        const byName = (a.schoolName ?? '').localeCompare(b.schoolName ?? '');
        if (byName !== 0) return byName;
        if (a.schoolId !== b.schoolId) return a.schoolId < b.schoolId ? -1 : 1;
        return a.month < b.month ? -1 : a.month > b.month ? 1 : 0;
      });

    const totals: PaymentReportTotals = ordered.reduce(
      (sum, r) => ({
        paid: sum.paid + r.paid,
        unpaid: sum.unpaid + r.unpaid,
        waived: sum.waived + r.waived,
        subscriptions: sum.subscriptions + r.subscriptions,
        paymentsRecorded: sum.paymentsRecorded + r.paymentsRecorded,
        paymentsReversed: sum.paymentsReversed + r.paymentsReversed,
      }),
      { paid: 0, unpaid: 0, waived: 0, subscriptions: 0, paymentsRecorded: 0, paymentsReversed: 0 },
    );

    return {
      type: 'PAYMENT',
      period: { kind: period.kind, startDate: period.startDate, endDate: period.endDate },
      generatedAt: this.clock.now().toISOString(),
      rows: ordered,
      totals,
    };
  }

  /**
   * ATTENDANCE report: PRESENT and ABSENT counts per student, teacher and group (data only: counts, no rates or grades). Rows are per school, group of the RECORD (the group at the time, §65) and subject.
   *  - Organization Manager / School Manager: students and teachers of their schools (optionally narrowed by `schoolId`, `groupId`, `studentId`, each proven to lie inside the scope first);
   *  - Teacher: the students of the groups they currently teach (never other teachers' attendance);
   *  - Parent: their own children only, each with its own rows.
   * Student rows follow the student effective start (§67): nothing before the student's join date is reported, and a student who joined after the period ended has no rows.
   */
  async attendanceReport(requester: ReportRequester, request: AttendanceReportRequest): Promise<AttendanceReport> {
    const sources = this.deps.attendance;
    const scope = await this.deps.scopes.authorize(requester, 'ATTENDANCE');
    const period = this.deps.periods.resolvePeriod(request.period);
    const targets = restrictToScope(scope, {
      ...(request.schoolId !== undefined ? { schoolIds: [request.schoolId] } : {}),
      ...(request.groupId !== undefined ? { groupIds: [request.groupId] } : {}),
      ...(request.studentId !== undefined ? { studentIds: [request.studentId] } : {}),
    });
    const wantedGroups = targets.mustBeContained.groupIds;
    const wantedStudents = targets.mustBeContained.studentIds;
    const forbidden = () => reportError('REPORT_SCOPE_FORBIDDEN');

    let filters: AttendanceReportQuery;
    if (scope.kind === 'ORGANIZATIONS' || scope.kind === 'SCHOOLS') {
      const scopeSchools = scope.kind === 'ORGANIZATIONS' ? await sources.schoolIdsOfOrganizations(targets.allowedIds) : scope.schoolIds;
      const schoolIds = scope.kind === 'ORGANIZATIONS' ? authorizeRequestedIds(targets.mustBeContained.schoolIds, scopeSchools) : [...targets.allowedIds];
      const inScope = new Set(scopeSchools);
      for (const groupId of wantedGroups ?? []) {
        const school = await sources.schoolIdOfGroup(groupId);
        if (school === undefined || !inScope.has(school)) throw forbidden();
      }
      for (const studentId of wantedStudents ?? []) {
        const school = await sources.schoolIdOfStudent(studentId);
        if (school === undefined || !inScope.has(school)) throw forbidden();
      }
      filters = {
        schoolIds,
        ...(wantedGroups !== undefined ? { groupIds: wantedGroups } : {}),
        ...(wantedStudents !== undefined ? { studentIds: wantedStudents } : {}),
        subjectTypes: wantedStudents !== undefined ? ['STUDENT'] : ['STUDENT', 'TEACHER'],
      };
    } else if (scope.kind === 'GROUPS') {
      for (const studentId of wantedStudents ?? []) {
        if (!(await sources.isStudentInGroupOfTeacherUser(studentId, requester.userId))) throw forbidden();
      }
      filters = { groupIds: [...targets.allowedIds], ...(wantedStudents !== undefined ? { studentIds: wantedStudents } : {}), subjectTypes: ['STUDENT'] };
    } else if (scope.kind === 'STUDENTS') {
      filters = { studentIds: [...targets.allowedIds], subjectTypes: ['STUDENT'] };
    } else {
      throw reportError('REPORT_NOT_ALLOWED');
    }

    const bounds = { ...(period.startDate !== null ? { fromDate: period.startDate } : {}), ...(period.endDate !== null ? { toDate: period.endDate } : {}) };
    let counts = await sources.attendanceCounts({ ...filters, ...bounds });

    // Student effective start (§67): MAX(join date, period start). A student that cannot be proven to exist, or who joined after the period ended, has no rows.
    const studentIds = [...new Set(counts.filter((c) => c.subjectType === 'STUDENT').map((c) => c.subjectId))];
    const facts = await sources.studentFacts(studentIds);
    const startOf = new Map<string, string>();
    for (const id of studentIds) {
      const fact = facts.get(id);
      if (!fact) continue;
      const start = period.startDate !== null && period.startDate > fact.joinDate ? period.startDate : fact.joinDate;
      if (period.endDate !== null && start > period.endDate) continue;
      startOf.set(id, start);
    }
    const toRecount = new Map<string, string[]>();
    for (const c of counts) {
      const start = c.subjectType === 'STUDENT' ? startOf.get(c.subjectId) : undefined;
      if (start !== undefined && c.firstDate < start) {
        const ids = toRecount.get(start) ?? [];
        if (!ids.includes(c.subjectId)) ids.push(c.subjectId);
        toRecount.set(start, ids);
      }
    }
    const recounted = new Set([...toRecount.values()].flat());
    const kept = counts.filter((c) => c.subjectType === 'TEACHER' || (startOf.has(c.subjectId) && !recounted.has(c.subjectId)));
    const again: typeof counts = [];
    for (const [start, ids] of toRecount) {
      again.push(...(await sources.attendanceCounts({ ...filters, ...bounds, studentIds: ids, subjectTypes: ['STUDENT'], fromDate: start })));
    }
    counts = [...kept, ...again];

    const [schoolNames, groupNames, teacherNames] = await Promise.all([
      sources.schoolNames([...new Set(counts.map((c) => c.schoolId))]),
      sources.groupNames([...new Set(counts.map((c) => c.groupId))]),
      sources.teacherNames([...new Set(counts.filter((c) => c.subjectType === 'TEACHER').map((c) => c.subjectId))]),
    ]);

    const rows = new Map<string, { subjectType: 'STUDENT' | 'TEACHER'; subjectId: string; schoolId: string; groupId: string; present: number; absent: number }>();
    for (const c of counts) {
      const key = `${c.schoolId}|${c.groupId}|${c.subjectType}|${c.subjectId}`;
      let row = rows.get(key);
      if (!row) {
        row = { subjectType: c.subjectType, subjectId: c.subjectId, schoolId: c.schoolId, groupId: c.groupId, present: 0, absent: 0 };
        rows.set(key, row);
      }
      if (c.status === 'PRESENT') row.present += c.count;
      else row.absent += c.count;
    }
    const ordered: AttendanceReportRow[] = [...rows.values()]
      .map((r) => ({
        subjectType: r.subjectType,
        subjectId: r.subjectId,
        subjectName: (r.subjectType === 'STUDENT' ? facts.get(r.subjectId)?.fullName : teacherNames.get(r.subjectId)) ?? null,
        schoolId: r.schoolId,
        schoolName: schoolNames.get(r.schoolId) ?? null,
        groupId: r.groupId,
        groupName: groupNames.get(r.groupId) ?? null,
        present: r.present,
        absent: r.absent,
        total: r.present + r.absent,
      }))
      .sort((a, b) => {
        for (const [x, y] of [
          [a.schoolName ?? '', b.schoolName ?? ''],
          [a.schoolId, b.schoolId],
          [a.groupName ?? '', b.groupName ?? ''],
          [a.groupId, b.groupId],
          [a.subjectType, b.subjectType],
          [a.subjectName ?? '', b.subjectName ?? ''],
          [a.subjectId, b.subjectId],
        ] as const) {
          const c = x.localeCompare(y);
          if (c !== 0) return c;
        }
        return 0;
      });

    const sum = (type: 'STUDENT' | 'TEACHER'): AttendanceCounts => {
      const mine = ordered.filter((r) => r.subjectType === type);
      const present = mine.reduce((n, r) => n + r.present, 0);
      const absent = mine.reduce((n, r) => n + r.absent, 0);
      return { present, absent, total: present + absent };
    };
    return {
      type: 'ATTENDANCE',
      period: { kind: period.kind, startDate: period.startDate, endDate: period.endDate },
      generatedAt: this.clock.now().toISOString(),
      rows: ordered,
      totals: { students: sum('STUDENT'), teachers: sum('TEACHER') },
    };
  }
}
