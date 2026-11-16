import { SystemClock } from '../modules/00-shared-kernel/public';
import { MemorizationService, SequelizeMemorizationRepository, registerMemorizationAuthorization } from '../modules/27-memorization/public';
import { getAuthorizationPolicyRegistry } from './authorization';
import { getClassSessionService } from './class-sessions';
import { getSequelize, getUnitOfWork } from './database';
import { getGroupService } from './groups';
import { getOutboxService } from './outbox';
import { getQuranRangeEngine } from './quran';
import { getSchoolService } from './schools';
import { getSmartGuard } from './smart-guard';
import { getTeacherService } from './teachers';

let service: MemorizationService | undefined;

/** Module 27: the next-session memorization assignment and the students' memorization records (recording and corrections go through Smart Guard). */
export function getMemorizationService(): MemorizationService {
  if (!service) {
    service = new MemorizationService({
      memorization: new SequelizeMemorizationRepository(getSequelize()),
      sessions: getClassSessionService(),
      smartGuard: getSmartGuard(),
      teachers: getTeacherService(),
      groups: getGroupService(),
      schools: getSchoolService(),
      ranges: getQuranRangeEngine(),
      unitOfWork: getUnitOfWork(),
      outbox: getOutboxService(),
      clock: new SystemClock(),
    });
  }
  return service;
}

/** The memorization permissions are registered ONCE, when this module is loaded, through the shared Authorization Engine (the scope resolvers are Modules 19 and 20). */
registerMemorizationAuthorization({ policies: getAuthorizationPolicyRegistry() });
