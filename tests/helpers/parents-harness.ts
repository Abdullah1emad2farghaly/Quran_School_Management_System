import {
  InMemoryParentRepository,
  InMemoryParentSchoolLinkRepository,
  ParentService,
  registerParentAuthorization,
} from '../../src/modules/17-parents/public';
import { createSchoolsApiHarness } from './schools-api-harness';

const gps = { latitude: 30.0444, longitude: 31.2357, accuracyMeters: 12 };

/**
 * In-memory wiring of Modules 08-10, 12, 13-16 (the schools API harness, with the REAL Authorization Engine and real sessions) plus
 * Module 17. Its unit of work rolls the Parent stores back together with everything else when the work throws.
 * Existing accounts are matched by the canonical name stored on the account (`users.full_name`), exactly as in production.
 */
export async function createParentsHarness() {
  const parentRepo = new InMemoryParentRepository();
  const links = new InMemoryParentSchoolLinkRepository();
  parentRepo.activeParentIdsOfSchool = (schoolId) => links.activeParentIdsOfSchool(schoolId);
  const t = await createSchoolsApiHarness({ extraStores: [parentRepo, links] });

  /** Students depending on a Parent-to-School link, by `${parentId}:${schoolId}` (what Module 19 will report). */
  const studentCounts = new Map<string, number>();
  const parents = new ParentService({
    parents: parentRepo,
    links,
    schools: t.service,
    address: t.address,
    identity: t.h.identity,
    roles: t.h.roles,
    studentDependencies: { countStudentsOfParentInSchool: async (parentId, schoolId) => studentCounts.get(`${parentId}:${schoolId}`) ?? 0 },
    unitOfWork: t.unitOfWork,
    outbox: t.h.outbox,
    clock: t.h.clock,
  });
  registerParentAuthorization({ policies: t.policies, resolvers: t.resolvers, parents, schools: t.service });

  const orgAdmin = await t.newOrgAdmin(t.org.id);
  /** An ACTIVE school of `organizationId` (default: the harness organization). */
  const newSchool = async (name = 'مدرسة النور', organizationId = t.org.id) => {
    const actor = organizationId === t.org.id ? orgAdmin : await t.newOrgAdmin(organizationId);
    const created = await t.service.createSchool({ actorId: actor.id, organizationId, name, governorateId: t.gov.id, gps });
    await t.service.approveSchool(created.id, actor.id);
    return t.service.getById(created.id);
  };
  /** A user holding SCHOOL_MANAGER and an active manager link to `schoolId`. */
  const newSchoolManager = async (schoolId: string, organizationId = t.org.id) => {
    const actor = organizationId === t.org.id ? orgAdmin : await t.newOrgAdmin(organizationId);
    const user = await t.h.createUser({ role: 'SCHOOL_MANAGER' });
    await t.service.assignSchoolManager({ schoolId, userId: user.id, actorId: actor.id });
    return user;
  };
  /** A second organization (same country) with its own manager, for cross-organization tests. */
  const otherOrg = async (name = 'مؤسسة أخرى') => t.organizations.createOrganization({ name, countryId: t.country.id, governorateId: t.gov.id });

  /** An account with a canonical personal name and the given role (the name lives on the account, Module 08). */
  const newNamedUser = async (role: string, fullName: string, password?: string) =>
    t.h.createUser({ role: role as never, fullName, ...(password ? { password } : {}) });

  return { ...t, parentRepo, links, parents, studentCounts, newNamedUser, orgAdmin, newSchool, newSchoolManager, otherOrg };
}
