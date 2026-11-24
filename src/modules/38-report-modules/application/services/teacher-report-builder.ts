import { businessDateOf, buildPageResult, pageOffset, type Clock, type PageRequest } from '../../../00-shared-kernel/public';
import { ReportPeriodService, reportError, restrictToScope, type ReportRequester } from '../../../37-reports-core/public';
import type { AttendanceReport } from '../dto/attendance-report';
import type { GroupReport } from '../dto/group-report';
import type { TeacherReport, TeacherReportRequest, TeacherTaughtGroup } from '../dto/teacher-report';
import type { TeacherReportSources } from '../ports/teacher-report-sources';
import type { StudentReportPageMeta, StudentReportScopes } from './student-report-builder';

/** The two existing reports the TEACHER report reuses unchanged, for ONE group and ONE stint (the same authorization and scope, so a group outside the requester's scope can never be reported). */
export interface TeacherReportDelegates {
  groupReport(requester: ReportRequester, request: { period: { kind: string; startDate: string; endDate: string }; groupId: string }): Promise<GroupReport>;
  attendanceReport(requester: ReportRequester, request: { period: { kind: string; startDate: string; endDate: string }; groupId: string }): Promise<AttendanceReport>;
}

export interface TeacherReportBuilderDeps {
  readonly scopes: StudentReportScopes;
  readonly periods: ReportPeriodService;
  readonly sources: TeacherReportSources;
  readonly clock: Clock;
}

/**
 * The TEACHER report (Master Specification §68), data only, limited to the REQUESTER'S AUTHORIZED SCHOOLS. The chain is the same as every report and nothing about the Teacher is read before it succeeds:
 *   1. Module 37's scope computation, `authorize(requester, 'TEACHER')`: only the Organization Manager and the School Manager (a Teacher, even for themselves, the Parent, the Collector, MAIN_ADMIN, geographic managers
 *      and Student: REPORT_NOT_ALLOWED);
 *   2. the period (Module 37);
 *   3. the authorized schools: the schools of the organizations, or the actively managed schools. EVERY later read is given ONLY these school ids, so the Teacher's work in any other school (or organization) is invisible;
 *   4. the Teacher is proven inside the scope: they are currently linked to an authorized school OR taught a group of one at some time (so a Teacher who has left that school keeps their history there). Otherwise,
 *      and for a Teacher that does not exist, the SAME 403 REPORT_SCOPE_FORBIDDEN;
 *   5. only then the Teacher's name, the authorized schools they are linked to, and each stint.
 * A stint is a continuous time the Teacher taught a group, derived only from the group's authoritative history (never from who owns it now). Every figure of a stint is the existing GROUP and ATTENDANCE reports
 * for exactly the stint's dates (clipped to the period); a stint is one entry (a Teacher who left a group and came back has two). Only the requested page of entries is computed; `page` undefined: all (files).
 */
export async function buildTeacherReport(
  deps: TeacherReportBuilderDeps,
  delegates: TeacherReportDelegates,
  requester: ReportRequester,
  request: TeacherReportRequest,
  page?: PageRequest,
): Promise<{ report: TeacherReport; meta: StudentReportPageMeta }> {
  const { sources } = deps;
  const forbidden = () => reportError('REPORT_SCOPE_FORBIDDEN');
  const scope = await deps.scopes.authorize(requester, 'TEACHER');
  const period = deps.periods.resolvePeriod(request.period);
  if (scope.kind !== 'ORGANIZATIONS' && scope.kind !== 'SCHOOLS') throw reportError('REPORT_NOT_ALLOWED');
  const targets = restrictToScope(scope, {});
  const authorizedSchools = [...new Set(scope.kind === 'ORGANIZATIONS' ? await sources.schoolIdsOfOrganizations(targets.allowedIds) : scope.schoolIds)];
  const teacherId = request.teacherId;

  const linkedHere = (await sources.activeSchoolIdsOfTeacher(teacherId)).filter((id) => authorizedSchools.includes(id));
  if (linkedHere.length === 0 && (await sources.taughtGroups({ teacherId, schoolIds: authorizedSchools })).length === 0) throw forbidden();
  const name = await sources.teacherName(teacherId);
  if (name === undefined) throw forbidden();

  const stints = await sources.taughtGroups({ teacherId, schoolIds: authorizedSchools, ...(period.start !== null ? { from: period.start } : {}), ...(period.endExclusive !== null ? { toExclusive: period.endExclusive } : {}) });
  const schoolNames = await sources.schoolNames([...linkedHere, ...stints.map((s) => s.schoolId)]);
  const entries = [...stints].sort(
    (a, b) => (schoolNames.get(a.schoolId) ?? '').localeCompare(schoolNames.get(b.schoolId) ?? '') || a.schoolId.localeCompare(b.schoolId) || a.groupName.localeCompare(b.groupName) || a.groupId.localeCompare(b.groupId) || a.from.getTime() - b.from.getTime(),
  );

  const today = businessDateOf(deps.clock.now());
  const paging: PageRequest = page ?? { page: 1, pageSize: Math.max(entries.length, 1) };
  const pageResult = buildPageResult(entries.slice(pageOffset(paging), pageOffset(paging) + paging.pageSize), entries.length, paging);

  const groups: TeacherTaughtGroup[] = [];
  for (const stint of pageResult.items) {
    const taughtFrom = businessDateOf(stint.from);
    const taughtTo = stint.to === null ? today : businessDateOf(new Date(stint.to.getTime() - 1)); // `to` is exclusive: the last instant of the stint decides the last day
    const stintPeriod = { kind: 'CUSTOM', startDate: taughtFrom, endDate: taughtTo < taughtFrom ? taughtFrom : taughtTo };
    const base = { period: stintPeriod, groupId: stint.groupId };
    const [group, attendance] = await Promise.all([delegates.groupReport(requester, base), delegates.attendanceReport(requester, base)]);
    const own = attendance.rows.filter((row) => row.subjectType === 'TEACHER' && row.subjectId === teacherId);
    groups.push({
      groupId: stint.groupId,
      groupName: stint.groupName,
      schoolId: stint.schoolId,
      schoolName: schoolNames.get(stint.schoolId) ?? null,
      learningMode: stint.learningMode,
      taughtFrom,
      taughtTo: stintPeriod.endDate,
      stillTeaching: stint.stillTeaching,
      teacherAttendance: { present: own.reduce((n, r) => n + r.present, 0), absent: own.reduce((n, r) => n + r.absent, 0), total: own.reduce((n, r) => n + r.total, 0) },
      students: group.totals.students,
      attendance: group.totals.attendance,
      memorization: group.totals.memorization,
      revision: group.totals.revision,
      evaluations: group.totals.evaluations,
      exams: group.totals.exams,
    });
  }

  const report: TeacherReport = {
    type: 'TEACHER',
    period: { kind: period.kind, startDate: period.startDate, endDate: period.endDate },
    generatedAt: deps.clock.now().toISOString(),
    teacher: { id: teacherId, name, schools: [...new Set(linkedHere)].map((id) => ({ id, name: schoolNames.get(id) ?? null })).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '') || a.id.localeCompare(b.id)) },
    groups,
  };
  return { report, meta: { page: pageResult.page, pageSize: pageResult.pageSize, total: pageResult.total, totalPages: pageResult.totalPages } };
}
