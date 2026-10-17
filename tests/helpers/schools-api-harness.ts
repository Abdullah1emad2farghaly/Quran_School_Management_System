import type { TransactionContext, UnitOfWork } from '../../src/modules/00-shared-kernel/public';
import type { Logger } from '../../src/modules/05-logging-request-context/public';
import { PermissionRegistry } from '../../src/modules/09-roles-permissions/public';
import {
  AuthorizationPolicyRegistry,
  AuthorizationResolvers,
  AuthorizationService,
  createRequirePermission,
} from '../../src/modules/12-authorization-engine/public';
import {
  InMemoryOrganizationAdminRepository,
  InMemoryOrganizationRepository,
  OrganizationService,
  registerOrganizationAuthorization,
} from '../../src/modules/13-organization-core/public';
import { GeographyNode, GeographyService, InMemoryGeographyRepository } from '../../src/modules/14-geography/public';
import { UnifiedAddressService } from '../../src/modules/15-unified-address/public';
import {
  InMemorySchoolCodeSequence,
  InMemorySchoolManagerRepository,
  InMemorySchoolRepository,
  OrganizationRegistrationService,
  SchoolService,
  registerSchoolAuthorization,
} from '../../src/modules/16-schools/public';
import { createSessionHarness } from './session-harness';

const tx = {} as TransactionContext;

/** In-memory wiring of Modules 08-10 (real sessions and tokens), 12 (the real Authorization Engine with the Module 13 and 16 registrations) plus 13, 14, 15 and 16, for HTTP tests. */
export async function createSchoolsApiHarness() {
  const h = createSessionHarness();
  const orgRepo = new InMemoryOrganizationRepository();
  const adminRepo = new InMemoryOrganizationAdminRepository();
  const schools = new InMemorySchoolRepository();
  const managers = new InMemorySchoolManagerRepository();
  const codes = new InMemorySchoolCodeSequence();
  /** Like a database transaction: a failed unit of work restores accounts, roles, organizations, schools and outbox messages. */
  const unitOfWork: UnitOfWork = {
    run: async (work) => {
      const saved = {
        u: [...h.users.rows], r: [...h.roleRepo.rows], g: [...orgRepo.rows], a: [...adminRepo.rows], s: schools.snapshot(), m: managers.snapshot(), c: codes.last, o: [...h.store.messages],
      };
      try {
        return await work(tx);
      } catch (error) {
        h.users.rows.clear();
        saved.u.forEach(([k, v]) => h.users.rows.set(k, v));
        h.roleRepo.rows.clear();
        saved.r.forEach(([k, v]) => h.roleRepo.rows.set(k, v));
        orgRepo.rows.clear();
        saved.g.forEach(([k, v]) => orgRepo.rows.set(k, v));
        adminRepo.rows.clear();
        saved.a.forEach(([k, v]) => adminRepo.rows.set(k, v));
        schools.restore(saved.s);
        managers.restore(saved.m);
        codes.last = saved.c;
        h.store.messages.splice(0, h.store.messages.length, ...saved.o);
        throw error;
      }
    },
  };
  const organizations = new OrganizationService({
    repository: orgRepo,
    admins: adminRepo,
    unitOfWork,
    outbox: h.outbox,
    clock: h.clock,
  });

  const geoRepo = new InMemoryGeographyRepository();
  const geography = new GeographyService(geoRepo);
  const address = new UnifiedAddressService({ geography, organizations });
  let n = 0;
  const add = async (level: 'COUNTRY' | 'GOVERNORATE' | 'CENTER' | 'VILLAGE', name: string, parentId: string | null) => {
    const prefix = { COUNTRY: 'CNT', GOVERNORATE: 'GOV', CENTER: 'CTR', VILLAGE: 'VIL' }[level];
    const node = GeographyNode.create({ level, name, parentId, kind: level === 'CENTER' ? 'CENTER' : undefined, code: `${prefix}-${String(600000 + ++n)}`, clock: h.clock });
    await geoRepo.insert(node, tx);
    return node;
  };
  const country = await add('COUNTRY', 'مصر', null);
  const france = await add('COUNTRY', 'France', null);
  const gov = await add('GOVERNORATE', 'المنيا', country.id);
  const paris = await add('GOVERNORATE', 'Paris', france.id);
  const center = await add('CENTER', 'سمالوط', gov.id);

  schools.managedSchoolIds = (userId) => [...managers.rows.values()].filter((r) => r.userId === userId && r.revokedAt === null).map((r) => r.schoolId);
  let passwords = 0;
  const generateApplicantPassword = () => `Gen${String(++passwords).padStart(4, '0')}Pass9`;
  const service = new SchoolService({
    repository: schools,
    managers,
    codes,
    unitOfWork,
    outbox: h.outbox,
    organizations,
    address,
    identity: h.identity,
    roles: h.roles,
    generateApplicantPassword,
    clock: h.clock,
  });
  const registration = new OrganizationRegistrationService({
    organizations,
    address,
    identity: h.identity,
    roles: h.roles,
    unitOfWork,
    generateApplicantPassword,
    clock: h.clock,
  });

  const silent: Logger = { error: () => undefined, warn: () => undefined, info: () => undefined, debug: () => undefined, child: () => silent };
  const permissions = new PermissionRegistry();
  const policies = new AuthorizationPolicyRegistry(permissions);
  const resolvers = new AuthorizationResolvers();
  registerOrganizationAuthorization({ policies, resolvers, organizations });
  registerSchoolAuthorization({ policies, resolvers, schools: service, organizations });
  const engine = new AuthorizationService({ identity: h.identity, roles: h.roles, permissions, policies, resolvers, logger: silent });
  const requirePermission = createRequirePermission(() => engine);

  const org = await organizations.createOrganization({ name: 'Al-Noor', countryId: country.id, governorateId: gov.id });
  /** A user (with credentials) holding ORGANIZATION_MANAGER AND linked as manager of `organizationId`. */
  const newOrgAdmin = async (organizationId: string) => {
    const user = await h.createUser({ role: 'ORGANIZATION_MANAGER' });
    await organizations.assignOrganizationAdmin({ organizationId, userId: user.id, assignedBy: null });
    return user;
  };
  return { h, service, registration, organizations, schools, managers, engine, requirePermission, country, france, gov, paris, center, org, newOrgAdmin };
}
