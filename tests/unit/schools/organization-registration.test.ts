import { describe, expect, it } from 'vitest';
import { codeOf, createSchoolsHarness, gps } from '../../helpers/schools-harness';

type Harness = Awaited<ReturnType<typeof createSchoolsHarness>>;
const form = (t: Harness, over: { phone?: string; name?: string; applicantName?: string; organization?: object } = {}) => ({
  applicant: { name: over.applicantName ?? 'أحمد محمد', phone: over.phone ?? '01012345678' },
  organization: { name: over.name ?? 'دار القرآن', countryId: t.country.id, governorateId: t.gov.id, ...over.organization },
});

describe('organization registration (own workflow, independent of schools)', () => {
  it('creates the account, the organization and the organization-scoped MAIN_ADMIN in one step', async () => {
    const t = await createSchoolsHarness();
    const usersBefore = t.users.rows.size;
    const result = await t.registration.registerOrganization(form(t, { organization: { centerId: t.center.id, villageId: t.village.id } }));

    expect(result.applicant.accountCreated).toBe(true);
    expect(t.users.rows.size).toBe(usersBefore + 1);
    expect(result.organization).toMatchObject({ name: 'دار القرآن', status: 'ACTIVE', countryId: t.country.id, governorateId: t.gov.id, centerId: t.center.id, villageId: t.village.id });
    const user = (await t.identity.findByPhone('+201012345678'))!;
    expect(user.id).toBe(result.applicant.userId);
    expect(await t.activeRoles(user.id)).toEqual(['MAIN_ADMIN']);
    expect(await t.organizations.isOrganizationAdmin(user.id, result.organization.id)).toBe(true);
    expect(await t.organizations.isOrganizationAdmin(user.id, t.org.id)).toBe(false); // scoped to THIS organization only
    expect(t.schools.rows.size).toBe(0); // no placeholder school
    expect(t.events()).toEqual(expect.arrayContaining(['UserCreated', 'OrganizationCreated', 'OrganizationAdminAssigned', 'RoleAssigned']));
    const link = [...t.adminRepo.rows.values()].find((r) => r.userId === user.id)!;
    expect(link).toMatchObject({ organizationId: result.organization.id, name: 'أحمد محمد', assignedBy: null, revokedAt: null });
  });

  it('the new account cannot log in with the phone or the phone-derived password; only OTP recovery can set one', async () => {
    const t = await createSchoolsHarness();
    const { applicant } = await t.registration.registerOrganization(form(t));
    for (const guess of ['5678', '01012345678', '+201012345678']) expect(await t.identity.verifyPassword(applicant.userId, guess)).toBe(false);
    expect(JSON.stringify(applicant)).not.toContain(t.generated[0]!);
  });

  it('requires applicant, name, country and governorate; nothing is created when the form is wrong', async () => {
    const t = await createSchoolsHarness();
    const usersBefore = t.users.rows.size;
    const orgsBefore = t.orgRepo.rows.size;
    const bad = async (input: object, code: string) => {
      expect(await codeOf(t.registration.registerOrganization({ ...form(t), ...input } as never))).toBe(code);
      expect(t.users.rows.size).toBe(usersBefore);
      expect(t.orgRepo.rows.size).toBe(orgsBefore);
    };
    await bad({ applicant: { name: '  ', phone: '01012345678' } }, 'INVALID_APPLICANT_NAME');
    await bad({ applicant: { name: 'أحمد', phone: 'abc' } }, 'INVALID_PHONE_NUMBER');
    await bad({ organization: { ...form(t).organization, name: '' } }, 'INVALID_ORGANIZATION_NAME');
    await bad({ organization: { ...form(t).organization, name: undefined } }, 'INVALID_ORGANIZATION_NAME');
    await bad({ organization: { ...form(t).organization, countryId: undefined } }, 'INVALID_PARENT_ADDRESS');
    await bad({ organization: { ...form(t).organization, governorateId: undefined } }, 'INVALID_PARENT_ADDRESS');
    await bad({ organization: undefined }, 'INVALID_ORGANIZATION_NAME');
  });

  it('validates the geographic relationships on the server', async () => {
    const t = await createSchoolsHarness();
    const bad = async (organization: object, code: string) => expect(await codeOf(t.registration.registerOrganization(form(t, { organization })))).toBe(code);
    await bad({ countryId: t.france.id }, 'ORGANIZATION_ADDRESS_COUNTRY_MISMATCH'); // governorate of Egypt, country France
    await bad({ governorateId: t.paris.id }, 'ORGANIZATION_ADDRESS_COUNTRY_MISMATCH'); // governorate of France, country Egypt
    await bad({ villageId: t.village.id }, 'INVALID_GEOGRAPHY_HIERARCHY'); // village without a center
    await bad({ governorateId: t.gov2.id, centerId: t.center.id }, 'INVALID_GEOGRAPHY_HIERARCHY'); // center of another governorate
    await bad({ governorateId: 'missing' }, 'GEOGRAPHY_NODE_NOT_FOUND');
    t.geoRepo.setStatus(t.gov.id, 'INACTIVE');
    await bad({}, 'GEOGRAPHY_NODE_INACTIVE');
    expect(t.users.rows.size).toBe(1); // only the harness administrator: every failed attempt rolled its account back
  });

  it('the organization name is unique system-wide; a duplicate rolls the new account back', async () => {
    const t = await createSchoolsHarness();
    await t.registration.registerOrganization(form(t, { phone: '01011111111', name: 'Dar Al-Quran' }));
    const usersBefore = t.users.rows.size;
    expect(await codeOf(t.registration.registerOrganization(form(t, { phone: '01022222222', name: 'dar   al-quran' })))).toBe('ORGANIZATION_NAME_ALREADY_EXISTS');
    expect(await t.identity.findByPhone('+201022222222')).toBeUndefined();
    expect(t.users.rows.size).toBe(usersBefore);
    expect(await codeOf(t.registration.registerOrganization(form(t, { phone: '01033333333', name: 'DAR AL-QURAN', organization: { countryId: t.france.id, governorateId: t.paris.id } })))).toBe('ORGANIZATION_NAME_ALREADY_EXISTS');
  });

  it('two concurrent registrations with the same name: exactly one wins and the loser leaves no account', async () => {
    const t = await createSchoolsHarness({ rollback: false });
    const results = await Promise.allSettled([
      t.registration.registerOrganization(form(t, { phone: '01044444441', name: 'Race' })),
      t.registration.registerOrganization(form(t, { phone: '01044444442', name: 'race' })),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect((rejected.reason as { code: string }).code).toBe('ORGANIZATION_NAME_ALREADY_EXISTS');
  });

  it('an existing phone is the IAM conflict: no account is reused or claimed, nothing is granted', async () => {
    const t = await createSchoolsHarness();
    const owner = await t.newUser('TEACHER');
    const orgsBefore = t.orgRepo.rows.size;
    expect(await codeOf(t.registration.registerOrganization(form(t, { phone: owner.phone })))).toBe('USER_PHONE_ALREADY_EXISTS');
    expect(t.orgRepo.rows.size).toBe(orgsBefore);
    expect(await t.activeRoles(owner.id)).toEqual(['TEACHER']);
    expect(await t.organizations.listAdministeredOrganizationIds(owner.id)).toEqual([]);
  });

  it('a logged-in user registers an organization as themselves (their own phone only) and keeps their other roles', async () => {
    const t = await createSchoolsHarness();
    const teacher = await t.newUser('TEACHER');
    const usersBefore = t.users.rows.size;
    const result = await t.registration.registerOrganization({ ...form(t, { phone: teacher.phone }), authenticatedUserId: teacher.id });
    expect(result.applicant).toEqual({ userId: teacher.id, accountCreated: false });
    expect(t.users.rows.size).toBe(usersBefore);
    expect((await t.activeRoles(teacher.id)).sort()).toEqual(['MAIN_ADMIN', 'TEACHER']);
    expect(await codeOf(t.registration.registerOrganization({ ...form(t, { phone: '01099999999', name: 'Other' }), authenticatedUserId: teacher.id }))).toBe('SCHOOL_APPLICANT_IDENTITY_MISMATCH');
  });

  it('is atomic: a failure while assigning the role rolls back the account, the organization and the link', async () => {
    const t = await createSchoolsHarness({ failRoleAssignment: true });
    const usersBefore = t.users.rows.size;
    const orgsBefore = t.orgRepo.rows.size;
    const linksBefore = t.adminRepo.rows.size;
    await expect(t.registration.registerOrganization(form(t))).rejects.toThrow('injected role failure');
    expect(await t.identity.findByPhone('+201012345678')).toBeUndefined();
    expect(t.users.rows.size).toBe(usersBefore);
    expect(t.orgRepo.rows.size).toBe(orgsBefore);
    expect(t.adminRepo.rows.size).toBe(linksBefore);
  });

  it('lists and reads only the organizations the caller administers; another organization answers not found', async () => {
    const t = await createSchoolsHarness();
    const a = await t.registration.registerOrganization(form(t, { phone: '01055555551', name: 'Org A' }));
    const b = await t.registration.registerOrganization(form(t, { phone: '01055555552', name: 'Org B' }));
    const adminA = a.applicant.userId;
    const page = await t.registration.listOrganizationsForActor(adminA, { page: 1, pageSize: 10 });
    expect(page.items.map((o) => o.id)).toEqual([a.organization.id]);
    expect((await t.registration.getOrganizationForActor(a.organization.id, adminA)).id).toBe(a.organization.id);
    expect(await codeOf(t.registration.getOrganizationForActor(b.organization.id, adminA))).toBe('ORGANIZATION_NOT_FOUND');
    const teacher = await t.newUser('TEACHER');
    expect((await t.registration.listOrganizationsForActor(teacher.id, { page: 1, pageSize: 10 })).total).toBe(0);
    // MAIN_ADMIN role without an organization link sees nothing
    const roleOnly = await t.newUser('MAIN_ADMIN');
    expect((await t.registration.listOrganizationsForActor(roleOnly.id, { page: 1, pageSize: 10 })).total).toBe(0);
    expect(await codeOf(t.registration.getOrganizationForActor(a.organization.id, roleOnly.id))).toBe('ORGANIZATION_NOT_FOUND');
  });
});

describe('organization scope on schools: the role alone is never enough', () => {
  async function twoOrganizations() {
    const t = await createSchoolsHarness();
    const b = await t.registration.registerOrganization(form(t, { phone: '01066666661', name: 'Org B' }));
    const mainB = await t.service.createMainSchool({ organizationId: b.organization.id, name: 'مدرسة ب', governorateId: t.gov.id, gps, actorId: b.applicant.userId });
    const mainA = await t.main('مدرسة أ');
    return { t, orgBId: b.organization.id, adminB: b.applicant.userId, mainA, mainB };
  }

  it('an administrator of one organization cannot create, approve, change or read schools of another', async () => {
    const { t, orgBId, adminB, mainA, mainB } = await twoOrganizations();
    const pendingA = await t.service.submitSubSchool(t.form({ parentSchoolId: mainA.id, phone: '01077777771', schoolName: 'فرع أ' }));
    // admin of A (t.admin) against organization B
    expect(await codeOf(t.service.createMainSchool({ organizationId: orgBId, name: 'x', ...t.address, gps, actorId: t.admin.id }))).toBe('SCHOOL_ACTION_NOT_ALLOWED');
    expect(await codeOf(t.service.deactivateSchool(mainB.id, t.admin.id))).toBe('SCHOOL_ACTION_NOT_ALLOWED');
    expect(await codeOf(t.service.getSchoolForActor(mainB.id, t.admin.id))).toBe('SCHOOL_NOT_FOUND');
    // admin of B against organization A
    expect(await codeOf(t.service.approveSubSchool(pendingA.school.id, adminB))).toBe('SCHOOL_ACTION_NOT_ALLOWED');
    expect(await codeOf(t.service.rejectSubSchool(pendingA.school.id, adminB, 'no'))).toBe('SCHOOL_ACTION_NOT_ALLOWED');
    expect(await codeOf(t.service.correctPendingGps(pendingA.school.id, gps, adminB))).toBe('SCHOOL_ACTION_NOT_ALLOWED');
    expect(await codeOf(t.service.assignSchoolManager({ schoolId: mainA.id, userId: adminB, actorId: adminB }))).toBe('SCHOOL_ACTION_NOT_ALLOWED');
    expect((await t.service.getById(pendingA.school.id)).status).toBe('PENDING');
    // each sees only their own organization's schools
    expect((await t.service.listSchools({ actorId: t.admin.id, page: { page: 1, pageSize: 20 } })).items.map((s) => s.id).sort()).toEqual([mainA.id, pendingA.school.id].sort());
    expect((await t.service.listSchools({ actorId: adminB, page: { page: 1, pageSize: 20 } })).items.map((s) => s.id)).toEqual([mainB.id]);
    // and each can still act inside their own organization
    expect((await t.service.approveSubSchool(pendingA.school.id, t.admin.id)).school.status).toBe('ACTIVE');
  });

  it('a user with the MAIN_ADMIN role but no organization link has no school access at all', async () => {
    const { t, mainA } = await twoOrganizations();
    const roleOnly = await t.newUser('MAIN_ADMIN');
    expect(await codeOf(t.service.createMainSchool({ organizationId: t.org.id, name: 'x', ...t.address, gps, actorId: roleOnly.id }))).toBe('SCHOOL_ACTION_NOT_ALLOWED');
    expect(await codeOf(t.service.deactivateSchool(mainA.id, roleOnly.id))).toBe('SCHOOL_ACTION_NOT_ALLOWED');
    expect((await t.service.listSchools({ actorId: roleOnly.id, page: { page: 1, pageSize: 20 } })).total).toBe(0);
    expect(await codeOf(t.service.getSchoolForActor(mainA.id, roleOnly.id))).toBe('SCHOOL_NOT_FOUND');
  });

  it('an organization link without the MAIN_ADMIN role grants nothing', async () => {
    const t = await createSchoolsHarness();
    const linkOnly = await t.newUser('TEACHER');
    await t.organizations.assignOrganizationAdmin({ organizationId: t.org.id, userId: linkOnly.id, assignedBy: null });
    expect(await codeOf(t.service.createMainSchool({ organizationId: t.org.id, name: 'x', ...t.address, gps, actorId: linkOnly.id }))).toBe('SCHOOL_ACTION_NOT_ALLOWED');
  });
});

describe('school country invariant and the school keeps its own address', () => {
  it('a school cannot be created under an organization that does not exist or has no country', async () => {
    const t = await createSchoolsHarness();
    expect(await codeOf(t.service.createMainSchool({ organizationId: '33333333-3333-4333-8333-333333333333', name: 'x', ...t.address, gps, actorId: t.admin.id }))).toBe('SCHOOL_ACTION_NOT_ALLOWED');
    // an organization without a country (legacy) cannot own schools
    const legacy = (await t.organizations.ensureMainOrganization('unused')).organization; // returns the existing first organization
    expect(legacy.countryId).not.toBeNull();
    const row = t.orgRepo.rows.get(t.org.id)!;
    t.orgRepo.rows.set(t.org.id, { ...row, countryId: null });
    expect(await codeOf(t.main('no country'))).toBe('ORGANIZATION_COUNTRY_NOT_SET');
  });

  it('the school country is derived from the organization: a governorate of another country is refused', async () => {
    const t = await createSchoolsHarness();
    expect(await codeOf(t.service.createMainSchool({ organizationId: t.org.id, name: 'x', governorateId: t.paris.id, gps, actorId: t.admin.id }))).toBe('SCHOOL_COUNTRY_MISMATCH');
    const parent = await t.main();
    expect(await codeOf(t.service.submitSubSchool({ ...t.form({ parentSchoolId: parent.id }), governorateId: t.paris.id }))).toBe('SCHOOL_COUNTRY_MISMATCH');
    expect(t.schools.rows.size).toBe(1);
  });

  it('a client-supplied country can never override the organization country', async () => {
    const t = await createSchoolsHarness();
    expect(await codeOf(t.service.createMainSchool({ organizationId: t.org.id, name: 'x', ...t.address, countryId: t.france.id, gps, actorId: t.admin.id }))).toBe('SCHOOL_COUNTRY_MISMATCH');
    const ok = await t.service.createMainSchool({ organizationId: t.org.id, name: 'y', ...t.address, countryId: t.country.id, gps, actorId: t.admin.id });
    expect(ok.countryId).toBe(t.country.id);
    const parent = await t.main('z');
    expect(await codeOf(t.service.submitSubSchool({ ...t.form({ parentSchoolId: parent.id }), countryId: t.france.id }))).toBe('SCHOOL_COUNTRY_MISMATCH');
  });

  it('a French organization can have French schools but not Egyptian ones; each organization chooses its own country', async () => {
    const t = await createSchoolsHarness();
    const fr = await t.registration.registerOrganization({
      applicant: { name: 'Jean', phone: '01088888881' },
      organization: { name: 'Org FR', countryId: t.france.id, governorateId: t.paris.id },
    });
    const adminFr = fr.applicant.userId;
    const school = await t.service.createMainSchool({ organizationId: fr.organization.id, name: 'École', governorateId: t.paris.id, gps, actorId: adminFr });
    expect(school.countryId).toBe(t.france.id);
    expect(await codeOf(t.service.createMainSchool({ organizationId: fr.organization.id, name: 'Autre', governorateId: t.gov.id, gps, actorId: adminFr }))).toBe('SCHOOL_COUNTRY_MISMATCH');
  });

  it("schools of one organization keep their OWN addresses (different governorates, centers and villages in the same country)", async () => {
    const t = await createSchoolsHarness();
    const a = await t.service.createMainSchool({ organizationId: t.org.id, name: 'أ', governorateId: t.gov.id, centerId: t.center.id, villageId: t.village.id, gps, actorId: t.admin.id });
    const b = await t.service.createMainSchool({ organizationId: t.org.id, name: 'ب', governorateId: t.gov2.id, gps, actorId: t.admin.id });
    expect([a.governorateId, a.centerId, a.villageId]).toEqual([t.gov.id, t.center.id, t.village.id]);
    expect([b.governorateId, b.centerId, b.villageId]).toEqual([t.gov2.id, null, null]);
    expect(a.countryId).toBe(b.countryId);
  });

  it('the organization country cannot be changed once schools exist (immutable; no update path)', async () => {
    const t = await createSchoolsHarness();
    await t.main();
    expect(await codeOf(t.organizations.assignMainOrganizationCountry(t.france.id))).toBe('ORGANIZATION_COUNTRY_ALREADY_SET');
    expect((await t.service.getById((await t.schools.list({ page: { page: 1, pageSize: 1 }, sort: 'createdAt', direction: 'asc' })).items[0]!.id)).countryId).toBe(t.country.id);
  });

  it('the Sub-School of a Main School inherits that organization and country, and approval/manager flows still work', async () => {
    const t = await createSchoolsHarness();
    const parent = await t.main();
    const { school, applicant } = await t.service.submitSubSchool(t.form({ parentSchoolId: parent.id }));
    expect(school).toMatchObject({ organizationId: t.org.id, countryId: t.country.id, status: 'PENDING' });
    const approved = await t.service.approveSubSchool(school.id, t.admin.id);
    expect(approved.manager.userId).toBe(applicant.userId);
    expect(await t.activeRoles(applicant.userId)).toEqual(['SCHOOL_MANAGER']);
  });
});
