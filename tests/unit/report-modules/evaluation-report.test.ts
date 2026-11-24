import { describe, expect, it } from 'vitest';
import { InMemoryEvaluationRepository, type EvaluationCategory, type EvaluationReportQuery } from '../../../src/modules/29-evaluations/public';
import { ReportPeriodService, ReportScopeResolver, type ReportScopeSources } from '../../../src/modules/37-reports-core/public';
import { ReportService, averageOf, type EvaluationReportSources } from '../../../src/modules/38-report-modules/public';

const ORG = 'org-1';
const S1 = 'school-1';
const S2 = 'school-2';
const G1 = 'group-1'; // S1, taught by TEACHER_USER
const G2 = 'group-2'; // S1
const G3 = 'group-3'; // S2
const G4 = 'group-4'; // a school of another organization
const ST1 = 'student-1'; // S1, joined 2026-09-01
const ST2 = 'student-2'; // S1, joined 2026-11-10
const ST3 = 'student-3'; // S2
const ST4 = 'student-4'; // a school of another organization
const TEACHER_USER = 'user-teacher';
const OTHER_TEACHER_USER = 'user-other-teacher';

const clock = { now: () => new Date('2026-11-18T10:00:00Z') };
const NAMES = {
  schools: { [S1]: 'مدرسة أ', [S2]: 'مدرسة ب' },
  groups: { [G1]: 'حلقة الفجر', [G2]: 'حلقة الظهر', [G3]: 'حلقة العصر' },
  students: { [ST1]: { fullName: 'أحمد محمد علي', joinDate: '2026-09-01' }, [ST2]: { fullName: 'بلال حسن علي', joinDate: '2026-11-10' }, [ST3]: { fullName: 'سعيد خالد علي', joinDate: '2026-09-01' } },
} as const;
const SCHOOL_OF_GROUP: Record<string, string> = { [G1]: S1, [G2]: S1, [G3]: S2, [G4]: 'school-other-org' };
const SCHOOL_OF_STUDENT: Record<string, string> = { [ST1]: S1, [ST2]: S1, [ST3]: S2, [ST4]: 'school-other-org' };

type Scores = Partial<Record<EvaluationCategory, number>>;

function fixture() {
  const repo = new InMemoryEvaluationRepository();
  let n = 0;
  const add = (schoolId: string, groupId: string, studentId: string, recordedBy: string, start: string, scores: Scores, note: string | null = null) => {
    n += 1;
    const at = new Date(start);
    repo.rows.set(`ev-${n}`, {
      id: `ev-${n}`, sessionId: `s-${n}`, schoolId, groupId, studentId, occurrenceDate: start.slice(0, 10), scheduledStart: at, note,
      scores: (Object.entries(scores) as Array<[EvaluationCategory, number]>).map(([category, score]) => ({ category, score, memorizationAssignmentId: null, revisionAssignmentId: null })),
      recordedBy, recordedAt: at, updatedBy: recordedBy, updatedAt: at,
    });
  };
  add(S1, G1, ST1, TEACHER_USER, '2026-10-05T09:00:00Z', { MEMORIZATION: 8, PERFORMANCE: 9 });
  add(S1, G1, ST1, TEACHER_USER, '2026-10-12T09:00:00Z', { MEMORIZATION: 7.5, REVISION: 6, PERFORMANCE: 8, TAJWEED: 10 }, 'ملاحظة سرية');
  add(S1, G1, ST1, OTHER_TEACHER_USER, '2026-11-02T09:00:00Z', { MEMORIZATION: 9, PERFORMANCE: 7 });
  add(S1, G2, ST1, OTHER_TEACHER_USER, '2026-11-16T09:00:00Z', { REVISION: 5, PERFORMANCE: 6 });
  add(S1, G2, ST2, OTHER_TEACHER_USER, '2026-11-03T09:00:00Z', { MEMORIZATION: 10 }); // before the join date of ST2
  add(S1, G2, ST2, OTHER_TEACHER_USER, '2026-11-12T09:00:00Z', { MEMORIZATION: 4, PERFORMANCE: 5 });
  add(S2, G3, ST3, OTHER_TEACHER_USER, '2026-11-04T09:00:00Z', { MEMORIZATION: 3.33, PERFORMANCE: 3.34 });

  const reads: EvaluationReportQuery[] = [];
  const sources: EvaluationReportSources = {
    schoolIdsOfOrganizations: async (ids) => (ids.includes(ORG) ? [S1, S2] : []),
    schoolIdOfGroup: async (id) => SCHOOL_OF_GROUP[id],
    schoolIdOfStudent: async (id) => SCHOOL_OF_STUDENT[id],
    isStudentInGroupOfTeacherUser: async (studentId, userId) => userId === TEACHER_USER && studentId === ST1,
    evaluationCounts: async (query) => {
      reads.push(query);
      return repo.summarizeForReport(query);
    },
    studentFacts: async (ids) => new Map(ids.filter((id) => id in NAMES.students).map((id) => [id, NAMES.students[id as keyof typeof NAMES.students]] as const)),
    groupNames: async (ids) => new Map(ids.filter((id) => id in NAMES.groups).map((id) => [id, NAMES.groups[id as keyof typeof NAMES.groups]] as const)),
    schoolNames: async (ids) => new Map(ids.filter((id) => id in NAMES.schools).map((id) => [id, NAMES.schools[id as keyof typeof NAMES.schools]] as const)),
  };
  const scopeSources: ReportScopeSources = {
    organizationIdsOfAdmin: async () => [ORG],
    schoolIdsOfManager: async () => [S1],
    schoolIdsOfCollector: async () => [S1],
    groupIdsOfTeacher: async () => [G1],
    studentIdsOfParent: async () => [ST1],
    geographicAreasOfManager: async () => undefined,
  };
  const service = new ReportService({
    scopes: new ReportScopeResolver(scopeSources),
    periods: new ReportPeriodService({ clock }),
    payments: {} as never,
    attendance: {} as never,
    memorization: {} as never,
    revision: {} as never,
    evaluation: sources,
    clock,
  });
  return { service, reads, add };
}

const as = (activeRole: string) => ({ userId: activeRole === 'TEACHER' ? TEACHER_USER : 'user-1', activeRole });
const ACROSS = { kind: 'ACROSS_TIME' };
type Stats = { count: number; average: number | null };
type Row = { studentId: string; groupId: string; evaluations: number; scores: Record<EvaluationCategory, Stats> };
const row = (report: { rows: readonly Row[] }, studentId: string, groupId: string) => report.rows.find((r) => r.studentId === studentId && r.groupId === groupId);
const NONE: Stats = { count: 0, average: null };

describe('averageOf (the only calculation of the EVALUATION report)', () => {
  it('is the arithmetic mean of the stored scores, from an exact integer sum, rounded half up to two decimals', () => {
    expect(averageOf(3, 2450)).toBe(8.17); // 8.1666...
    expect(averageOf(2, 1550)).toBe(7.75);
    expect(averageOf(2, 1001)).toBe(5.01); // 5.005 rounds half up
    expect(averageOf(1, 1000)).toBe(10);
    expect(averageOf(1, 0)).toBe(0); // a stored zero score is a real score
  });
  it('is null (never a made-up zero) when there is no score', () => {
    expect(averageOf(0, 0)).toBeNull();
  });
});

describe('EVALUATION report: the numbers (Organization Manager)', () => {
  it('counts evaluations per school, group of the evaluation and student, with the count and mean of each category; a student who changed groups has one row per group', async () => {
    const { service } = fixture();
    const report = await service.evaluationReport(as('ORGANIZATION_MANAGER'), { period: ACROSS });
    expect(report.type).toBe('EVALUATION');
    expect(row(report, ST1, G1)).toMatchObject({
      evaluations: 3, studentName: 'أحمد محمد علي', groupName: 'حلقة الفجر', schoolName: 'مدرسة أ',
      scores: { MEMORIZATION: { count: 3, average: 8.17 }, REVISION: { count: 1, average: 6 }, PERFORMANCE: { count: 3, average: 8 }, TAJWEED: { count: 1, average: 10 } },
    });
    expect(row(report, ST1, G2)).toMatchObject({ evaluations: 1, scores: { MEMORIZATION: NONE, REVISION: { count: 1, average: 5 }, PERFORMANCE: { count: 1, average: 6 }, TAJWEED: NONE } });
    expect(row(report, ST3, G3)).toMatchObject({ evaluations: 1, schoolName: 'مدرسة ب', scores: { MEMORIZATION: { count: 1, average: 3.33 }, PERFORMANCE: { count: 1, average: 3.34 } } });
  });

  it('the totals are over every row and each average comes from the exact sums, never an average of the row averages', async () => {
    const { service } = fixture();
    const report = await service.evaluationReport(as('ORGANIZATION_MANAGER'), { period: ACROSS });
    expect(report.totals).toEqual({
      evaluations: 6,
      scores: { MEMORIZATION: { count: 5, average: 6.37 }, REVISION: { count: 2, average: 5.5 }, PERFORMANCE: { count: 6, average: 6.39 }, TAJWEED: { count: 1, average: 10 } },
    });
  });

  it('has no combined score, grade or rate anywhere, and never the Teacher note', async () => {
    const { service } = fixture();
    const report = await service.evaluationReport(as('SCHOOL_MANAGER'), { period: ACROSS });
    expect(Object.keys(report.totals).sort()).toEqual(['evaluations', 'scores']);
    expect(Object.keys(report.totals.scores).sort()).toEqual(['MEMORIZATION', 'PERFORMANCE', 'REVISION', 'TAJWEED']);
    for (const r of report.rows) expect(Object.keys(r).sort()).toEqual(['evaluations', 'groupId', 'groupName', 'schoolId', 'schoolName', 'scores', 'studentId', 'studentName']);
    expect(JSON.stringify(report)).not.toContain('ملاحظة سرية');
  });

  it('never reports a student before the join date (§67), even with no period start', async () => {
    const { service } = fixture();
    const report = await service.evaluationReport(as('ORGANIZATION_MANAGER'), { period: ACROSS });
    expect(row(report, ST2, G2)).toMatchObject({ evaluations: 1, scores: { MEMORIZATION: { count: 1, average: 4 }, PERFORMANCE: { count: 1, average: 5 } } }); // the 2026-11-03 evaluation (MEMORIZATION 10) is before the 2026-11-10 join date
  });

  it('starts a student at the later of the join date and the period start, and omits a student who joined after the period ended', async () => {
    const { service } = fixture();
    const november = await service.evaluationReport(as('SCHOOL_MANAGER'), { period: { kind: 'CUSTOM', startDate: '2026-11-01', endDate: '2026-11-30' } });
    expect(row(november, ST1, G1)).toMatchObject({ evaluations: 1, scores: { MEMORIZATION: { count: 1, average: 9 } } }); // only 2026-11-02: October is outside the period
    expect(november.totals.evaluations).toBe(3); // ST1 G1, ST1 G2 and ST2 (after its join date)
    const early = await service.evaluationReport(as('SCHOOL_MANAGER'), { period: { kind: 'CUSTOM', startDate: '2026-11-01', endDate: '2026-11-05' } });
    expect(early.rows.some((r) => r.studentId === ST2)).toBe(false); // joined on 2026-11-10, after this window ended
  });

  it('an evaluation belongs to the Africa/Cairo business day of its session start, not the UTC day', async () => {
    const { service, add } = fixture();
    // 2026-10-11T22:30Z is 01:30 on 2026-10-12 in Cairo (UTC+3 until the clocks change on 2026-10-29).
    add(S1, G1, ST1, TEACHER_USER, '2026-10-11T22:30:00Z', { MEMORIZATION: 2 });
    const twelfth = await service.evaluationReport(as('SCHOOL_MANAGER'), { period: { kind: 'CUSTOM', startDate: '2026-10-12', endDate: '2026-10-12' }, studentId: ST1 });
    expect(twelfth.totals.evaluations).toBe(2); // the 01:30 evaluation and the 11:00 (09:00Z) one
    const eleventh = await service.evaluationReport(as('SCHOOL_MANAGER'), { period: { kind: 'CUSTOM', startDate: '2026-10-11', endDate: '2026-10-11' }, studentId: ST1 });
    expect(eleventh.rows).toEqual([]);
  });

  it('THIS_MONTH and LAST_MONTH use the period rules of Module 37', async () => {
    const { service } = fixture();
    const thisMonth = await service.evaluationReport(as('SCHOOL_MANAGER'), { period: { kind: 'THIS_MONTH' } });
    expect(thisMonth.period).toEqual({ kind: 'THIS_MONTH', startDate: '2026-11-01', endDate: '2026-11-18' });
    expect(thisMonth.totals.evaluations).toBe(3);
    const lastMonth = await service.evaluationReport(as('SCHOOL_MANAGER'), { period: { kind: 'LAST_MONTH' } });
    expect(lastMonth.totals.evaluations).toBe(2);
  });

  it('orders rows by school, group, then student', async () => {
    const { service } = fixture();
    const report = await service.evaluationReport(as('ORGANIZATION_MANAGER'), { period: ACROSS });
    expect(report.rows.map((r) => `${r.schoolName}/${r.groupName}/${r.studentName}`)).toEqual([
      'مدرسة أ/حلقة الظهر/أحمد محمد علي',
      'مدرسة أ/حلقة الظهر/بلال حسن علي',
      'مدرسة أ/حلقة الفجر/أحمد محمد علي',
      'مدرسة ب/حلقة العصر/سعيد خالد علي',
    ]);
  });
});

describe('EVALUATION report: filters are proven inside the scope before anything is read', () => {
  it('a School Manager: a group or student of another school is refused; their own narrows the result', async () => {
    for (const request of [{ groupId: G3 }, { groupId: 'no-such-group' }, { studentId: ST3 }, { schoolId: S2 }]) {
      const { service, reads } = fixture();
      await expect(service.evaluationReport(as('SCHOOL_MANAGER'), { period: ACROSS, ...request })).rejects.toMatchObject({ code: 'REPORT_SCOPE_FORBIDDEN' });
      expect(reads).toEqual([]);
    }
    const { service } = fixture();
    const group = await service.evaluationReport(as('SCHOOL_MANAGER'), { period: ACROSS, groupId: G1 });
    expect(group.rows.every((r) => r.groupId === G1)).toBe(true);
    const student = await service.evaluationReport(as('SCHOOL_MANAGER'), { period: ACROSS, studentId: ST1 });
    expect(student.rows.map((r) => r.groupId).sort()).toEqual([G1, G2]);
  });

  it('an Organization Manager: schools, groups and students of another organization are refused', async () => {
    for (const request of [{ schoolId: 'school-other-org' }, { groupId: G4 }, { studentId: ST4 }]) {
      const { service, reads } = fixture();
      await expect(service.evaluationReport(as('ORGANIZATION_MANAGER'), { period: ACROSS, ...request })).rejects.toMatchObject({ code: 'REPORT_SCOPE_FORBIDDEN' });
      expect(reads).toEqual([]);
    }
    const { service } = fixture();
    const school = await service.evaluationReport(as('ORGANIZATION_MANAGER'), { period: ACROSS, schoolId: S2 });
    expect(school.rows.map((r) => r.studentId)).toEqual([ST3]);
  });
});

describe('EVALUATION report: Teacher and Parent', () => {
  it('a Teacher sees ONLY the evaluations they recorded (Module 29: sessions assigned to them only), inside the groups they currently teach', async () => {
    const { service, reads } = fixture();
    const report = await service.evaluationReport(as('TEACHER'), { period: ACROSS });
    expect(reads[0]).toMatchObject({ groupIds: [G1], recordedByUserIds: [TEACHER_USER] });
    expect(report.rows).toHaveLength(1);
    expect(row(report, ST1, G1)).toMatchObject({
      evaluations: 2, // the 2026-11-02 evaluation of the same group was recorded by another Teacher and is not theirs
      scores: { MEMORIZATION: { count: 2, average: 7.75 }, REVISION: { count: 1, average: 6 }, PERFORMANCE: { count: 2, average: 8.5 }, TAJWEED: { count: 1, average: 10 } },
    });
  });

  it('a Teacher may not ask for a broader level, nor for a student or group that is not theirs', async () => {
    const { service } = fixture();
    await expect(service.evaluationReport(as('TEACHER'), { period: ACROSS, schoolId: S1 })).rejects.toMatchObject({ code: 'REPORT_SCOPE_FORBIDDEN' });
    await expect(service.evaluationReport(as('TEACHER'), { period: ACROSS, groupId: G2 })).rejects.toMatchObject({ code: 'REPORT_SCOPE_FORBIDDEN' });
    await expect(service.evaluationReport(as('TEACHER'), { period: ACROSS, studentId: ST3 })).rejects.toMatchObject({ code: 'REPORT_SCOPE_FORBIDDEN' });
    const one = await service.evaluationReport(as('TEACHER'), { period: ACROSS, studentId: ST1 });
    expect(one.rows.map((r) => r.groupId)).toEqual([G1]);
  });

  it('a Parent sees all evaluations of their own children (no Teacher restriction), each with its own rows, and may not ask for a school or group', async () => {
    const { service, reads } = fixture();
    const report = await service.evaluationReport(as('PARENT'), { period: ACROSS });
    expect(reads[0]).toMatchObject({ studentIds: [ST1] });
    expect(reads[0]).not.toHaveProperty('recordedByUserIds');
    expect(row(report, ST1, G1)).toMatchObject({ evaluations: 3 });
    expect(new Set(report.rows.map((r) => r.studentId))).toEqual(new Set([ST1]));
    for (const request of [{ schoolId: S1 }, { groupId: G1 }, { studentId: ST3 }]) {
      await expect(service.evaluationReport(as('PARENT'), { period: ACROSS, ...request })).rejects.toMatchObject({ code: 'REPORT_SCOPE_FORBIDDEN' });
    }
  });

  it('a School Manager and an Organization Manager see every Teacher\'s evaluations (no recorder filter)', async () => {
    const { service, reads } = fixture();
    await service.evaluationReport(as('SCHOOL_MANAGER'), { period: ACROSS });
    await service.evaluationReport(as('ORGANIZATION_MANAGER'), { period: ACROSS });
    for (const read of reads) expect(read).not.toHaveProperty('recordedByUserIds');
  });
});

describe('EVALUATION report: who has no report', () => {
  it.each([['SUBSCRIPTION_COLLECTOR'], ['MAIN_ADMIN'], ['STUDENT'], ['GOVERNORATE_MANAGER'], ['CENTER_MANAGER'], ['VILLAGE_MANAGER'], ['']])('%s is refused and nothing is read', async (role) => {
    const { service, reads } = fixture();
    await expect(service.evaluationReport(as(role), { period: ACROSS })).rejects.toMatchObject({ code: 'REPORT_NOT_ALLOWED' });
    expect(reads).toEqual([]);
  });

  it('an invalid period is refused before anything is read', async () => {
    const { service, reads } = fixture();
    await expect(service.evaluationReport(as('SCHOOL_MANAGER'), { period: { kind: 'FOREVER' } })).rejects.toMatchObject({ kind: 'VALIDATION' });
    expect(reads).toEqual([]);
  });
});

describe('EVALUATION report: pagination (standard list pagination: default 20, maximum 100)', () => {
  it('cuts only the rows to the requested page; totals and meta cover the WHOLE report', async () => {
    const { service } = fixture();
    const whole = await service.evaluationReport(as('ORGANIZATION_MANAGER'), { period: ACROSS });
    expect(whole.rows).toHaveLength(4);
    const first = await service.evaluationReportPage(as('ORGANIZATION_MANAGER'), { period: ACROSS }, { page: 1, pageSize: 3 });
    expect(first.report.rows).toEqual(whole.rows.slice(0, 3));
    expect(first.meta).toEqual({ page: 1, pageSize: 3, total: 4, totalPages: 2 });
    expect(first.report.totals).toEqual(whole.totals);
    const second = await service.evaluationReportPage(as('ORGANIZATION_MANAGER'), { period: ACROSS }, { page: 2, pageSize: 3 });
    expect(second.report.rows).toEqual(whole.rows.slice(3));
    const beyond = await service.evaluationReportPage(as('ORGANIZATION_MANAGER'), { period: ACROSS }, { page: 3, pageSize: 3 });
    expect(beyond.report.rows).toEqual([]);
    expect(beyond.meta).toEqual({ page: 3, pageSize: 3, total: 4, totalPages: 2 });
  });

  it('an empty report is one empty page, and pagination never widens access', async () => {
    const { service, reads } = fixture();
    const empty = await service.evaluationReportPage(as('SCHOOL_MANAGER'), { period: { kind: 'CUSTOM', startDate: '2020-01-01', endDate: '2020-01-31' } }, { page: 1, pageSize: 20 });
    expect(empty.report.rows).toEqual([]);
    expect(empty.report.totals.evaluations).toBe(0);
    expect(empty.meta).toEqual({ page: 1, pageSize: 20, total: 0, totalPages: 0 });
    reads.length = 0;
    await expect(service.evaluationReportPage(as('SCHOOL_MANAGER'), { period: ACROSS, groupId: G3 }, { page: 1, pageSize: 20 })).rejects.toMatchObject({ code: 'REPORT_SCOPE_FORBIDDEN' });
    await expect(service.evaluationReportPage(as('MAIN_ADMIN'), { period: ACROSS }, { page: 1, pageSize: 20 })).rejects.toMatchObject({ code: 'REPORT_NOT_ALLOWED' });
    expect(reads).toEqual([]);
  });
});
