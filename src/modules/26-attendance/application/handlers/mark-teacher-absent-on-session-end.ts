import type { EventHandler } from '../../../06-domain-events-outbox/public';
import { SessionEventTypes, type SessionEventPayload } from '../../../24-sessions/public';
import type { AttendanceService } from '../services/attendance-service';

/**
 * The ONE automatic attendance rule (approved by the project owner), driven by Module 24's events, for the TEACHER only:
 *   - ClassSessionCompleted: a Teacher with no attendance record for the session is ABSENT;
 *   - ClassSessionCancelled by the TEACHER (`cancelSource` TEACHER): the Teacher is ABSENT in it;
 *   - ClassSessionCancelled by the SYSTEM (a retired schedule slot): nothing: the Teacher is not at fault.
 * Students are NEVER touched here. Delivery is at least once and the service is idempotent.
 */
export function createMarkTeacherAbsentOnSessionEndHandler(getService: () => Pick<AttendanceService, 'markTeacherAbsentForCompletedSession' | 'markTeacherAbsentForSessionCancelledByTeacher'>): EventHandler {
  return {
    name: 'attendance.teacher-absent-on-session-end',
    eventTypes: [SessionEventTypes.COMPLETED, SessionEventTypes.CANCELLED],
    async handle(event) {
      const p = event.payload as Partial<SessionEventPayload> | null;
      if (!p?.sessionId || !p.schoolId || !p.groupId || !p.teacherId || !p.occurrenceDate || !p.scheduledStart) return;
      const facts = { sessionId: p.sessionId, schoolId: p.schoolId, groupId: p.groupId, teacherId: p.teacherId, occurrenceDate: p.occurrenceDate, scheduledStart: new Date(p.scheduledStart) };
      if (event.eventType === SessionEventTypes.COMPLETED) await getService().markTeacherAbsentForCompletedSession(facts);
      else if (event.eventType === SessionEventTypes.CANCELLED && p.cancelSource === 'TEACHER') await getService().markTeacherAbsentForSessionCancelledByTeacher(facts);
    },
  };
}
