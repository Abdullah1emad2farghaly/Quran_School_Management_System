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
import { getUnifiedAddressService } from './unified-address';

let service: ParentService | undefined;

/**
 * Inject into other modules' use cases (read-only: type it as `ParentLookup`). Writes are protected at the routes by the Authorization Engine.
 * `accountNames` is left at its default (no module vouches for a person's name yet), so an existing account WITHOUT a Parent record is never
 * reused: the registration answers PARENT_IDENTITY_CONFLICT. When Module 18 (Teachers) or another module exposes verified names through its
 * public contract, pass them here.
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
