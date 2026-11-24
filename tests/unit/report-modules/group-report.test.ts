import { describe, expect, it } from 'vitest';
import { ReportPeriodService, ReportScopeResolver, type ReportScopeSources } from '../../../src/modules/37-reports-core/public';
import { PublicGroupReportSources, ReportService, type GroupReportSources } from '../../../src/modules/38-report-modules/public';
import { buildGroupReport, type GroupReportDelegates } from '../../../src/modules/38-report-modules/application/services/group-report-builder';

const ORG = 'org-1';
const S1 = 'school-1'; // managed by the School Manager
const S2 = 'school-2'; // same organization, NOT managed by the School Manager
const S_OTHER = 'school-other-org';
const G1 = 'group-1'; // taught by the Teacher
const G2 = 'group-2'; // school 2
const G_OTHER = 'group-other-org';
const A = 'student-a'; // joined 2026-09-01, in the group since 2026-09-05
const B = 'student-b'; // moved out of the group on 2026-10-10
const C = 'student-c'; // joined 2026-11-10
const D = 'student-d'; // archived: left the group on 2026-10-20
const E = 'student-e'; // joined 2026-09-01 but assigned to the group only on 2026-11-12, no activity at all

const NOW = new Date('2026-11-18T10:00:00Z');
const clock = { now: () => NOW };
const FACTS = [
  { id: A, fullName: 'أحمد محمد علي', joinDate: '2026-09-01' },
  { id: B, fullName: 'بلال محمد علي', joinDate: '2026-09-01' },
  { id: C, fullName: 'جابر محمد علي', joinDate: '2026-11-10' },
  { id: D, fullName: 'زياد محمد علي', joinDate: '2026-09-01' },
  { id: E, fullName: 'سعيد محمد علي', joinDate: '2026-09-01' },
];
const ASSIGNMENTS = [
  { studentId: A, assignedAt: new Date('2026-09-05T08:00:00Z'), unassignedAt: null },
  { studentId: B, assignedAt: new Date('2026-09-05T08:00:00Z'), unassignedAt: new Date('2026-10-10T08:00:00Z') },
  { studentId: C, assignedAt: new Date('2026-11-10T08:00:00Z'), unassignedAt: null },
  { studentId: D, assignedAt: new Date('2026-09-05T08:00:00Z'), unassignedAt: new Date('2026-10-20T08:00:00Z') },
  { studentId: E, assignedAt: new Date('2026-11-12T08:00:00Z'), unassignedAt: null },
];
const GROUPS: Record<string, { schoolId: string; name: string; teacherName: string | null }> = {
  [G1]: { schoolId: S1, name: 'حلقة الفجر', teacherName: 'محمود حسن علي' },
  [G2]: { schoolId: S2, name: 'حلقة العصر', teacherName: null },
  [G_OTHER]: { schoolId: S_OTHER, name: 'حلقة أخرى', teacherName: 'خالد' },
};

function fixture() {
  const reads = { roster: [] as unknown[], facts: 0, exams: [] as Array<{ studentId: string; from?: Date; toExclusive?: Date; groupIds?: readonly string[] }>, delegates: [] as unknown[], header: 0, school: 0 };
  const sources: GroupReportSources = {
    schoolIdsOfOrganizations: async (ids) => (ids.includes(ORG) ? [S1, S2] : []),
    schoolIdOfGroup: async (id) => {
      reads.school += 1;
      return GROUPS[id]?.schoolId;
    },
    groupHeader: async (id) => {
      reads.header += 1;
      const g = GROUPS[id];
      return g ? { id, name: g.name, schoolId: g.schoolId, learningMode: 'GROUP', status: 'ACTIVE', teacherName: g.teacherName } : undefined;
    },
    roster: async (query) => {
      reads.roster.push(query);
      return ASSIGNMENTS.filter(
        (a) => (query.toExclusive === undefined || a.assignedAt.getTime() < query.toExclusive.getTime()) && (query.from === undefined || a.unassignedAt === null || a.unassignedAt.getTime() > query.from.getTime()),
      );
    },
    studentFacts: async (ids) => {
      reads.facts += 1;
      return FACTS.filter((f) => ids.includes(f.id));
    },
    examOutcomes: async (query) => {
      reads.exams.push(query);
      const outcome = (examId: string, kind: 'EXAMINED' | 'ABSENT') => ({ examId, schoolId: S1, groupId: G1, startAt: new Date('2026-11-05T07:00:00Z'), outcome: kind, questionCount: 2, maxScorePerQuestion: 10, scores: kind === 'ABSENT' ? [] : [9, 8], total: kind === 'ABSENT' ? null : 17, maxTotal: 20 });
      if (query.studentId === A) return [outcome('e1', 'EXAMINED'), outcome('e2', 'ABSENT')];
      if (query.studentId === B) return [outcome('e3', 'EXAMINED')];
      return [];
    },
    schoolNames: async (ids) => new Map(ids.filter((id) => id === S1).map((id) => [id, 'مدرسة النور'] as const)),
  };
  const none = { count: 0, average: null };
  const delegates: GroupReportDelegates = {
    attendanceReport: async (_r, request) => {
      reads.delegates.push(['attendance', request]);
      return {
        type: 'ATTENDANCE', period: { kind: 'ACROSS_TIME', startDate: null, endDate: null }, generatedAt: '',
        rows: [
          { subjectType: 'STUDENT', subjectId: A, subjectName: 'x', schoolId: S1, schoolName: 'm', groupId: G1, groupName: 'g', present: 8, absent: 2, total: 10 },
          { subjectType: 'STUDENT', subjectId: B, subjectName: 'x', schoolId: S1, schoolName: 'm', groupId: G1, groupName: 'g', present: 4, absent: 1, total: 5 },
          { subjectType: 'TEACHER', subjectId: 't1', subjectName: 'x', schoolId: S1, schoolName: 'm', groupId: G1, groupName: 'g', present: 9, absent: 1, total: 10 },
        ],
        totals: { students: { present: 12, absent: 3, total: 15 }, teachers: { present: 9, absent: 1, total: 10 } },
      };
    },
    memorizationReport: async (_r, request) => {
      reads.delegates.push(['memorization', request]);
      return { type: 'MEMORIZATION', period: { kind: 'ACROSS_TIME', startDate: null, endDate: null }, generatedAt: '', rows: [{ studentId: A, studentName: 'x', schoolId: S1, schoolName: 'm', groupId: G1, groupName: 'g', records: 5, fulfilled: 3, notFulfilled: 1, unscheduled: 1 }], totals: { records: 5, fulfilled: 3, notFulfilled: 1, unscheduled: 1 } };
    },
    revisionReport: async (_r, request) => {
      reads.delegates.push(['revision', request]);
      return { type: 'REVISION', period: { kind: 'ACROSS_TIME', startDate: null, endDate: null }, generatedAt: '', rows: [], totals: { records: 0, fulfilled: 0, notFulfilled: 0, unscheduled: 0 } };
    },
    evaluationReport: async (_r, request) => {
      reads.delegates.push(['evaluation', request]);
      const scores = { MEMORIZATION: { count: 2, average: 7.5 }, REVISION: none, PERFORMANCE: { count: 1, average: 9 }, TAJWEED: none };
      return { type: 'EVALUATION', period: { kind: 'ACROSS_TIME', startDate: null, endDate: null }, generatedAt: '', rows: [{ studentId: A, studentName: 'x', schoolId: S1, schoolName: 'm', groupId: G1, groupName: 'g', evaluations: 2, scores }], totals: { evaluations: 2, scores } };
    },
  };
  const scopeSources: ReportScopeSources = {
    organizationIdsOfAdmin: async () => [ORG],
    schoolIdsOfManager: async () => [S1],
    schoolIdsOfCollector: async () => [S1],
    groupIdsOfTeacher: async () => [G1],
    studentIdsOfParent: async () => [A],
    geographicAreasOfManager: async () => undefined,
  };
  const deps = { scopes: new ReportScopeResolver(scopeSources), periods: new ReportPeriodService({ clock }), sources, clock };
  const run = (role: string, request: { period: { kind: string; startDate?: string; endDate?: string }; groupId: string }, page?: { page: number; pageSize: number }) =>
    buildGroupReport(deps, delegates, { userId: 'user-1', activeRole: role }, request, page);
  return { run, reads };
}

const ACROSS = { kind: 'ACROSS_TIME' };
const THIS_MONTH = { kind: 'THIS_MONTH' };
const nothingRead = (reads: ReturnType<typeof fixture>['reads']) => {
  expect(reads.roster).toEqual([]);
  expect(reads.facts).toBe(0);
  expect(reads.exams).toEqual([]);
  expect(reads.delegates).toEqual([]);
  expect(reads.header).toBe(0);
};

describe('GROUP report: who may run it, and for which group', () => {
  it('Organization Manager (any school of the organization), School Manager (a managed school) and Teacher (a group they teach)', async () => {
    const org = fixture();
    expect((await org.run('ORGANIZATION_MANAGER', { period: ACROSS, groupId: G2 })).report.group.id).toBe(G2);
    expect((await org.run('ORGANIZATION_MANAGER', { period: ACROSS, groupId: G1 })).report.group.id).toBe(G1);
    expect((await fixture().run('SCHOOL_MANAGER', { period: ACROSS, groupId: G1 })).report.group.id).toBe(G1);
    expect((await fixture().run('TEACHER', { period: ACROSS, groupId: G1 })).report.group.id).toBe(G1);
  });

  it('refuses a group outside the scope and one that does not exist with the SAME answer, and reads nothing', async () => {
    const cases: Array<[string, string]> = [['ORGANIZATION_MANAGER', G_OTHER], ['ORGANIZATION_MANAGER', 'no-such-group'], ['SCHOOL_MANAGER', G2], ['SCHOOL_MANAGER', G_OTHER], ['SCHOOL_MANAGER', 'no-such-group'], ['TEACHER', G2], ['TEACHER', G_OTHER], ['TEACHER', 'no-such-group']];
    for (const [role, groupId] of cases) {
      const { run, reads } = fixture();
      await expect(run(role, { period: ACROSS, groupId }), `${role} ${groupId}`).rejects.toMatchObject({ code: 'REPORT_SCOPE_FORBIDDEN' });
      nothingRead(reads);
    }
  });

  it('the Parent, the Collector, MAIN_ADMIN, geographic managers and STUDENT are refused before anything is read', async () => {
    for (const role of ['PARENT', 'SUBSCRIPTION_COLLECTOR', 'MAIN_ADMIN', 'GOVERNORATE_MANAGER', 'CENTER_MANAGER', 'VILLAGE_MANAGER', 'STUDENT']) {
      const { run, reads } = fixture();
      await expect(run(role, { period: ACROSS, groupId: G1 }), role).rejects.toMatchObject({ code: 'REPORT_NOT_ALLOWED' });
      nothingRead(reads);
      expect(reads.school).toBe(0);
    }
  });

  it('validates the period before reading', async () => {
    const { run, reads } = fixture();
    await expect(run('SCHOOL_MANAGER', { period: { kind: 'FOREVER' }, groupId: G1 })).rejects.toMatchObject({ code: 'INVALID_REPORT_PERIOD' });
    nothingRead(reads);
  });
});

describe('GROUP report: the header and the roster', () => {
  it('the header has the name, school, learning mode, status and the Teacher\'s NAME only', async () => {
    const { report } = await fixture().run('SCHOOL_MANAGER', { period: ACROSS, groupId: G1 });
    expect(report.group).toEqual({ id: G1, name: 'حلقة الفجر', schoolId: S1, schoolName: 'مدرسة النور', learningMode: 'GROUP', status: 'ACTIVE', teacherName: 'محمود حسن علي' });
    expect(/phone|mobile|email/i.test(JSON.stringify(report.group))).toBe(false);
  });

  it('ACROSS_TIME: every student ever assigned (also those who left, archived ones and those without any activity), ordered by name', async () => {
    const { report } = await fixture().run('SCHOOL_MANAGER', { period: ACROSS, groupId: G1 });
    expect(report.students.map((s) => s.studentId)).toEqual([A, B, C, D, E]);
    expect(report.totals.students).toBe(5);
    expect(report.students.find((s) => s.studentId === E)).toMatchObject({ attendance: { present: 0, absent: 0, total: 0 }, memorization: { records: 0 }, exams: { examined: 0, absent: 0, total: 0 }, evaluations: { evaluations: 0 } });
  });

  it('a period is about the students who were in the group DURING it (historical membership, each with their own effective start)', async () => {
    const { run } = fixture();
    const month = (await run('SCHOOL_MANAGER', { period: THIS_MONTH, groupId: G1 })).report;
    expect(month.students.map((s) => [s.studentId, s.effectiveStartDate])).toEqual([[A, '2026-11-01'], [C, '2026-11-10'], [E, '2026-11-01']]);
    const october = (await run('SCHOOL_MANAGER', { period: { kind: 'LAST_MONTH' }, groupId: G1 })).report;
    expect(october.students.map((s) => s.studentId)).toEqual([A, B, D]); // C joined in November, E was assigned in November
    expect(october.students.find((s) => s.studentId === D)).toBeDefined(); // the archived student is reported for the time they were in the group
  });

  it('asks Module 20 for the assignment history of the period (never rebuilds it from the current roster)', async () => {
    const { run, reads } = fixture();
    await run('SCHOOL_MANAGER', { period: THIS_MONTH, groupId: G1 });
    const query = reads.roster[0] as { groupId: string; from: Date; toExclusive: Date };
    expect(reads.roster).toHaveLength(1);
    expect(query.groupId).toBe(G1);
    expect(query.from).toEqual(new Date('2026-10-31T22:00:00.000Z')); // 1 November in Africa/Cairo
    expect(query.toExclusive).toBeInstanceOf(Date);
    const across = fixture();
    await across.run('SCHOOL_MANAGER', { period: ACROSS, groupId: G1 });
    expect(across.reads.roster).toEqual([{ groupId: G1 }]);
  });

  it('never exposes a lifecycle status', async () => {
    const { report } = await fixture().run('SCHOOL_MANAGER', { period: ACROSS, groupId: G1 });
    expect(/status|archiv|inactive/i.test(JSON.stringify(report.students))).toBe(false);
  });
});

describe('GROUP report: figures and totals', () => {
  it('the four learning figures are the existing reports for the group (same period, only the group added)', async () => {
    const { run, reads } = fixture();
    await run('SCHOOL_MANAGER', { period: { kind: 'CUSTOM', startDate: '2026-10-01', endDate: '2026-10-31' }, groupId: G1 });
    const request = { period: { kind: 'CUSTOM', startDate: '2026-10-01', endDate: '2026-10-31' }, groupId: G1 };
    expect(reads.delegates).toEqual([['attendance', request], ['memorization', request], ['revision', request], ['evaluation', request]]);
  });

  it('each student row carries the counts; absent rows are zero, never invented', async () => {
    const { report } = await fixture().run('SCHOOL_MANAGER', { period: ACROSS, groupId: G1 });
    const a = report.students.find((s) => s.studentId === A)!;
    expect(a.attendance).toEqual({ present: 8, absent: 2, total: 10 });
    expect(a.memorization).toEqual({ records: 5, fulfilled: 3, notFulfilled: 1, unscheduled: 1 });
    expect(a.revision).toEqual({ records: 0, fulfilled: 0, notFulfilled: 0, unscheduled: 0 });
    expect(a.evaluations.scores.MEMORIZATION).toEqual({ count: 2, average: 7.5 });
    expect(a.evaluations.scores.REVISION).toEqual({ count: 0, average: null });
    expect(a.exams).toEqual({ examined: 1, absent: 1, total: 2 });
    expect(report.students.find((s) => s.studentId === B)!.attendance).toEqual({ present: 4, absent: 1, total: 5 });
  });

  it('exam figures are COUNTS only (no score), limited to this group and to each student\'s effective window', async () => {
    const { run, reads } = fixture();
    const { report } = await run('SCHOOL_MANAGER', { period: ACROSS, groupId: G1 });
    expect(JSON.stringify(report)).not.toMatch(/maxTotal|scores":\[9|total":17/);
    const forA = reads.exams.find((q) => q.studentId === A)!;
    expect(forA.groupIds).toEqual([G1]);
    expect(forA.from).toEqual(new Date('2026-08-31T21:00:00.000Z')); // join date 2026-09-01 (Africa/Cairo, summer time)
    expect(reads.exams.map((q) => q.studentId).sort()).toEqual([A, B, C, D, E]);
  });

  it('the totals cover the WHOLE roster: counts are the sums of the rows, the evaluation means come from the existing report', async () => {
    const { report } = await fixture().run('SCHOOL_MANAGER', { period: ACROSS, groupId: G1 });
    expect(report.totals.attendance).toEqual({ present: 12, absent: 3, total: 15 });
    expect(report.totals.memorization).toEqual({ records: 5, fulfilled: 3, notFulfilled: 1, unscheduled: 1 });
    expect(report.totals.exams).toEqual({ examined: 2, absent: 1, total: 3 });
    expect(report.totals.evaluations.evaluations).toBe(2);
    expect(report.totals.evaluations.scores.MEMORIZATION).toEqual({ count: 2, average: 7.5 });
    expect(report.totals.evaluations.scores.PERFORMANCE).toEqual({ count: 1, average: 9 });
  });

  it('creates no overall score, ranking, weighting or comparison between students or categories', async () => {
    const { report } = await fixture().run('SCHOOL_MANAGER', { period: ACROSS, groupId: G1 });
    expect(Object.keys(report.students[0]!).sort()).toEqual(['attendance', 'effectiveStartDate', 'evaluations', 'exams', 'memorization', 'name', 'revision', 'studentId']);
    expect(Object.keys(report.totals.evaluations).sort()).toEqual(['evaluations', 'scores']);
    expect(Object.keys(report.totals.evaluations.scores).sort()).toEqual(['MEMORIZATION', 'PERFORMANCE', 'REVISION', 'TAJWEED']);
    expect(/percent|rank|grade|weight|overall|composite|best|worst/i.test(JSON.stringify(report))).toBe(false);
  });

  it('no subscription, payment or financial datum, for any role', async () => {
    for (const role of ['ORGANIZATION_MANAGER', 'SCHOOL_MANAGER', 'TEACHER']) {
      const { report } = await fixture().run(role, { period: ACROSS, groupId: G1 });
      expect(/subscription|payment|paid|unpaid|waived|financ|invoice|fee/i.test(JSON.stringify(report)), role).toBe(false);
    }
  });
});

describe('GROUP report: the Teacher\'s attendance', () => {
  it('the Organization Manager and the School Manager get it (from the existing attendance records)', async () => {
    for (const role of ['ORGANIZATION_MANAGER', 'SCHOOL_MANAGER']) {
      const { report } = await fixture().run(role, { period: ACROSS, groupId: G1 });
      expect(report.teacherAttendance).toEqual({ present: 9, absent: 1, total: 10 });
    }
  });

  it('a Teacher does not (the ATTENDANCE report shows a Teacher students only): the key is absent', async () => {
    const { report } = await fixture().run('TEACHER', { period: ACROSS, groupId: G1 });
    expect('teacherAttendance' in report).toBe(false);
  });
});

describe('GROUP report: pagination of the students', () => {
  it('pages the STUDENTS; the totals and the roster size always cover everyone', async () => {
    const { run } = fixture();
    const first = await run('SCHOOL_MANAGER', { period: ACROSS, groupId: G1 }, { page: 1, pageSize: 2 });
    expect(first.report.students.map((s) => s.studentId)).toEqual([A, B]);
    expect(first.report.totals.students).toBe(5);
    expect(first.report.totals.attendance.total).toBe(15);
    expect(first.meta).toEqual({ page: 1, pageSize: 2, total: 5, totalPages: 3 });
    expect((await run('SCHOOL_MANAGER', { period: ACROSS, groupId: G1 }, { page: 3, pageSize: 2 })).report.students.map((s) => s.studentId)).toEqual([E]);
    const beyond = await run('SCHOOL_MANAGER', { period: ACROSS, groupId: G1 }, { page: 9, pageSize: 2 });
    expect(beyond.report.students).toEqual([]);
    expect(beyond.report.totals.students).toBe(5);
  });

  it('without a page (the files) every student is returned', async () => {
    expect((await fixture().run('SCHOOL_MANAGER', { period: ACROSS, groupId: G1 })).report.students).toHaveLength(5);
  });

  it('an empty roster is an empty report, not an error', async () => {
    const { run } = fixture();
    const { report, meta } = await run('SCHOOL_MANAGER', { period: { kind: 'CUSTOM', startDate: '2026-01-01', endDate: '2026-01-31' }, groupId: G1 });
    expect(report.students).toEqual([]);
    expect(report.totals).toMatchObject({ students: 0, attendance: { total: 0 }, exams: { total: 0 } });
    expect(meta.total).toBe(0);
  });
});

describe('GROUP report through ReportService and the public sources', () => {
  it('asking for it without the sources is a configuration error, never an empty report', async () => {
    const service = new ReportService({ scopes: {} as never, periods: {} as never, payments: {} as never, attendance: {} as never, memorization: {} as never, revision: {} as never, evaluation: {} as never, clock });
    await expect(service.groupReport({ userId: 'u', activeRole: 'SCHOOL_MANAGER' }, { period: ACROSS, groupId: G1 })).rejects.toThrow('GROUP_REPORT_SOURCES_NOT_CONFIGURED');
  });

  it('reads only through the School, Student, Group and Exam public lookups; the header carries the Teacher\'s name and nothing else of the Teacher', async () => {
    const calls: string[] = [];
    const sources = new PublicGroupReportSources({
      schools: { listSchoolIdsOfOrganizations: async (ids: readonly string[]) => (calls.push('schools'), [...ids]), findById: async () => ({ id: S1, name: 'مدرسة النور' }) } as never,
      students: { listReportFacts: async () => (calls.push('facts'), []) } as never,
      groups: {
        findScopeById: async (id: string) => (calls.push('scope'), id === G1 ? { id, schoolId: S1, teacherId: 't1', status: 'ACTIVE' } : undefined),
        getGroup: async () => (calls.push('group'), { id: G1, schoolId: S1, name: 'حلقة الفجر', learningMode: 'GROUP', status: 'ACTIVE', teacher: { id: 't1', name: 'محمود حسن علي', phone: '01010001' } }),
        listAssignmentsOfGroupForReport: async () => (calls.push('roster'), []),
      } as never,
      exams: { listStudentOutcomesForReport: async () => (calls.push('exams'), []) } as never,
    });
    expect(await sources.groupHeader('missing')).toBeUndefined();
    expect(await sources.groupHeader(G1)).toEqual({ id: G1, name: 'حلقة الفجر', schoolId: S1, learningMode: 'GROUP', status: 'ACTIVE', teacherName: 'محمود حسن علي' });
    await sources.roster({ groupId: G1 });
    await sources.examOutcomes({ studentId: A });
    expect(calls).toEqual(['scope', 'scope', 'group', 'roster', 'exams']);
  });
});
