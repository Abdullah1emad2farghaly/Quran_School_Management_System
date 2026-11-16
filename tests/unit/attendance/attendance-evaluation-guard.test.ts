import { describe, expect, it } from 'vitest';
import { GPS, MANAGER, createAttendanceFakes } from '../../helpers/attendance-fakes';
import { TEACHER } from '../../helpers/attendance-fakes';

const guardOf = (evaluated: string[]) => {
  const calls: Array<{ sessionId: string; studentIds: readonly string[] }> = [];
  return { calls, findEvaluatedStudents: async (sessionId: string, studentIds: readonly string[]) => { calls.push({ sessionId, studentIds: [...studentIds] }); return studentIds.filter((id) => evaluated.includes(id)); } };
};
const teacherBatch = (t: ReturnType<typeof createAttendanceFakes>, records: unknown) => t.service.recordStudentAttendance('session-1', TEACHER.userId, { gps: GPS, records });
const refused = async (promise: Promise<unknown>, code: string, details?: unknown) => expect(promise).rejects.toMatchObject({ code, ...(details === undefined ? {} : { details }) });

describe('Module 29 rule in Module 26: a student who already has an evaluation cannot be marked ABSENT (approved decision 4)', () => {
  it('the Teacher cannot mark an evaluated student ABSENT: the WHOLE batch is rejected (atomic), nothing is written', async () => {
    const guard = guardOf(['student-2']);
    const t = createAttendanceFakes({ evaluationGuard: guard });
    await refused(teacherBatch(t, [{ studentId: 'student-1', status: 'ABSENT' }, { studentId: 'student-2', status: 'ABSENT' }]), 'ATTENDANCE_STUDENT_ALREADY_EVALUATED', { studentIds: ['student-2'] });
    expect(t.repo.rows.size).toBe(0);
    expect(t.events).toHaveLength(0);
  });

  it('the School Manager cannot either, also when correcting an existing PRESENT record to ABSENT', async () => {
    const guard = guardOf(['student-1']);
    const t = createAttendanceFakes({ evaluationGuard: guard });
    await teacherBatch(t, [{ studentId: 'student-1', status: 'PRESENT' }]);
    await refused(t.service.setStudentAttendanceByManager('session-1', 'student-1', MANAGER, { status: 'ABSENT', reason: 'خطأ' }), 'ATTENDANCE_STUDENT_ALREADY_EVALUATED');
    expect([...t.repo.rows.values()][0]!.status).toBe('PRESENT');
    expect(t.repo.corrections).toHaveLength(0);
  });

  it('the veto is asked INSIDE the transaction, after the session row lock, only for students that would BECOME absent', async () => {
    const guard = guardOf([]);
    const t = createAttendanceFakes({ evaluationGuard: guard });
    await teacherBatch(t, [{ studentId: 'student-1', status: 'ABSENT' }, { studentId: 'student-2', status: 'PRESENT' }]);
    expect(t.state.lockedSessions).toEqual(['session-1']);
    expect(guard.calls).toEqual([{ sessionId: 'session-1', studentIds: ['student-1'] }]);
  });

  it('an already-ABSENT student sent as ABSENT again is unchanged and is not vetoed; PRESENT never needs the lock or the veto', async () => {
    const guard = guardOf(['student-1']);
    const t = createAttendanceFakes({ evaluationGuard: guard });
    await teacherBatch(t, [{ studentId: 'student-3', status: 'ABSENT' }]);
    guard.calls.length = 0;
    t.state.lockedSessions.length = 0;
    const same = await teacherBatch(t, [{ studentId: 'student-3', status: 'ABSENT' }]);
    expect(same.results[0]!.outcome).toBe('UNCHANGED');
    expect(guard.calls).toEqual([]);
    const present = await teacherBatch(t, [{ studentId: 'student-1', status: 'PRESENT' }]); // an evaluated student can still be PRESENT
    expect(present.results[0]!.outcome).toBe('RECORDED');
    expect(t.state.lockedSessions).toEqual(['session-1']); // the lock was only taken by the ABSENT batch above, not by this one
  });

  it('without the veto plugged in (as in the Module 26 tests) attendance works exactly as before, including marking students ABSENT', async () => {
    const t = createAttendanceFakes();
    const result = await teacherBatch(t, [{ studentId: 'student-1', status: 'ABSENT' }]);
    expect(result.results[0]!.outcome).toBe('RECORDED');
  });

  it('students nobody marks stay UNMARKED: reading the evaluated students never creates an attendance record', async () => {
    const t = createAttendanceFakes({ evaluationGuard: guardOf(['student-1']) });
    expect([...t.repo.rows.values()]).toHaveLength(0);
    expect(await t.service.listStudentStatuses('session-1')).toEqual(new Map());
  });
});

describe('the two reads Module 29 uses', () => {
  it('lockStudentStatuses returns the status of the students that have a record (UNMARKED students are simply absent from the map)', async () => {
    const t = createAttendanceFakes();
    await teacherBatch(t, [{ studentId: 'student-1', status: 'PRESENT' }, { studentId: 'student-2', status: 'ABSENT' }]);
    const map = await t.service.lockStudentStatuses('session-1', ['student-1', 'student-2', 'student-3'], {} as never);
    expect([...map]).toEqual([['student-1', 'PRESENT'], ['student-2', 'ABSENT']]);
    expect(map.has('student-3')).toBe(false);
  });
});
