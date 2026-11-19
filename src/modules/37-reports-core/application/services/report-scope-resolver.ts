import type { ReportScope } from '../../domain/value-objects/report-scope';
import { isReportAvailableTo, type ReportType } from '../../domain/value-objects/report-types';
import { reportError } from '../../domain/errors/report-errors';
import type { ReportScopeSources } from '../ports/report-scope-sources';

const unique = (ids: readonly string[]): string[] => [...new Set(ids)];

/** The requester as proven by the verified session: the user id and the ACTIVE role (a user with several roles reports under the role they are currently using, never the union). */
export interface ReportRequester {
  readonly userId: string;
  readonly activeRole: string;
}

/**
 * Computes the reporting scope of a requester and checks report availability. Everything here is deny-by-default and server-side:
 *  - MAIN_ADMIN is a separate system-level role: it is NEVER given organization-wide reporting access (it is not an Organization Manager); with no defined reporting rule it has no scope;
 *  - STUDENT and any unknown role: no scope;
 *  - an assignment that cannot be proven (no school, group, child, area) is a denial, never "everything".
 */
export class ReportScopeResolver {
  constructor(private readonly sources: ReportScopeSources) {}

  async resolve(requester: ReportRequester): Promise<ReportScope> {
    const { userId } = requester;
    switch (requester.activeRole) {
      case 'ORGANIZATION_MANAGER':
        return this.of(await this.sources.organizationIdsOfAdmin(userId), (organizationIds) => ({ kind: 'ORGANIZATIONS', organizationIds }));
      case 'GOVERNORATE_MANAGER':
        return this.geographic(userId, 'GOVERNORATE');
      case 'CENTER_MANAGER':
        return this.geographic(userId, 'CENTER');
      case 'VILLAGE_MANAGER':
        return this.geographic(userId, 'VILLAGE');
      case 'SCHOOL_MANAGER':
        return this.of(await this.sources.schoolIdsOfManager(userId), (schoolIds) => ({ kind: 'SCHOOLS', schoolIds }));
      case 'SUBSCRIPTION_COLLECTOR':
        return this.of(await this.sources.schoolIdsOfCollector(userId), (schoolIds) => ({ kind: 'SCHOOLS', schoolIds }));
      case 'TEACHER':
        return this.of(await this.sources.groupIdsOfTeacher(userId), (groupIds) => ({ kind: 'GROUPS', groupIds }));
      case 'PARENT':
        return this.of(await this.sources.studentIdsOfParent(userId), (studentIds) => ({ kind: 'STUDENTS', studentIds }));
      default:
        return { kind: 'NONE', reason: 'ROLE_HAS_NO_REPORT_ACCESS' };
    }
  }

  /** The one entry point every report endpoint and export must use: the role must be allowed this report type AND have a non-empty scope; otherwise a 403 (REPORT_NOT_ALLOWED). */
  async authorize(requester: ReportRequester, type: ReportType): Promise<ReportScope> {
    if (!isReportAvailableTo(requester.activeRole, type)) throw reportError('REPORT_NOT_ALLOWED');
    const scope = await this.resolve(requester);
    if (scope.kind === 'NONE') throw reportError('REPORT_NOT_ALLOWED');
    return scope;
  }

  private of(ids: readonly string[], build: (ids: string[]) => ReportScope): ReportScope {
    const list = unique(ids);
    return list.length === 0 ? { kind: 'NONE', reason: 'NO_CURRENT_ASSIGNMENT' } : build(list);
  }

  private async geographic(userId: string, level: 'GOVERNORATE' | 'CENTER' | 'VILLAGE'): Promise<ReportScope> {
    const areas = await this.sources.geographicAreasOfManager(userId, level);
    if (areas === undefined) return { kind: 'NONE', reason: 'GEOGRAPHIC_ASSIGNMENT_UNAVAILABLE' };
    return this.of(areas, (areaIds) => ({ kind: 'GEOGRAPHIC', level, areaIds }));
  }
}

/**
 * Checks ids that a client REQUESTED (a school, group, student or area filter) against the ids the scope allows. It returns the requested ids when every one is allowed and throws
 * REPORT_SCOPE_FORBIDDEN otherwise (the same answer whether the id exists or not: existence is never revealed). With nothing requested it returns all the allowed ids, so
 * a report without filters covers exactly the whole scope and nothing more. Use it for filters, pagination targets, aggregates and exports alike.
 */
export function authorizeRequestedIds(requested: readonly string[] | undefined, allowed: readonly string[]): string[] {
  if (requested === undefined || requested.length === 0) return unique(allowed);
  const allowedSet = new Set(allowed);
  const wanted = unique(requested);
  if (wanted.some((id) => !allowedSet.has(id))) throw reportError('REPORT_SCOPE_FORBIDDEN');
  return wanted;
}

/** What a client may ask a report to narrow to. Every list is only a REQUEST that is checked against the scope; none of it grants anything. */
export interface RequestedReportTargets {
  readonly organizationIds?: readonly string[];
  readonly schoolIds?: readonly string[];
  readonly groupIds?: readonly string[];
  readonly studentIds?: readonly string[];
}

/** The result of checking a request against the scope: the scope's own allowed ids (narrowed by the request when it names the same dimension) and the finer-grained ids that the report must still prove lie inside the scope. */
export interface ScopedReportTargets {
  readonly scope: ReportScope;
  /** The ids of the scope's own dimension (organizations, areas, schools, groups or students) the report may read: the whole scope, or the requested subset of it. */
  readonly allowedIds: readonly string[];
  /** Requested ids of a FINER dimension than the scope (e.g. a school inside an Organization Manager's organization, a student inside a Teacher's groups). They are NOT yet proven to be inside the scope: the report must verify containment through the owning module before reading, and must treat a miss exactly like REPORT_SCOPE_FORBIDDEN. */
  readonly mustBeContained: Readonly<Partial<Record<'schoolIds' | 'groupIds' | 'studentIds', readonly string[]>>>;
}

const DIMENSION_RANK = { organizationIds: 5, areaIds: 4, schoolIds: 3, groupIds: 2, studentIds: 1 } as const;

const scopeDimension = (scope: Exclude<ReportScope, { kind: 'NONE' }>): { key: keyof typeof DIMENSION_RANK; ids: readonly string[] } => {
  switch (scope.kind) {
    case 'ORGANIZATIONS':
      return { key: 'organizationIds', ids: scope.organizationIds };
    case 'GEOGRAPHIC':
      return { key: 'areaIds', ids: scope.areaIds };
    case 'SCHOOLS':
      return { key: 'schoolIds', ids: scope.schoolIds };
    case 'GROUPS':
      return { key: 'groupIds', ids: scope.groupIds };
    case 'STUDENTS':
      return { key: 'studentIds', ids: scope.studentIds };
  }
};

/**
 * THE single place where a request is checked against a scope, for filters, requested ids, aggregates, counts and exports alike (so no report re-implements it):
 *  - a requested dimension BROADER than the scope's own (an organization for a School Manager, a school for a Teacher, a group for a Parent) is forbidden: REPORT_SCOPE_FORBIDDEN;
 *  - the SAME dimension must be a subset of the scope (`authorizeRequestedIds`); with no request the whole scope is used, never more;
 *  - a FINER dimension is returned in `mustBeContained` for the report to verify through the owning module (it can never widen `allowedIds`).
 * A NONE scope never gets here (`ReportScopeResolver.authorize` refuses it first); it is refused again as a safety net.
 */
export function restrictToScope(scope: ReportScope, requested: RequestedReportTargets = {}): ScopedReportTargets {
  if (scope.kind === 'NONE') throw reportError('REPORT_NOT_ALLOWED');
  const own = scopeDimension(scope);
  const asked: Record<'organizationIds' | 'schoolIds' | 'groupIds' | 'studentIds', readonly string[] | undefined> = {
    organizationIds: requested.organizationIds,
    schoolIds: requested.schoolIds,
    groupIds: requested.groupIds,
    studentIds: requested.studentIds,
  };
  let allowedIds: string[] = unique(own.ids);
  const mustBeContained: { schoolIds?: readonly string[]; groupIds?: readonly string[]; studentIds?: readonly string[] } = {};
  for (const key of ['organizationIds', 'schoolIds', 'groupIds', 'studentIds'] as const) {
    const ids = asked[key];
    if (ids === undefined || ids.length === 0) continue;
    const rank = DIMENSION_RANK[key];
    const ownRank = DIMENSION_RANK[own.key];
    if (rank > ownRank) throw reportError('REPORT_SCOPE_FORBIDDEN');
    if (rank === ownRank) allowedIds = authorizeRequestedIds(ids, own.ids);
    else if (key !== 'organizationIds') mustBeContained[key] = unique(ids);
  }
  return { scope, allowedIds, mustBeContained };
}
