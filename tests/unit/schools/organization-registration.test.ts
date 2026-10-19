import { describe, expect, it } from 'vitest';
import { codeOf, createSchoolsHarness, gps } from '../../helpers/schools-harness';

type Harness = Awaited<ReturnType<typeof createSchoolsHarness>>;
const form = (t: Harness, over: { phone?: string; name?: string; applicantName?: string; organization?: object } = {}) => ({
  applicant: { name: over.applicantName ?? 'أحمد محمد علي', phone: over.phone ?? '01012345678', password: 'Pass1234' },
  organization: { name: over.name ?? 'دار القرآن', countryId: t.country.id, governorateId: t.gov.id, ...over.organization },
});

describe('organization registration (own workflow, independent of schools)', () => {
  it('creates the account, the organization and the organization-scoped ORGANIZATION_MANAGER in one step (never MAIN_ADMIN)', async () => {
    const t = await createSchoolsHarness();
    const usersBefore = t.users.rows.size;
    const result = await t.registration.registerOrganization(form(t, { organization: { centerName: '  مركز   حر ', villageName: 'قرية حرة' } }));

    expect(result.applicant.accountCreated).toBe(true);
    expect(t.users.rows.size).toBe(usersBefore + 1);
    expect(result.organization).toMatchObject({ name: 'دار القرآن', status: 'ACTIVE', countryId: t.country.id, governorateId: t.gov.id, centerName: 'مركز حر', villageName: 'قرية حرة' });
    const user = (await t.identity.findByPhone('+201012345678'))!;
    expect(user.id).toBe(result.applicant.userId);
    expect(await t.activeRoles(user.id)).toEqual(['ORGANIZATION_MANAGER']);
    expect(await t.roleService.hasRole(user.id, 'MAIN_ADMIN')).toBe(false); // the platform administrator role is never granted by registration
    expect(await t.organizations.isOrganizationAdmin(user.id, result.organization.id)).toBe(true);
    expect(await t.organizations.isOrganizationAdmin(user.id, t.org.id)).toBe(false); // scoped to THIS organization only
    expect(t.schools.rows.size).toBe(0); // no placeholder school
    expect(t.events()).toEqual(expect.arrayContaining(['UserCreated', 'OrganizationCreated', 'OrganizationAdminAssigned', 'RoleAssigned']));
    const link = [...t.adminRepo.rows.values()].find((r) => r.userId === user.id)!;
    expect(link).toMatchObject({ organizationId: result.organization.id, name: 'أحمد محمد علي', assignedBy: null, revokedAt: null });
  });

  it('the new account is created with the password the applicant typed: they can log in with it, and it is never returned', async () => {
    const t = await createSchoolsHarness();
    const { applicant } = await t.registration.registerOrganization(form(t));
    expect(await t.identity.verifyPassword(applicant.userId, 'Pass1234')).toBe(true);
    expect(await t.identity.verifyPassword(applicant.userId, '5678')).toBe(false); // not the phone-derived password
    expect(JSON.stringify(applicant)).not.toContain('Pass1234');
    expect(t.generated).toHaveLength(0); // no password was generated
  });

  it('requires a valid password (4-12 characters) for a new account; nothing is created when it is missing or invalid', async () => {
    const t = await createSchoolsHarness();
    const usersBefore = t.users.rows.size;
    for (const password of [undefined, '', 'abc', 'x'.repeat(13), 12345678, null]) {
      const body = form(t);
      await expect(codeOf(t.registration.registerOrganization({ ...body, applicant: { ...body.applicant, password } as never }))).resolves.toBe('INVALID_PASSWORD');
    }
    expect(t.users.rows.size).toBe(usersBefore);
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
    await bad({ applicant: { name: 'أحمد محمد علي', phone: 'abc' } }, 'INVALID_PHONE_NUMBER');
    await bad({ organization: { ...form(t).organization, name: '' } }, 'INVALID_ORGANIZATION_NAME');
    await bad({ organization: { ...form(t).organization, name: undefined } }, 'INVALID_ORGANIZATION_NAME');
    await bad({ organization: { ...form(t).organization, countryId: undefined } }, 'INVALID_PARENT_ADDRESS');
    await bad({ organization: { ...form(t).organization, governorateId: undefined } }, 'INVALID_PARENT_ADDRESS');
    await bad({ organization: undefined }, 'INVALID_ORGANIZATION_NAME');
  });

  it('validates the geographic relationships on the server; center and village are free text and never looked up', async () => {
    const t = await createSchoolsHarness();
    const bad = async (organization: object, code: string) => expect(await codeOf(t.registration.registerOrganization(form(t, { organization })))).toBe(code);
    await bad({ countryId: t.france.id }, 'ORGANIZATION_ADDRESS_COUNTRY_MISMATCH'); // governorate of Egypt, country France
    await bad({ governorateId: t.paris.id }, 'ORGANIZATION_ADDRESS_COUNTRY_MISMATCH'); // governorate of France, country Egypt
    await bad({ villageName: 'قرية' }, 'INVALID_PARENT_ADDRESS'); // a village needs a center
    await bad({ centerName: 'x'.repeat(201) }, 'INVALID_PARENT_ADDRESS');
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
    expect((await t.activeRoles(teacher.id)).sort()).toEqual(['ORGANIZATION_MANAGER', 'TEACHER']);
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

  it('lists only the organizations the caller manages; a role without a link (or a link without the role) sees nothing', async () => {
    const t = await createSchoolsHarness();
    const a = await t.registration.registerOrganization(form(t, { phone: '01055555551', name: 'Org A' }));
    await t.registration.registerOrganization(form(t, { phone: '01055555552', name: 'Org B' }));
    const managerA = a.applicant.userId;
    const page = await t.registration.listOrganizationsForActor(managerA, { page: 1, pageSize: 10 });
    expect(page.items.map((o) => o.id)).toEqual([a.organization.id]);
    expect((await t.registration.getOrganization(a.organization.id)).id).toBe(a.organization.id);
    expect(await codeOf(t.registration.getOrganization('no-such-organization'))).toBe('ORGANIZATION_NOT_FOUND');
    const teacher = await t.newUser('TEACHER');
    expect((await t.registration.listOrganizationsForActor(teacher.id, { page: 1, pageSize: 10 })).total).toBe(0);
    const roleOnly = await t.newUser('ORGANIZATION_MANAGER'); // role without an organization link
    expect((await t.registration.listOrganizationsForActor(roleOnly.id, { page: 1, pageSize: 10 })).total).toBe(0);
    const platformAdmin = await t.newUser('MAIN_ADMIN'); // the platform administrator is NOT an organization manager
    expect((await t.registration.listOrganizationsForActor(platformAdmin.id, { page: 1, pageSize: 10 })).total).toBe(0);
  });
});

describe('school country invariant and the school keeps its own address', () => {
  it('a school cannot be created under an organization that does not exist or has no country', async () => {
    const t = await createSchoolsHarness();
    expect(await codeOf(t.service.createSchool({ organizationId: '33333333-3333-4333-8333-333333333333', name: 'x', ...t.address, gps, actorId: t.admin.id }))).toBe('ORGANIZATION_NOT_FOUND');
    const row = t.orgRepo.rows.get(t.org.id)!;
    t.orgRepo.rows.set(t.org.id, { ...row, countryId: null });
    expect(await codeOf(t.create('no country'))).toBe('ORGANIZATION_COUNTRY_NOT_SET');
  });

  it('the school country is derived from the organization: a governorate of another country is refused', async () => {
    const t = await createSchoolsHarness();
    expect(await codeOf(t.service.createSchool({ organizationId: t.org.id, name: 'x', governorateId: t.paris.id, gps, actorId: t.admin.id }))).toBe('PARENT_ADDRESS_COUNTRY_MISMATCH');
    expect(await codeOf(t.service.submitSchool({ ...t.form(), governorateId: t.paris.id }))).toBe('PARENT_ADDRESS_COUNTRY_MISMATCH');
    expect(t.schools.rows.size).toBe(0);
  });

  it('a client-supplied country can never override the organization country', async () => {
    const t = await createSchoolsHarness();
    expect(await codeOf(t.service.createSchool({ organizationId: t.org.id, name: 'x', ...t.address, countryId: t.france.id, gps, actorId: t.admin.id }))).toBe('SCHOOL_COUNTRY_MISMATCH');
    const ok = await t.service.createSchool({ organizationId: t.org.id, name: 'y', ...t.address, countryId: t.country.id, gps, actorId: t.admin.id });
    expect(ok.countryId).toBe(t.country.id);
    expect(await codeOf(t.service.submitSchool({ ...t.form(), countryId: t.france.id }))).toBe('SCHOOL_COUNTRY_MISMATCH');
  });

  it('a French organization can have French schools but not Egyptian ones; each organization chooses its own country', async () => {
    const t = await createSchoolsHarness();
    const fr = await t.registration.registerOrganization({
      applicant: { name: 'Jean Pierre Martin', phone: '01088888881', password: 'Pass1234' },
      organization: { name: 'Org FR', countryId: t.france.id, governorateId: t.paris.id },
    });
    const managerFr = fr.applicant.userId;
    const school = await t.service.createSchool({ organizationId: fr.organization.id, name: 'École', governorateId: t.paris.id, gps, actorId: managerFr });
    expect(school.countryId).toBe(t.france.id);
    expect(await codeOf(t.service.createSchool({ organizationId: fr.organization.id, name: 'Autre', governorateId: t.gov.id, gps, actorId: managerFr }))).toBe('PARENT_ADDRESS_COUNTRY_MISMATCH');
  });

  it('schools of one organization keep their OWN addresses (different governorates and free-text centers/villages in the same country)', async () => {
    const t = await createSchoolsHarness();
    const a = await t.service.createSchool({ organizationId: t.org.id, name: 'أ', governorateId: t.gov.id, centerName: 'مركز أ', villageName: 'قرية أ', gps, actorId: t.admin.id });
    const b = await t.service.createSchool({ organizationId: t.org.id, name: 'ب', governorateId: t.gov2.id, gps, actorId: t.admin.id });
    expect([a.governorateId, a.centerName, a.villageName]).toEqual([t.gov.id, 'مركز أ', 'قرية أ']);
    expect([b.governorateId, b.centerName, b.villageName]).toEqual([t.gov2.id, null, null]);
    expect(a.countryId).toBe(b.countryId);
  });

  it('the organization country cannot be changed once schools exist (immutable; no update path)', async () => {
    const t = await createSchoolsHarness();
    await t.create();
    expect(await codeOf(t.organizations.assignMainOrganizationCountry(t.france.id))).toBe('ORGANIZATION_COUNTRY_ALREADY_SET');
    expect((await t.service.getById((await t.schools.list({ organizationIds: [t.org.id], page: { page: 1, pageSize: 1 }, sort: 'createdAt', direction: 'asc' })).items[0]!.id)).countryId).toBe(t.country.id);
  });
});
