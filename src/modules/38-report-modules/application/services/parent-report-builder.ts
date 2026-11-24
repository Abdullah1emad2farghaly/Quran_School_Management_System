import { buildPageResult, pageOffset, type Clock, type PageRequest } from '../../../00-shared-kernel/public';
import { ValidationError } from '../../../04-validation-api/public';
import { ReportPeriodService, reportError, restrictToScope, type ReportRequester } from '../../../37-reports-core/public';
import type { ParentReport, ParentReportRequest } from '../dto/parent-report';
import type { StudentReport, StudentReportRequest } from '../dto/student-report';
import type { ParentReportSources } from '../ports/parent-report-sources';
import type { StudentReportPageMeta, StudentReportScopes } from './student-report-builder';

export interface ParentReportBuilderDeps {
  readonly scopes: StudentReportScopes;
  readonly periods: ReportPeriodService;
  readonly sources: ParentReportSources;
  readonly clock: Clock;
  /** The STUDENT report of one child, for the SAME requester (it repeats the whole authorization chain for that child, so a child is never reported outside the scope). */
  studentReport(requester: ReportRequester, request: StudentReportRequest): Promise<StudentReport>;
}

/**
 * The PARENT report (Master Specification §68): ONE Parent and ALL their linked children, each with a separate, complete STUDENT report. The chain is the same as every report and nothing about a child is read before it succeeds:
 *   1. Module 37's scope computation, `authorize(requester, 'PARENT')` (ORGANIZATION_MANAGER, SCHOOL_MANAGER and PARENT only; everyone else REPORT_NOT_ALLOWED);
 *   2. the period (Module 37);
 *   3. WHICH Parent: a PARENT is their own Parent record and may never name another (REPORT_SCOPE_FORBIDDEN); a manager MUST name one (a missing `parentId` is a 400 REQUIRED_FIELD) and the Parent must lie inside the scope:
 *      the Parent has a child in a school of the scope, or is currently linked to one. A Parent outside the scope and a Parent that does not exist are the SAME 403 REPORT_SCOPE_FORBIDDEN;
 *   4. WHICH children: all the Parent's children of ANY lifecycle status (ARCHIVED and INACTIVE included; the status is never exposed), for a manager only those in the schools of their scope (a Parent linked to several schools never
 *      exposes the children of a school the manager does not manage), for a PARENT all their own;
 *   5. only then each child's STUDENT report is built.
 * The children are ordered by name; only the requested page of them gets a full report (`page` undefined: all, for the files). Nothing is invented, summed or compared across children.
 */
export async function buildParentReport(
  deps: ParentReportBuilderDeps,
  requester: ReportRequester,
  request: ParentReportRequest,
  page?: PageRequest,
): Promise<{ report: ParentReport; meta: StudentReportPageMeta }> {
  const { sources } = deps;
  const forbidden = () => reportError('REPORT_SCOPE_FORBIDDEN');
  const scope = await deps.scopes.authorize(requester, 'PARENT');
  const period = deps.periods.resolvePeriod(request.period);

  let parentId: string;
  let children: Awaited<ReturnType<ParentReportSources['childrenOfParent']>>;
  if (scope.kind === 'STUDENTS') {
    // The PARENT role: the Parent record comes from the verified account, never from the request.
    const own = await sources.parentOfUser(requester.userId);
    if (!own || (request.parentId !== undefined && request.parentId !== own.id)) throw forbidden();
    parentId = own.id;
    const ownChildren = new Set(scope.studentIds);
    children = (await sources.childrenOfParent({ parentId })).filter((child) => ownChildren.has(child.id));
  } else if (scope.kind === 'ORGANIZATIONS' || scope.kind === 'SCHOOLS') {
    if (request.parentId === undefined) throw new ValidationError([{ field: 'parentId', code: 'REQUIRED_FIELD' }]);
    parentId = request.parentId;
    const targets = restrictToScope(scope, {});
    const scopeSchools = scope.kind === 'ORGANIZATIONS' ? await sources.schoolIdsOfOrganizations(targets.allowedIds) : scope.schoolIds;
    children = await sources.childrenOfParent({ parentId, schoolIds: scopeSchools });
    if (children.length === 0 && !(await sources.activeSchoolIdsOfParent(parentId)).some((schoolId) => scopeSchools.includes(schoolId))) throw forbidden();
  } else {
    throw reportError('REPORT_NOT_ALLOWED');
  }

  const name = await sources.parentName(parentId);
  if (name === undefined) throw forbidden();

  const paging: PageRequest = page ?? { page: 1, pageSize: Math.max(children.length, 1) };
  const pageResult = buildPageResult(children.slice(pageOffset(paging), pageOffset(paging) + paging.pageSize), children.length, paging);
  const childReports: StudentReport[] = [];
  for (const child of pageResult.items) childReports.push(await deps.studentReport(requester, { period: request.period, studentId: child.id }));

  const report: ParentReport = {
    type: 'PARENT',
    period: { kind: period.kind, startDate: period.startDate, endDate: period.endDate },
    generatedAt: deps.clock.now().toISOString(),
    parent: { id: parentId, name, children: children.map((child) => ({ id: child.id, name: child.fullName })) },
    childReports,
  };
  return { report, meta: { page: pageResult.page, pageSize: pageResult.pageSize, total: pageResult.total, totalPages: pageResult.totalPages } };
}
