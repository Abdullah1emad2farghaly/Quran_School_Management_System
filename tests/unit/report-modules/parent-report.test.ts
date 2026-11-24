import { describe, expect, it } from 'vitest';
import { ReportPeriodService, ReportScopeResolver, type ReportScopeSources } from '../../../src/modules/37-reports-core/public';
import { PublicParentReportSources, ReportService, type ParentReportSources, type StudentReport } from '../../../src/modules/38-report-modules/public';
import { buildParentReport } from '../../../src/modules/38-report-modules/application/services/parent-report-builder';

const ORG = 'org-1';
const S1 = 'school-1'; // managed by the School Manager
const S2 = 'school-2'; // same organization, NOT managed by the School Manager
const S_OTHER = 'school-other-org';
const P1 = 'parent-1'; // user-parent: children C1 (S1), C2 (S2), C3 (S1, archived)
const P_EMPTY = 'parent-empty'; // linked to S1, no child yet
const P_OTHER = 'parent-other'; // another organization
const C1 = 'child-1';
const C2 = 'child-2';
const C3 = 'child-3';
const C_OTHER = 'child-other';

const NOW = new Date('2026-11-18T10:00:00Z');
const clock = { now: () => NOW };
const CHILDREN = [
  { id: C1, schoolId: S1, fullName: 'أحمد محمد علي', joinDate: '2026-09-01', parentId: P1 },
  { id: C2, schoolId: S2, fullName: 'بلال محمد علي', joinDate: '2026-09-01', parentId: P1 },
  { id: C3, schoolId: S1, fullName: 'زياد محمد علي', joinDate: '2026-09-01', parentId: P1 }, // ARCHIVED (the status is never exposed by the contract)
  { id: C_OTHER, schoolId: S_OTHER, fullName: 'سعيد خالد', joinDate: '2026-01-01', parentId: P_OTHER },
];
const PARENTS: Record<string, { name: string; links: string[]; userId: string }> = {
  [P1]: { name: 'محمد علي حسن', links: [S1, S2], userId: 'user-parent' },
  [P_EMPTY]: { name: 'فاطمة أحمد حسن', links: [S1], userId: 'user-empty' },
  [P_OTHER]: { name: 'خالد سعيد علي', links: [S_OTHER], userId: 'user-other' },
};

function fixture(options: { parentScope?: string[] } = {}) {
  const reads = { children: [] as unknown[], studentReports: [] as Array<{ role: string; studentId: string; period: unknown }>, names: 0 };
  const sources: ParentReportSources = {
    schoolIdsOfOrganizations: async (ids) => (ids.includes(ORG) ? [S1, S2] : []),
    parentOfUser: async (userId) => {
      const found = Object.entries(PARENTS).find(([, p]) => p.userId === userId);
      return found ? { id: found[0] } : undefined;
    },
    parentName: async (id) => {
      reads.names += 1;
      return PARENTS[id]?.name;
    },
    activeSchoolIdsOfParent: async (id) => PARENTS[id]?.links ?? [],
    childrenOfParent: async (query) => {
      reads.children.push(query);
      return CHILDREN.filter((c) => c.parentId === query.parentId && (query.schoolIds === undefined || query.schoolIds.includes(c.schoolId)))
        .map(({ id, schoolId, fullName, joinDate }) => ({ id, schoolId, fullName, joinDate }))
        .sort((a, b) => a.fullName.localeCompare(b.fullName));
    },
  };
  const scopeSources: ReportScopeSources = {
    organizationIdsOfAdmin: async () => [ORG],
    schoolIdsOfManager: async () => [S1],
    schoolIdsOfCollector: async () => [S1],
    groupIdsOfTeacher: async () => ['group-1'],
    studentIdsOfParent: async (userId) => (userId === 'user-parent' ? (options.parentScope ?? [C1, C2, C3]) : []),
    geographicAreasOfManager: async () => undefined,
  };
  const studentReport = async (requester: { activeRole: string }, request: { period: unknown; studentId: string }): Promise<StudentReport> => {
    reads.studentReports.push({ role: requester.activeRole, studentId: request.studentId, period: request.period });
    const child = CHILDREN.find((c) => c.id === request.studentId)!;
    const manager = requester.activeRole === 'ORGANIZATION_MANAGER' || requester.activeRole === 'SCHOOL_MANAGER';
    return {
      type: 'STUDENT', period: { kind: 'ACROSS_TIME', startDate: null, endDate: null }, generatedAt: NOW.toISOString(),
      student: { id: child.id, name: child.fullName, schoolId: child.schoolId, schoolName: 'مدرسة', joinDate: child.joinDate }, effectiveStartDate: child.joinDate,
      sections: {
        attendance: { rows: [], totals: { present: 0, absent: 0, total: 0 } },
        memorization: { rows: [], totals: { records: 0, fulfilled: 0, notFulfilled: 0, unscheduled: 0 } },
        revision: { rows: [], totals: { records: 0, fulfilled: 0, notFulfilled: 0, unscheduled: 0 } },
        evaluations: { rows: [], totals: { evaluations: 0, scores: { MEMORIZATION: { count: 0, average: null }, REVISION: { count: 0, average: null }, PERFORMANCE: { count: 0, average: null }, TAJWEED: { count: 0, average: null } } } },
        examResults: { counts: { examined: 0, absent: 0, total: 0 }, rows: [] },
        ...(manager ? { subscriptions: { statusAsOf: NOW.toISOString(), rows: [], totals: { paid: 0, unpaid: 0, waived: 0, total: 0 } } } : {}),
        groupHistory: { rows: [] },
      },
    };
  };
  const deps = { scopes: new ReportScopeResolver(scopeSources), periods: new ReportPeriodService({ clock }), sources, clock, studentReport: studentReport as never };
  const run = (role: string, request: { period: { kind: string }; parentId?: string }, page?: { page: number; pageSize: number }, userId?: string) =>
    buildParentReport(deps, { userId: userId ?? (role === 'PARENT' ? 'user-parent' : 'user-1'), activeRole: role }, request, page);
  return { run, reads };
}

const ACROSS = { kind: 'ACROSS_TIME' };
const nothingRead = (reads: ReturnType<typeof fixture>['reads']) => {
  expect(reads.children).toEqual([]);
  expect(reads.studentReports).toEqual([]);
  expect(reads.names).toBe(0);
};

describe('PARENT report: who may run it', () => {
  it('only the Organization Manager, the School Manager and the Parent; everyone else is refused before anything is read', async () => {
    for (const role of ['TEACHER', 'SUBSCRIPTION_COLLECTOR', 'MAIN_ADMIN', 'GOVERNORATE_MANAGER', 'CENTER_MANAGER', 'VILLAGE_MANAGER', 'STUDENT']) {
      const { run, reads } = fixture();
      await expect(run(role, { period: ACROSS, parentId: P1 }), role).rejects.toMatchObject({ code: 'REPORT_NOT_ALLOWED' });
      nothingRead(reads);
    }
  });

  it('validates the period before reading', async () => {
    const { run, reads } = fixture();
    await expect(run('ORGANIZATION_MANAGER', { period: { kind: 'FOREVER' }, parentId: P1 })).rejects.toMatchObject({ code: 'INVALID_REPORT_PERIOD' });
    nothingRead(reads);
  });
});

describe('PARENT report: a manager', () => {
  it('must name the Parent: a missing parentId is a 400 REQUIRED_FIELD and nothing is read', async () => {
    for (const role of ['ORGANIZATION_MANAGER', 'SCHOOL_MANAGER']) {
      const { run, reads } = fixture();
      await expect(run(role, { period: ACROSS })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', fields: [{ field: 'parentId', code: 'REQUIRED_FIELD' }] });
      nothingRead(reads);
    }
  });

  it('Organization Manager: every child of the Parent in the schools of the organization (any status), ordered by name', async () => {
    const { run, reads } = fixture();
    const { report } = await run('ORGANIZATION_MANAGER', { period: ACROSS, parentId: P1 });
    expect(report.type).toBe('PARENT');
    expect(report.parent).toEqual({ id: P1, name: 'محمد علي حسن', children: [{ id: C1, name: 'أحمد محمد علي' }, { id: C2, name: 'بلال محمد علي' }, { id: C3, name: 'زياد محمد علي' }] });
    expect(report.childReports.map((r) => r.student.id)).toEqual([C1, C2, C3]);
    expect(reads.children).toEqual([{ parentId: P1, schoolIds: [S1, S2] }]);
    expect(reads.studentReports.map((r) => r.studentId)).toEqual([C1, C2, C3]);
    expect(reads.studentReports.every((r) => r.role === 'ORGANIZATION_MANAGER')).toBe(true);
  });

  it('School Manager: ONLY the children in the schools they manage, even though the Parent has a child elsewhere', async () => {
    const { run, reads } = fixture();
    const { report } = await run('SCHOOL_MANAGER', { period: ACROSS, parentId: P1 });
    expect(reads.children).toEqual([{ parentId: P1, schoolIds: [S1] }]);
    expect(report.parent.children.map((c) => c.id)).toEqual([C1, C3]);
    expect(report.childReports.map((r) => r.student.id)).toEqual([C1, C3]);
    expect(JSON.stringify(report)).not.toContain(C2);
    expect(JSON.stringify(report)).not.toContain('بلال');
  });

  it('each child gets the STUDENT report for the same period, with the managers\' subscription section', async () => {
    const { run, reads } = fixture();
    const { report } = await run('SCHOOL_MANAGER', { period: { kind: 'THIS_MONTH' }, parentId: P1 });
    expect(reads.studentReports.every((r) => JSON.stringify(r.period) === JSON.stringify({ kind: 'THIS_MONTH' }))).toBe(true);
    for (const child of report.childReports) expect(child.sections.subscriptions).toBeDefined();
  });

  it('a Parent outside the scope and a Parent that does not exist are the SAME 403, before any child is reported', async () => {
    for (const role of ['ORGANIZATION_MANAGER', 'SCHOOL_MANAGER']) {
      for (const parentId of [P_OTHER, 'no-such-parent']) {
        const { run, reads } = fixture();
        await expect(run(role, { period: ACROSS, parentId }), `${role} ${parentId}`).rejects.toMatchObject({ code: 'REPORT_SCOPE_FORBIDDEN' });
        expect(reads.studentReports).toEqual([]);
        expect(reads.names).toBe(0);
      }
    }
  });

  it('a Parent linked only to a school the School Manager does not manage is unreachable', async () => {
    const { run, reads } = fixture();
    await expect(run('SCHOOL_MANAGER', { period: ACROSS, parentId: P_OTHER })).rejects.toMatchObject({ code: 'REPORT_SCOPE_FORBIDDEN' });
    expect(reads.studentReports).toEqual([]);
  });

  it('a Parent with no child yet but linked to a school of the scope gives an empty report', async () => {
    const { run } = fixture();
    const { report, meta } = await run('SCHOOL_MANAGER', { period: ACROSS, parentId: P_EMPTY });
    expect(report.parent).toEqual({ id: P_EMPTY, name: 'فاطمة أحمد حسن', children: [] });
    expect(report.childReports).toEqual([]);
    expect(meta).toEqual({ page: 1, pageSize: 1, total: 0, totalPages: 0 });
  });
});

describe('PARENT report: the Parent', () => {
  it('may omit parentId (their own account) or name their own; all their children, whatever the status', async () => {
    for (const request of [{ period: ACROSS }, { period: ACROSS, parentId: P1 }]) {
      const { run, reads } = fixture();
      const { report } = await run('PARENT', request);
      expect(report.parent.id).toBe(P1);
      expect(report.childReports.map((r) => r.student.id)).toEqual([C1, C2, C3]);
      expect(reads.children).toEqual([{ parentId: P1 }]);
      for (const child of report.childReports) expect('subscriptions' in child.sections).toBe(false); // the fake STUDENT report mirrors the real rule
    }
  });

  it('can NEVER get another Parent\'s report', async () => {
    for (const parentId of [P_OTHER, P_EMPTY, 'no-such-parent']) {
      const { run, reads } = fixture();
      await expect(run('PARENT', { period: ACROSS, parentId }), parentId).rejects.toMatchObject({ code: 'REPORT_SCOPE_FORBIDDEN' });
      expect(reads.studentReports).toEqual([]);
    }
  });

  it('only children inside the verified reporting scope are reported (a child missing from the scope is dropped)', async () => {
    const { run } = fixture({ parentScope: [C1, C3] });
    const { report } = await run('PARENT', { period: ACROSS });
    expect(report.childReports.map((r) => r.student.id)).toEqual([C1, C3]);
    expect(report.parent.children.map((c) => c.id)).toEqual([C1, C3]);
  });

  it('a Parent account without any child has no reporting scope (Module 37): REPORT_NOT_ALLOWED, nothing read', async () => {
    const { run, reads } = fixture();
    await expect(run('PARENT', { period: ACROSS }, undefined, 'user-empty')).rejects.toMatchObject({ code: 'REPORT_NOT_ALLOWED' });
    nothingRead(reads);
  });
});

describe('PARENT report: pagination of the children and the header', () => {
  it('pages the CHILDREN; the header always lists every authorized child; each returned child has its full report', async () => {
    const { run } = fixture();
    const first = await run('ORGANIZATION_MANAGER', { period: ACROSS, parentId: P1 }, { page: 1, pageSize: 2 });
    expect(first.report.childReports.map((r) => r.student.id)).toEqual([C1, C2]);
    expect(first.report.parent.children).toHaveLength(3);
    expect(first.meta).toEqual({ page: 1, pageSize: 2, total: 3, totalPages: 2 });
    const second = await run('ORGANIZATION_MANAGER', { period: ACROSS, parentId: P1 }, { page: 2, pageSize: 2 });
    expect(second.report.childReports.map((r) => r.student.id)).toEqual([C3]);
    const beyond = await run('ORGANIZATION_MANAGER', { period: ACROSS, parentId: P1 }, { page: 9, pageSize: 2 });
    expect(beyond.report.childReports).toEqual([]);
    expect(beyond.report.parent.children).toHaveLength(3);
  });

  it('without a page (the files) every authorized child is reported', async () => {
    const { run } = fixture();
    expect((await run('ORGANIZATION_MANAGER', { period: ACROSS, parentId: P1 })).report.childReports).toHaveLength(3);
  });

  it('the Parent header holds the name and the children only: no phone, address, lifecycle status or school link', async () => {
    const { run } = fixture();
    const { report } = await run('PARENT', { period: ACROSS });
    expect(Object.keys(report.parent).sort()).toEqual(['children', 'id', 'name']);
    for (const child of report.parent.children) expect(Object.keys(child).sort()).toEqual(['id', 'name']);
    expect(/phone|address|status|archiv|inactive/i.test(JSON.stringify(report.parent))).toBe(false);
  });
});

describe('PARENT report through ReportService and the public sources', () => {
  it('asking for it without the sources is a configuration error, never an empty report', async () => {
    const service = new ReportService({ scopes: {} as never, periods: {} as never, payments: {} as never, attendance: {} as never, memorization: {} as never, revision: {} as never, evaluation: {} as never, clock });
    await expect(service.parentReport({ userId: 'u', activeRole: 'PARENT' }, { period: ACROSS })).rejects.toThrow('PARENT_REPORT_SOURCES_NOT_CONFIGURED');
    const withoutStudent = new ReportService({ scopes: {} as never, periods: {} as never, payments: {} as never, attendance: {} as never, memorization: {} as never, revision: {} as never, evaluation: {} as never, parent: {} as never, clock });
    await expect(withoutStudent.parentReport({ userId: 'u', activeRole: 'PARENT' }, { period: ACROSS })).rejects.toThrow('PARENT_REPORT_SOURCES_NOT_CONFIGURED');
  });

  it('reads only through the Parent, School and Student public lookups and copies no phone or address', async () => {
    const calls: string[] = [];
    const sources = new PublicParentReportSources({
      schools: { listSchoolIdsOfOrganizations: async (ids: readonly string[]) => (calls.push('schools'), [...ids]) } as never,
      parents: {
        findByUserId: async () => (calls.push('findByUserId'), { id: P1, name: 'محمد علي حسن', phone: '01010001', address: { text: 'x' }, schoolIds: [S1] }),
        findById: async () => (calls.push('findById'), { id: P1, name: 'محمد علي حسن', phone: '01010001', address: { text: 'x' } }),
        listActiveSchoolIds: async () => (calls.push('links'), [S1]),
      } as never,
      students: { listChildrenOfParentForReport: async (q: unknown) => (calls.push('children'), [{ id: C1, schoolId: S1, fullName: 'أحمد', joinDate: '2026-09-01' }, q].slice(0, 1)) } as never,
    });
    expect(await sources.parentOfUser('u')).toEqual({ id: P1 });
    expect(await sources.parentName(P1)).toBe('محمد علي حسن');
    expect(await sources.activeSchoolIdsOfParent(P1)).toEqual([S1]);
    expect(await sources.childrenOfParent({ parentId: P1 })).toHaveLength(1);
    expect(calls).toEqual(['findByUserId', 'findById', 'links', 'children']);
  });
});
