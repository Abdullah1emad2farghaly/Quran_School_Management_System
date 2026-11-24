import { describe, expect, it } from 'vitest';
import { InMemoryMemorizationRepository, type MemorizationReportQuery, type MemorizationRange } from '../../../src/modules/27-memorization/public';
import { ReportPeriodService, ReportScopeResolver, type ReportScopeSources } from '../../../src/modules/37-reports-core/public';
import { ReportService, type MemorizationReportSources } from '../../../src/modules/38-report-modules/public';

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

const clock = { now: () => new Date('2026-11-18T10:00:00Z') };
const NAMES = {
  schools: { [S1]: 'مدرسة أ', [S2]: 'مدرسة ب' },
  groups: { [G1]: 'حلقة الفجر', [G2]: 'حلقة الظهر', [G3]: 'حلقة العصر' },
  students: { [ST1]: { fullName: 'أحمد محمد علي', joinDate: '2026-09-01' }, [ST2]: { fullName: 'بلال حسن علي', joinDate: '2026-11-10' }, [ST3]: { fullName: 'سعيد خالد علي', joinDate: '2026-09-01' } },
} as const;
const SCHOOL_OF_GROUP: Record<string, string> = { [G1]: S1, [G2]: S1, [G3]: S2, [G4]: 'school-other-org' };
const SCHOOL_OF_STUDENT: Record<string, string> = { [ST1]: S1, [ST2]: S1, [ST3]: S2, [ST4]: 'school-other-org' };

const RANGE: MemorizationRange = {
  request: { start: { surah: 1, ayah: 1 }, unit: 'AYAHS', amount: 7, direction: 'FORWARD' },
  first: { surah: 1, ayah: 1 },
  last: { surah: 1, ayah: 7 },
  segments: [{ surah: 1, firstAyah: 1, lastAyah: 7 }],
  ayahCount: 7,
};

function fixture() {
  const repo = new InMemoryMemorizationRepository();
  let n = 0;
  const add = (schoolId: string, groupId: string, studentId: string, matches: boolean | null, start: string) => {
    n += 1;
    const id = `rec-${n}`;
    const at = new Date(start);
    repo.records.set(id, {
      id, sessionId: `s-${n}`, schoolId, groupId, studentId, assignmentId: matches === null ? null : `a-${n}`, range: RANGE, matchesAssignment: matches,
      recordedBy: 'u', recordedAt: at, updatedBy: 'u', updatedAt: at, sessionScheduledStart: at,
    });
  };
  // ST1: G1 (Oct x2, Nov), then G2 (Nov 16): a student who changed groups
  add(S1, G1, ST1, true, '2026-10-05T09:00:00Z');
  add(S1, G1, ST1, false, '2026-10-12T09:00:00Z');
  add(S1, G1, ST1, true, '2026-11-02T09:00:00Z');
  add(S1, G2, ST1, null, '2026-11-16T09:00:00Z');
  // ST2 joined 2026-11-10: one record BEFORE the join date (must never be reported)
  add(S1, G2, ST2, true, '2026-11-03T09:00:00Z');
  add(S1, G2, ST2, true, '2026-11-12T09:00:00Z');
  add(S1, G2, ST2, false, '2026-11-15T09:00:00Z');
  add(S2, G3, ST3, null, '2026-11-04T09:00:00Z');

  const reads: MemorizationReportQuery[] = [];
  const sources: MemorizationReportSources = {
    schoolIdsOfOrganizations: async (ids) => (ids.includes(ORG) ? [S1, S2] : []),
    schoolIdOfGroup: async (id) => SCHOOL_OF_GROUP[id],
    schoolIdOfStudent: async (id) => SCHOOL_OF_STUDENT[id],
    isStudentInGroupOfTeacherUser: async (studentId, userId) => userId === TEACHER_USER && studentId === ST1,
    memorizationCounts: async (query) => {
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
    memorization: sources,
    revision: {} as never,
    evaluation: {} as never,
    clock,
  });
  return { service, reads, add };
}

const as = (activeRole: string) => ({ userId: activeRole === 'TEACHER' ? TEACHER_USER : 'user-1', activeRole });
const ACROSS = { kind: 'ACROSS_TIME' };
type Row = { studentId: string; groupId: string; records: number; fulfilled: number; notFulfilled: number; unscheduled: number };
const row = (report: { rows: readonly Row[] }, studentId: string, groupId: string) => report.rows.find((r) => r.studentId === studentId && r.groupId === groupId);

describe('MEMORIZATION report: the numbers (Organization Manager)', () => {
  it('counts per school, group of the record and student by the stored fulfilment state; a student who changed groups has one row per group', async () => {
    const { service } = fixture();
    const report = await service.memorizationReport(as('ORGANIZATION_MANAGER'), { period: ACROSS });
    expect(report.type).toBe('MEMORIZATION');
    expect(row(report, ST1, G1)).toMatchObject({ records: 3, fulfilled: 2, notFulfilled: 1, unscheduled: 0, studentName: 'أحمد محمد علي', groupName: 'حلقة الفجر', schoolName: 'مدرسة أ' });
    expect(row(report, ST1, G2)).toMatchObject({ records: 1, fulfilled: 0, notFulfilled: 0, unscheduled: 1, groupName: 'حلقة الظهر' });
    expect(row(report, ST3, G3)).toMatchObject({ records: 1, unscheduled: 1, schoolName: 'مدرسة ب' });
  });

  it('every row adds up: records = fulfilled + notFulfilled + unscheduled, and the totals are the sums of the rows (counts only, no score or rate)', async () => {
    const { service } = fixture();
    const report = await service.memorizationReport(as('ORGANIZATION_MANAGER'), { period: ACROSS });
    for (const r of report.rows) expect(r.records).toBe(r.fulfilled + r.notFulfilled + r.unscheduled);
    expect(report.totals).toEqual({ records: 7, fulfilled: 3, notFulfilled: 2, unscheduled: 2 });
    expect(Object.keys(report.totals).sort()).toEqual(['fulfilled', 'notFulfilled', 'records', 'unscheduled']);
  });

  it('never reports a student before the join date (§67), even with no period start', async () => {
    const { service } = fixture();
    const report = await service.memorizationReport(as('ORGANIZATION_MANAGER'), { period: ACROSS });
    expect(row(report, ST2, G2)).toMatchObject({ records: 2, fulfilled: 1, notFulfilled: 1 }); // the 2026-11-03 record before the 2026-11-10 join date is not counted
  });

  it('starts a student at the later of the join date and the period start, and omits a student who joined after the period ended', async () => {
    const { service } = fixture();
    const november = await service.memorizationReport(as('SCHOOL_MANAGER'), { period: { kind: 'CUSTOM', startDate: '2026-11-01', endDate: '2026-11-30' } });
    expect(row(november, ST1, G1)).toMatchObject({ records: 1, fulfilled: 1 }); // only 2026-11-02: October is outside the period
    expect(row(november, ST2, G2)).toMatchObject({ records: 2 }); // 2026-11-03 is before the join date
    const early = await service.memorizationReport(as('SCHOOL_MANAGER'), { period: { kind: 'CUSTOM', startDate: '2026-11-01', endDate: '2026-11-05' } });
    expect(early.rows.some((r) => r.studentId === ST2)).toBe(false); // joined on 2026-11-10, after this window ended
  });

  it('a record belongs to the Africa/Cairo business day of its session start, not the UTC day', async () => {
    const { service, add } = fixture();
    // 2026-10-11T22:30Z is 01:30 on 2026-10-12 in Cairo (UTC+3 until the clocks change on 2026-10-29): a Cairo-day 2026-10-12 record that a UTC reading would put on the 11th.
    add(S1, G1, ST1, null, '2026-10-11T22:30:00Z');
    const twelfth = await service.memorizationReport(as('SCHOOL_MANAGER'), { period: { kind: 'CUSTOM', startDate: '2026-10-12', endDate: '2026-10-12' }, studentId: ST1 });
    expect(twelfth.totals).toEqual({ records: 2, fulfilled: 0, notFulfilled: 1, unscheduled: 1 }); // the 01:30 record and the 11:00 (09:00Z) record
    const eleventh = await service.memorizationReport(as('SCHOOL_MANAGER'), { period: { kind: 'CUSTOM', startDate: '2026-10-11', endDate: '2026-10-11' }, studentId: ST1 });
    expect(eleventh.rows).toEqual([]); // nothing on the Cairo 11th
  });

  it('THIS_MONTH and LAST_MONTH use the period rules of Module 37', async () => {
    const { service } = fixture();
    const thisMonth = await service.memorizationReport(as('SCHOOL_MANAGER'), { period: { kind: 'THIS_MONTH' } });
    expect(thisMonth.period).toEqual({ kind: 'THIS_MONTH', startDate: '2026-11-01', endDate: '2026-11-18' });
    expect(thisMonth.totals).toEqual({ records: 4, fulfilled: 2, notFulfilled: 1, unscheduled: 1 }); // ST1: Nov 2 + Nov 16, ST2: Nov 12 + Nov 15 (the 2026-11-03 record is before the join date)
    const lastMonth = await service.memorizationReport(as('SCHOOL_MANAGER'), { period: { kind: 'LAST_MONTH' } });
    expect(lastMonth.totals).toEqual({ records: 2, fulfilled: 1, notFulfilled: 1, unscheduled: 0 });
  });

  it('orders rows by school, group, then student', async () => {
    const { service } = fixture();
    const report = await service.memorizationReport(as('ORGANIZATION_MANAGER'), { period: ACROSS });
    expect(report.rows.map((r) => `${r.schoolName}/${r.groupName}/${r.studentName}`)).toEqual([
      'مدرسة أ/حلقة الظهر/أحمد محمد علي',
      'مدرسة أ/حلقة الظهر/بلال حسن علي',
      'مدرسة أ/حلقة الفجر/أحمد محمد علي',
      'مدرسة ب/حلقة العصر/سعيد خالد علي',
    ]);
  });
});

describe('MEMORIZATION report: filters are proven inside the scope before anything is read', () => {
  it('a School Manager: a group or student of another school is refused; their own narrows the result', async () => {
    for (const request of [{ groupId: G3 }, { groupId: 'no-such-group' }, { studentId: ST3 }, { schoolId: S2 }]) {
      const { service, reads } = fixture();
      await expect(service.memorizationReport(as('SCHOOL_MANAGER'), { period: ACROSS, ...request })).rejects.toMatchObject({ code: 'REPORT_SCOPE_FORBIDDEN' });
      expect(reads).toEqual([]);
    }
    const { service } = fixture();
    const group = await service.memorizationReport(as('SCHOOL_MANAGER'), { period: ACROSS, groupId: G1 });
    expect(group.rows.every((r) => r.groupId === G1)).toBe(true);
    const student = await service.memorizationReport(as('SCHOOL_MANAGER'), { period: ACROSS, studentId: ST1 });
    expect(student.rows.every((r) => r.studentId === ST1)).toBe(true);
    expect(student.rows.map((r) => r.groupId).sort()).toEqual([G1, G2]);
  });

  it('an Organization Manager: schools, groups and students of another organization are refused', async () => {
    for (const request of [{ schoolId: 'school-other-org' }, { groupId: G4 }, { studentId: ST4 }]) {
      const { service, reads } = fixture();
      await expect(service.memorizationReport(as('ORGANIZATION_MANAGER'), { period: ACROSS, ...request })).rejects.toMatchObject({ code: 'REPORT_SCOPE_FORBIDDEN' });
      expect(reads).toEqual([]);
    }
    const { service } = fixture();
    const school = await service.memorizationReport(as('ORGANIZATION_MANAGER'), { period: ACROSS, schoolId: S2 });
    expect(school.rows.map((r) => r.studentId)).toEqual([ST3]);
  });
});

describe('MEMORIZATION report: Teacher and Parent', () => {
  it('a Teacher sees the students of the groups they teach and may not ask for a broader level', async () => {
    const { service, reads } = fixture();
    const report = await service.memorizationReport(as('TEACHER'), { period: ACROSS });
    expect(report.rows.every((r) => r.groupId === G1)).toBe(true);
    expect(reads[0]).toMatchObject({ groupIds: [G1] });
    await expect(service.memorizationReport(as('TEACHER'), { period: ACROSS, schoolId: S1 })).rejects.toMatchObject({ code: 'REPORT_SCOPE_FORBIDDEN' });
    await expect(service.memorizationReport(as('TEACHER'), { period: ACROSS, groupId: G2 })).rejects.toMatchObject({ code: 'REPORT_SCOPE_FORBIDDEN' });
    await expect(service.memorizationReport(as('TEACHER'), { period: ACROSS, studentId: ST3 })).rejects.toMatchObject({ code: 'REPORT_SCOPE_FORBIDDEN' });
    const one = await service.memorizationReport(as('TEACHER'), { period: ACROSS, studentId: ST1 });
    expect(one.rows.map((r) => r.groupId)).toEqual([G1]); // only the group the Teacher teaches: the other group's rows are not theirs
  });

  it('a Parent sees only their own children, each with its own rows, and may not ask for a school or group', async () => {
    const { service, reads } = fixture();
    const report = await service.memorizationReport(as('PARENT'), { period: ACROSS });
    expect(new Set(report.rows.map((r) => r.studentId))).toEqual(new Set([ST1]));
    expect(reads[0]).toMatchObject({ studentIds: [ST1] });
    for (const request of [{ schoolId: S1 }, { groupId: G1 }, { studentId: ST3 }]) {
      await expect(service.memorizationReport(as('PARENT'), { period: ACROSS, ...request })).rejects.toMatchObject({ code: 'REPORT_SCOPE_FORBIDDEN' });
    }
  });
});

describe('MEMORIZATION report: who has no report', () => {
  it.each([['SUBSCRIPTION_COLLECTOR'], ['MAIN_ADMIN'], ['STUDENT'], ['GOVERNORATE_MANAGER'], ['CENTER_MANAGER'], ['VILLAGE_MANAGER'], ['']])('%s is refused and nothing is read', async (role) => {
    const { service, reads } = fixture();
    await expect(service.memorizationReport(as(role), { period: ACROSS })).rejects.toMatchObject({ code: 'REPORT_NOT_ALLOWED' });
    expect(reads).toEqual([]);
  });

  it('an invalid period is refused before anything is read', async () => {
    const { service, reads } = fixture();
    await expect(service.memorizationReport(as('SCHOOL_MANAGER'), { period: { kind: 'FOREVER' } })).rejects.toMatchObject({ kind: 'VALIDATION' });
    expect(reads).toEqual([]);
  });
});

describe('MEMORIZATION report: pagination (standard list pagination: default 20, maximum 100)', () => {
  it('cuts only the rows to the requested page; totals and meta cover the WHOLE report', async () => {
    const { service } = fixture();
    const whole = await service.memorizationReport(as('ORGANIZATION_MANAGER'), { period: ACROSS });
    expect(whole.rows).toHaveLength(4);
    const first = await service.memorizationReportPage(as('ORGANIZATION_MANAGER'), { period: ACROSS }, { page: 1, pageSize: 3 });
    expect(first.report.rows).toEqual(whole.rows.slice(0, 3));
    expect(first.meta).toEqual({ page: 1, pageSize: 3, total: 4, totalPages: 2 });
    expect(first.report.totals).toEqual(whole.totals); // never only the page
    const second = await service.memorizationReportPage(as('ORGANIZATION_MANAGER'), { period: ACROSS }, { page: 2, pageSize: 3 });
    expect(second.report.rows).toEqual(whole.rows.slice(3));
    expect(second.report.totals).toEqual(whole.totals);
    const beyond = await service.memorizationReportPage(as('ORGANIZATION_MANAGER'), { period: ACROSS }, { page: 3, pageSize: 3 });
    expect(beyond.report.rows).toEqual([]);
    expect(beyond.meta).toEqual({ page: 3, pageSize: 3, total: 4, totalPages: 2 });
  });

  it('an empty report is one empty page (total 0, 0 pages)', async () => {
    const { service } = fixture();
    const empty = await service.memorizationReportPage(as('SCHOOL_MANAGER'), { period: { kind: 'CUSTOM', startDate: '2020-01-01', endDate: '2020-01-31' } }, { page: 1, pageSize: 20 });
    expect(empty.report.rows).toEqual([]);
    expect(empty.meta).toEqual({ page: 1, pageSize: 20, total: 0, totalPages: 0 });
  });

  it('pagination never widens access: an out-of-scope request is still refused and nothing is read', async () => {
    const { service, reads } = fixture();
    await expect(service.memorizationReportPage(as('SCHOOL_MANAGER'), { period: ACROSS, groupId: G3 }, { page: 1, pageSize: 20 })).rejects.toMatchObject({ code: 'REPORT_SCOPE_FORBIDDEN' });
    await expect(service.memorizationReportPage(as('MAIN_ADMIN'), { period: ACROSS }, { page: 1, pageSize: 20 })).rejects.toMatchObject({ code: 'REPORT_NOT_ALLOWED' });
    expect(reads).toEqual([]);
  });
});
