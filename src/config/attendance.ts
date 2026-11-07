import { SystemClock } from '../modules/00-shared-kernel/public';
import { AttendanceService, SequelizeAttendanceRepository, createMarkTeacherAbsentOnSessionEndHandler, registerAttendanceAuthorization } from '../modules/26-attendance/public';
import { getAuthorizationPolicyRegistry } from './authorization';
import { getClassSessionService } from './class-sessions';
import { getEvaluationService } from './evaluations';
import { getSequelize, getUnitOfWork } from './database';
import { getGroupService } from './groups';
import { getEventHandlerRegistry, getOutboxService } from './outbox';
import { getSchoolService } from './schools';
import { getSmartGuard } from './smart-guard';
import { getTeacherService } from './teachers';

let service: AttendanceService | undefined;

/** Module 26: attendance of the students and the Teacher for a class session (Teacher actions go through Smart Guard). */
export function getAttendanceService(): AttendanceService {
  if (!service) {
    service = new AttendanceService({
      attendance: new SequelizeAttendanceRepository(getSequelize()),
      sessions: getClassSessionService(),
      smartGuard: getSmartGuard(),
      teachers: getTeacherService(),
      groups: getGroupService(),
      schools: getSchoolService(),
      unitOfWork: getUnitOfWork(),
      outbox: getOutboxService(),
      // Approved Module 29 rule: a student who already has an evaluation for the session cannot be marked ABSENT. The veto is resolved LAZILY (at call time), because Module 29 itself
      // depends on this service; Module 26 never imports Module 29.
      evaluationGuard: { findEvaluatedStudents: (sessionId, studentIds, tx) => getEvaluationService().findEvaluatedStudents(sessionId, studentIds, tx) },
      clock: new SystemClock(),
    });
  }
  return service;
}

/** The attendance permissions are registered ONCE, when this module is loaded, through the shared Authorization Engine (the scope resolvers are Modules 19 and 20). */
registerAttendanceAuthorization({ policies: getAuthorizationPolicyRegistry() });

let handlersRegistered = false;
/**
 * Call once at startup, before startOutbox(): the ONE automatic rule. A Teacher who has not recorded their attendance when their session is COMPLETED, or who cancels the
 * session, is ABSENT in it (recorded by the system from Module 24's events). Students are never marked automatically.
 */
export function registerAttendanceEventHandlers(): void {
  if (handlersRegistered) return;
  handlersRegistered = true;
  getEventHandlerRegistry().register(createMarkTeacherAbsentOnSessionEndHandler(getAttendanceService));
}
