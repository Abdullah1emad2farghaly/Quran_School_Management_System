import { SystemClock } from '../modules/00-shared-kernel/public';
import {
  GROUPS_MODULE_NOT_IMPLEMENTED_YET,
  SequelizeTeacherRepository,
  SequelizeTeacherSchoolLinkRepository,
  TeacherService,
  registerTeacherAuthorization,
} from '../modules/18-teachers/public';
import { getAuthorizationPolicyRegistry, getAuthorizationResolvers } from './authorization';
import { getSequelize, getUnitOfWork } from './database';
import { getIdentityService } from './identity';
import { getOutboxService } from './outbox';
import { getParentService } from './parents';
import { getRoleService } from './roles';
import { getSchoolService } from './schools';

let service: TeacherService | undefined;

/**
 * Inject into other modules' use cases (read-only: type it as `TeacherLookup`). Writes are protected at the routes by the Authorization Engine.
 * An existing account is matched by the canonical three-part name stored on the account itself (`users.full_name`, Module 08).
 */
export function getTeacherService(): TeacherService {
  if (!service) {
    const db = getSequelize();
    service = new TeacherService({
      teachers: new SequelizeTeacherRepository(db),
      links: new SequelizeTeacherSchoolLinkRepository(db),
      schools: getSchoolService(),
      identity: getIdentityService(),
      roles: getRoleService(),
      parents: getParentService(),
      // TEMPORARY: Module 20 (Groups) does not exist, so no group can depend on a Teacher-to-School link. Replace this with the Groups module's
      // implementation when Module 20 is implemented (a boundary test fails as soon as Module 20 has source files).
      groupDependencies: GROUPS_MODULE_NOT_IMPLEMENTED_YET,
      unitOfWork: getUnitOfWork(),
      outbox: getOutboxService(),
      clock: new SystemClock(),
    });
  }
  return service;
}

/** Teacher permissions and the MANAGEMENT/TEACHER scope resolver are registered ONCE, when this module is loaded, through the shared Authorization Engine. */
registerTeacherAuthorization({
  policies: getAuthorizationPolicyRegistry(),
  resolvers: getAuthorizationResolvers(),
  teachers: { listActiveSchoolIds: (teacherId) => getTeacherService().listActiveSchoolIds(teacherId) },
  schools: { isSchoolManager: (userId, schoolId) => getSchoolService().isSchoolManager(userId, schoolId) },
});
