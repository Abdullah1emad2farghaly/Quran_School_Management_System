import { AppError, type TransactionContext, type UnitOfWork } from '../../src/modules/00-shared-kernel/public';
import { InMemoryOutboxStore, OutboxService } from '../../src/modules/06-domain-events-outbox/public';
import { BcryptPasswordHasher, IdentityService, InMemoryUserRepository } from '../../src/modules/08-identity-core/public';
import { InMemoryRoleAssignmentRepository, PermissionRegistry, RoleService } from '../../src/modules/09-roles-permissions/public';
import { InMemoryOrganizationAdminRepository, InMemoryOrganizationRepository, OrganizationService } from '../../src/modules/13-organization-core/public';
import { GeographyNode, GeographyService, InMemoryGeographyRepository } from '../../src/modules/14-geography/public';
import { UnifiedAddressService } from '../../src/modules/15-unified-address/public';
import {
  InMemorySchoolCodeSequence,
  InMemorySchoolManagerRepository,
  InMemorySchoolRepository,
  OrganizationRegistrationService,
  SchoolService,
} from '../../src/modules/16-schools/public';

const tx = {} as TransactionContext;
export const gps = { latitude: 30.0444, longitude: 31.2357, accuracyMeters: 12 };
export const codeOf = (p: Promise<unknown>) => p.then(() => 'NO_ERROR', (e: unknown) => (e instanceof AppError ? e.code : `NOT_APP_ERROR:${String(e)}`));

/**
 * In-memory wiring of Modules 08, 09, 13, 14, 15 and 16 whose unit of work REALLY rolls back every store (users, roles,
 * organizations, administrator links, schools, managers, codes, outbox) when the work throws. Framework-free (no Express).
 * It has a default ORGANIZATION in Egypt with its own administrator (`admin`: MAIN_ADMIN role AND an organization link).
 */
export async function createSchoolsHarness(options: { failRoleAssignment?: boolean; rollback?: boolean } = {}) {
  let now = new Date('2026-10-14T10:00:00Z');
  const clock = { now: () => new Date((now = new Date(now.getTime() + 1000))) };
  const store = new InMemoryOutboxStore();
  const outbox = new OutboxService(store, clock);
  const users = new InMemoryUserRepository();
  const schools = new InMemorySchoolRepository();
  const managers = new InMemorySchoolManagerRepository();
  const codes = new InMemorySchoolCodeSequence();
  const roleRepo = new InMemoryRoleAssignmentRepository();
  const orgRepo = new InMemoryOrganizationRepository();
  const adminRepo = new InMemoryOrganizationAdminRepository();
  schools.managedSchoolIds = (userId) => [...managers.rows.values()].filter((r) => r.userId === userId && r.revokedAt === null).map((r) => r.schoolId);

  const unitOfWork: UnitOfWork = {
    run: async (work) => {
      const saved = {
        u: [...users.rows], s: schools.snapshot(), m: managers.snapshot(), c: codes.last, r: [...roleRepo.rows], o: [...store.messages],
        g: [...orgRepo.rows], a: [...adminRepo.rows],
      };
      try {
        return await work(tx);
      } catch (error) {
        if (options.rollback === false) throw error;
        users.rows.clear();
        saved.u.forEach(([k, v]) => users.rows.set(k, v));
        schools.restore(saved.s);
        managers.restore(saved.m);
        codes.last = saved.c;
        roleRepo.rows.clear();
        saved.r.forEach(([k, v]) => roleRepo.rows.set(k, v));
        orgRepo.rows.clear();
        saved.g.forEach(([k, v]) => orgRepo.rows.set(k, v));
        adminRepo.rows.clear();
        saved.a.forEach(([k, v]) => adminRepo.rows.set(k, v));
        store.messages.splice(0, store.messages.length, ...saved.o);
        throw error;
      }
    },
  };

  const identity = new IdentityService({ repository: users, hasher: new BcryptPasswordHasher(4), unitOfWork, outbox, clock });
  const roleService = new RoleService({ repository: roleRepo, identity, permissions: new PermissionRegistry(), unitOfWork, outbox, clock });
  const organizations = new OrganizationService({ repository: orgRepo, admins: adminRepo, unitOfWork, outbox, clock });

  const geoRepo = new InMemoryGeographyRepository();
  const geography = new GeographyService(geoRepo);
  let n = 0;
  const add = async (level: 'COUNTRY' | 'GOVERNORATE' | 'CENTER' | 'VILLAGE', name: string, parentId: string | null) => {
    const prefix = { COUNTRY: 'CNT', GOVERNORATE: 'GOV', CENTER: 'CTR', VILLAGE: 'VIL' }[level];
    const node = GeographyNode.create({ level, name, parentId, kind: level === 'CENTER' ? 'CENTER' : undefined, code: `${prefix}-${String(700000 + ++n)}`, clock });
    await geoRepo.insert(node, tx);
    return node;
  };
  const country = await add('COUNTRY', 'مصر', null);
  const france = await add('COUNTRY', 'France', null);
  const gov = await add('GOVERNORATE', 'المنيا', country.id);
  const gov2 = await add('GOVERNORATE', 'أسيوط', country.id);
  const paris = await add('GOVERNORATE', 'Paris', france.id);
  const center = await add('CENTER', 'سمالوط', gov.id);
  const village = await add('VILLAGE', 'قرية النور', center.id);

  let passwords = 0;
  const generated: string[] = [];
  const generateApplicantPassword = () => {
    const password = `Ap${String(++passwords).padStart(4, '0')}xyzQ9`; // 12 characters, never the phone's last digits
    generated.push(password);
    return password;
  };
  const roles = options.failRoleAssignment
    ? { hasRole: roleService.hasRole.bind(roleService), assignRole: async () => Promise.reject(new Error('injected role failure')) }
    : roleService;
  const service = new SchoolService({
    repository: schools, managers, codes, unitOfWork, outbox, organizations, geography, identity, roles, generateApplicantPassword, clock,
  });
  const address = new UnifiedAddressService({ geography, organizations });
  const registration = new OrganizationRegistrationService({ organizations, address, identity, roles, unitOfWork, generateApplicantPassword, clock });

  let phone = 0;
  const newUser = async (role?: string) => {
    const user = await identity.createUser({ phone: `0101000${String(++phone).padStart(4, '0')}`, password: 'secret1' });
    if (role) await roleService.assignRole({ userId: user.id, roleCode: role, assignedBy: null });
    return user;
  };
  /** An organization (ACTIVE) in `countryId` with its own address, created directly (not through the public workflow). */
  const newOrganization = (name: string, countryId = country.id, governorateId = gov.id) => organizations.createOrganization({ name, countryId, governorateId });
  /** A user holding MAIN_ADMIN AND linked as administrator of `organizationId`. */
  const newOrgAdmin = async (organizationId: string) => {
    const user = await newUser('MAIN_ADMIN');
    await organizations.assignOrganizationAdmin({ organizationId, userId: user.id, assignedBy: null });
    return user;
  };
  const org = await newOrganization('Al-Noor');
  const admin = await newOrgAdmin(org.id);

  const addressInput = { governorateId: gov.id };
  const form = (over: { phone?: string; name?: string; schoolName?: string; parentSchoolId?: string } = {}) => ({
    applicant: { name: over.name ?? 'أحمد محمد', phone: over.phone ?? '01012345678' },
    parentSchoolId: over.parentSchoolId ?? '', // Sub-School submissions only
    name: over.schoolName ?? 'مدرسة النور',
    ...addressInput,
    gps,
  });
  const main = (name = 'المدرسة الرئيسية', organizationId = org.id, actorId = admin.id) =>
    service.createMainSchool({ organizationId, name, ...addressInput, gps, actorId });
  const request = (requesterUserId: string, parentSchoolId: string, name = 'فرع النور') =>
    service.requestSubSchool({ requesterUserId, parentSchoolId, name, ...addressInput, gps });
  const events = () => store.messages.map((m) => m.eventType);
  const activeRoles = async (userId: string) => roleService.listActiveRoles(userId);
  return {
    service, registration, schools, managers, codes, users, roleRepo, orgRepo, adminRepo, store, identity, roleService, organizations, geoRepo, geography,
    admin, org, newUser, newOrganization, newOrgAdmin, main, request, form, events, activeRoles, generated,
    country, france, gov, gov2, paris, center, village, address: addressInput,
  };
}
