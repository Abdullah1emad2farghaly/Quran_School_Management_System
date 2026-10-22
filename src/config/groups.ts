import { SystemClock } from '../modules/00-shared-kernel/public';
import { GroupService, SequelizeGroupRepository, createStudentArchivedHandler, registerGroupAuthorization } from '../modules/20-groups/public';
import { getAuthorizationPolicyRegistry, getAuthorizationResolvers } from './authorization';
import { getSequelize, getUnitOfWork } from './database';
import { getEventHandlerRegistry, getOutboxService } from './outbox';
import { getParentService } from './parents';
import { getSchoolService } from './schools';
import { getStudentService } from './students';
import { getTeacherService } from './teachers';

let service: GroupService | undefined;

/**
 * Inject into other modules' use cases (read-only: type it as `GroupLookup`). Writes are protected at the routes by the Authorization Engine.
 * It also is the Groups implementation of Module 18's unlink guard and of Module 19's Teacher read access (see `teachers.ts` and `students.ts`,
 * which reach it lazily: the config files reference each other only inside functions, never at import time).
 */
export function getGroupService(): GroupService {
  if (!service) {
    service = new GroupService({
      groups: new SequelizeGroupRepository(getSequelize()),
      schools: getSchoolService(),
      teachers: getTeacherService(),
      students: getStudentService(),
      unitOfWork: getUnitOfWork(),
      outbox: getOutboxService(),
      clock: new SystemClock(),
    });
  }
  return service;
}

/**
 * Group permissions and the MANAGEMENT/GROUP scope resolver are registered ONCE, when this module is loaded, through the shared Authorization
 * Engine; the Students event consumer is registered with the outbox registry here too (before `startOutbox()`, which `server.ts` calls after the
 * routes are imported). The resolver reads through lazy lookups, so nothing touches the database at import.
 */
registerGroupAuthorization({
  policies: getAuthorizationPolicyRegistry(),
  resolvers: getAuthorizationResolvers(),
  groups: {
    findScopeById: (groupId) => getGroupService().findScopeById(groupId),
    isParentOfAnAssignedStudent: (groupId, parentId) => getGroupService().isParentOfAnAssignedStudent(groupId, parentId),
  },
  schools: { isSchoolManager: (userId, schoolId) => getSchoolService().isSchoolManager(userId, schoolId) },
  parents: { findByUserId: (userId) => getParentService().findByUserId(userId) },
  teachers: { findByUserId: (userId) => getTeacherService().findByUserId(userId) },
});
getEventHandlerRegistry().register(createStudentArchivedHandler(getGroupService));
