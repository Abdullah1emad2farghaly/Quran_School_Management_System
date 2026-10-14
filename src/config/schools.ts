import { SystemClock } from '../modules/00-shared-kernel/public';
import {
  OrganizationRegistrationService,
  SchoolService,
  generateApplicantPassword,
  SequelizeSchoolCodeSequence,
  SequelizeSchoolManagerRepository,
  SequelizeSchoolRepository,
} from '../modules/16-schools/public';
import { getSequelize, getUnitOfWork } from './database';
import { getGeographyService } from './geography';
import { getIdentityService } from './identity';
import { getOrganizationService } from './organization';
import { getOutboxService } from './outbox';
import { getRoleService } from './roles';
import { getUnifiedAddressService } from './unified-address';

let service: SchoolService | undefined;
let registration: OrganizationRegistrationService | undefined;

/** Inject into other modules' use cases (read-only: type it as `SchoolLookup`). Writes are for later authorized endpoints/CLIs. */
export function getSchoolService(): SchoolService {
  if (!service) {
    const db = getSequelize();
    service = new SchoolService({
      repository: new SequelizeSchoolRepository(db),
      managers: new SequelizeSchoolManagerRepository(db),
      codes: new SequelizeSchoolCodeSequence(db),
      unitOfWork: getUnitOfWork(),
      outbox: getOutboxService(),
      organizations: getOrganizationService(),
      geography: getGeographyService(),
      identity: getIdentityService(),
      roles: getRoleService(),
      generateApplicantPassword,
      clock: new SystemClock(),
    });
  }
  return service;
}

/**
 * Abuse limit of the PUBLIC school submissions (per client IP, in memory). Provisional default chosen for this module:
 * the project has no approved figure; change it here.
 */
export const PUBLIC_SUBMISSION_RATE_LIMIT = { maxRequests: 10, windowMs: 60 * 60 * 1000 } as const;

/** Organization registration workflow (public endpoint POST /organizations) and the organization-scoped reads. */
export function getOrganizationRegistrationService(): OrganizationRegistrationService {
  registration ??= new OrganizationRegistrationService({
    organizations: getOrganizationService(),
    address: getUnifiedAddressService(),
    identity: getIdentityService(),
    roles: getRoleService(),
    unitOfWork: getUnitOfWork(),
    generateApplicantPassword,
    clock: new SystemClock(),
  });
  return registration;
}
