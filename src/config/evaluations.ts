import { SystemClock } from '../modules/00-shared-kernel/public';
import { EvaluationService, SequelizeEvaluationRepository, registerEvaluationAuthorization } from '../modules/29-evaluations/public';
import { getAttendanceService } from './attendance';
import { getAuthorizationPolicyRegistry } from './authorization';
import { getClassSessionService } from './class-sessions';
import { getSequelize, getUnitOfWork } from './database';
import { getGroupService } from './groups';
import { getMemorizationService } from './memorization';
import { getOutboxService } from './outbox';
import { getRevisionService } from './revision';
import { getSchoolService } from './schools';
import { getSmartGuard } from './smart-guard';
import { getTeacherService } from './teachers';

let service: EvaluationService | undefined;

/**
 * Module 29: evaluations of the students of a class session (recording and score changes go through Smart Guard, with the narrow post-completion grace exception). It reads
 * attendance (Module 26) and the scheduled assignments (Modules 27 and 28) only through their public services.
 */
export function getEvaluationService(): EvaluationService {
  if (!service) {
    service = new EvaluationService({
      evaluations: new SequelizeEvaluationRepository(getSequelize()),
      sessions: getClassSessionService(),
      smartGuard: getSmartGuard(),
      teachers: getTeacherService(),
      groups: getGroupService(),
      schools: getSchoolService(),
      attendance: getAttendanceService(),
      memorization: getMemorizationService(),
      revision: getRevisionService(),
      unitOfWork: getUnitOfWork(),
      outbox: getOutboxService(),
      clock: new SystemClock(),
    });
  }
  return service;
}

/** The evaluation permissions are registered ONCE, when this module is loaded, through the shared Authorization Engine (the scope resolvers are Modules 19 and 20). */
registerEvaluationAuthorization({ policies: getAuthorizationPolicyRegistry() });
