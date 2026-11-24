import { describe, expect, it } from 'vitest';
import { clipStint } from '../../../src/modules/20-groups/public';
import { ReportPeriodService, ReportScopeResolver, type ReportScopeSources } from '../../../src/modules/37-reports-core/public';
import { PublicTeacherReportSources, ReportService, type TeacherReportSources } from '../../../src/modules/38-report-modules/public';
import { buildTeacherReport, type TeacherReportDelegates } from '../../../src/modules/38-report-modules/application/services/teacher-report-builder';

const ORG1 = 'org-1';
const ORG2 = 'org-2';
const SA = 'school-a';
const SB = 'school-b';
const SC = 'school-c';
const SX = 'school-x'; // another organization
const SD = 'school-d'; // a school the Teacher never worked in
const T = 'teacher-1'; // works in A and B; taught in C until 20 October; (artificially) has a stint in the other organization's school X
const NOW = new Date('2026-11-18T10:00:00Z');
const clock = { now: () => NOW };
const at = (iso: string) => new Date(iso);

const SCHOOL_NAMES: Record<string, string> = { [SA]: 'مدرسة النور', [SB]: 'مدرسة الهدى', [SC]: 'مدرسة الأمل', [SX]: 'مدرسة أخرى', [SD]: 'مدرسة د' };
const GROUPS: Record<string, { schoolId: string; name: string }> = {
  ga: { schoolId: SA, name: 'حلقة أ' }, ga2: { schoolId: SA, name: 'حلقة أ2' }, gb: { schoolId: SB, name: 'حلقة ب' }, gc: { schoolId: SC, name: 'حلقة ج' }, gx: { schoolId: SX, name: 'حلقة س' },
};
/** The Teacher's stints, as the groups' history gives them. */
const STINTS: Array<{ groupId: string; from: string; to: string | null }> = [
  { groupId: 'ga', from: '2026-09-10T08:00:00Z', to: null },
  { groupId: 'ga2', from: '2026-09-10T08:00:00Z', to: '2026-10-01T08:00:00Z' },
  { groupId: 'ga2', from: '2026-11-01T08:00:00Z', to: null },
  { groupId: 'gb', from: '2026-10-01T08:00:00Z', to: null },
  { groupId: 'gc', from: '2026-09-10T08:00:00Z', to: '2026-10-20T08:00:00Z' },
  { groupId: 'gx', from: '2026-09-10T08:00:00Z', to: null },
];

function fixture() {
  const reads = { taught: [] as Array<{ schoolIds: readonly string[]; from?: Date; toExclusive?: Date }>, links: 0, name: 0, schoolNames: 0, groupReports: [] as Array<{ groupId: string; period: { startDate: string; endDate: string } }>, attendance: [] as string[], orgSchools: 0 };
  const sources: TeacherReportSources = {
    schoolIdsOfOrganizations: async (ids) => {
      reads.orgSchools += 1;
      return ids.flatMap((id) => (id === ORG1 ? [SA, SB, SC] : id === ORG2 ? [SX] : []));
    },
    teacherName: async (id) => {
      reads.name += 1;
      return id === T ? 'محمود حسن علي' : undefined;
    },
    activeSchoolIdsOfTeacher: async (id) => {
      reads.links += 1;
      return id === T ? [SA, SB] : [];
    },
    taughtGroups: async (query) => {
      reads.taught.push({ schoolIds: query.schoolIds, ...(query.from ? { from: query.from } : {}), ...(query.toExclusive ? { toExclusive: query.toExclusive } : {}) });
      if (query.teacherId !== T) return [];
      const rows = [];
      for (const s of STINTS) {
        const g = GROUPS[s.groupId]!;
        if (!query.schoolIds.includes(g.schoolId)) continue; // ONLY the given schools are ever read
        const clipped = clipStint({ from: at(s.from), to: s.to ? at(s.to) : null }, { ...(query.from ? { from: query.from } : {}), ...(query.toExclusive ? { toExclusive: query.toExclusive } : {}) });
        if (clipped) rows.push({ groupId: s.groupId, schoolId: g.schoolId, groupName: g.name, learningMode: 'GROUP', from: clipped.from, to: clipped.to, stillTeaching: s.to === null });
      }
      return rows;
    },
    schoolNames: async (ids) => {
      reads.schoolNames += 1;
      return new Map(ids.filter((id) => SCHOOL_NAMES[id] !== undefined).map((id) => [id, SCHOOL_NAMES[id]!] as const));
    },
  };
  const none = { count: 0, average: null };
  const delegates: TeacherReportDelegates = {
    groupReport: async (_r, request) => {
      reads.groupReports.push({ groupId: request.groupId, period: { startDate: request.period.startDate, endDate: request.period.endDate } });
      return {
        type: 'GROUP', totals: {
          students: 3, attendance: { present: 20, absent: 4, total: 24 }, memorization: { records: 10, fulfilled: 6, notFulfilled: 3, unscheduled: 1 }, revision: { records: 2, fulfilled: 2, notFulfilled: 0, unscheduled: 0 },
          evaluations: { evaluations: 2, scores: { MEMORIZATION: { count: 2, average: 8.5 }, REVISION: none, PERFORMANCE: none, TAJWEED: none } }, exams: { examined: 3, absent: 1, total: 4 },
        },
      } as never;
    },
    attendanceReport: async (_r, request) => {
      reads.attendance.push(request.groupId);
      return {
        type: 'ATTENDANCE', rows: [
          { subjectType: 'TEACHER', subjectId: T, groupId: request.groupId, present: 2, absent: 1, total: 3 },
          { subjectType: 'TEACHER', subjectId: 'other-teacher', groupId: request.groupId, present: 9, absent: 9, total: 18 },
          { subjectType: 'STUDENT', subjectId: 'student-1', groupId: request.groupId, present: 5, absent: 5, total: 10 },
        ],
      } as never;
    },
  };
  const scopeSources: ReportScopeSources = {
    organizationIdsOfAdmin: async (userId) => (userId === 'org1-admin' ? [ORG1] : userId === 'org2-admin' ? [ORG2] : []),
    schoolIdsOfManager: async (userId) => ({ 'mgr-a': [SA], 'mgr-ab': [SA, SB], 'mgr-b': [SB], 'mgr-c': [SC], 'mgr-d': [SD] } as Record<string, string[]>)[userId] ?? [],
    schoolIdsOfCollector: async () => [SA],
    groupIdsOfTeacher: async () => ['ga'],
    studentIdsOfParent: async () => ['student-1'],
    geographicAreasOfManager: async () => undefined,
  };
  const deps = { scopes: new ReportScopeResolver(scopeSources), periods: new ReportPeriodService({ clock }), sources, clock };
  const run = (userId: string, role: string, request: { period: { kind: string; startDate?: string; endDate?: string }; teacherId: string }, page?: { page: number; pageSize: number }) =>
    buildTeacherReport(deps, delegates, { userId, activeRole: role }, request, page);
  return { run, reads };
}

const ACROSS = { kind: 'ACROSS_TIME' };
const asSchoolManager = (f: ReturnType<typeof fixture>, user: string, request = { period: ACROSS, teacherId: T }, page?: { page: number; pageSize: number }) => f.run(user, 'SCHOOL_MANAGER', request, page);
const asOrgAdmin = (f: ReturnType<typeof fixture>, user: string, request = { period: ACROSS, teacherId: T }, page?: { page: number; pageSize: number }) => f.run(user, 'ORGANIZATION_MANAGER', request, page);
const nothingRead = (reads: ReturnType<typeof fixture>['reads']) => {
  expect(reads.taught).toEqual([]);
  expect(reads.links).toBe(0);
  expect(reads.name).toBe(0);
  expect(reads.groupReports).toEqual([]);
  expect(reads.attendance).toEqual([]);
  expect(reads.schoolNames).toBe(0);
};
const leaks = (report: unknown, ...needles: string[]) => needles.filter((n) => JSON.stringify(report).includes(n));

describe('TEACHER report: who may run it', () => {
  it('only the Organization Manager and the School Manager; a Teacher (even for themselves), the Parent and everyone else are refused before anything is read', async () => {
    for (const role of ['TEACHER', 'PARENT', 'SUBSCRIPTION_COLLECTOR', 'MAIN_ADMIN', 'GOVERNORATE_MANAGER', 'CENTER_MANAGER', 'VILLAGE_MANAGER', 'STUDENT']) {
      const f = fixture();
      await expect(f.run('mgr-a', role, { period: ACROSS, teacherId: T }), role).rejects.toMatchObject({ code: 'REPORT_NOT_ALLOWED' });
      nothingRead(f.reads);
      expect(f.reads.orgSchools).toBe(0);
    }
  });

  it('validates the period before reading', async () => {
    const f = fixture();
    await expect(f.run('mgr-a', 'SCHOOL_MANAGER', { period: { kind: 'FOREVER' }, teacherId: T })).rejects.toMatchObject({ code: 'INVALID_REPORT_PERIOD' });
    nothingRead(f.reads);
  });

  it('a teacher outside the authorized schools and one that does not exist get the SAME 403, and no report data is read', async () => {
    for (const [user, role, teacherId] of [['mgr-d', 'SCHOOL_MANAGER', T], ['mgr-a', 'SCHOOL_MANAGER', 'no-such-teacher'], ['org1-admin', 'ORGANIZATION_MANAGER', 'no-such-teacher']] as const) {
      const f = fixture();
      await expect(f.run(user, role, { period: ACROSS, teacherId }), `${user} ${teacherId}`).rejects.toMatchObject({ code: 'REPORT_SCOPE_FORBIDDEN' });
      expect(f.reads.name).toBe(0);
      expect(f.reads.groupReports).toEqual([]);
      expect(f.reads.attendance).toEqual([]);
      expect(f.reads.schoolNames).toBe(0);
    }
  });
});

describe('TEACHER report: a teacher working in several schools (multi-school isolation)', () => {
  it('a School Manager sees ONLY their school: schools B, C and the other organization appear nowhere', async () => {
    const f = fixture();
    const { report, meta } = await asSchoolManager(f, 'mgr-a');
    expect(report.teacher).toEqual({ id: T, name: 'محمود حسن علي', schools: [{ id: SA, name: 'مدرسة النور' }] });
    expect(report.groups.map((g) => [g.groupId, g.schoolId])).toEqual([['ga', SA], ['ga2', SA], ['ga2', SA]]);
    expect(leaks(report, SB, SC, SX, 'مدرسة الهدى', 'مدرسة الأمل', 'مدرسة أخرى', 'حلقة ب', 'حلقة ج', 'حلقة س', '"gb"', '"gc"', '"gx"')).toEqual([]);
    expect(meta).toEqual({ page: 1, pageSize: 3, total: 3, totalPages: 1 }); // the totals count only the authorized school
    // every read was given ONLY the authorized school, and no other school's group was ever reported
    expect(f.reads.taught.every((q) => q.schoolIds.length === 1 && q.schoolIds[0] === SA)).toBe(true);
    expect([...new Set(f.reads.groupReports.map((r) => r.groupId))].sort()).toEqual(['ga', 'ga2']);
    expect([...new Set(f.reads.attendance)].sort()).toEqual(['ga', 'ga2']);
  });

  it('the same rule applies independently to the managers of the other schools', async () => {
    const b = await asSchoolManager(fixture(), 'mgr-b');
    expect(b.report.groups.map((g) => g.groupId)).toEqual(['gb']);
    expect(leaks(b.report, SA, SC, SX, 'مدرسة النور', 'حلقة أ', 'حلقة ج')).toEqual([]);
    expect(b.report.teacher.schools).toEqual([{ id: SB, name: 'مدرسة الهدى' }]);
  });

  it('a manager of several schools gets every school in their scope (never an arbitrary one)', async () => {
    const f = fixture();
    const { report } = await asSchoolManager(f, 'mgr-ab');
    expect(report.teacher.schools.map((s) => s.id)).toEqual([SB, SA].sort((a, b) => SCHOOL_NAMES[a]!.localeCompare(SCHOOL_NAMES[b]!)));
    expect([...new Set(report.groups.map((g) => g.schoolId))].sort()).toEqual([SA, SB]);
    expect(leaks(report, SC, SX, 'مدرسة الأمل')).toEqual([]);
  });

  it('an Organization Manager sees every school of their organization the Teacher worked in, each entry carrying its own school; another organization stays out', async () => {
    const f = fixture();
    const { report, meta } = await asOrgAdmin(f, 'org1-admin');
    expect(report.groups.map((g) => [g.schoolName, g.groupId])).toEqual([['مدرسة الأمل', 'gc'], ['مدرسة النور', 'ga'], ['مدرسة النور', 'ga2'], ['مدرسة النور', 'ga2'], ['مدرسة الهدى', 'gb']]); // ordered by school name, then group
    expect(report.teacher.schools.map((s) => s.id).sort()).toEqual([SA, SB]); // C is history only
    expect(leaks(report, SX, 'مدرسة أخرى', 'حلقة س', '"gx"')).toEqual([]);
    expect(meta.total).toBe(5);
    expect(f.reads.taught.every((q) => !q.schoolIds.includes(SX))).toBe(true);
  });

  it('the other organization\'s manager sees only their own school\'s data', async () => {
    const { report } = await asOrgAdmin(fixture(), 'org2-admin');
    expect(report.groups.map((g) => g.groupId)).toEqual(['gx']);
    expect(report.teacher.schools).toEqual([]);
    expect(leaks(report, SA, SB, SC, 'مدرسة النور', 'مدرسة الهدى', 'مدرسة الأمل')).toEqual([]);
  });

  it('a Teacher who is no longer (or never was) linked to a school keeps their history there', async () => {
    const { report } = await asSchoolManager(fixture(), 'mgr-c');
    expect(report.teacher.schools).toEqual([]);
    expect(report.groups).toHaveLength(1);
    expect(report.groups[0]).toMatchObject({ groupId: 'gc', schoolId: SC, taughtFrom: '2026-09-10', taughtTo: '2026-10-20', stillTeaching: false });
  });
});

describe('TEACHER report: stints and their dates', () => {
  it('an open stint runs to today; a closed one to the day the history ended it; each entry reports exactly those dates', async () => {
    const f = fixture();
    const { report } = await asOrgAdmin(f, 'org1-admin');
    const entry = (id: string, from: string) => report.groups.find((g) => g.groupId === id && g.taughtFrom === from)!;
    expect(entry('ga', '2026-09-10')).toMatchObject({ taughtTo: '2026-11-18', stillTeaching: true });
    expect(entry('gc', '2026-09-10')).toMatchObject({ taughtTo: '2026-10-20', stillTeaching: false });
    expect(entry('gb', '2026-10-01')).toMatchObject({ taughtTo: '2026-11-18', stillTeaching: true });
    const periods = new Map(f.reads.groupReports.map((r) => [`${r.groupId}:${r.period.startDate}`, r.period.endDate] as const));
    expect(periods.get('gc:2026-09-10')).toBe('2026-10-20'); // the GROUP report is asked for exactly the stint's dates
    expect(periods.get('ga:2026-09-10')).toBe('2026-11-18');
  });

  it('a teacher who left a group and came back has TWO entries for it, each with its own dates', async () => {
    const { report } = await asSchoolManager(fixture(), 'mgr-a');
    expect(report.groups.filter((g) => g.groupId === 'ga2').map((g) => [g.taughtFrom, g.taughtTo, g.stillTeaching])).toEqual([['2026-09-10', '2026-10-01', false], ['2026-11-01', '2026-11-18', true]]); // the first stint was ended by the history, the second is open
  });

  it('the period clips the stints; a stint outside it disappears', async () => {
    const f = fixture();
    const october = (await asOrgAdmin(f, 'org1-admin', { period: { kind: 'LAST_MONTH' }, teacherId: T })).report;
    expect(october.groups.map((g) => [g.groupId, g.taughtFrom, g.taughtTo])).toEqual([['gc', '2026-10-01', '2026-10-20'], ['ga', '2026-10-01', '2026-10-31'], ['ga2', '2026-10-01', '2026-10-01'], ['gb', '2026-10-01', '2026-10-31']]);
    const none = (await asSchoolManager(fixture(), 'mgr-c', { period: { kind: 'THIS_MONTH' }, teacherId: T })).report; // C ended in October, but the teacher is in scope (history)
    expect(none.groups).toEqual([]);
  });
});

describe('TEACHER report: figures', () => {
  it('the Teacher\'s own attendance counts only their own records; the group figures are the GROUP report\'s', async () => {
    const { report } = await asSchoolManager(fixture(), 'mgr-b');
    expect(report.groups[0]).toMatchObject({
      teacherAttendance: { present: 2, absent: 1, total: 3 }, students: 3, attendance: { present: 20, absent: 4, total: 24 }, memorization: { records: 10, fulfilled: 6, notFulfilled: 3, unscheduled: 1 },
      revision: { records: 2, fulfilled: 2, notFulfilled: 0, unscheduled: 0 }, exams: { examined: 3, absent: 1, total: 4 },
    });
    expect(report.groups[0]!.evaluations.scores.MEMORIZATION).toEqual({ count: 2, average: 8.5 });
  });

  it('creates no score, ranking or comparison, nothing is combined across groups or schools, and no financial data', async () => {
    const { report } = await asOrgAdmin(fixture(), 'org1-admin');
    expect(Object.keys(report).sort()).toEqual(['generatedAt', 'groups', 'period', 'teacher', 'type']);
    expect(/percent|rank|grade|weight|overall|composite|best|worst|subscription|payment|paid|phone/i.test(JSON.stringify(report))).toBe(false);
  });
});

describe('TEACHER report: pagination and exports respect the same scope', () => {
  it('pages the entries of the authorized schools only; the files (no page) hold every one of them and nothing else', async () => {
    const f = fixture();
    const first = await asOrgAdmin(f, 'org1-admin', { period: ACROSS, teacherId: T }, { page: 1, pageSize: 2 });
    expect(first.report.groups).toHaveLength(2);
    expect(first.meta).toEqual({ page: 1, pageSize: 2, total: 5, totalPages: 3 });
    const pages = [first, await asOrgAdmin(fixture(), 'org1-admin', { period: ACROSS, teacherId: T }, { page: 2, pageSize: 2 }), await asOrgAdmin(fixture(), 'org1-admin', { period: ACROSS, teacherId: T }, { page: 3, pageSize: 2 })];
    const file = (await asOrgAdmin(fixture(), 'org1-admin')).report.groups;
    expect(pages.flatMap((p) => p.report.groups)).toEqual(file);
    expect(file).toHaveLength(5);
    const beyond = await asOrgAdmin(fixture(), 'org1-admin', { period: ACROSS, teacherId: T }, { page: 9, pageSize: 2 });
    expect(beyond.report.groups).toEqual([]);
    expect(beyond.meta.total).toBe(5);
    // the School Manager's pagination metadata never counts the other schools' entries
    expect((await asSchoolManager(fixture(), 'mgr-a', { period: ACROSS, teacherId: T }, { page: 1, pageSize: 1 })).meta).toEqual({ page: 1, pageSize: 1, total: 3, totalPages: 3 });
    expect(JSON.stringify(first.meta)).not.toMatch(/school-/);
  });

  it('computes the figures of the requested page only (a page of one entry reads one group)', async () => {
    const f = fixture();
    await asOrgAdmin(f, 'org1-admin', { period: ACROSS, teacherId: T }, { page: 1, pageSize: 1 });
    expect(f.reads.groupReports).toHaveLength(1);
  });
});

describe('TEACHER report through ReportService and the public sources', () => {
  it('asking for it without the sources is a configuration error, never an empty report', async () => {
    const service = new ReportService({ scopes: {} as never, periods: {} as never, payments: {} as never, attendance: {} as never, memorization: {} as never, revision: {} as never, evaluation: {} as never, clock });
    await expect(service.teacherReport({ userId: 'u', activeRole: 'SCHOOL_MANAGER' }, { period: ACROSS, teacherId: T })).rejects.toThrow('TEACHER_REPORT_SOURCES_NOT_CONFIGURED');
    const withoutGroup = new ReportService({ scopes: {} as never, periods: {} as never, payments: {} as never, attendance: {} as never, memorization: {} as never, revision: {} as never, evaluation: {} as never, teacher: {} as never, clock });
    await expect(withoutGroup.teacherReport({ userId: 'u', activeRole: 'SCHOOL_MANAGER' }, { period: ACROSS, teacherId: T })).rejects.toThrow('TEACHER_REPORT_SOURCES_NOT_CONFIGURED');
  });

  it('reads only through the School, Teacher and Group public lookups and copies no phone or address', async () => {
    const calls: string[] = [];
    const sources = new PublicTeacherReportSources({
      schools: { listSchoolIdsOfOrganizations: async (ids: readonly string[]) => (calls.push('schools'), [...ids]), findById: async () => ({ id: SA, name: 'مدرسة النور' }) } as never,
      teachers: {
        findById: async () => (calls.push('findById'), { id: T, name: 'محمود حسن علي', phone: '01010001', address: { text: 'x' } }),
        listActiveSchoolIds: async () => (calls.push('links'), [SA]),
      } as never,
      groups: { listGroupsTaughtByTeacherForReport: async () => (calls.push('taught'), []) } as never,
    });
    expect(await sources.teacherName(T)).toBe('محمود حسن علي');
    expect(await sources.activeSchoolIdsOfTeacher(T)).toEqual([SA]);
    await sources.taughtGroups({ teacherId: T, schoolIds: [SA] });
    expect((await sources.schoolNames([SA, SA])).get(SA)).toBe('مدرسة النور');
    expect(calls).toEqual(['findById', 'links', 'taught']);
  });
});
