import { SystemClock } from '../modules/00-shared-kernel/public';
import {
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
import { getGroupService } from './groups';
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
      // Module 20 (Groups): the ACTIVE groups of the Teacher in the school, counted inside the unlink transaction. Reached lazily (inside the
      // function): `groups.ts` imports this file too, and neither touches the other at import time.
      groupDependencies: { countGroupsOfTeacherInSchool: (teacherId, schoolId, tx) => getGroupService().countGroupsOfTeacherInSchool(teacherId, schoolId, tx) },
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
