import { SystemClock } from '../modules/00-shared-kernel/public';
import {
  GROUPS_MODULE_NOT_IMPLEMENTED_YET_FOR_STUDENTS,
  SequelizeStudentRepository,
  StudentService,
  registerStudentAuthorization,
} from '../modules/19-students/public';
import { getAuthorizationPolicyRegistry, getAuthorizationResolvers } from './authorization';
import { getSequelize, getUnitOfWork } from './database';
import { getOutboxService } from './outbox';
import { getParentService } from './parents';
import { getSchoolService } from './schools';
import { getTeacherService } from './teachers';

let service: StudentService | undefined;

/**
 * Inject into other modules' use cases (read-only: type it as `StudentLookup`). Writes are protected at the routes by the Authorization Engine.
 * It also is the Students implementation of Module 17's unlink guard (see `parents.ts`, which reaches it lazily: the two config files
 * reference each other only inside functions, never at import time).
 */
export function getStudentService(): StudentService {
  if (!service) {
    service = new StudentService({
      students: new SequelizeStudentRepository(getSequelize()),
      schools: getSchoolService(),
      parents: getParentService(),
      unitOfWork: getUnitOfWork(),
      outbox: getOutboxService(),
      clock: new SystemClock(),
    });
  }
  return service;
}

/**
 * Student permissions and the MANAGEMENT/STUDENT scope resolver are registered ONCE, when this module is loaded, through the shared
 * Authorization Engine. The resolver reads through lazy lookups, so nothing touches the database at import.
 */
registerStudentAuthorization({
  policies: getAuthorizationPolicyRegistry(),
  resolvers: getAuthorizationResolvers(),
  students: { findScopeById: (studentId) => getStudentService().findScopeById(studentId) },
  schools: { isSchoolManager: (userId, schoolId) => getSchoolService().isSchoolManager(userId, schoolId) },
  parents: { findByUserId: (userId) => getParentService().findByUserId(userId) },
  teachers: { findByUserId: (userId) => getTeacherService().findByUserId(userId) },
  // TEMPORARY: Module 20 (Groups) does not exist, so no Teacher can be proven to teach a Student: every Teacher read is denied (fail closed).
  // Replace this with the Groups module's implementation when Module 20 is implemented (a boundary test fails as soon as Module 20 has
  // source files).
  groupAccess: GROUPS_MODULE_NOT_IMPLEMENTED_YET_FOR_STUDENTS,
});
