import { describe, expect, it } from 'vitest';
import { InMemoryAttendanceRepository, type AttendanceReportQuery, type AttendanceStatus, type SubjectType } from '../../../src/modules/26-attendance/public';
import { ReportPeriodService, ReportScopeResolver, type ReportScopeSources } from '../../../src/modules/37-reports-core/public';
import { ReportService, type AttendanceReportSources } from '../../../src/modules/38-report-modules/public';

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
const T1 = 'teacher-1';
const TEACHER_USER = 'user-teacher';

const clock = { now: () => new Date('2026-11-18T10:00:00Z') };
const NAMES = {
  schools: { [S1]: 'مدرسة أ', [S2]: 'مدرسة ب' },
  groups: { [G1]: 'حلقة الفجر', [G2]: 'حلقة الظهر', [G3]: 'حلقة العصر' },
  teachers: { [T1]: 'خالد أحمد حسن' },
  students: { [ST1]: { fullName: 'أحمد محمد علي', joinDate: '2026-09-01' }, [ST2]: { fullName: 'بلال حسن علي', joinDate: '2026-11-10' }, [ST3]: { fullName: 'سعيد خالد علي', joinDate: '2026-09-01' } },
} as const;
const SCHOOL_OF_GROUP: Record<string, string> = { [G1]: S1, [G2]: S1, [G3]: S2, [G4]: 'school-other-org' };
const SCHOOL_OF_STUDENT: Record<string, string> = { [ST1]: S1, [ST2]: S1, [ST3]: S2, [ST4]: 'school-other-org' };

function fixture() {
  const repo = new InMemoryAttendanceRepository();
  let n = 0;
  const add = (schoolId: string, groupId: string, subjectType: SubjectType, subjectId: string, status: AttendanceStatus, date: string) => {
    n += 1;
    const id = `rec-${n}`;
    const at = new Date(`${date}T09:00:00Z`);
    repo.rows.set(id, { id, sessionId: `s-${n}`, schoolId, groupId, subjectType, subjectId, status, occurrenceDate: date, scheduledStart: at, recordedBy: 'u', recordedByRole: 'SCHOOL_MANAGER', recordedAt: at, updatedBy: 'u', updatedByRole: 'SCHOOL_MANAGER', updatedAt: at });
  };
  // ST1: G1 (Oct, Nov), then G2 (Nov 16): a student who changed groups
  add(S1, G1, 'STUDENT', ST1, 'PRESENT', '2026-10-05');
  add(S1, G1, 'STUDENT', ST1, 'ABSENT', '2026-10-12');
  add(S1, G1, 'STUDENT', ST1, 'PRESENT', '2026-11-02');
  add(S1, G2, 'STUDENT', ST1, 'PRESENT', '2026-11-16');
  // ST2 joined 2026-11-10: one record BEFORE the join date (must never be reported)
  add(S1, G2, 'STUDENT', ST2, 'PRESENT', '2026-11-03');
  add(S1, G2, 'STUDENT', ST2, 'PRESENT', '2026-11-12');
  add(S1, G2, 'STUDENT', ST2, 'ABSENT', '2026-11-15');
  add(S2, G3, 'STUDENT', ST3, 'PRESENT', '2026-11-04');
  add(S1, G1, 'TEACHER', T1, 'PRESENT', '2026-11-02');
  add(S1, G1, 'TEACHER', T1, 'ABSENT', '2026-11-09');

  const reads: AttendanceReportQuery[] = [];
  const sources: AttendanceReportSources = {
    schoolIdsOfOrganizations: async (ids) => (ids.includes(ORG) ? [S1, S2] : []),
    schoolIdOfGroup: async (id) => SCHOOL_OF_GROUP[id],
    schoolIdOfStudent: async (id) => SCHOOL_OF_STUDENT[id],
    isStudentInGroupOfTeacherUser: async (studentId, userId) => userId === TEACHER_USER && studentId === ST1,
    attendanceCounts: async (query) => {
      reads.push(query);
      return repo.summarizeForReport(query);
    },
    studentFacts: async (ids) => new Map(ids.filter((id) => id in NAMES.students).map((id) => [id, NAMES.students[id as keyof typeof NAMES.students]] as const)),
    teacherNames: async (ids) => new Map(ids.filter((id) => id in NAMES.teachers).map((id) => [id, NAMES.teachers[id as keyof typeof NAMES.teachers]] as const)),
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
  const service = new ReportService({ scopes: new ReportScopeResolver(scopeSources), periods: new ReportPeriodService({ clock }), payments: {} as never, attendance: sources, memorization: {} as never, revision: {} as never, evaluation: {} as never, clock });
  return { service, reads };
}

const as = (activeRole: string) => ({ userId: activeRole === 'TEACHER' ? TEACHER_USER : 'user-1', activeRole });
const ACROSS = { kind: 'ACROSS_TIME' };
const row = (report: { rows: ReadonlyArray<{ subjectId: string; groupId: string; present: number; absent: number; total: number }> }, subjectId: string, groupId: string) => report.rows.find((r) => r.subjectId === subjectId && r.groupId === groupId);

describe('ATTENDANCE report: the numbers (Organization Manager)', () => {
  it('counts per school, group of the record and subject; a student who changed groups has one row per group; teachers are included', async () => {
    const { service } = fixture();
    const report = await service.attendanceReport(as('ORGANIZATION_MANAGER'), { period: ACROSS });
    expect(report.type).toBe('ATTENDANCE');
    expect(row(report, ST1, G1)).toMatchObject({ present: 2, absent: 1, total: 3, subjectName: 'أحمد محمد علي', groupName: 'حلقة الفجر', schoolName: 'مدرسة أ' });
    expect(row(report, ST1, G2)).toMatchObject({ present: 1, absent: 0, total: 1, groupName: 'حلقة الظهر' });
    expect(row(report, ST3, G3)).toMatchObject({ present: 1, absent: 0, schoolName: 'مدرسة ب' });
    expect(row(report, T1, G1)).toMatchObject({ subjectType: 'TEACHER', present: 1, absent: 1, total: 2, subjectName: 'خالد أحمد حسن' });
  });

  it('never reports a student before the join date (§67), even with no period start', async () => {
    const { service } = fixture();
    const report = await service.attendanceReport(as('ORGANIZATION_MANAGER'), { period: ACROSS });
    expect(row(report, ST2, G2)).toMatchObject({ present: 1, absent: 1, total: 2 }); // the 2026-11-03 record before the 2026-11-10 join date is not counted
  });

  it('starts a student at the later of the join date and the period start, and omits a student who joined after the period ended', async () => {
    const { service } = fixture();
    const november = await service.attendanceReport(as('SCHOOL_MANAGER'), { period: { kind: 'CUSTOM', startDate: '2026-11-01', endDate: '2026-11-30' } });
    expect(row(november, ST1, G1)).toMatchObject({ present: 1, absent: 0 }); // only 2026-11-02: October is outside the period
    expect(row(november, ST2, G2)).toMatchObject({ present: 1, absent: 1 }); // 2026-11-03 is before the join date
    const early = await service.attendanceReport(as('SCHOOL_MANAGER'), { period: { kind: 'CUSTOM', startDate: '2026-11-01', endDate: '2026-11-05' } });
    expect(early.rows.some((r) => r.subjectId === ST2)).toBe(false); // joined on 2026-11-10, after this window ended
  });

  it('totals students and teachers separately; THIS_MONTH and LAST_MONTH use the period rules of Module 37', async () => {
    const { service } = fixture();
    const thisMonth = await service.attendanceReport(as('SCHOOL_MANAGER'), { period: { kind: 'THIS_MONTH' } });
    expect(thisMonth.period).toEqual({ kind: 'THIS_MONTH', startDate: '2026-11-01', endDate: '2026-11-18' });
    expect(thisMonth.totals.teachers).toEqual({ present: 1, absent: 1, total: 2 });
    expect(thisMonth.totals.students).toEqual({ present: 3, absent: 1, total: 4 }); // ST1 G1 + G2, ST2 two records (the early one is excluded)
    const lastMonth = await service.attendanceReport(as('SCHOOL_MANAGER'), { period: { kind: 'LAST_MONTH' } });
    expect(lastMonth.totals.students).toEqual({ present: 1, absent: 1, total: 2 });
    expect(lastMonth.totals.teachers).toEqual({ present: 0, absent: 0, total: 0 });
  });
});

describe('ATTENDANCE report: filters are proven inside the scope before anything is read', () => {
  it('a School Manager: a group or student of another school is refused; their own narrows the result', async () => {
    const outsideGroup = fixture();
    await expect(outsideGroup.service.attendanceReport(as('SCHOOL_MANAGER'), { period: ACROSS, groupId: G3 })).rejects.toMatchObject({ code: 'REPORT_SCOPE_FORBIDDEN' });
    expect(outsideGroup.reads).toEqual([]);
    const unknownGroup = fixture();
    await expect(unknownGroup.service.attendanceReport(as('SCHOOL_MANAGER'), { period: ACROSS, groupId: 'no-such-group' })).rejects.toMatchObject({ code: 'REPORT_SCOPE_FORBIDDEN' });
    const outsideStudent = fixture();
    await expect(outsideStudent.service.attendanceReport(as('SCHOOL_MANAGER'), { period: ACROSS, studentId: ST3 })).rejects.toMatchObject({ code: 'REPORT_SCOPE_FORBIDDEN' });
    const outsideSchool = fixture();
    await expect(outsideSchool.service.attendanceReport(as('SCHOOL_MANAGER'), { period: ACROSS, schoolId: S2 })).rejects.toMatchObject({ code: 'REPORT_SCOPE_FORBIDDEN' });

    const { service } = fixture();
    const group = await service.attendanceReport(as('SCHOOL_MANAGER'), { period: ACROSS, groupId: G1 });
    expect(group.rows.every((r) => r.groupId === G1)).toBe(true);
    const student = await service.attendanceReport(as('SCHOOL_MANAGER'), { period: ACROSS, studentId: ST1 });
    expect(student.rows.every((r) => r.subjectId === ST1 && r.subjectType === 'STUDENT')).toBe(true); // a student filter never includes teacher rows
    expect(student.rows.map((r) => r.groupId).sort()).toEqual([G1, G2]);
  });

  it('an Organization Manager: schools, groups and students of another organization are refused', async () => {
    for (const request of [{ schoolId: 'school-other-org' }, { groupId: G4 }, { studentId: ST4 }]) {
      const { service, reads } = fixture();
      await expect(service.attendanceReport(as('ORGANIZATION_MANAGER'), { period: ACROSS, ...request })).rejects.toMatchObject({ code: 'REPORT_SCOPE_FORBIDDEN' });
      expect(reads).toEqual([]);
    }
    const { service } = fixture();
    const school = await service.attendanceReport(as('ORGANIZATION_MANAGER'), { period: ACROSS, schoolId: S2 });
    expect(school.rows.map((r) => r.subjectId)).toEqual([ST3]);
  });
});

describe('ATTENDANCE report: Teacher and Parent', () => {
  it('a Teacher sees the students of the groups they teach, never teacher rows, and may not ask for a broader level', async () => {
    const { service, reads } = fixture();
    const report = await service.attendanceReport(as('TEACHER'), { period: ACROSS });
    expect(report.rows.every((r) => r.groupId === G1 && r.subjectType === 'STUDENT')).toBe(true);
    expect(report.totals.teachers.total).toBe(0);
    expect(reads[0]).toMatchObject({ groupIds: [G1], subjectTypes: ['STUDENT'] });
    await expect(service.attendanceReport(as('TEACHER'), { period: ACROSS, schoolId: S1 })).rejects.toMatchObject({ code: 'REPORT_SCOPE_FORBIDDEN' });
    await expect(service.attendanceReport(as('TEACHER'), { period: ACROSS, groupId: G2 })).rejects.toMatchObject({ code: 'REPORT_SCOPE_FORBIDDEN' });
    await expect(service.attendanceReport(as('TEACHER'), { period: ACROSS, studentId: ST3 })).rejects.toMatchObject({ code: 'REPORT_SCOPE_FORBIDDEN' });
    const one = await service.attendanceReport(as('TEACHER'), { period: ACROSS, studentId: ST1 });
    expect(one.rows.map((r) => r.groupId)).toEqual([G1]); // only the group the Teacher teaches: the other group's rows are not theirs
  });

  it('a Parent sees only their own children, each with its own rows, and may not ask for a school or group', async () => {
    const { service, reads } = fixture();
    const report = await service.attendanceReport(as('PARENT'), { period: ACROSS });
    expect(new Set(report.rows.map((r) => r.subjectId))).toEqual(new Set([ST1]));
    expect(reads[0]).toMatchObject({ studentIds: [ST1], subjectTypes: ['STUDENT'] });
    for (const request of [{ schoolId: S1 }, { groupId: G1 }, { studentId: ST3 }]) {
      await expect(service.attendanceReport(as('PARENT'), { period: ACROSS, ...request })).rejects.toMatchObject({ code: 'REPORT_SCOPE_FORBIDDEN' });
    }
  });
});

describe('ATTENDANCE report: who has no report', () => {
  it.each([['SUBSCRIPTION_COLLECTOR'], ['MAIN_ADMIN'], ['STUDENT'], ['GOVERNORATE_MANAGER'], ['']])('%s is refused and nothing is read', async (role) => {
    const { service, reads } = fixture();
    await expect(service.attendanceReport(as(role), { period: ACROSS })).rejects.toMatchObject({ code: 'REPORT_NOT_ALLOWED' });
    expect(reads).toEqual([]);
  });

  it('an invalid period is refused before anything is read', async () => {
    const { service, reads } = fixture();
    await expect(service.attendanceReport(as('SCHOOL_MANAGER'), { period: { kind: 'FOREVER' } })).rejects.toMatchObject({ kind: 'VALIDATION' });
    expect(reads).toEqual([]);
  });
});
