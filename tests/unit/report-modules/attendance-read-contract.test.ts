import { describe, expect, it } from 'vitest';
import { InMemoryAttendanceRepository, type AttendanceStatus, type SubjectType } from '../../../src/modules/26-attendance/public';

/** The read-only attendance aggregate Module 38 needs from Module 26 (additive: no existing behaviour changes). */
describe('Module 26 summarizeForReport', () => {
  const repo = new InMemoryAttendanceRepository();
  let n = 0;
  const add = (schoolId: string, groupId: string, subjectType: SubjectType, subjectId: string, status: AttendanceStatus, date: string) => {
    n += 1;
    const at = new Date(`${date}T09:00:00Z`);
    repo.rows.set(`r${n}`, { id: `r${n}`, sessionId: `s${n}`, schoolId, groupId, subjectType, subjectId, status, occurrenceDate: date, scheduledStart: at, recordedBy: 'u', recordedByRole: 'SCHOOL_MANAGER', recordedAt: at, updatedBy: 'u', updatedByRole: 'SCHOOL_MANAGER', updatedAt: at });
  };
  add('s1', 'g1', 'STUDENT', 'a', 'PRESENT', '2026-10-05');
  add('s1', 'g1', 'STUDENT', 'a', 'PRESENT', '2026-10-12');
  add('s1', 'g1', 'STUDENT', 'a', 'ABSENT', '2026-11-02');
  add('s1', 'g2', 'STUDENT', 'a', 'PRESENT', '2026-11-16');
  add('s1', 'g1', 'TEACHER', 't', 'PRESENT', '2026-11-02');
  add('s2', 'g3', 'STUDENT', 'b', 'PRESENT', '2026-11-04');
  const key = (r: { schoolId: string; groupId: string; subjectType: string; subjectId: string; status: string; count: number; firstDate: string }) => `${r.schoolId}/${r.groupId}/${r.subjectType}/${r.subjectId}/${r.status}=${r.count}@${r.firstDate}`;

  it('counts per school, group, subject and status with the earliest date, in a stable order', async () => {
    const rows = await repo.summarizeForReport({ subjectTypes: ['STUDENT', 'TEACHER'] });
    expect(rows.map(key)).toEqual([
      's1/g1/STUDENT/a/ABSENT=1@2026-11-02',
      's1/g1/STUDENT/a/PRESENT=2@2026-10-05',
      's1/g1/TEACHER/t/PRESENT=1@2026-11-02',
      's1/g2/STUDENT/a/PRESENT=1@2026-11-16',
      's2/g3/STUDENT/b/PRESENT=1@2026-11-04',
    ]);
  });

  it('every filter narrows (AND): schools, groups, students, subject types and the inclusive date range', async () => {
    expect((await repo.summarizeForReport({ subjectTypes: ['STUDENT'], schoolIds: ['s1'] })).map((r) => r.subjectId)).toEqual(['a', 'a', 'a']);
    expect((await repo.summarizeForReport({ subjectTypes: ['STUDENT', 'TEACHER'], groupIds: ['g1'] })).map((r) => r.subjectType)).toEqual(['STUDENT', 'STUDENT', 'TEACHER']);
    expect((await repo.summarizeForReport({ subjectTypes: ['STUDENT'], studentIds: ['b'] })).map(key)).toEqual(['s2/g3/STUDENT/b/PRESENT=1@2026-11-04']);
    expect((await repo.summarizeForReport({ subjectTypes: ['STUDENT'], schoolIds: ['s1'], fromDate: '2026-11-02', toDate: '2026-11-16' })).map(key)).toEqual(['s1/g1/STUDENT/a/ABSENT=1@2026-11-02', 's1/g2/STUDENT/a/PRESENT=1@2026-11-16']);
    expect(await repo.summarizeForReport({ subjectTypes: ['STUDENT'], schoolIds: ['s2'], toDate: '2026-11-03' })).toEqual([]);
  });

  it('an empty list or no subject type matches nothing (never everything)', async () => {
    expect(await repo.summarizeForReport({ subjectTypes: ['STUDENT'], schoolIds: [] })).toEqual([]);
    expect(await repo.summarizeForReport({ subjectTypes: ['STUDENT'], groupIds: [] })).toEqual([]);
    expect(await repo.summarizeForReport({ subjectTypes: ['STUDENT'], studentIds: [] })).toEqual([]);
    expect(await repo.summarizeForReport({ subjectTypes: [] })).toEqual([]);
  });
});
