import { businessDateOf, buildPageResult, pageOffset, type Clock, type PageRequest } from '../../../00-shared-kernel/public';
import { ReportPeriodService, authorizeRequestedIds, reportError, restrictToScope, type ReportRequester, type ReportScope, type ReportType } from '../../../37-reports-core/public';
import type { AttendanceReport } from '../dto/attendance-report';
import type { EvaluationReport } from '../dto/evaluation-report';
import type { MemorizationReport } from '../dto/memorization-report';
import type { RevisionReport } from '../dto/revision-report';
import type { StudentExamResultRow, StudentGroupHistoryRow, StudentReport, StudentReportRequest, StudentSubscriptionRow } from '../dto/student-report';
import type { StudentReportSources } from '../ports/student-report-sources';

/** The four existing reports the STUDENT report reuses unchanged (same authorization, same scope, same effective start, same Teacher restrictions), so the figures can never differ from those reports. */
export interface StudentReportDelegates {
  attendanceReport(requester: ReportRequester, request: { period: StudentReportRequest['period']; studentId: string }): Promise<AttendanceReport>;
  memorizationReport(requester: ReportRequester, request: { period: StudentReportRequest['period']; studentId: string }): Promise<MemorizationReport>;
  revisionReport(requester: ReportRequester, request: { period: StudentReportRequest['period']; studentId: string }): Promise<RevisionReport>;
  evaluationReport(requester: ReportRequester, request: { period: StudentReportRequest['period']; studentId: string }): Promise<EvaluationReport>;
}

/** What the builder needs of Module 37's scope computation (the report service passes its own resolver). */
export interface StudentReportScopes {
  authorize(requester: ReportRequester, type: ReportType): Promise<ReportScope>;
}

export interface StudentReportBuilderDeps {
  readonly scopes: StudentReportScopes;
  readonly periods: ReportPeriodService;
  readonly sources: StudentReportSources;
  readonly clock: Clock;
}

export type StudentReportPageMeta = {
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
};

/** The only roles that may see the subscription section (owner decision): Module 33's authorization is never widened through Module 38. */
const SUBSCRIPTION_ROLES: readonly string[] = ['ORGANIZATION_MANAGER', 'SCHOOL_MANAGER'];

const maxDate = (a: string, b: string): string => (a > b ? a : b);

/**
 * The STUDENT report (Master Specification §67, §68): ONE student, seven data-only sections. The chain is the same as every report and NOTHING is read before it succeeds:
 *   1. Module 37's scope computation, `authorize(requester, 'STUDENT')` (role allowed + current, non-empty scope: REPORT_NOT_ALLOWED);
 *   2. the period (Module 37);
 *   3. the requested student is proven inside the scope (REPORT_SCOPE_FORBIDDEN, never revealing whether the id exists): the schools of the organizations / managed schools,
 *      the students of the groups a Teacher currently teaches, or a Parent's own child. The lifecycle status is not checked: an ARCHIVED or INACTIVE student can still be reported, and nothing here changes it;
 *   4. only then data is read, through the owning modules' public contracts.
 * Student effective start (§67): MAX(join date, period start). A Teacher sees only the groups they currently teach in EVERY section. The subscription section exists only for the Organization Manager and the School Manager.
 * No score, grade, percentage, ranking, weight or combined figure is created: every number is a count or a stored value.
 */
export async function buildStudentReport(
  deps: StudentReportBuilderDeps,
  delegates: StudentReportDelegates,
  requester: ReportRequester,
  request: StudentReportRequest,
  page?: PageRequest,
): Promise<{ report: StudentReport; meta: StudentReportPageMeta }> {
  const { sources } = deps;
  const forbidden = () => reportError('REPORT_SCOPE_FORBIDDEN');
  const scope = await deps.scopes.authorize(requester, 'STUDENT');
  const period = deps.periods.resolvePeriod(request.period);
  const studentId = request.studentId;
  const targets = restrictToScope(scope, { studentIds: [studentId] });

  let teacherGroupIds: readonly string[] | undefined;
  if (scope.kind === 'ORGANIZATIONS' || scope.kind === 'SCHOOLS') {
    const scopeSchools = scope.kind === 'ORGANIZATIONS' ? await sources.schoolIdsOfOrganizations(targets.allowedIds) : scope.schoolIds;
    const school = await sources.schoolIdOfStudent(studentId);
    if (school === undefined || !scopeSchools.includes(school)) throw forbidden();
  } else if (scope.kind === 'GROUPS') {
    if (!(await sources.isStudentInGroupOfTeacherUser(studentId, requester.userId))) throw forbidden();
    teacherGroupIds = [...targets.allowedIds];
  } else if (scope.kind === 'STUDENTS') {
    // restrictToScope already proved the student is one of the Parent's own children (a SAME-dimension request must be a subset of the scope).
    authorizeRequestedIds([studentId], scope.studentIds);
  } else {
    throw reportError('REPORT_NOT_ALLOWED');
  }

  const facts = await sources.studentFacts(studentId);
  const schoolId = await sources.schoolIdOfStudent(studentId);
  if (!facts || schoolId === undefined) throw forbidden();

  const window = deps.periods.studentWindow(period, facts.joinDate);
  const effectiveStart = period.startDate !== null ? maxDate(period.startDate, facts.joinDate) : facts.joinDate;
  const isEmpty = window.isEmpty;
  const canSeeSubscriptions = SUBSCRIPTION_ROLES.includes(requester.activeRole) && (scope.kind === 'ORGANIZATIONS' || scope.kind === 'SCHOOLS');

  const base = { period: request.period, studentId };
  const [attendance, memorization, revision, evaluation] = isEmpty
    ? [undefined, undefined, undefined, undefined]
    : await Promise.all([delegates.attendanceReport(requester, base), delegates.memorizationReport(requester, base), delegates.revisionReport(requester, base), delegates.evaluationReport(requester, base)]);

  const examRows = isEmpty
    ? []
    : await sources.examOutcomes({
        studentId,
        from: window.start,
        ...(window.endExclusive !== null ? { toExclusive: window.endExclusive } : {}),
        ...(teacherGroupIds !== undefined ? { groupIds: teacherGroupIds } : {}),
      });

  const subscriptionRows =
    canSeeSubscriptions && !isEmpty
      ? await sources.subscriptions({ studentId, fromMonth: effectiveStart.slice(0, 7), ...(period.endDate !== null ? { toMonth: period.endDate.slice(0, 7) } : {}) })
      : [];

  const assignments = isEmpty ? [] : await sources.assignmentHistoryOfStudent(studentId);

  const groupIds = [...new Set([...examRows.map((r) => r.groupId), ...assignments.map((a) => a.groupId)])];
  const [groupNames, schoolNames] = await Promise.all([sources.groupNames(groupIds), sources.schoolNames([schoolId])]);

  // Group history: the periods that overlap the effective window, clipped to it; a Teacher sees only the groups they currently teach.
  const history: StudentGroupHistoryRow[] = [];
  for (const a of assignments) {
    if (teacherGroupIds !== undefined && !teacherGroupIds.includes(a.groupId)) continue;
    const assignedDate = businessDateOf(a.assignedAt);
    const unassignedDate = a.unassignedAt === null ? null : businessDateOf(a.unassignedAt);
    if (period.endDate !== null && assignedDate > period.endDate) continue;
    if (unassignedDate !== null && unassignedDate < effectiveStart) continue;
    const to = unassignedDate === null ? period.endDate : period.endDate !== null && unassignedDate > period.endDate ? period.endDate : unassignedDate;
    history.push({ groupId: a.groupId, groupName: a.groupName ?? groupNames.get(a.groupId) ?? null, from: maxDate(assignedDate, effectiveStart), to, current: a.unassignedAt === null });
  }
  history.sort((x, y) => (x.from < y.from ? -1 : x.from > y.from ? 1 : (x.groupName ?? '').localeCompare(y.groupName ?? '') || x.groupId.localeCompare(y.groupId)));

  const exams: StudentExamResultRow[] = examRows.map((r) => ({
    examId: r.examId,
    examDate: businessDateOf(r.startAt),
    startAt: r.startAt.toISOString(),
    groupId: r.groupId,
    groupName: groupNames.get(r.groupId) ?? null,
    outcome: r.outcome,
    questionCount: r.questionCount,
    maxScorePerQuestion: r.maxScorePerQuestion,
    scores: [...r.scores],
    total: r.total,
    maxTotal: r.maxTotal,
  }));
  const examined = exams.filter((e) => e.outcome === 'EXAMINED').length;
  const paging: PageRequest = page ?? { page: 1, pageSize: Math.max(exams.length, 1) };
  const pageResult = buildPageResult(exams.slice(pageOffset(paging), pageOffset(paging) + paging.pageSize), exams.length, paging);

  const subscriptions: StudentSubscriptionRow[] = subscriptionRows.map((r) => ({ month: r.month, status: r.status }));
  const noScores = { count: 0, average: null };
  const zeroScores = { MEMORIZATION: noScores, REVISION: noScores, PERFORMANCE: noScores, TAJWEED: noScores };
  const zeroRecords = { records: 0, fulfilled: 0, notFulfilled: 0, unscheduled: 0 };

  const report: StudentReport = {
    type: 'STUDENT',
    period: { kind: period.kind, startDate: period.startDate, endDate: period.endDate },
    generatedAt: deps.clock.now().toISOString(),
    student: { id: studentId, name: facts.fullName, schoolId, schoolName: schoolNames.get(schoolId) ?? null, joinDate: facts.joinDate },
    effectiveStartDate: isEmpty ? null : effectiveStart,
    sections: {
      attendance: {
        rows: (attendance?.rows ?? []).filter((r) => r.subjectType === 'STUDENT').map((r) => ({ groupId: r.groupId, groupName: r.groupName, present: r.present, absent: r.absent, total: r.total })),
        totals: attendance?.totals.students ?? { present: 0, absent: 0, total: 0 },
      },
      memorization: {
        rows: (memorization?.rows ?? []).map((r) => ({ groupId: r.groupId, groupName: r.groupName, records: r.records, fulfilled: r.fulfilled, notFulfilled: r.notFulfilled, unscheduled: r.unscheduled })),
        totals: memorization?.totals ?? zeroRecords,
      },
      revision: {
        rows: (revision?.rows ?? []).map((r) => ({ groupId: r.groupId, groupName: r.groupName, records: r.records, fulfilled: r.fulfilled, notFulfilled: r.notFulfilled, unscheduled: r.unscheduled })),
        totals: revision?.totals ?? zeroRecords,
      },
      evaluations: {
        rows: (evaluation?.rows ?? []).map((r) => ({ groupId: r.groupId, groupName: r.groupName, evaluations: r.evaluations, scores: r.scores })),
        totals: evaluation?.totals ?? { evaluations: 0, scores: zeroScores },
      },
      examResults: { counts: { examined, absent: exams.length - examined, total: exams.length }, rows: pageResult.items },
      ...(canSeeSubscriptions
        ? {
            subscriptions: {
              statusAsOf: deps.clock.now().toISOString(),
              rows: subscriptions,
              totals: {
                paid: subscriptions.filter((r) => r.status === 'PAID').length,
                unpaid: subscriptions.filter((r) => r.status === 'UNPAID').length,
                waived: subscriptions.filter((r) => r.status === 'WAIVED').length,
                total: subscriptions.length,
              },
            },
          }
        : {}),
      groupHistory: { rows: history },
    },
  };
  return { report, meta: { page: pageResult.page, pageSize: pageResult.pageSize, total: pageResult.total, totalPages: pageResult.totalPages } };
}
