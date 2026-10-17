import { SystemClock } from '../modules/00-shared-kernel/public';
import {
  OrganizationRegistrationService,
  SchoolService,
  registerSchoolAuthorization,
  generateApplicantPassword,
  SequelizeSchoolCodeSequence,
  SequelizeSchoolManagerRepository,
  SequelizeSchoolRepository,
} from '../modules/16-schools/public';
import { getAuthorizationPolicyRegistry, getAuthorizationResolvers } from './authorization';
import { getSequelize, getUnitOfWork } from './database';
import { getIdentityService } from './identity';
import { getOrganizationService } from './organization';
import { getOutboxService } from './outbox';
import { getRoleService } from './roles';
import { getUnifiedAddressService } from './unified-address';

let service: SchoolService | undefined;
let registration: OrganizationRegistrationService | undefined;

/** Inject into other modules' use cases (read-only: type it as `SchoolLookup`). Writes are protected at the routes by the Authorization Engine. */
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
      address: getUnifiedAddressService(),
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

/**
 * Schools permissions and the MANAGEMENT/SCHOOL scope resolver are registered ONCE, when this module is loaded, through the shared
 * Authorization Engine (never a second framework). The resolver reads through lazy lookups, so nothing touches the database at import.
 */
registerSchoolAuthorization({
  policies: getAuthorizationPolicyRegistry(),
  resolvers: getAuthorizationResolvers(),
  schools: {
    findById: (id) => getSchoolService().findById(id),
    isSchoolManager: (userId, schoolId) => getSchoolService().isSchoolManager(userId, schoolId),
  },
  organizations: { isOrganizationAdmin: (userId, organizationId) => getOrganizationService().isOrganizationAdmin(userId, organizationId) },
});
