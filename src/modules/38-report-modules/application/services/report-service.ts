import { SystemClock, type Clock } from '../../../00-shared-kernel/public';
import { ReportPeriodService, ReportScopeResolver, authorizeRequestedIds, reportError, restrictToScope, type ReportRequester } from '../../../37-reports-core/public';
import { buildPageResult, pageOffset, type PageRequest } from '../../../00-shared-kernel/public';
import type { AttendanceReportQuery } from '../../../26-attendance/public';
import type { MemorizationReportQuery } from '../../../27-memorization/public';
import type { RevisionReportQuery } from '../../../28-revision/public';
import type { EvaluationReportQuery } from '../../../29-evaluations/public';
import type { AttendanceCounts, AttendanceReport, AttendanceReportRequest, AttendanceReportRow } from '../dto/attendance-report';
import type { MemorizationCounts, MemorizationReport, MemorizationReportRequest, MemorizationReportRow } from '../dto/memorization-report';
import type { EvaluationReport, EvaluationReportRequest, EvaluationReportRow, EvaluationReportTotals } from '../dto/evaluation-report';
import type { RevisionCounts, RevisionReport, RevisionReportRequest, RevisionReportRow } from '../dto/revision-report';
import type { PaymentReport, PaymentReportRequest, PaymentReportRow, PaymentReportTotals } from '../dto/payment-report';
import type { AttendanceReportSources } from '../ports/attendance-report-sources';
import type { MemorizationReportSources } from '../ports/memorization-report-sources';
import type { EvaluationReportSources } from '../ports/evaluation-report-sources';
import type { RevisionReportSources } from '../ports/revision-report-sources';
import { addCategories, emptyCategoryTotals, scoresOf } from './evaluation-stats';
import type { PaymentReportSources } from '../ports/payment-report-sources';
import type { StudentReport, StudentReportRequest } from '../dto/student-report';
import type { StudentReportSources } from '../ports/student-report-sources';
import type { ParentReport, ParentReportRequest } from '../dto/parent-report';
import type { ParentReportSources } from '../ports/parent-report-sources';
import type { GroupReport, GroupReportRequest } from '../dto/group-report';
import type { GroupReportSources } from '../ports/group-report-sources';
import type { TeacherReport, TeacherReportRequest } from '../dto/teacher-report';
import type { TeacherReportSources } from '../ports/teacher-report-sources';
import { buildTeacherReport } from './teacher-report-builder';
import { buildGroupReport } from './group-report-builder';
import { buildParentReport } from './parent-report-builder';
import { buildStudentReport, type StudentReportPageMeta } from './student-report-builder';

export interface ReportServiceDeps {
  readonly scopes: ReportScopeResolver;
  readonly periods: ReportPeriodService;
  readonly payments: PaymentReportSources;
  readonly attendance: AttendanceReportSources;
  readonly memorization: MemorizationReportSources;
  readonly revision: RevisionReportSources;
  readonly evaluation: EvaluationReportSources;
  /** Slice 5 (STUDENT report). Optional so the earlier reports can be composed without it; asking for the STUDENT report without it is a configuration error. */
  readonly student?: StudentReportSources;
  /** Slice 6 (PARENT report; it also needs `student`). Optional so the earlier reports can be composed without it; asking for the PARENT report without it is a configuration error. */
  readonly parent?: ParentReportSources;
  /** Slice 7 (GROUP report). Optional so the earlier reports can be composed without it; asking for the GROUP report without it is a configuration error. */
  readonly group?: GroupReportSources;
  /** Slice 8 (TEACHER report; it also needs `group`). Optional so the earlier reports can be composed without it; asking for the TEACHER report without it is a configuration error. */
  readonly teacher?: TeacherReportSources;
  readonly clock?: Clock;
}

const monthOf = (date: string | null): string | undefined => (date === null ? undefined : date.slice(0, 7));

/**
 * The report catalog (Master Specification §68). Slices 1-4 hold the PAYMENT, ATTENDANCE, MEMORIZATION, REVISION and EVALUATION reports. Every report follows the same chain, in this order, with NOTHING read before it succeeds:
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

  /**
   * MEMORIZATION report: the students' memorization records counted per student and group, by the fulfilment state Module 27 stored when each record was made (data only: counts; no score, grade, rate or completion rule).
   * Rows are per school, group of the RECORD (the group at the time, §65) and student. Who and how much is the same as the ATTENDANCE report, for students only:
   *  - Organization Manager / School Manager: the students of their schools (optionally narrowed by `schoolId`, `groupId`, `studentId`, each proven to lie inside the scope first);
   *  - Teacher: the students of the groups they currently teach; Parent: their own children only, each with its own rows.
   * A record belongs to the period of its session's scheduled start (Africa/Cairo). Student rows follow the student effective start (§67): nothing before the join date is reported, and a student who joined
   * after the period ended has no rows. The same chain as every report: authorize -> period -> filters inside the scope -> only then read.
   */
  async memorizationReport(requester: ReportRequester, request: MemorizationReportRequest): Promise<MemorizationReport> {
    const sources = this.deps.memorization;
    const scope = await this.deps.scopes.authorize(requester, 'MEMORIZATION');
    const period = this.deps.periods.resolvePeriod(request.period);
    const targets = restrictToScope(scope, {
      ...(request.schoolId !== undefined ? { schoolIds: [request.schoolId] } : {}),
      ...(request.groupId !== undefined ? { groupIds: [request.groupId] } : {}),
      ...(request.studentId !== undefined ? { studentIds: [request.studentId] } : {}),
    });
    const wantedGroups = targets.mustBeContained.groupIds;
    const wantedStudents = targets.mustBeContained.studentIds;
    const forbidden = () => reportError('REPORT_SCOPE_FORBIDDEN');

    let filters: MemorizationReportQuery;
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
      filters = { schoolIds, ...(wantedGroups !== undefined ? { groupIds: wantedGroups } : {}), ...(wantedStudents !== undefined ? { studentIds: wantedStudents } : {}) };
    } else if (scope.kind === 'GROUPS') {
      for (const studentId of wantedStudents ?? []) {
        if (!(await sources.isStudentInGroupOfTeacherUser(studentId, requester.userId))) throw forbidden();
      }
      filters = { groupIds: [...targets.allowedIds], ...(wantedStudents !== undefined ? { studentIds: wantedStudents } : {}) };
    } else if (scope.kind === 'STUDENTS') {
      filters = { studentIds: [...targets.allowedIds] };
    } else {
      throw reportError('REPORT_NOT_ALLOWED');
    }

    const bounds = { ...(period.start !== null ? { from: period.start } : {}), ...(period.endExclusive !== null ? { toExclusive: period.endExclusive } : {}) };
    let counts = await sources.memorizationCounts({ ...filters, ...bounds });

    // Student effective start (§67): MAX(join date, period start), computed by Module 37. A student that cannot be proven to exist, or who joined after the period ended, has no rows.
    const studentIds = [...new Set(counts.map((c) => c.studentId))];
    const facts = await sources.studentFacts(studentIds);
    const startOf = new Map<string, Date>();
    for (const id of studentIds) {
      const fact = facts.get(id);
      if (!fact) continue;
      const window = this.deps.periods.studentWindow(period, fact.joinDate);
      if (!window.isEmpty) startOf.set(id, window.start);
    }
    const toRecount = new Map<number, { start: Date; ids: string[] }>();
    for (const c of counts) {
      const start = startOf.get(c.studentId);
      if (start !== undefined && c.firstStart.getTime() < start.getTime()) {
        const entry = toRecount.get(start.getTime()) ?? { start, ids: [] };
        if (!entry.ids.includes(c.studentId)) entry.ids.push(c.studentId);
        toRecount.set(start.getTime(), entry);
      }
    }
    const recounted = new Set([...toRecount.values()].flatMap((e) => e.ids));
    const kept = counts.filter((c) => startOf.has(c.studentId) && !recounted.has(c.studentId));
    const again: typeof counts = [];
    for (const { start, ids } of toRecount.values()) {
      again.push(...(await sources.memorizationCounts({ ...filters, ...bounds, studentIds: ids, from: start })));
    }
    counts = [...kept, ...again];

    const [schoolNames, groupNames] = await Promise.all([
      sources.schoolNames([...new Set(counts.map((c) => c.schoolId))]),
      sources.groupNames([...new Set(counts.map((c) => c.groupId))]),
    ]);

    const rows = new Map<string, { studentId: string; schoolId: string; groupId: string; fulfilled: number; notFulfilled: number; unscheduled: number }>();
    for (const c of counts) {
      const key = `${c.schoolId}|${c.groupId}|${c.studentId}`;
      let row = rows.get(key);
      if (!row) {
        row = { studentId: c.studentId, schoolId: c.schoolId, groupId: c.groupId, fulfilled: 0, notFulfilled: 0, unscheduled: 0 };
        rows.set(key, row);
      }
      if (c.matches === true) row.fulfilled += c.count;
      else if (c.matches === false) row.notFulfilled += c.count;
      else row.unscheduled += c.count;
    }
    const ordered: MemorizationReportRow[] = [...rows.values()]
      .map((r) => ({
        studentId: r.studentId,
        studentName: facts.get(r.studentId)?.fullName ?? null,
        schoolId: r.schoolId,
        schoolName: schoolNames.get(r.schoolId) ?? null,
        groupId: r.groupId,
        groupName: groupNames.get(r.groupId) ?? null,
        records: r.fulfilled + r.notFulfilled + r.unscheduled,
        fulfilled: r.fulfilled,
        notFulfilled: r.notFulfilled,
        unscheduled: r.unscheduled,
      }))
      .sort((a, b) => {
        for (const [x, y] of [
          [a.schoolName ?? '', b.schoolName ?? ''],
          [a.schoolId, b.schoolId],
          [a.groupName ?? '', b.groupName ?? ''],
          [a.groupId, b.groupId],
          [a.studentName ?? '', b.studentName ?? ''],
          [a.studentId, b.studentId],
        ] as const) {
          const c = x.localeCompare(y);
          if (c !== 0) return c;
        }
        return 0;
      });

    const totals: MemorizationCounts = ordered.reduce(
      (sum, r) => ({ records: sum.records + r.records, fulfilled: sum.fulfilled + r.fulfilled, notFulfilled: sum.notFulfilled + r.notFulfilled, unscheduled: sum.unscheduled + r.unscheduled }),
      { records: 0, fulfilled: 0, notFulfilled: 0, unscheduled: 0 },
    );
    return {
      type: 'MEMORIZATION',
      period: { kind: period.kind, startDate: period.startDate, endDate: period.endDate },
      generatedAt: this.clock.now().toISOString(),
      rows: ordered,
      totals,
    };
  }

  /**
   * The MEMORIZATION report as ONE PAGE of its rows (the standard list pagination of the Master Specification, default 20 / maximum 100, owned by Module 00). The report is built and authorized exactly as in
   * `memorizationReport`; only `rows` is cut to the page, and `totals` still cover EVERY row of the report (not just the page). `meta` is the standard pagination meta (`total` = rows of the whole report).
   * The CSV and Excel files are complete exports and use `memorizationReport`.
   */
  async memorizationReportPage(requester: ReportRequester, request: MemorizationReportRequest, page: PageRequest): Promise<{ report: MemorizationReport; meta: { page: number; pageSize: number; total: number; totalPages: number } }> {
    const full = await this.memorizationReport(requester, request);
    const result = buildPageResult(full.rows.slice(pageOffset(page), pageOffset(page) + page.pageSize), full.rows.length, page);
    return { report: { ...full, rows: result.items }, meta: { page: result.page, pageSize: result.pageSize, total: result.total, totalPages: result.totalPages } };
  }

  /**
   * REVISION report: the students' revision records counted per student and group, by the fulfilment state Module 28 stored when each record was made (data only: counts; no score, grade, rate or completion rule).
   * Rows are per school, group of the RECORD (the group at the time, §65) and student. Who and how much is the same as the ATTENDANCE report, for students only:
   *  - Organization Manager / School Manager: the students of their schools (optionally narrowed by `schoolId`, `groupId`, `studentId`, each proven to lie inside the scope first);
   *  - Teacher: the students of the groups they currently teach; Parent: their own children only, each with its own rows.
   * A record belongs to the period of its session's scheduled start (Africa/Cairo). Student rows follow the student effective start (§67): nothing before the join date is reported, and a student who joined
   * after the period ended has no rows. The same chain as every report: authorize -> period -> filters inside the scope -> only then read.
   */
  async revisionReport(requester: ReportRequester, request: RevisionReportRequest): Promise<RevisionReport> {
    const sources = this.deps.revision;
    const scope = await this.deps.scopes.authorize(requester, 'REVISION');
    const period = this.deps.periods.resolvePeriod(request.period);
    const targets = restrictToScope(scope, {
      ...(request.schoolId !== undefined ? { schoolIds: [request.schoolId] } : {}),
      ...(request.groupId !== undefined ? { groupIds: [request.groupId] } : {}),
      ...(request.studentId !== undefined ? { studentIds: [request.studentId] } : {}),
    });
    const wantedGroups = targets.mustBeContained.groupIds;
    const wantedStudents = targets.mustBeContained.studentIds;
    const forbidden = () => reportError('REPORT_SCOPE_FORBIDDEN');

    let filters: RevisionReportQuery;
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
      filters = { schoolIds, ...(wantedGroups !== undefined ? { groupIds: wantedGroups } : {}), ...(wantedStudents !== undefined ? { studentIds: wantedStudents } : {}) };
    } else if (scope.kind === 'GROUPS') {
      for (const studentId of wantedStudents ?? []) {
        if (!(await sources.isStudentInGroupOfTeacherUser(studentId, requester.userId))) throw forbidden();
      }
      filters = { groupIds: [...targets.allowedIds], ...(wantedStudents !== undefined ? { studentIds: wantedStudents } : {}) };
    } else if (scope.kind === 'STUDENTS') {
      filters = { studentIds: [...targets.allowedIds] };
    } else {
      throw reportError('REPORT_NOT_ALLOWED');
    }

    const bounds = { ...(period.start !== null ? { from: period.start } : {}), ...(period.endExclusive !== null ? { toExclusive: period.endExclusive } : {}) };
    let counts = await sources.revisionCounts({ ...filters, ...bounds });

    // Student effective start (§67): MAX(join date, period start), computed by Module 37. A student that cannot be proven to exist, or who joined after the period ended, has no rows.
    const studentIds = [...new Set(counts.map((c) => c.studentId))];
    const facts = await sources.studentFacts(studentIds);
    const startOf = new Map<string, Date>();
    for (const id of studentIds) {
      const fact = facts.get(id);
      if (!fact) continue;
      const window = this.deps.periods.studentWindow(period, fact.joinDate);
      if (!window.isEmpty) startOf.set(id, window.start);
    }
    const toRecount = new Map<number, { start: Date; ids: string[] }>();
    for (const c of counts) {
      const start = startOf.get(c.studentId);
      if (start !== undefined && c.firstStart.getTime() < start.getTime()) {
        const entry = toRecount.get(start.getTime()) ?? { start, ids: [] };
        if (!entry.ids.includes(c.studentId)) entry.ids.push(c.studentId);
        toRecount.set(start.getTime(), entry);
      }
    }
    const recounted = new Set([...toRecount.values()].flatMap((e) => e.ids));
    const kept = counts.filter((c) => startOf.has(c.studentId) && !recounted.has(c.studentId));
    const again: typeof counts = [];
    for (const { start, ids } of toRecount.values()) {
      again.push(...(await sources.revisionCounts({ ...filters, ...bounds, studentIds: ids, from: start })));
    }
    counts = [...kept, ...again];

    const [schoolNames, groupNames] = await Promise.all([
      sources.schoolNames([...new Set(counts.map((c) => c.schoolId))]),
      sources.groupNames([...new Set(counts.map((c) => c.groupId))]),
    ]);

    const rows = new Map<string, { studentId: string; schoolId: string; groupId: string; fulfilled: number; notFulfilled: number; unscheduled: number }>();
    for (const c of counts) {
      const key = `${c.schoolId}|${c.groupId}|${c.studentId}`;
      let row = rows.get(key);
      if (!row) {
        row = { studentId: c.studentId, schoolId: c.schoolId, groupId: c.groupId, fulfilled: 0, notFulfilled: 0, unscheduled: 0 };
        rows.set(key, row);
      }
      if (c.matches === true) row.fulfilled += c.count;
      else if (c.matches === false) row.notFulfilled += c.count;
      else row.unscheduled += c.count;
    }
    const ordered: RevisionReportRow[] = [...rows.values()]
      .map((r) => ({
        studentId: r.studentId,
        studentName: facts.get(r.studentId)?.fullName ?? null,
        schoolId: r.schoolId,
        schoolName: schoolNames.get(r.schoolId) ?? null,
        groupId: r.groupId,
        groupName: groupNames.get(r.groupId) ?? null,
        records: r.fulfilled + r.notFulfilled + r.unscheduled,
        fulfilled: r.fulfilled,
        notFulfilled: r.notFulfilled,
        unscheduled: r.unscheduled,
      }))
      .sort((a, b) => {
        for (const [x, y] of [
          [a.schoolName ?? '', b.schoolName ?? ''],
          [a.schoolId, b.schoolId],
          [a.groupName ?? '', b.groupName ?? ''],
          [a.groupId, b.groupId],
          [a.studentName ?? '', b.studentName ?? ''],
          [a.studentId, b.studentId],
        ] as const) {
          const c = x.localeCompare(y);
          if (c !== 0) return c;
        }
        return 0;
      });

    const totals: RevisionCounts = ordered.reduce(
      (sum, r) => ({ records: sum.records + r.records, fulfilled: sum.fulfilled + r.fulfilled, notFulfilled: sum.notFulfilled + r.notFulfilled, unscheduled: sum.unscheduled + r.unscheduled }),
      { records: 0, fulfilled: 0, notFulfilled: 0, unscheduled: 0 },
    );
    return {
      type: 'REVISION',
      period: { kind: period.kind, startDate: period.startDate, endDate: period.endDate },
      generatedAt: this.clock.now().toISOString(),
      rows: ordered,
      totals,
    };
  }

  /**
   * The REVISION report as ONE PAGE of its rows (the standard list pagination of the Master Specification, default 20 / maximum 100, owned by Module 00). The report is built and authorized exactly as in
   * `revisionReport`; only `rows` is cut to the page, and `totals` still cover EVERY row of the report (not just the page). `meta` is the standard pagination meta (`total` = rows of the whole report).
   * The CSV and Excel files are complete exports and use `revisionReport`.
   */
  async revisionReportPage(requester: ReportRequester, request: RevisionReportRequest, page: PageRequest): Promise<{ report: RevisionReport; meta: { page: number; pageSize: number; total: number; totalPages: number } }> {
    const full = await this.revisionReport(requester, request);
    const result = buildPageResult(full.rows.slice(pageOffset(page), pageOffset(page) + page.pageSize), full.rows.length, page);
    return { report: { ...full, rows: result.items }, meta: { page: result.page, pageSize: result.pageSize, total: result.total, totalPages: result.totalPages } };
  }

  /**
   * EVALUATION report: the students' evaluations counted per student and group, with, per category (Memorization, Revision, Performance, Tajweed), how many scores exist and their arithmetic mean
   * (the stored scores, rounded half up to two decimals). Data only: no combined score, grade, weighting, rate, ranking or completion rule, and never the Teacher's note. Rows are per school, group of
   * the EVALUATION (the group at the time, §65) and student. Who and how much, as in the ATTENDANCE report, for students only:
   *  - Organization Manager / School Manager: the students of their schools (optionally narrowed by `schoolId`, `groupId`, `studentId`, each proven to lie inside the scope first);
   *  - Teacher: the evaluations of THEIR OWN sessions (Module 29 decision 2: "the Teacher reads the evaluations of sessions assigned to them only"; only the session's Teacher records an evaluation, so the
   *    evaluations recorded by the requester) within the groups they currently teach; Parent: their own children only, each with its own rows.
   * An evaluation belongs to the period of its session's scheduled start (Africa/Cairo). Student rows follow the student effective start (§67): nothing before the join date is reported, and a student who
   * joined after the period ended has no rows. The same chain as every report: authorize -> period -> filters inside the scope -> only then read.
   */
  async evaluationReport(requester: ReportRequester, request: EvaluationReportRequest): Promise<EvaluationReport> {
    const sources = this.deps.evaluation;
    const scope = await this.deps.scopes.authorize(requester, 'EVALUATION');
    const period = this.deps.periods.resolvePeriod(request.period);
    const targets = restrictToScope(scope, {
      ...(request.schoolId !== undefined ? { schoolIds: [request.schoolId] } : {}),
      ...(request.groupId !== undefined ? { groupIds: [request.groupId] } : {}),
      ...(request.studentId !== undefined ? { studentIds: [request.studentId] } : {}),
    });
    const wantedGroups = targets.mustBeContained.groupIds;
    const wantedStudents = targets.mustBeContained.studentIds;
    const forbidden = () => reportError('REPORT_SCOPE_FORBIDDEN');

    let filters: EvaluationReportQuery;
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
      filters = { schoolIds, ...(wantedGroups !== undefined ? { groupIds: wantedGroups } : {}), ...(wantedStudents !== undefined ? { studentIds: wantedStudents } : {}) };
    } else if (scope.kind === 'GROUPS') {
      for (const studentId of wantedStudents ?? []) {
        if (!(await sources.isStudentInGroupOfTeacherUser(studentId, requester.userId))) throw forbidden();
      }
      filters = { groupIds: [...targets.allowedIds], recordedByUserIds: [requester.userId], ...(wantedStudents !== undefined ? { studentIds: wantedStudents } : {}) };
    } else if (scope.kind === 'STUDENTS') {
      filters = { studentIds: [...targets.allowedIds] };
    } else {
      throw reportError('REPORT_NOT_ALLOWED');
    }

    const bounds = { ...(period.start !== null ? { from: period.start } : {}), ...(period.endExclusive !== null ? { toExclusive: period.endExclusive } : {}) };
    let counts = await sources.evaluationCounts({ ...filters, ...bounds });

    // Student effective start (§67): MAX(join date, period start), computed by Module 37. A student that cannot be proven to exist, or who joined after the period ended, has no rows.
    const studentIds = [...new Set(counts.map((c) => c.studentId))];
    const facts = await sources.studentFacts(studentIds);
    const startOf = new Map<string, Date>();
    for (const id of studentIds) {
      const fact = facts.get(id);
      if (!fact) continue;
      const window = this.deps.periods.studentWindow(period, fact.joinDate);
      if (!window.isEmpty) startOf.set(id, window.start);
    }
    const toRecount = new Map<number, { start: Date; ids: string[] }>();
    for (const c of counts) {
      const start = startOf.get(c.studentId);
      if (start !== undefined && c.firstStart.getTime() < start.getTime()) {
        const entry = toRecount.get(start.getTime()) ?? { start, ids: [] };
        if (!entry.ids.includes(c.studentId)) entry.ids.push(c.studentId);
        toRecount.set(start.getTime(), entry);
      }
    }
    const recounted = new Set([...toRecount.values()].flatMap((e) => e.ids));
    const kept = counts.filter((c) => startOf.has(c.studentId) && !recounted.has(c.studentId));
    const again: typeof counts = [];
    for (const { start, ids } of toRecount.values()) {
      again.push(...(await sources.evaluationCounts({ ...filters, ...bounds, studentIds: ids, from: start })));
    }
    counts = [...kept, ...again];

    const [schoolNames, groupNames] = await Promise.all([
      sources.schoolNames([...new Set(counts.map((c) => c.schoolId))]),
      sources.groupNames([...new Set(counts.map((c) => c.groupId))]),
    ]);

    const ordered = counts
      .map((c): EvaluationReportRow => {
        const totals = emptyCategoryTotals();
        addCategories(totals, c.categories);
        return {
          studentId: c.studentId,
          studentName: facts.get(c.studentId)?.fullName ?? null,
          schoolId: c.schoolId,
          schoolName: schoolNames.get(c.schoolId) ?? null,
          groupId: c.groupId,
          groupName: groupNames.get(c.groupId) ?? null,
          evaluations: c.evaluations,
          scores: scoresOf(totals),
        };
      })
      .sort((a, b) => {
        for (const [x, y] of [
          [a.schoolName ?? '', b.schoolName ?? ''],
          [a.schoolId, b.schoolId],
          [a.groupName ?? '', b.groupName ?? ''],
          [a.groupId, b.groupId],
          [a.studentName ?? '', b.studentName ?? ''],
          [a.studentId, b.studentId],
        ] as const) {
          const c = x.localeCompare(y);
          if (c !== 0) return c;
        }
        return 0;
      });

    // Totals over EVERY row, from the exact integer sums (never an average of averages).
    const overall = emptyCategoryTotals();
    let evaluations = 0;
    for (const c of counts) {
      evaluations += c.evaluations;
      addCategories(overall, c.categories);
    }
    const totals: EvaluationReportTotals = { evaluations, scores: scoresOf(overall) };
    return {
      type: 'EVALUATION',
      period: { kind: period.kind, startDate: period.startDate, endDate: period.endDate },
      generatedAt: this.clock.now().toISOString(),
      rows: ordered,
      totals,
    };
  }

  /**
   * The EVALUATION report as ONE PAGE of its rows (the standard list pagination of the Master Specification, default 20 / maximum 100, owned by Module 00). The report is built and authorized exactly as in
   * `evaluationReport`; only `rows` is cut to the page, and `totals` still cover EVERY row of the report (not just the page). `meta` is the standard pagination meta (`total` = rows of the whole report).
   * The CSV and Excel files are complete exports and use `evaluationReport`.
   */
  async evaluationReportPage(requester: ReportRequester, request: EvaluationReportRequest, page: PageRequest): Promise<{ report: EvaluationReport; meta: { page: number; pageSize: number; total: number; totalPages: number } }> {
    const full = await this.evaluationReport(requester, request);
    const result = buildPageResult(full.rows.slice(pageOffset(page), pageOffset(page) + page.pageSize), full.rows.length, page);
    return { report: { ...full, rows: result.items }, meta: { page: result.page, pageSize: result.pageSize, total: result.total, totalPages: result.totalPages } };
  }
  /**
   * STUDENT report (slice 5, Master Specification §67, §68): ONE student, seven data-only sections (attendance, memorization, revision, evaluations, exam results, subscriptions, group history).
   * The four learning sections are the SAME reports as `attendanceReport`, `memorizationReport`, `revisionReport` and `evaluationReport` for that student (nothing is recomputed), so authorization, scope, effective start and the
   * Teacher restrictions are identical. Exam results and group history are read through Modules 30 and 20; the subscription section (Module 33) exists only for the Organization Manager and the School Manager.
   * Available to the Organization Manager, the School Manager, the Teacher (only a student currently in a group they teach, only those groups) and the Parent (own children). MAIN_ADMIN and geographic managers stay denied.
   * This is the COMPLETE report (every exam); the files use it. See `studentReportPage` for the JSON.
   */
  async studentReport(requester: ReportRequester, request: StudentReportRequest): Promise<StudentReport> {
    return (await this.runStudentReport(requester, request)).report;
  }

  /** The STUDENT report with the exam list cut to ONE page (standard pagination: default 20, maximum 100). Only `sections.examResults.rows` is paged; `counts` and every other section cover everything. */
  async studentReportPage(requester: ReportRequester, request: StudentReportRequest, page: PageRequest): Promise<{ report: StudentReport; meta: StudentReportPageMeta }> {
    return this.runStudentReport(requester, request, page);
  }

  private async runStudentReport(requester: ReportRequester, request: StudentReportRequest, page?: PageRequest): Promise<{ report: StudentReport; meta: StudentReportPageMeta }> {
    const sources = this.deps.student;
    if (!sources) throw new Error('STUDENT_REPORT_SOURCES_NOT_CONFIGURED');
    return buildStudentReport({ scopes: this.deps.scopes, periods: this.deps.periods, sources, clock: this.clock }, this, requester, request, page);
  }
  /**
   * PARENT report (slice 6, Master Specification §68): ONE Parent and ALL their linked children, each child with a separate, complete STUDENT report (`studentReport`, called unchanged for that child, so every figure and
   * every authorization rule is the STUDENT report's). Available to the Organization Manager and the School Manager (they must name the Parent; only the children inside their scope) and to the Parent (their own children only).
   * This is the COMPLETE report (every child); the files use it. See `parentReportPage` for the JSON.
   */
  async parentReport(requester: ReportRequester, request: ParentReportRequest): Promise<ParentReport> {
    return (await this.runParentReport(requester, request)).report;
  }

  /** The PARENT report with the children cut to ONE page (standard pagination: default 20, maximum 100). `parent.children` always lists every authorized child; each returned child has its full report. */
  async parentReportPage(requester: ReportRequester, request: ParentReportRequest, page: PageRequest): Promise<{ report: ParentReport; meta: StudentReportPageMeta }> {
    return this.runParentReport(requester, request, page);
  }

  private async runParentReport(requester: ReportRequester, request: ParentReportRequest, page?: PageRequest): Promise<{ report: ParentReport; meta: StudentReportPageMeta }> {
    const sources = this.deps.parent;
    if (!sources || !this.deps.student) throw new Error('PARENT_REPORT_SOURCES_NOT_CONFIGURED');
    return buildParentReport({ scopes: this.deps.scopes, periods: this.deps.periods, sources, clock: this.clock, studentReport: (r, q) => this.studentReport(r, q) }, requester, request, page);
  }
  /**
   * GROUP report (slice 7, Master Specification §68): ONE group, data only: the group header, the roster of every student assigned to it at any time inside each student's effective window (from the authoritative assignment
   * history) with attendance, memorization, revision, evaluation (per category) and exam counts, group totals over the complete roster, and, for the Organization Manager and the School Manager, the Teacher's attendance.
   * The four learning figures are the existing reports called unchanged for the group, so authorization, scope, effective start and Teacher restrictions are theirs. No financial data. This is the COMPLETE report (every student); the files use it.
   */
  async groupReport(requester: ReportRequester, request: GroupReportRequest): Promise<GroupReport> {
    return (await this.runGroupReport(requester, request)).report;
  }

  /** The GROUP report with the student list cut to ONE page (standard pagination: default 20, maximum 100). `totals` always cover the complete roster. */
  async groupReportPage(requester: ReportRequester, request: GroupReportRequest, page: PageRequest): Promise<{ report: GroupReport; meta: StudentReportPageMeta }> {
    return this.runGroupReport(requester, request, page);
  }

  private async runGroupReport(requester: ReportRequester, request: GroupReportRequest, page?: PageRequest): Promise<{ report: GroupReport; meta: StudentReportPageMeta }> {
    const sources = this.deps.group;
    if (!sources) throw new Error('GROUP_REPORT_SOURCES_NOT_CONFIGURED');
    return buildGroupReport({ scopes: this.deps.scopes, periods: this.deps.periods, sources, clock: this.clock }, this, requester, request, page);
  }
  /**
   * TEACHER report (slice 8, Master Specification §68): ONE Teacher, limited to the requester's authorized schools (a School Manager's managed schools, an Organization Manager's organization), whatever other schools the
   * Teacher works in. The Teacher's stints in groups come from the groups' authoritative history; each stint's figures are the existing GROUP and ATTENDANCE reports for exactly its dates. Only the Organization Manager and
   * the School Manager may run it (a Teacher cannot, not even their own). This is the COMPLETE report (every stint); the files use it. See `teacherReportPage` for the JSON.
   */
  async teacherReport(requester: ReportRequester, request: TeacherReportRequest): Promise<TeacherReport> {
    return (await this.runTeacherReport(requester, request)).report;
  }

  /** The TEACHER report with the taught groups cut to ONE page (standard pagination: default 20, maximum 100); the total counts only the authorized schools' entries. */
  async teacherReportPage(requester: ReportRequester, request: TeacherReportRequest, page: PageRequest): Promise<{ report: TeacherReport; meta: StudentReportPageMeta }> {
    return this.runTeacherReport(requester, request, page);
  }

  private async runTeacherReport(requester: ReportRequester, request: TeacherReportRequest, page?: PageRequest): Promise<{ report: TeacherReport; meta: StudentReportPageMeta }> {
    const sources = this.deps.teacher;
    if (!sources || !this.deps.group) throw new Error('TEACHER_REPORT_SOURCES_NOT_CONFIGURED');
    return buildTeacherReport({ scopes: this.deps.scopes, periods: this.deps.periods, sources, clock: this.clock }, { groupReport: (r, q) => this.groupReport(r, q), attendanceReport: (r, q) => this.attendanceReport(r, q) }, requester, request, page);
  }
}
