import { describe, expect, it } from 'vitest';
import { SmartGuard } from '../../../src/modules/25-smart-guard/public';
import { createClassSessionsHarness } from '../../helpers/class-sessions-harness';
import { INSIDE, OUTSIDE } from '../../helpers/smart-guard-fakes';

const THRESHOLD = new Date('2026-11-02T15:45:00Z'); // Monday; the 18:00 Cairo (UTC+2) slot runs 16:00Z-17:00Z

/** Smart Guard over the REAL Module 24 (sessions), Module 16 (the school's official GPS) and Modules 18/20/23. */
async function setup() {
  const t = await createClassSessionsHarness();
  const school = await t.newSchool('مدرسة أ');
  const manager = await t.newSchoolManager(school.id);
  const teacher = await t.newTeacher(school.id, manager.id);
  const teacher2 = await t.newTeacher(school.id, manager.id);
  const group = await t.newGroup(school.id, manager.id, { teacherId: teacher.id });
  await t.schedules.addSlot(group.id, { dayOfWeek: 'MONDAY', startTime: '18:00', endTime: '19:00' }, manager.id);
  t.sessionClock.set(THRESHOLD);
  await t.classSessions.generateDueSessions();
  const sessionId = [...t.sessionRepo.rows.keys()][0]!;
  const guard = new SmartGuard({ sessions: t.classSessions, schools: t.service, clock: t.sessionClock });
  return { t, school, teacher, teacher2, group, sessionId, guard };
}

describe('Smart Guard over the real Modules 16 and 24', () => {
  it('allows the session\'s Teacher at the school\'s official GPS inside the window', async () => {
    const { guard, teacher, sessionId, school, group } = await setup();
    expect(await guard.check({ teacherId: teacher.id, sessionId, gps: INSIDE })).toEqual({ sessionId, schoolId: school.id, groupId: group.id, teacherId: teacher.id });
  });

  it('refuses another Teacher, a far position, a bad accuracy and a missing reading', async () => {
    const { guard, teacher, teacher2, sessionId } = await setup();
    await expect(guard.check({ teacherId: teacher2.id, sessionId, gps: INSIDE })).rejects.toMatchObject({ code: 'SMART_GUARD_NOT_SESSION_TEACHER' });
    await expect(guard.check({ teacherId: teacher.id, sessionId, gps: OUTSIDE })).rejects.toMatchObject({ code: 'SMART_GUARD_OUTSIDE_SCHOOL_GEOFENCE' });
    await expect(guard.check({ teacherId: teacher.id, sessionId, gps: { ...INSIDE, accuracyMeters: 25 } })).rejects.toMatchObject({ code: 'SMART_GUARD_GPS_ACCURACY_TOO_LOW' });
    await expect(guard.check({ teacherId: teacher.id, sessionId, gps: undefined })).rejects.toMatchObject({ code: 'SMART_GUARD_GPS_REQUIRED' });
  });

  it('follows the real session time: closed before the window, open from start - 15 min through the end inclusive, closed after', async () => {
    const { t, guard, teacher, sessionId } = await setup();
    t.sessionClock.set(new Date('2026-11-02T15:44:59Z'));
    await expect(guard.check({ teacherId: teacher.id, sessionId, gps: INSIDE })).rejects.toMatchObject({ code: 'SMART_GUARD_OUTSIDE_SESSION_WINDOW' });
    t.sessionClock.set(new Date('2026-11-02T17:00:00Z'));
    expect((await guard.check({ teacherId: teacher.id, sessionId, gps: INSIDE })).sessionId).toBe(sessionId);
    t.sessionClock.set(new Date('2026-11-02T17:00:01Z'));
    await expect(guard.check({ teacherId: teacher.id, sessionId, gps: INSIDE })).rejects.toMatchObject({ code: 'SMART_GUARD_OUTSIDE_SESSION_WINDOW' });
  });

  it('a session cancelled by its Teacher is refused, and cancelling needs no GPS (it never goes through Smart Guard)', async () => {
    const { t, guard, teacher, sessionId } = await setup();
    t.sessionClock.set(new Date('2026-11-02T15:50:00Z'));
    await t.classSessions.cancelSession(sessionId, teacher.userId, 'مريض'); // no GPS anywhere
    await expect(guard.check({ teacherId: teacher.id, sessionId, gps: INSIDE })).rejects.toMatchObject({ code: 'SMART_GUARD_SESSION_CANCELLED' });
  });
});
