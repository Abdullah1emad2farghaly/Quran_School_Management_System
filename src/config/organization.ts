import { SystemClock } from '../modules/00-shared-kernel/public';
import { OrganizationService, SequelizeOrganizationRepository } from '../modules/13-organization-core/public';
import { getSequelize, getUnitOfWork } from './database';
import { getOutboxService } from './outbox';

let service: OrganizationService | undefined;

/** Inject into other modules' use cases (read-only: type it as `OrganizationLookup`). */
export function getOrganizationService(): OrganizationService {
  if (!service) {
    service = new OrganizationService({
      repository: new SequelizeOrganizationRepository(getSequelize()),
      unitOfWork: getUnitOfWork(),
      outbox: getOutboxService(),
      clock: new SystemClock(),
    });
  }
  return service;
}
