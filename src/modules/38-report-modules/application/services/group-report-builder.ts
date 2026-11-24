import { buildPageResult, pageOffset, type Clock, type PageRequest } from '../../../00-shared-kernel/public';
import { ReportPeriodService, authorizeRequestedIds, reportError, restrictToScope, type ReportRequester } from '../../../37-reports-core/public';
import type { AttendanceReport } from '../dto/attendance-report';
import type { EvaluationReport } from '../dto/evaluation-report';
import type { GroupReport, GroupReportRequest, GroupStudentRow } from '../dto/group-report';
import type { MemorizationReport } from '../dto/memorization-report';
import type { RevisionReport } from '../dto/revision-report';
import type { StudentExamCounts } from '../dto/student-report';
import type { GroupReportSources } from '../ports/group-report-sources';
import type { StudentReportPageMeta, StudentReportScopes } from './student-report-builder';

/** The four existing reports the GROUP report reuses unchanged for the group (same authorization, scope, effective start and Teacher restrictions), so the figures can never differ from those reports. */
export interface GroupReportDelegates {
  attendanceReport(requester: ReportRequester, request: { period: GroupReportRequest['period']; groupId: string }): Promise<AttendanceReport>;
  memorizationReport(requester: ReportRequester, request: { period: GroupReportRequest['period']; groupId: string }): Promise<MemorizationReport>;
  revisionReport(requester: ReportRequester, request: { period: GroupReportRequest['period']; groupId: string }): Promise<RevisionReport>;
  evaluationReport(requester: ReportRequester, request: { period: GroupReportRequest['period']; groupId: string }): Promise<EvaluationReport>;
}

export interface GroupReportBuilderDeps {
  readonly scopes: StudentReportScopes;
  readonly periods: ReportPeriodService;
  readonly sources: GroupReportSources;
  readonly clock: Clock;
}

const zeroRecords = () => ({ records: 0, fulfilled: 0, notFulfilled: 0, unscheduled: 0 });
const zeroAttendance = () => ({ present: 0, absent: 0, total: 0 });
const zeroScores = () => ({ MEMORIZATION: { count: 0, average: null }, REVISION: { count: 0, average: null }, PERFORMANCE: { count: 0, average: null }, TAJWEED: { count: 0, average: null } });
const maxDate = (a: string, b: string): string => (a > b ? a : b);
/** The exam lookups of the roster run a few at a time (one read per student through Module 30's public contract). */
const EXAM_LOOKUPS_AT_ONCE = 10;

/**
 * The GROUP report (Master Specification §68, §69, §67): ONE group, data only. The chain is the same as every report and nothing is read before it succeeds:
 *   1. Module 37's scope computation, `authorize(requester, 'GROUP')` (Organization Manager, School Manager and Teacher; the Parent and everyone else REPORT_NOT_ALLOWED);
 *   2. the period (Module 37);
 *   3. the requested group is proven inside the scope (REPORT_SCOPE_FORBIDDEN, never revealing whether the id exists): a group of the organizations' / managed schools, or, for a Teacher, a group they CURRENTLY teach;
 *   4. only then data is read, through the owning modules' public contracts.
 * The roster is every student assigned to the group at any time inside the effective window, taken from the authoritative assignment history (not from the current roster), with or without activity; each student's
 * effective start is MAX(join date, period start). The four learning figures are the existing reports for that group; exam counts come from Module 30; the Teacher's own attendance only for the roles the ATTENDANCE
 * report shows it to. No score, ranking, weighting, comparison or financial datum is created or shown.
 */
export async function buildGroupReport(
  deps: GroupReportBuilderDeps,
  delegates: GroupReportDelegates,
  requester: ReportRequester,
  request: GroupReportRequest,
  page?: PageRequest,
): Promise<{ report: GroupReport; meta: StudentReportPageMeta }> {
  const { sources } = deps;
  const forbidden = () => reportError('REPORT_SCOPE_FORBIDDEN');
  const scope = await deps.scopes.authorize(requester, 'GROUP');
  const period = deps.periods.resolvePeriod(request.period);
  const groupId = request.groupId;
  const targets = restrictToScope(scope, { groupIds: [groupId] });

  let managerScope = false;
  if (scope.kind === 'ORGANIZATIONS' || scope.kind === 'SCHOOLS') {
    const scopeSchools = scope.kind === 'ORGANIZATIONS' ? await sources.schoolIdsOfOrganizations(targets.allowedIds) : scope.schoolIds;
    const school = await sources.schoolIdOfGroup(groupId);
    if (school === undefined || !scopeSchools.includes(school)) throw forbidden();
    managerScope = true;
  } else if (scope.kind === 'GROUPS') {
    // restrictToScope already proved the group is one the Teacher currently teaches (a SAME-dimension request must be a subset of the scope).
    authorizeRequestedIds([groupId], scope.groupIds);
  } else {
    throw reportError('REPORT_NOT_ALLOWED');
  }

  const header = await sources.groupHeader(groupId);
  if (!header) throw forbidden();

  // The roster, from the authoritative assignment history: every student with a period that overlaps the student's own effective window.
  const assignments = await sources.roster({ groupId, ...(period.start !== null ? { from: period.start } : {}), ...(period.endExclusive !== null ? { toExclusive: period.endExclusive } : {}) });
  const facts = new Map((await sources.studentFacts([...new Set(assignments.map((a) => a.studentId))])).map((f) => [f.id, f] as const));
  const eligible: Array<{ id: string; name: string; joinDate: string; effectiveStart: string; from: Date; toExclusive: Date | null }> = [];
  for (const studentId of [...new Set(assignments.map((a) => a.studentId))]) {
    const fact = facts.get(studentId);
    if (!fact) continue;
    const window = deps.periods.studentWindow(period, fact.joinDate);
    if (window.isEmpty) continue;
    const overlaps = assignments.some(
      (a) => a.studentId === studentId && (window.endExclusive === null || a.assignedAt.getTime() < window.endExclusive.getTime()) && (a.unassignedAt === null || a.unassignedAt.getTime() > window.start.getTime()),
    );
    if (!overlaps) continue;
    eligible.push({ id: studentId, name: fact.fullName, joinDate: fact.joinDate, effectiveStart: period.startDate !== null ? maxDate(period.startDate, fact.joinDate) : fact.joinDate, from: window.start, toExclusive: window.endExclusive });
  }
  eligible.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

  const base = { period: request.period, groupId };
  const [attendance, memorization, revision, evaluation] =
    eligible.length === 0 && !managerScope
      ? [undefined, undefined, undefined, undefined]
      : await Promise.all([delegates.attendanceReport(requester, base), delegates.memorizationReport(requester, base), delegates.revisionReport(requester, base), delegates.evaluationReport(requester, base)]);

  const attendanceOf = new Map((attendance?.rows ?? []).filter((r) => r.subjectType === 'STUDENT').map((r) => [r.subjectId, r] as const));
  const memorizationOf = new Map((memorization?.rows ?? []).map((r) => [r.studentId, r] as const));
  const revisionOf = new Map((revision?.rows ?? []).map((r) => [r.studentId, r] as const));
  const evaluationOf = new Map((evaluation?.rows ?? []).map((r) => [r.studentId, r] as const));

  const examCounts = new Map<string, StudentExamCounts>();
  for (let i = 0; i < eligible.length; i += EXAM_LOOKUPS_AT_ONCE) {
    await Promise.all(
      eligible.slice(i, i + EXAM_LOOKUPS_AT_ONCE).map(async (student) => {
        const outcomes = await sources.examOutcomes({ studentId: student.id, from: student.from, ...(student.toExclusive !== null ? { toExclusive: student.toExclusive } : {}), groupIds: [groupId] });
        const examined = outcomes.filter((o) => o.outcome === 'EXAMINED').length;
        examCounts.set(student.id, { examined, absent: outcomes.length - examined, total: outcomes.length });
      }),
    );
  }

  const rows: GroupStudentRow[] = eligible.map((student) => {
    const a = attendanceOf.get(student.id);
    const m = memorizationOf.get(student.id);
    const r = revisionOf.get(student.id);
    const e = evaluationOf.get(student.id);
    return {
      studentId: student.id,
      name: student.name,
      effectiveStartDate: student.effectiveStart,
      attendance: a ? { present: a.present, absent: a.absent, total: a.total } : zeroAttendance(),
      memorization: m ? { records: m.records, fulfilled: m.fulfilled, notFulfilled: m.notFulfilled, unscheduled: m.unscheduled } : zeroRecords(),
      revision: r ? { records: r.records, fulfilled: r.fulfilled, notFulfilled: r.notFulfilled, unscheduled: r.unscheduled } : zeroRecords(),
      evaluations: e ? { evaluations: e.evaluations, scores: e.scores } : { evaluations: 0, scores: zeroScores() },
      exams: examCounts.get(student.id) ?? { examined: 0, absent: 0, total: 0 },
    };
  });

  // Totals over the WHOLE eligible roster. The integer counts are the sums of the roster rows; the evaluation means are the existing report's own totals (exact: they come from the stored scores, never from averaging averages).
  const sum = <K extends 'attendance' | 'memorization' | 'revision'>(key: K): GroupStudentRow[K] =>
    rows.reduce<Record<string, number>>((acc, row) => {
      for (const [field, value] of Object.entries(row[key])) acc[field] = (acc[field] ?? 0) + (value as number);
      return acc;
    }, key === 'attendance' ? zeroAttendance() : zeroRecords()) as unknown as GroupStudentRow[K];
  const examTotals = rows.reduce((acc, row) => ({ examined: acc.examined + row.exams.examined, absent: acc.absent + row.exams.absent, total: acc.total + row.exams.total }), { examined: 0, absent: 0, total: 0 });

  const paging: PageRequest = page ?? { page: 1, pageSize: Math.max(rows.length, 1) };
  const pageResult = buildPageResult(rows.slice(pageOffset(paging), pageOffset(paging) + paging.pageSize), rows.length, paging);
  const schoolNames = await sources.schoolNames([header.schoolId]);

  const report: GroupReport = {
    type: 'GROUP',
    period: { kind: period.kind, startDate: period.startDate, endDate: period.endDate },
    generatedAt: deps.clock.now().toISOString(),
    group: { id: header.id, name: header.name, schoolId: header.schoolId, schoolName: schoolNames.get(header.schoolId) ?? null, learningMode: header.learningMode, status: header.status, teacherName: header.teacherName },
    students: pageResult.items,
    totals: {
      students: rows.length,
      attendance: sum('attendance'),
      memorization: sum('memorization'),
      revision: sum('revision'),
      evaluations: { evaluations: rows.reduce((n, row) => n + row.evaluations.evaluations, 0), scores: rows.length === 0 ? zeroScores() : (evaluation?.totals.scores ?? zeroScores()) },
      exams: examTotals,
    },
    ...(managerScope ? { teacherAttendance: attendance?.totals.teachers ?? zeroAttendance() } : {}),
  };
  return { report, meta: { page: pageResult.page, pageSize: pageResult.pageSize, total: pageResult.total, totalPages: pageResult.totalPages } };
}
