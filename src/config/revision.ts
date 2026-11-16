import { SystemClock } from '../modules/00-shared-kernel/public';
import { RevisionRangeResolver, RevisionService, SequelizeRevisionRepository, registerRevisionAuthorization } from '../modules/28-revision/public';
import { getAuthorizationPolicyRegistry } from './authorization';
import { getClassSessionService } from './class-sessions';
import { getSequelize, getUnitOfWork } from './database';
import { getGroupService } from './groups';
import { getOutboxService } from './outbox';
import { getQuranRangeEngine, getQuranStructureService } from './quran';
import { getSchoolService } from './schools';
import { getSmartGuard } from './smart-guard';
import { getTeacherService } from './teachers';

let service: RevisionService | undefined;

/** Module 28: the next-session revision assignment and the students' revision records (recording and corrections go through Smart Guard). */
export function getRevisionService(): RevisionService {
  if (!service) {
    service = new RevisionService({
      revision: new SequelizeRevisionRepository(getSequelize()),
      sessions: getClassSessionService(),
      smartGuard: getSmartGuard(),
      teachers: getTeacherService(),
      groups: getGroupService(),
      schools: getSchoolService(),
      ranges: new RevisionRangeResolver({ engine: getQuranRangeEngine(), quran: getQuranStructureService() }),
      unitOfWork: getUnitOfWork(),
      outbox: getOutboxService(),
      clock: new SystemClock(),
    });
  }
  return service;
}

/** The revision permissions are registered ONCE, when this module is loaded, through the shared Authorization Engine (the scope resolvers are Modules 19 and 20). */
registerRevisionAuthorization({ policies: getAuthorizationPolicyRegistry() });
