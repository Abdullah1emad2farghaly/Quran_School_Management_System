import type { TransactionContext } from '../../src/modules/00-shared-kernel/public';
import { InMemoryOrganizationAdminRepository, InMemoryOrganizationRepository, OrganizationService } from '../../src/modules/13-organization-core/public';
import { GeographyNode, GeographyService, InMemoryGeographyRepository } from '../../src/modules/14-geography/public';
import { UnifiedAddressService } from '../../src/modules/15-unified-address/public';
import { InMemorySchoolCodeSequence, InMemorySchoolManagerRepository, InMemorySchoolRepository, OrganizationRegistrationService, SchoolService } from '../../src/modules/16-schools/public';
import { createSessionHarness } from './session-harness';

const tx = {} as TransactionContext;

/** In-memory wiring of Modules 08-10 (real sessions and tokens) plus 13, 14, 15 and 16, for HTTP tests. */
export async function createSchoolsApiHarness() {
  const h = createSessionHarness();
  const organizations = new OrganizationService({
    repository: new InMemoryOrganizationRepository(),
    admins: new InMemoryOrganizationAdminRepository(),
    unitOfWork: h.unitOfWork,
    outbox: h.outbox,
    clock: h.clock,
  });

  const geoRepo = new InMemoryGeographyRepository();
  const geography = new GeographyService(geoRepo);
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

  const schools = new InMemorySchoolRepository();
  const managers = new InMemorySchoolManagerRepository();
  schools.managedSchoolIds = (userId) => [...managers.rows.values()].filter((r) => r.userId === userId && r.revokedAt === null).map((r) => r.schoolId);
  let passwords = 0;
  const generateApplicantPassword = () => `Gen${String(++passwords).padStart(4, '0')}Pass9`;
  const service = new SchoolService({
    repository: schools,
    managers,
    codes: new InMemorySchoolCodeSequence(),
    unitOfWork: h.unitOfWork,
    outbox: h.outbox,
    organizations,
    geography,
    identity: h.identity,
    roles: h.roles,
    generateApplicantPassword,
    clock: h.clock,
  });
  const registration = new OrganizationRegistrationService({
    organizations,
    address: new UnifiedAddressService({ geography, organizations }),
    identity: h.identity,
    roles: h.roles,
    unitOfWork: h.unitOfWork,
    generateApplicantPassword,
    clock: h.clock,
  });

  const org = await organizations.createOrganization({ name: 'Al-Noor', countryId: country.id, governorateId: gov.id });
  /** A user (with credentials) holding MAIN_ADMIN AND linked as administrator of `organizationId`. */
  const newOrgAdmin = async (organizationId: string) => {
    const user = await h.createUser({ role: 'MAIN_ADMIN' });
    await organizations.assignOrganizationAdmin({ organizationId, userId: user.id, assignedBy: null });
    return user;
  };
  return { h, service, registration, organizations, schools, managers, country, france, gov, paris, center, org, newOrgAdmin };
}
