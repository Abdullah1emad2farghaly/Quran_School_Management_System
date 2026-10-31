import { describe, expect, it } from 'vitest';
import { createAttendanceHarness } from '../../helpers/attendance-harness';

const THRESHOLD = new Date('2026-11-02T15:45:00Z'); // Monday; the 18:00 Cairo (UTC+2) slot runs 16:00Z-17:00Z
const GPS = { latitude: 30.0444 + 0.0004, longitude: 31.2357, accuracyMeters: 10 }; // about 44 m from the school's official GPS

/** Attendance over the REAL Smart Guard, Module 24 sessions, Module 20 assignments and Module 23 slots. */
async function setup() {
  const t = await createAttendanceHarness();
  const school = await t.newSchool('مدرسة أ');
  const manager = await t.newSchoolManager(school.id);
  const teacher = await t.newTeacher(school.id, manager.id);
  const group = await t.newGroup(school.id, manager.id, { teacherId: teacher.id });
  const parent = await t.newParent(school.id, manager.id);
  const s1 = await t.registerStudent(school.id, parent.id, manager.id);
  const s2 = await t.registerStudent(school.id, parent.id, manager.id);
  const outsider = await t.registerStudent(school.id, parent.id, manager.id); // never assigned to the group
  await t.groups.assignStudent(group.id, s1.id, manager.id);
  await t.groups.assignStudent(group.id, s2.id, manager.id);
  await t.schedules.addSlot(group.id, { dayOfWeek: 'MONDAY', startTime: '18:00', endTime: '19:00' }, manager.id);
  t.sessionClock.set(THRESHOLD);
  await t.classSessions.generateDueSessions();
  const sessionId = [...t.sessionRepo.rows.keys()][0]!;
  return { t, school, manager, teacher, group, s1, s2, outsider, sessionId };
}

describe('Attendance over the real Smart Guard, sessions and group assignments', () => {
  it('records a batch for the currently assigned students with one GPS reading and publishes the events', async () => {
    const { t, teacher, s1, s2, sessionId } = await setup();
    const result = await t.attendance.recordStudentAttendance(sessionId, teacher.userId, { gps: GPS, records: [{ studentId: s1.id, status: 'PRESENT' }, { studentId: s2.id, status: 'ABSENT' }] });
    expect(result.results.map((r) => r.outcome)).toEqual(['RECORDED', 'RECORDED']);
    expect([...t.attendanceRepo.rows.values()].map((r) => `${r.subjectId}:${r.status}`).sort()).toEqual([`${s1.id}:PRESENT`, `${s2.id}:ABSENT`].sort());
  });

  it('refuses what Smart Guard refuses, writing nothing: far, inaccurate, no GPS, outside the window', async () => {
    const { t, teacher, s1, sessionId } = await setup();
    const rec = [{ studentId: s1.id, status: 'PRESENT' }];
    await expect(t.attendance.recordStudentAttendance(sessionId, teacher.userId, { gps: { ...GPS, latitude: 30.0444 + 0.00046 }, records: rec })).rejects.toMatchObject({ code: 'SMART_GUARD_OUTSIDE_SCHOOL_GEOFENCE' });
    await expect(t.attendance.recordStudentAttendance(sessionId, teacher.userId, { gps: { ...GPS, accuracyMeters: 25 }, records: rec })).rejects.toMatchObject({ code: 'SMART_GUARD_GPS_ACCURACY_TOO_LOW' });
    await expect(t.attendance.recordStudentAttendance(sessionId, teacher.userId, { gps: undefined, records: rec })).rejects.toMatchObject({ code: 'SMART_GUARD_GPS_REQUIRED' });
    t.sessionClock.set(new Date('2026-11-02T17:00:01Z'));
    await expect(t.attendance.recordStudentAttendance(sessionId, teacher.userId, { gps: GPS, records: rec })).rejects.toMatchObject({ code: 'SMART_GUARD_OUTSIDE_SESSION_WINDOW' });
    expect(t.attendanceRepo.rows.size).toBe(0);
  });

  it('a student who is not assigned to the group rejects the whole batch', async () => {
    const { t, teacher, s1, outsider, sessionId } = await setup();
    await expect(t.attendance.recordStudentAttendance(sessionId, teacher.userId, { gps: GPS, records: [{ studentId: s1.id, status: 'PRESENT' }, { studentId: outsider.id, status: 'PRESENT' }] })).rejects.toMatchObject({ code: 'ATTENDANCE_STUDENT_NOT_IN_GROUP' });
    expect(t.attendanceRepo.rows.size).toBe(0);
  });

  it('a student unassigned after being recorded is no longer accepted in a Teacher batch, but the School Manager can still correct the record', async () => {
    const { t, teacher, manager, group, s1, sessionId } = await setup();
    await t.attendance.recordStudentAttendance(sessionId, teacher.userId, { gps: GPS, records: [{ studentId: s1.id, status: 'PRESENT' }] });
    await t.groups.unassignStudent(group.id, s1.id, manager.id);
    await expect(t.attendance.recordStudentAttendance(sessionId, teacher.userId, { gps: GPS, records: [{ studentId: s1.id, status: 'ABSENT', reason: 'x' }] })).rejects.toMatchObject({ code: 'ATTENDANCE_STUDENT_NOT_IN_GROUP' });
    const fixed = await t.attendance.setStudentAttendanceByManager(sessionId, s1.id, manager.id, { status: 'ABSENT', reason: 'تصحيح' });
    expect(fixed.results[0]!.outcome).toBe('CORRECTED');
  });

  it('a session cancelled by its Teacher accepts no attendance; cancelling itself needed no GPS', async () => {
    const { t, teacher, manager, s1, sessionId } = await setup();
    t.sessionClock.set(new Date('2026-11-02T15:50:00Z'));
    await t.classSessions.cancelSession(sessionId, teacher.userId, 'مريض');
    await expect(t.attendance.recordStudentAttendance(sessionId, teacher.userId, { gps: GPS, records: [{ studentId: s1.id, status: 'PRESENT' }] })).rejects.toMatchObject({ code: 'SMART_GUARD_SESSION_CANCELLED' });
    await expect(t.attendance.setStudentAttendanceByManager(sessionId, s1.id, manager.id, { status: 'PRESENT' })).rejects.toMatchObject({ code: 'ATTENDANCE_SESSION_CANCELLED' });
  });

  it('the School Manager records the Teacher ABSENT days later without GPS, and reads the session; another school\'s manager and other Teachers cannot read it', async () => {
    const { t, school, manager, teacher, sessionId } = await setup();
    t.sessionClock.set(new Date('2026-11-09T09:00:00Z'));
    await t.attendance.setTeacherAttendanceByManager(sessionId, manager.id, { status: 'ABSENT' });
    expect((await t.attendance.getSessionAttendance(sessionId, manager.id)).teacher).toMatchObject({ status: 'ABSENT', subjectId: teacher.id });
    expect((await t.attendance.getSessionAttendance(sessionId, teacher.userId)).teacher).toMatchObject({ status: 'ABSENT' });
    const school2 = await t.newSchool('مدرسة ب');
    const manager2 = await t.newSchoolManager(school2.id);
    await expect(t.attendance.getSessionAttendance(sessionId, manager2.id)).rejects.toMatchObject({ code: 'ATTENDANCE_READ_NOT_ALLOWED' });
    expect(school.id).not.toBe(school2.id);
  });

  it('the automatic Teacher-absence rule over the real session lifecycle: completion without check-in, a Teacher who checked in, and a Teacher who cancels', async () => {
    const facts = async (t: Awaited<ReturnType<typeof setup>>['t'], sessionId: string) => {
      const s = await t.classSessions.getSession(sessionId);
      return { sessionId: s.id, schoolId: s.schoolId, groupId: s.groupId, teacherId: s.teacherId, occurrenceDate: s.occurrenceDate, scheduledStart: s.scheduledStart };
    };
    // 1. the session runs to its end with no check-in: ABSENT by the system
    const a = await setup();
    a.t.sessionClock.set(new Date('2026-11-02T17:00:00Z'));
    await a.t.classSessions.advanceDueSessions();
    expect((await a.t.classSessions.getSession(a.sessionId)).status).toBe('COMPLETED');
    expect(await a.t.attendance.markTeacherAbsentForCompletedSession(await facts(a.t, a.sessionId))).toBe('RECORDED');
    expect((await a.t.attendance.getSessionAttendance(a.sessionId, a.manager.id)).teacher).toMatchObject({ status: 'ABSENT', recordedByRole: 'SYSTEM', subjectId: a.teacher.id });
    // 2. a Teacher who checked in (real Smart Guard) stays PRESENT at completion
    const b = await setup();
    b.t.sessionClock.set(new Date('2026-11-02T16:10:00Z'));
    await b.t.attendance.checkInTeacher(b.sessionId, b.teacher.userId, { gps: GPS });
    b.t.sessionClock.set(new Date('2026-11-02T17:00:00Z'));
    await b.t.classSessions.advanceDueSessions();
    expect(await b.t.attendance.markTeacherAbsentForCompletedSession(await facts(b.t, b.sessionId))).toBe('UNCHANGED');
    expect((await b.t.attendance.getSessionAttendance(b.sessionId, b.manager.id)).teacher).toMatchObject({ status: 'PRESENT' });
    // 3. the Teacher cancels: ABSENT (even after checking in), history kept; a cancellation by the system marks nobody
    const c = await setup();
    c.t.sessionClock.set(new Date('2026-11-02T16:10:00Z'));
    await c.t.attendance.checkInTeacher(c.sessionId, c.teacher.userId, { gps: GPS });
    await c.t.classSessions.cancelSession(c.sessionId, c.teacher.userId, 'طارئ');
    expect(await c.t.attendance.markTeacherAbsentForSessionCancelledByTeacher(await facts(c.t, c.sessionId))).toBe('CORRECTED');
    expect((await c.t.attendance.getSessionAttendance(c.sessionId, c.manager.id)).teacher).toMatchObject({ status: 'ABSENT', updatedByRole: 'SYSTEM' });
    expect((await c.t.attendance.listCorrectionsOfSession(c.sessionId))[0]).toMatchObject({ previousStatus: 'PRESENT', newStatus: 'ABSENT', changedByRole: 'SYSTEM' });
  });
});

