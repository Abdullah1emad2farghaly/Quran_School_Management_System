import { describe, expect, it } from 'vitest';
import { ReportPeriodService, ReportScopeResolver, type ReportScopeSources } from '../../../src/modules/37-reports-core/public';
import { PublicStudentReportSources, ReportService, type StudentReportSources } from '../../../src/modules/38-report-modules/public';
import { buildStudentReport, type StudentReportDelegates } from '../../../src/modules/38-report-modules/application/services/student-report-builder';

const ORG = 'org-1';
const S1 = 'school-1';
const S_OTHER = 'school-other-org';
const G_OLD = 'group-old'; // ST1 was here 2026-09-01 .. 2026-10-10, taught by someone else
const G1 = 'group-1'; // ST1 is here since 2026-10-10, taught by TEACHER_USER
const ST1 = 'student-1'; // S1, joined 2026-09-15
const ST2 = 'student-2'; // S1, joined 2026-11-10
const ST_OTHER = 'student-other-org';
const TEACHER_USER = 'user-teacher';

const NOW = new Date('2026-11-18T10:00:00Z');
const clock = { now: () => NOW };
const NAMES: Record<string, string> = { [G_OLD]: 'حلقة قديمة', [G1]: 'حلقة الفجر' };
const FACTS: Record<string, { fullName: string; joinDate: string; schoolId: string }> = {
  [ST1]: { fullName: 'أحمد محمد علي', joinDate: '2026-09-15', schoolId: S1 },
  [ST2]: { fullName: 'بلال حسن علي', joinDate: '2026-11-10', schoolId: S1 },
  [ST_OTHER]: { fullName: 'سعيد خالد', joinDate: '2026-01-01', schoolId: S_OTHER },
};

interface ExamFixture {
  examId: string;
  groupId: string;
  startAt: string;
  outcome: 'EXAMINED' | 'ABSENT';
  scores?: number[];
  total?: number;
}
const EXAMS: ExamFixture[] = [
  { examId: 'exam-1', groupId: G_OLD, startAt: '2026-10-05T07:00:00Z', outcome: 'EXAMINED', scores: [9, 8.5], total: 17.5 },
  { examId: 'exam-2', groupId: G1, startAt: '2026-11-01T22:30:00Z', outcome: 'EXAMINED', scores: [10, 7], total: 17 }, // 2026-11-02 00:30 in Cairo
  { examId: 'exam-3', groupId: G1, startAt: '2026-11-10T07:00:00Z', outcome: 'ABSENT' },
  { examId: 'exam-4', groupId: G1, startAt: '2026-11-02T22:30:00Z', outcome: 'EXAMINED', scores: [5, 5], total: 10 }, // 2026-11-03 00:30 in Cairo
];

function fixture() {
  const reads = { exams: [] as unknown[], subscriptions: [] as unknown[], assignments: 0, delegates: [] as unknown[], students: 0 };
  const sources: StudentReportSources = {
    schoolIdsOfOrganizations: async (ids) => (ids.includes(ORG) ? [S1] : []),
    schoolIdOfStudent: async (id) => {
      reads.students += 1;
      return FACTS[id]?.schoolId;
    },
    isStudentInGroupOfTeacherUser: async (studentId, userId) => userId === TEACHER_USER && studentId === ST1,
    studentFacts: async (id) => (FACTS[id] ? { fullName: FACTS[id]!.fullName, joinDate: FACTS[id]!.joinDate } : undefined),
    assignmentHistoryOfStudent: async () => {
      reads.assignments += 1;
      return [
        { id: 'a1', groupId: G_OLD, groupName: NAMES[G_OLD]!, assignedAt: new Date('2026-09-15T08:00:00Z'), assignedBy: 'u', unassignedAt: new Date('2026-10-10T08:00:00Z'), unassignedBy: 'u', endReason: 'MOVED' },
        { id: 'a2', groupId: G1, groupName: NAMES[G1]!, assignedAt: new Date('2026-10-10T08:00:00Z'), assignedBy: 'u', unassignedAt: null, unassignedBy: null, endReason: null },
      ] as never;
    },
    examOutcomes: async (query) => {
      reads.exams.push(query);
      return EXAMS.filter((e) => {
        const at = new Date(e.startAt).getTime();
        return (
          (query.from === undefined || at >= query.from.getTime()) &&
          (query.toExclusive === undefined || at < query.toExclusive.getTime()) &&
          (query.groupIds === undefined || query.groupIds.includes(e.groupId))
        );
      })
        .sort((a, b) => a.startAt.localeCompare(b.startAt))
        .map((e) => ({
          examId: e.examId, schoolId: S1, groupId: e.groupId, startAt: new Date(e.startAt), outcome: e.outcome, questionCount: 2, maxScorePerQuestion: 10,
          scores: e.outcome === 'ABSENT' ? [] : e.scores!, total: e.outcome === 'ABSENT' ? null : e.total!, maxTotal: 20,
        }));
    },
    subscriptions: async (query) => {
      reads.subscriptions.push(query);
      return [
        { month: '2026-09', status: 'PAID' as const },
        { month: '2026-10', status: 'WAIVED' as const },
        { month: '2026-11', status: 'UNPAID' as const },
      ].filter((r) => (query.fromMonth === undefined || r.month >= query.fromMonth) && (query.toMonth === undefined || r.month <= query.toMonth));
    },
    groupNames: async (ids) => new Map(ids.filter((id) => NAMES[id] !== undefined).map((id) => [id, NAMES[id]!] as const)),
    schoolNames: async (ids) => new Map(ids.filter((id) => id === S1).map((id) => [id, 'مدرسة النور'] as const)),
  };
  const delegates: StudentReportDelegates = {
    attendanceReport: async (_requester, request) => {
      reads.delegates.push(['attendance', request]);
      return { type: 'ATTENDANCE', period: { kind: 'ACROSS_TIME', startDate: null, endDate: null }, generatedAt: '', rows: [{ subjectType: 'STUDENT', subjectId: ST1, subjectName: 'x', schoolId: S1, schoolName: 'm', groupId: G1, groupName: NAMES[G1]!, present: 3, absent: 1, total: 4 }], totals: { students: { present: 3, absent: 1, total: 4 }, teachers: { present: 0, absent: 0, total: 0 } } };
    },
    memorizationReport: async (_requester, request) => {
      reads.delegates.push(['memorization', request]);
      return { type: 'MEMORIZATION', period: { kind: 'ACROSS_TIME', startDate: null, endDate: null }, generatedAt: '', rows: [{ studentId: ST1, studentName: 'x', schoolId: S1, schoolName: 'm', groupId: G1, groupName: NAMES[G1]!, records: 5, fulfilled: 3, notFulfilled: 1, unscheduled: 1 }], totals: { records: 5, fulfilled: 3, notFulfilled: 1, unscheduled: 1 } };
    },
    revisionReport: async (_requester, request) => {
      reads.delegates.push(['revision', request]);
      return { type: 'REVISION', period: { kind: 'ACROSS_TIME', startDate: null, endDate: null }, generatedAt: '', rows: [], totals: { records: 0, fulfilled: 0, notFulfilled: 0, unscheduled: 0 } };
    },
    evaluationReport: async (_requester, request) => {
      reads.delegates.push(['evaluation', request]);
      const none = { count: 0, average: null };
      const scores = { MEMORIZATION: { count: 2, average: 7.5 }, REVISION: none, PERFORMANCE: none, TAJWEED: none };
      return { type: 'EVALUATION', period: { kind: 'ACROSS_TIME', startDate: null, endDate: null }, generatedAt: '', rows: [{ studentId: ST1, studentName: 'x', schoolId: S1, schoolName: 'm', groupId: G1, groupName: NAMES[G1]!, evaluations: 2, scores }], totals: { evaluations: 2, scores } };
    },
  };
  const scopeSources: ReportScopeSources = {
    organizationIdsOfAdmin: async () => [ORG],
    schoolIdsOfManager: async () => [S1],
    schoolIdsOfCollector: async () => [S1],
    groupIdsOfTeacher: async () => [G1],
    studentIdsOfParent: async () => [ST1],
    geographicAreasOfManager: async () => undefined,
  };
  const deps = { scopes: new ReportScopeResolver(scopeSources), periods: new ReportPeriodService({ clock }), sources, clock };
  const run = (role: string, request: { period: { kind: string; startDate?: string; endDate?: string }; studentId: string }, page?: { page: number; pageSize: number }) =>
    buildStudentReport(deps, delegates, { userId: role === 'TEACHER' ? TEACHER_USER : 'user-1', activeRole: role }, request, page);
  return { run, reads };
}

const ACROSS = { kind: 'ACROSS_TIME' };
const nothingRead = (reads: ReturnType<typeof fixture>['reads']) => {
  expect(reads.exams).toEqual([]);
  expect(reads.subscriptions).toEqual([]);
  expect(reads.assignments).toBe(0);
  expect(reads.delegates).toEqual([]);
};

describe('STUDENT report: who may run it, and for which student', () => {
  it('Organization Manager and School Manager: a student of their schools, with all seven sections', async () => {
    for (const role of ['ORGANIZATION_MANAGER', 'SCHOOL_MANAGER']) {
      const { run } = fixture();
      const { report } = await run(role, { period: ACROSS, studentId: ST1 });
      expect(report.type).toBe('STUDENT');
      expect(report.student).toEqual({ id: ST1, name: 'أحمد محمد علي', schoolId: S1, schoolName: 'مدرسة النور', joinDate: '2026-09-15' });
      expect(Object.keys(report.sections).sort()).toEqual(['attendance', 'evaluations', 'examResults', 'groupHistory', 'memorization', 'revision', 'subscriptions']);
    }
  });

  it('Teacher: only a student currently in one of their groups; Parent: only their own child', async () => {
    const teacher = fixture();
    expect((await teacher.run('TEACHER', { period: ACROSS, studentId: ST1 })).report.student.id).toBe(ST1);
    await expect(teacher.run('TEACHER', { period: ACROSS, studentId: ST2 })).rejects.toMatchObject({ code: 'REPORT_SCOPE_FORBIDDEN' });
    const parent = fixture();
    expect((await parent.run('PARENT', { period: ACROSS, studentId: ST1 })).report.student.id).toBe(ST1);
    await expect(parent.run('PARENT', { period: ACROSS, studentId: ST2 })).rejects.toMatchObject({ code: 'REPORT_SCOPE_FORBIDDEN' });
  });

  it('refuses a student outside the scope or that does not exist with the SAME answer, and reads nothing', async () => {
    for (const role of ['ORGANIZATION_MANAGER', 'SCHOOL_MANAGER']) {
      for (const studentId of [ST_OTHER, 'no-such-student']) {
        const { run, reads } = fixture();
        await expect(run(role, { period: ACROSS, studentId })).rejects.toMatchObject({ code: 'REPORT_SCOPE_FORBIDDEN' });
        nothingRead(reads);
      }
    }
  });

  it('MAIN_ADMIN, geographic managers, the Subscription Collector and STUDENT are refused before anything is read', async () => {
    for (const role of ['MAIN_ADMIN', 'GOVERNORATE_MANAGER', 'CENTER_MANAGER', 'VILLAGE_MANAGER', 'SUBSCRIPTION_COLLECTOR', 'STUDENT']) {
      const { run, reads } = fixture();
      await expect(run(role, { period: ACROSS, studentId: ST1 })).rejects.toMatchObject({ code: 'REPORT_NOT_ALLOWED' });
      nothingRead(reads);
      expect(reads.students).toBe(0);
    }
  });

  it('a Teacher or Parent request for a student outside their scope reads nothing either', async () => {
    const { run, reads } = fixture();
    await expect(run('PARENT', { period: ACROSS, studentId: ST2 })).rejects.toMatchObject({ code: 'REPORT_SCOPE_FORBIDDEN' });
    nothingRead(reads);
  });

  it('validates the period through Module 37 before reading', async () => {
    const { run, reads } = fixture();
    await expect(run('SCHOOL_MANAGER', { period: { kind: 'FOREVER' }, studentId: ST1 })).rejects.toMatchObject({ code: 'INVALID_REPORT_PERIOD' });
    nothingRead(reads);
  });
});

describe('STUDENT report: the subscription section belongs to the managers only', () => {
  it('Teacher and Parent receive NO subscription section (the key is absent) and no subscription is read', async () => {
    for (const role of ['TEACHER', 'PARENT']) {
      const { run, reads } = fixture();
      const { report } = await run(role, { period: ACROSS, studentId: ST1 });
      expect('subscriptions' in report.sections).toBe(false);
      expect(reads.subscriptions).toEqual([]);
    }
  });

  it('shows the months of the period that are not before the join month, with the status recorded NOW', async () => {
    const all = fixture();
    const across = (await all.run('SCHOOL_MANAGER', { period: ACROSS, studentId: ST1 })).report.sections.subscriptions!;
    expect(across.rows).toEqual([{ month: '2026-09', status: 'PAID' }, { month: '2026-10', status: 'WAIVED' }, { month: '2026-11', status: 'UNPAID' }]);
    expect(across.totals).toEqual({ paid: 1, unpaid: 1, waived: 1, total: 3 });
    expect(across.statusAsOf).toBe(NOW.toISOString());
    expect(all.reads.subscriptions).toEqual([{ studentId: ST1, fromMonth: '2026-09' }]); // join 2026-09-15: from the join MONTH, no end

    const month = fixture();
    await month.run('ORGANIZATION_MANAGER', { period: { kind: 'THIS_MONTH' }, studentId: ST1 });
    expect(month.reads.subscriptions).toEqual([{ studentId: ST1, fromMonth: '2026-11', toMonth: '2026-11' }]);

    const early = fixture();
    await early.run('ORGANIZATION_MANAGER', { period: { kind: 'CUSTOM', startDate: '2026-01-01', endDate: '2026-10-31' }, studentId: ST1 });
    expect(early.reads.subscriptions).toEqual([{ studentId: ST1, fromMonth: '2026-09', toMonth: '2026-10' }]); // never before the join month
  });
});

describe('STUDENT report: effective start (§67) and the group history', () => {
  it('a student who joined after the period ended has empty sections and nothing is read', async () => {
    const { run, reads } = fixture();
    const { report } = await run('SCHOOL_MANAGER', { period: { kind: 'LAST_MONTH' }, studentId: ST2 }); // joined 2026-11-10, period is October
    expect(report.effectiveStartDate).toBeNull();
    expect(report.student.joinDate).toBe('2026-11-10');
    expect(report.sections.examResults).toEqual({ counts: { examined: 0, absent: 0, total: 0 }, rows: [] });
    expect(report.sections.groupHistory.rows).toEqual([]);
    expect(report.sections.subscriptions).toMatchObject({ rows: [], totals: { total: 0 } });
    nothingRead(reads);
  });

  it('the four learning sections are the existing reports for that student (same period, only the student id added)', async () => {
    const { run, reads } = fixture();
    const { report } = await run('SCHOOL_MANAGER', { period: { kind: 'CUSTOM', startDate: '2026-10-01', endDate: '2026-10-31' }, studentId: ST1 });
    expect(reads.delegates).toEqual(['attendance', 'memorization', 'revision', 'evaluation'].map((kind) => [kind, { period: { kind: 'CUSTOM', startDate: '2026-10-01', endDate: '2026-10-31' }, studentId: ST1 }]));
    expect(report.sections.attendance).toEqual({ rows: [{ groupId: G1, groupName: 'حلقة الفجر', present: 3, absent: 1, total: 4 }], totals: { present: 3, absent: 1, total: 4 } });
    expect(report.sections.memorization.rows).toEqual([{ groupId: G1, groupName: 'حلقة الفجر', records: 5, fulfilled: 3, notFulfilled: 1, unscheduled: 1 }]);
    expect(report.sections.revision).toEqual({ rows: [], totals: { records: 0, fulfilled: 0, notFulfilled: 0, unscheduled: 0 } });
    expect(report.sections.evaluations.totals.evaluations).toBe(2);
  });

  it('ACROSS_TIME: every group period from the join date; an open period has no end and is current', async () => {
    const { run } = fixture();
    const { report } = await run('ORGANIZATION_MANAGER', { period: ACROSS, studentId: ST1 });
    expect(report.effectiveStartDate).toBe('2026-09-15');
    expect(report.sections.groupHistory.rows).toEqual([
      { groupId: G_OLD, groupName: 'حلقة قديمة', from: '2026-09-15', to: '2026-10-10', current: false },
      { groupId: G1, groupName: 'حلقة الفجر', from: '2026-10-10', to: null, current: true },
    ]);
  });

  it('is clipped to the effective window: a period that ended before it is dropped, an open one ends with the period', async () => {
    const { run } = fixture();
    const month = (await run('ORGANIZATION_MANAGER', { period: { kind: 'THIS_MONTH' }, studentId: ST1 })).report;
    expect(month.effectiveStartDate).toBe('2026-11-01');
    expect(month.sections.groupHistory.rows).toEqual([{ groupId: G1, groupName: 'حلقة الفجر', from: '2026-11-01', to: '2026-11-18', current: true }]);
    const october = (await run('ORGANIZATION_MANAGER', { period: { kind: 'CUSTOM', startDate: '2026-10-01', endDate: '2026-10-20' }, studentId: ST1 })).report;
    expect(october.sections.groupHistory.rows).toEqual([
      { groupId: G_OLD, groupName: 'حلقة قديمة', from: '2026-10-01', to: '2026-10-10', current: false },
      { groupId: G1, groupName: 'حلقة الفجر', from: '2026-10-10', to: '2026-10-20', current: true },
    ]);
  });

  it('a Teacher sees only the groups they currently teach, in the group history and the exams', async () => {
    const { run, reads } = fixture();
    const { report } = await run('TEACHER', { period: ACROSS, studentId: ST1 });
    expect(report.sections.groupHistory.rows.map((r) => r.groupId)).toEqual([G1]);
    expect((reads.exams[0] as { groupIds: string[] }).groupIds).toEqual([G1]);
    expect(report.sections.examResults.rows.map((r) => r.groupId)).not.toContain(G_OLD);
  });
});

describe('STUDENT report: exam results', () => {
  it('lists the recorded outcomes oldest first; the period follows the exam start date in Africa/Cairo', async () => {
    const { run } = fixture();
    const all = (await run('SCHOOL_MANAGER', { period: ACROSS, studentId: ST1 })).report.sections.examResults;
    expect(all.rows.map((r) => r.examId)).toEqual(['exam-1', 'exam-2', 'exam-4', 'exam-3']);
    expect(all.counts).toEqual({ examined: 3, absent: 1, total: 4 });

    // 2026-11-02 in Cairo: exam-2 starts 2026-11-02 00:30 (UTC+2) and belongs to it, exam-4 starts 2026-11-03 00:30 and does not
    const day = (await run('SCHOOL_MANAGER', { period: { kind: 'CUSTOM', startDate: '2026-11-02', endDate: '2026-11-02' }, studentId: ST1 })).report.sections.examResults;
    expect(day.rows.map((r) => [r.examId, r.examDate])).toEqual([['exam-2', '2026-11-02']]);
  });

  it('shows the recorded scores and total; an ABSENT outcome shows no score; nothing is combined across exams', async () => {
    const { run } = fixture();
    const rows = (await run('SCHOOL_MANAGER', { period: { kind: 'THIS_MONTH' }, studentId: ST1 })).report.sections.examResults.rows;
    const examined = rows.find((r) => r.examId === 'exam-2')!;
    expect(examined).toEqual({
      examId: 'exam-2', examDate: '2026-11-02', startAt: '2026-11-01T22:30:00.000Z', groupId: G1, groupName: 'حلقة الفجر', outcome: 'EXAMINED',
      questionCount: 2, maxScorePerQuestion: 10, scores: [10, 7], total: 17, maxTotal: 20,
    });
    const absent = rows.find((r) => r.examId === 'exam-3')!;
    expect(absent.outcome).toBe('ABSENT');
    expect(absent.scores).toEqual([]);
    expect(absent.total).toBeNull();
    // no sum, average, percentage, rank or grade anywhere in the exam section
    const section = (await run('SCHOOL_MANAGER', { period: { kind: 'THIS_MONTH' }, studentId: ST1 })).report.sections.examResults;
    expect(Object.keys(section).sort()).toEqual(['counts', 'rows']);
    expect(Object.keys(section.counts).sort()).toEqual(['absent', 'examined', 'total']);
    expect(Object.keys(examined).some((k) => /percent|average|rank|grade|sum/i.test(k))).toBe(false);
  });

  it('paginates ONLY the exam list (default 20, standard meta); the counts cover every exam', async () => {
    const { run } = fixture();
    const first = await run('SCHOOL_MANAGER', { period: ACROSS, studentId: ST1 }, { page: 1, pageSize: 3 });
    expect(first.report.sections.examResults.rows.map((r) => r.examId)).toEqual(['exam-1', 'exam-2', 'exam-4']);
    expect(first.report.sections.examResults.counts.total).toBe(4);
    expect(first.meta).toEqual({ page: 1, pageSize: 3, total: 4, totalPages: 2 });
    const second = await run('SCHOOL_MANAGER', { period: ACROSS, studentId: ST1 }, { page: 2, pageSize: 3 });
    expect(second.report.sections.examResults.rows.map((r) => r.examId)).toEqual(['exam-3']);
    expect(second.report.sections.attendance.totals.total).toBe(4); // the other sections are complete on every page
    const beyond = await run('SCHOOL_MANAGER', { period: ACROSS, studentId: ST1 }, { page: 9, pageSize: 3 });
    expect(beyond.report.sections.examResults.rows).toEqual([]);
    expect(beyond.report.sections.examResults.counts.total).toBe(4);
  });

  it('without a page (the files) every exam is returned', async () => {
    const { run } = fixture();
    expect((await run('SCHOOL_MANAGER', { period: ACROSS, studentId: ST1 })).report.sections.examResults.rows).toHaveLength(4);
  });
});

describe('STUDENT report through ReportService', () => {
  it('asking for it without the sources is a configuration error, never a silent empty report', async () => {
    const service = new ReportService({ scopes: {} as never, periods: {} as never, payments: {} as never, attendance: {} as never, memorization: {} as never, revision: {} as never, evaluation: {} as never, clock });
    await expect(service.studentReport({ userId: 'u', activeRole: 'SCHOOL_MANAGER' }, { period: ACROSS, studentId: ST1 })).rejects.toThrow('STUDENT_REPORT_SOURCES_NOT_CONFIGURED');
  });
});

describe('PublicStudentReportSources (reads only through the owning modules, any lifecycle status)', () => {
  it('finds an ARCHIVED or INACTIVE student exactly like an active one, and only reads', async () => {
    const calls: string[] = [];
    const sources = new PublicStudentReportSources({
      schools: { findById: async () => undefined, listSchoolIdsOfOrganizations: async () => [] } as never,
      students: {
        findScopeById: async (id: string) => {
          calls.push(`scope:${id}`);
          return { id, schoolId: S1, organizationId: ORG, parentId: 'p', status: id === 'archived' ? 'ARCHIVED' : 'INACTIVE' };
        },
        listReportFacts: async (ids: string[]) => ids.map((id) => ({ id, fullName: 'اسم', joinDate: '2026-01-01' })),
      } as never,
      teachers: { findByUserId: async () => undefined } as never,
      groups: { isStudentInGroupOfTeacher: async () => false, listNamesByIds: async () => new Map(), listAssignmentHistoryOfStudent: async () => [] } as never,
      exams: { listStudentOutcomesForReport: async () => [] } as never,
      subscriptions: { listStudentSubscriptionsForReport: async () => [] } as never,
    });
    expect(await sources.schoolIdOfStudent('archived')).toBe(S1);
    expect(await sources.schoolIdOfStudent('inactive')).toBe(S1);
    expect(await sources.studentFacts('archived')).toEqual({ fullName: 'اسم', joinDate: '2026-01-01' });
    expect(calls).toEqual(['scope:archived', 'scope:inactive']);
  });
});
