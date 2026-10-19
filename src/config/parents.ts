import { SystemClock } from '../modules/00-shared-kernel/public';
import {
  ParentService,
  SequelizeParentRepository,
  STUDENTS_MODULE_NOT_IMPLEMENTED_YET,
  SequelizeParentSchoolLinkRepository,
  registerParentAuthorization,
} from '../modules/17-parents/public';
import { getAuthorizationPolicyRegistry, getAuthorizationResolvers } from './authorization';
import { getSequelize, getUnitOfWork } from './database';
import { getIdentityService } from './identity';
import { getOutboxService } from './outbox';
import { getRoleService } from './roles';
import { getSchoolService } from './schools';
import { getUnifiedAddressService } from './unified-address';

let service: ParentService | undefined;

/**
 * Inject into other modules' use cases (read-only: type it as `ParentLookup`). Writes are protected at the routes by the Authorization Engine.
 * An existing account is matched by the canonical three-part name stored on the account itself (`users.full_name`, Module 08): there is no
 * separate name source to wire.
 */
export function getParentService(): ParentService {
  if (!service) {
    const db = getSequelize();
    service = new ParentService({
      parents: new SequelizeParentRepository(db),
      links: new SequelizeParentSchoolLinkRepository(db),
      schools: getSchoolService(),
      address: getUnifiedAddressService(),
      identity: getIdentityService(),
      roles: getRoleService(),
      // TEMPORARY: Module 19 (Students) does not exist, so no student can depend on a Parent-to-School link. Replace this with the Students
      // module's implementation when Module 19 is implemented (a boundary test fails as soon as Module 19 has source files).
      studentDependencies: STUDENTS_MODULE_NOT_IMPLEMENTED_YET,
      unitOfWork: getUnitOfWork(),
      outbox: getOutboxService(),
      clock: new SystemClock(),
    });
  }
  return service;
}

/**
 * Parents permissions and the MANAGEMENT/PARENT scope resolver are registered ONCE, when this module is loaded, through the shared
 * Authorization Engine (never a second framework). The resolver reads through lazy lookups, so nothing touches the database at import.
 */
registerParentAuthorization({
  policies: getAuthorizationPolicyRegistry(),
  resolvers: getAuthorizationResolvers(),
  parents: { listActiveSchoolIds: (parentId) => getParentService().listActiveSchoolIds(parentId) },
  schools: { isSchoolManager: (userId, schoolId) => getSchoolService().isSchoolManager(userId, schoolId) },
});
