import { SystemClock } from '../modules/00-shared-kernel/public';
import {
  SequelizeStudentRepository,
  StudentService,
  registerStudentAuthorization,
} from '../modules/19-students/public';
import { getAuthorizationPolicyRegistry, getAuthorizationResolvers } from './authorization';
import { getSequelize, getUnitOfWork } from './database';
import { getGroupService } from './groups';
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
  // Module 20 (Groups): the student is currently in an ACTIVE group of this Teacher. Reached lazily, like the other lookups above.
  groupAccess: { isStudentInGroupOfTeacher: (studentId, teacherId) => getGroupService().isStudentInGroupOfTeacher(studentId, teacherId) },
});
