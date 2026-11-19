import { describe, expect, it } from 'vitest';
import { AppError } from '../../../src/modules/00-shared-kernel/public';
import {
  PublicReportScopeSources,
  REPORT_AVAILABILITY,
  REPORT_TYPES,
  ReportScopeResolver,
  authorizeRequestedIds,
  isReportAvailableTo,
  restrictToScope,
  type ReportScopeSources,
} from '../../../src/modules/37-reports-core/public';

const U = 'u1';
const codeOf = (fn: () => unknown): string => {
  try {
    fn();
    return 'NO_ERROR';
  } catch (e) {
    return e instanceof AppError ? e.code : `NOT_APP_ERROR:${String(e)}`;
  }
};
const codeOfAsync = (p: Promise<unknown>) => p.then(() => 'NO_ERROR', (e: unknown) => (e instanceof AppError ? e.code : `NOT_APP_ERROR:${String(e)}`));

function sources(over: Partial<ReportScopeSources> = {}): ReportScopeSources {
  return {
    organizationIdsOfAdmin: async () => ['org1'],
    schoolIdsOfManager: async () => ['s1', 's2'],
    schoolIdsOfCollector: async () => ['s1'],
    groupIdsOfTeacher: async () => ['g1', 'g2'],
    studentIdsOfParent: async () => ['st1', 'st2'],
    geographicAreasOfManager: async () => ['area1'],
    ...over,
  };
}

describe('ReportScopeResolver: every role reports only inside its own scope (deny by default)', () => {
  it('maps each approved role to its own scope', async () => {
    const r = new ReportScopeResolver(sources());
    expect(await r.resolve({ userId: U, activeRole: 'ORGANIZATION_MANAGER' })).toEqual({ kind: 'ORGANIZATIONS', organizationIds: ['org1'] });
    expect(await r.resolve({ userId: U, activeRole: 'SCHOOL_MANAGER' })).toEqual({ kind: 'SCHOOLS', schoolIds: ['s1', 's2'] });
    expect(await r.resolve({ userId: U, activeRole: 'SUBSCRIPTION_COLLECTOR' })).toEqual({ kind: 'SCHOOLS', schoolIds: ['s1'] });
    expect(await r.resolve({ userId: U, activeRole: 'TEACHER' })).toEqual({ kind: 'GROUPS', groupIds: ['g1', 'g2'] });
    expect(await r.resolve({ userId: U, activeRole: 'PARENT' })).toEqual({ kind: 'STUDENTS', studentIds: ['st1', 'st2'] });
  });

  it('MAIN_ADMIN has NO reporting access and is never treated as an Organization Manager (even when it administers an organization)', async () => {
    let asked = 0;
    const r = new ReportScopeResolver(sources({ organizationIdsOfAdmin: async () => { asked += 1; return ['org1']; } }));
    expect(await r.resolve({ userId: U, activeRole: 'MAIN_ADMIN' })).toEqual({ kind: 'NONE', reason: 'ROLE_HAS_NO_REPORT_ACCESS' });
    expect(asked).toBe(0); // the organization source is not even consulted for it
    for (const type of REPORT_TYPES) expect(await codeOfAsync(r.authorize({ userId: U, activeRole: 'MAIN_ADMIN' }, type))).toBe('REPORT_NOT_ALLOWED');
  });

  it('STUDENT and unknown roles have no reporting access', async () => {
    const r = new ReportScopeResolver(sources());
    for (const role of ['STUDENT', 'NOBODY', '', 'main_admin', 'organization_manager']) {
      expect(await r.resolve({ userId: U, activeRole: role })).toEqual({ kind: 'NONE', reason: 'ROLE_HAS_NO_REPORT_ACCESS' });
      expect(await codeOfAsync(r.authorize({ userId: U, activeRole: role }, 'STUDENT'))).toBe('REPORT_NOT_ALLOWED');
    }
  });

  it('Governorate, Center and Village managers are DENIED while no authoritative assignment exists (the production adapter answers undefined)', async () => {
    const production = new ReportScopeResolver(new PublicReportScopeSources({
      organizations: { listAdministeredOrganizationIds: async () => ['org1'] },
      schools: { listManagedSchoolIds: async () => ['s1'] },
      collectors: { listActiveSchoolIds: async () => ['s1'] },
      groups: { listCurrentGroupIdsOfTeacherUser: async () => ['g1'] },
      students: { listChildrenOfParentUser: async () => ({ items: [], total: 0 }) } as never,
    }));
    for (const role of ['GOVERNORATE_MANAGER', 'CENTER_MANAGER', 'VILLAGE_MANAGER']) {
      expect(await production.resolve({ userId: U, activeRole: role })).toEqual({ kind: 'NONE', reason: 'GEOGRAPHIC_ASSIGNMENT_UNAVAILABLE' });
      for (const type of REPORT_TYPES) expect(await codeOfAsync(production.authorize({ userId: U, activeRole: role }, type))).toBe('REPORT_NOT_ALLOWED');
    }
  });

  it('once an authoritative assignment exists the intended geographic scope applies per level, and an empty assignment still denies', async () => {
    const seen: string[] = [];
    const r = new ReportScopeResolver(sources({ geographicAreasOfManager: async (_u, level) => { seen.push(level); return ['a1', 'a1', 'a2']; } }));
    expect(await r.resolve({ userId: U, activeRole: 'GOVERNORATE_MANAGER' })).toEqual({ kind: 'GEOGRAPHIC', level: 'GOVERNORATE', areaIds: ['a1', 'a2'] });
    expect(await r.resolve({ userId: U, activeRole: 'CENTER_MANAGER' })).toMatchObject({ level: 'CENTER' });
    expect(await r.resolve({ userId: U, activeRole: 'VILLAGE_MANAGER' })).toMatchObject({ level: 'VILLAGE' });
    expect(seen).toEqual(['GOVERNORATE', 'CENTER', 'VILLAGE']);
    const empty = new ReportScopeResolver(sources({ geographicAreasOfManager: async () => [] }));
    expect(await empty.resolve({ userId: U, activeRole: 'CENTER_MANAGER' })).toEqual({ kind: 'NONE', reason: 'NO_CURRENT_ASSIGNMENT' });
  });

  it('a role with no current assignment gets NO scope (never "everything")', async () => {
    const r = new ReportScopeResolver(sources({
      organizationIdsOfAdmin: async () => [], schoolIdsOfManager: async () => [], schoolIdsOfCollector: async () => [], groupIdsOfTeacher: async () => [], studentIdsOfParent: async () => [],
    }));
    for (const role of ['ORGANIZATION_MANAGER', 'SCHOOL_MANAGER', 'SUBSCRIPTION_COLLECTOR', 'TEACHER', 'PARENT']) {
      expect(await r.resolve({ userId: U, activeRole: role })).toEqual({ kind: 'NONE', reason: 'NO_CURRENT_ASSIGNMENT' });
      expect(await codeOfAsync(r.authorize({ userId: U, activeRole: role }, isReportAvailableTo(role, 'PAYMENT') ? 'PAYMENT' : 'STUDENT'))).toBe('REPORT_NOT_ALLOWED');
    }
  });

  it('uses the ACTIVE role only: a user who is a School Manager and a Teacher gets the scope of the role being used, never the union', async () => {
    const r = new ReportScopeResolver(sources());
    expect((await r.resolve({ userId: U, activeRole: 'TEACHER' })).kind).toBe('GROUPS');
    expect((await r.resolve({ userId: U, activeRole: 'SCHOOL_MANAGER' })).kind).toBe('SCHOOLS');
  });

  it('authorize needs BOTH the report type for the role AND a non-empty scope', async () => {
    const r = new ReportScopeResolver(sources());
    expect(await r.authorize({ userId: U, activeRole: 'SUBSCRIPTION_COLLECTOR' }, 'PAYMENT')).toEqual({ kind: 'SCHOOLS', schoolIds: ['s1'] });
    expect(await codeOfAsync(r.authorize({ userId: U, activeRole: 'SUBSCRIPTION_COLLECTOR' }, 'ATTENDANCE'))).toBe('REPORT_NOT_ALLOWED');
    expect(await codeOfAsync(r.authorize({ userId: U, activeRole: 'TEACHER' }, 'PAYMENT'))).toBe('REPORT_NOT_ALLOWED');
    expect(await codeOfAsync(r.authorize({ userId: U, activeRole: 'PARENT' }, 'GROUP'))).toBe('REPORT_NOT_ALLOWED');
    expect(await codeOfAsync(r.authorize({ userId: U, activeRole: 'SCHOOL_MANAGER' }, 'GEOGRAPHIC'))).toBe('REPORT_NOT_ALLOWED');
  });
});

describe('the report availability matrix', () => {
  it('lists exactly the approved roles and report types (deny by default for everything else)', () => {
    expect(Object.keys(REPORT_AVAILABILITY).sort()).toEqual(['CENTER_MANAGER', 'GOVERNORATE_MANAGER', 'ORGANIZATION_MANAGER', 'PARENT', 'SCHOOL_MANAGER', 'SUBSCRIPTION_COLLECTOR', 'TEACHER', 'VILLAGE_MANAGER']);
    expect(REPORT_TYPES).toHaveLength(12);
    expect(REPORT_AVAILABILITY.SUBSCRIPTION_COLLECTOR).toEqual(['PAYMENT']);
    expect(REPORT_AVAILABILITY.TEACHER).not.toContain('PAYMENT');
    expect(REPORT_AVAILABILITY.PARENT).not.toContain('PAYMENT');
    expect(isReportAvailableTo('MAIN_ADMIN', 'SCHOOL')).toBe(false);
    expect(isReportAvailableTo('STUDENT', 'STUDENT')).toBe(false);
    expect(isReportAvailableTo('ORGANIZATION_MANAGER', 'GEOGRAPHIC')).toBe(true);
  });
});

describe('requested ids are checked against the scope, never trusted', () => {
  it('authorizeRequestedIds: no request means exactly the scope; a subset is allowed; one foreign id forbids the whole request without revealing existence', () => {
    expect(authorizeRequestedIds(undefined, ['a', 'b'])).toEqual(['a', 'b']);
    expect(authorizeRequestedIds([], ['a', 'b', 'a'])).toEqual(['a', 'b']);
    expect(authorizeRequestedIds(['b'], ['a', 'b'])).toEqual(['b']);
    expect(codeOf(() => authorizeRequestedIds(['a', 'zzz'], ['a', 'b']))).toBe('REPORT_SCOPE_FORBIDDEN');
    expect(codeOf(() => authorizeRequestedIds(['anything'], []))).toBe('REPORT_SCOPE_FORBIDDEN');
  });

  it('restrictToScope: same dimension must be a subset; a BROADER dimension is forbidden; a FINER one must still be proven by the report', () => {
    const school = { kind: 'SCHOOLS', schoolIds: ['s1', 's2'] } as const;
    expect(restrictToScope(school).allowedIds).toEqual(['s1', 's2']);
    expect(restrictToScope(school, { schoolIds: ['s2'] }).allowedIds).toEqual(['s2']);
    expect(codeOf(() => restrictToScope(school, { schoolIds: ['s9'] }))).toBe('REPORT_SCOPE_FORBIDDEN');
    expect(codeOf(() => restrictToScope(school, { organizationIds: ['org1'] }))).toBe('REPORT_SCOPE_FORBIDDEN'); // broader than a school
    const finer = restrictToScope(school, { groupIds: ['g9'], studentIds: ['x'] });
    expect(finer.allowedIds).toEqual(['s1', 's2']); // a finer request never widens the scope
    expect(finer.mustBeContained).toEqual({ groupIds: ['g9'], studentIds: ['x'] });

    const teacher = { kind: 'GROUPS', groupIds: ['g1'] } as const;
    expect(codeOf(() => restrictToScope(teacher, { schoolIds: ['s1'] }))).toBe('REPORT_SCOPE_FORBIDDEN');
    expect(codeOf(() => restrictToScope(teacher, { groupIds: ['g2'] }))).toBe('REPORT_SCOPE_FORBIDDEN');
    expect(restrictToScope(teacher, { studentIds: ['st1'] }).mustBeContained).toEqual({ studentIds: ['st1'] });

    const parent = { kind: 'STUDENTS', studentIds: ['c1'] } as const;
    expect(codeOf(() => restrictToScope(parent, { groupIds: ['g1'] }))).toBe('REPORT_SCOPE_FORBIDDEN');
    expect(codeOf(() => restrictToScope(parent, { studentIds: ['c1', 'other'] }))).toBe('REPORT_SCOPE_FORBIDDEN'); // another parent's child
    expect(restrictToScope(parent, { studentIds: ['c1'] }).allowedIds).toEqual(['c1']);

    const org = { kind: 'ORGANIZATIONS', organizationIds: ['org1'] } as const;
    expect(codeOf(() => restrictToScope(org, { organizationIds: ['org2'] }))).toBe('REPORT_SCOPE_FORBIDDEN');
    expect(restrictToScope(org, { schoolIds: ['s5'] }).mustBeContained).toEqual({ schoolIds: ['s5'] });
  });

  it('a NONE scope is refused again as a safety net', () => {
    expect(codeOf(() => restrictToScope({ kind: 'NONE', reason: 'ROLE_HAS_NO_REPORT_ACCESS' }))).toBe('REPORT_NOT_ALLOWED');
  });
});

describe('PublicReportScopeSources reads through the owning modules only', () => {
  it('pages through a Parent\'s children and returns the ids; the Collector scope uses active assignments only', async () => {
    const calls: number[] = [];
    const sourcesFromPublic = new PublicReportScopeSources({
      organizations: { listAdministeredOrganizationIds: async () => ['o'] },
      schools: { listManagedSchoolIds: async () => ['s'] },
      collectors: { listActiveSchoolIds: async (u: string) => (u === 'collector' ? ['active-school'] : []) },
      groups: { listCurrentGroupIdsOfTeacherUser: async () => ['g'] },
      students: {
        listChildrenOfParentUser: async (_u: string, input: { page: { page: number } }) => {
          calls.push(input.page.page);
          return input.page.page === 1 ? { items: [{ id: 'c1' }, { id: 'c2' }], total: 3 } : { items: [{ id: 'c3' }], total: 3 };
        },
      } as never,
    });
    expect(await sourcesFromPublic.studentIdsOfParent('p')).toEqual(['c1', 'c2', 'c3']);
    expect(calls).toEqual([1, 2]);
    expect(await sourcesFromPublic.schoolIdsOfCollector('collector')).toEqual(['active-school']);
    expect(await sourcesFromPublic.schoolIdsOfCollector('ended-link-user')).toEqual([]);
    expect(await sourcesFromPublic.geographicAreasOfManager('x', 'CENTER')).toBeUndefined();
  });
});
