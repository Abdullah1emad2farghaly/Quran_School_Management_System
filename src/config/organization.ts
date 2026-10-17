import { SystemClock } from '../modules/00-shared-kernel/public';
import { OrganizationService, SequelizeOrganizationAdminRepository, SequelizeOrganizationRepository, registerOrganizationAuthorization } from '../modules/13-organization-core/public';
import { getAuthorizationPolicyRegistry, getAuthorizationResolvers } from './authorization';
import { getSequelize, getUnitOfWork } from './database';
import { getOutboxService } from './outbox';

let service: OrganizationService | undefined;

/** Inject into other modules' use cases (read-only: type it as `OrganizationLookup`). */
export function getOrganizationService(): OrganizationService {
  if (!service) {
    service = new OrganizationService({
      repository: new SequelizeOrganizationRepository(getSequelize()),
      admins: new SequelizeOrganizationAdminRepository(getSequelize()),
      unitOfWork: getUnitOfWork(),
      outbox: getOutboxService(),
      clock: new SystemClock(),
    });
  }
  return service;
}

/** Organization permissions and the MANAGEMENT/ORGANIZATION scope resolver (registered once, through the shared Authorization Engine). */
registerOrganizationAuthorization({
  policies: getAuthorizationPolicyRegistry(),
  resolvers: getAuthorizationResolvers(),
  organizations: { isOrganizationAdmin: (userId, organizationId) => getOrganizationService().isOrganizationAdmin(userId, organizationId) },
});
