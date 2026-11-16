import { SmartGuard } from '../../src/modules/25-smart-guard/public';
import { AttendanceService, InMemoryAttendanceRepository, registerAttendanceAuthorization } from '../../src/modules/26-attendance/public';
import { createClassSessionsHarness } from './class-sessions-harness';

/**
 * The Class Sessions harness (real Authorization Engine, Modules 16-24) plus the REAL Smart Guard and the REAL Module 26 `AttendanceService` over the in-memory
 * attendance repository. Time is the session clock (`sessionClock`) for Modules 24, 25 and 26 together. Students are registered with `t.registerStudent` and
 * assigned with the real `t.groups.assignStudent`.
 */
export async function createAttendanceHarness() {
  const t = await createClassSessionsHarness();
  const attendanceRepo = new InMemoryAttendanceRepository();
  const smartGuard = new SmartGuard({ sessions: t.classSessions, schools: t.service, clock: t.sessionClock });
  const attendance = new AttendanceService({
    attendance: attendanceRepo, sessions: t.classSessions, smartGuard, teachers: t.teachers, groups: t.groups, schools: t.service, unitOfWork: t.unitOfWork, outbox: t.h.outbox, clock: t.sessionClock,
  });
  registerAttendanceAuthorization({ policies: t.policies });
  return { ...t, attendanceRepo, smartGuard, attendance };
}
