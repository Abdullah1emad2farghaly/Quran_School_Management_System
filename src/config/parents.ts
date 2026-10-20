import { SystemClock } from '../modules/00-shared-kernel/public';
import {
  ParentService,
  SequelizeParentRepository,
  SequelizeParentSchoolLinkRepository,
  registerParentAuthorization,
} from '../modules/17-parents/public';
import { getAuthorizationPolicyRegistry, getAuthorizationResolvers } from './authorization';
import { getSequelize, getUnitOfWork } from './database';
import { getIdentityService } from './identity';
import { getOutboxService } from './outbox';
import { getRoleService } from './roles';
import { getSchoolService } from './schools';
import { getStudentService } from './students';
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
      // Module 19 (Students): how many students of the Parent exist in the school (every status), counted inside the unlink transaction.
      // Reached lazily (inside the function): `students.ts` imports this file too, and neither touches the other at import time.
      studentDependencies: { countStudentsOfParentInSchool: (parentId, schoolId, tx) => getStudentService().countStudentsOfParentInSchool(parentId, schoolId, tx) },
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
