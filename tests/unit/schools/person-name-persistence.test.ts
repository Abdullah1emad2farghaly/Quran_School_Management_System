import { describe, expect, it } from 'vitest';
import { codeOf, createSchoolsHarness, gps } from '../../helpers/schools-harness';

type Harness = Awaited<ReturnType<typeof createSchoolsHarness>>;
const NAME = 'أحمد محمد علي';
const orgForm = (t: Harness, over: { phone?: string; applicantName?: unknown; orgName?: string } = {}) => ({
  applicant: { name: 'applicantName' in over ? over.applicantName : NAME, phone: over.phone ?? '01012345678', password: 'Pass1234' },
  organization: { name: over.orgName ?? 'دار القرآن', countryId: t.country.id, governorateId: t.gov.id },
});

describe('the personal name must be EXACTLY three parts (organization creator, school applicant)', () => {
  const invalid = ['أحمد محمد', 'أحمد', 'أحمد محمد علي حسن', '   ', '', 'أحمد   محمد', undefined, 5];

  it('organization registration refuses anything else and creates nothing', async () => {
    const t = await createSchoolsHarness();
    const users = t.users.rows.size;
    for (const bad of invalid) {
      expect(await codeOf(t.registration.registerOrganization(orgForm(t, { applicantName: bad }))), String(bad)).toBe('INVALID_APPLICANT_NAME');
    }
    expect(t.users.rows.size).toBe(users);
    expect(await t.identity.findByPhone('01012345678')).toBeUndefined();
  });

  it('a public school submission refuses anything else and creates nothing', async () => {
    const t = await createSchoolsHarness();
    const users = t.users.rows.size;
    for (const bad of invalid) {
      const base = t.form();
      expect(await codeOf(t.service.submitSchool({ ...base, applicant: { ...base.applicant, name: bad as string } })), String(bad)).toBe('INVALID_APPLICANT_NAME');
    }
    expect(t.users.rows.size).toBe(users);
    expect(t.schools.rows.size).toBe(0);
  });

  it('normalizes whitespace consistently (tabs, newlines, repeated spaces) before counting the parts', async () => {
    const t = await createSchoolsHarness();
    const result = await t.registration.registerOrganization(orgForm(t, { applicantName: '  أحمد \t محمد\n  علي  ' }));
    expect((await t.identity.findById(result.applicant.userId))!.fullName).toBe(NAME);
  });
});

describe('the personal name is stored on the ACCOUNT (users.full_name), not only on the request', () => {
  it('organization creator: the new account carries the name, and the organization name is a different thing', async () => {
    const t = await createSchoolsHarness();
    const result = await t.registration.registerOrganization(orgForm(t, { orgName: 'دار الهدى للقرآن' }));
    const user = (await t.identity.findById(result.applicant.userId))!;
    expect(user.fullName).toBe(NAME);
    expect(result.organization.name).toBe('دار الهدى للقرآن');
    expect(user.fullName).not.toBe(result.organization.name);
  });

  it('school applicant who becomes the School Manager: the same account keeps the name after approval', async () => {
    const t = await createSchoolsHarness();
    const { school, applicant } = await t.service.submitSchool(t.form({ name: '  أحمد   محمد  علي ', schoolName: 'مدرسة الأمل' }));
    expect(school.name).toBe('مدرسة الأمل');
    expect((await t.identity.findById(applicant.userId))!.fullName).toBe(NAME);
    await t.service.approveSchool(school.id, t.admin.id);
    expect(await t.service.isSchoolManager(applicant.userId, school.id)).toBe(true);
    expect((await t.identity.findById(applicant.userId))!.fullName).toBe(NAME);
  });

  it('a logged-in applicant whose account has no name yet gets it; the same name again is a no-op', async () => {
    const t = await createSchoolsHarness();
    const user = await t.newUser();
    expect((await t.identity.findById(user.id))!.fullName).toBeNull();
    const phone = (await t.identity.findById(user.id))!.phone;
    const submit = (name: string, schoolName: string) =>
      t.service.submitSchool({ applicant: { name, phone }, organizationId: t.org.id, name: schoolName, governorateId: t.gov.id, gps, authenticatedUserId: user.id });
    await submit(NAME, 'مدرسة أ');
    expect((await t.identity.findById(user.id))!.fullName).toBe(NAME);
    await submit(' أحمد  محمد علي ', 'مدرسة ب');
    expect((await t.identity.findById(user.id))!.fullName).toBe(NAME);
  });

  it('a logged-in applicant who submits a DIFFERENT name never overwrites the stored one (PERSON_NAME_MISMATCH, nothing created)', async () => {
    const t = await createSchoolsHarness();
    const result = await t.registration.registerOrganization(orgForm(t));
    const userId = result.applicant.userId;
    const schools = t.schools.rows.size;
    const attempt = t.service.submitSchool({
      applicant: { name: 'محمود خالد سعيد', phone: '01012345678' },
      organizationId: result.organization.id,
      name: 'مدرسة ج',
      governorateId: t.gov.id,
      gps,
      authenticatedUserId: userId,
    });
    expect(await codeOf(attempt)).toBe('PERSON_NAME_MISMATCH');
    expect((await t.identity.findById(userId))!.fullName).toBe(NAME);
    expect(t.schools.rows.size).toBe(schools);
  });

  it('Arabic letters are never folded when the stored name is compared (أحمد is not احمد)', async () => {
    const t = await createSchoolsHarness();
    const result = await t.registration.registerOrganization(orgForm(t));
    const attempt = t.service.submitSchool({
      applicant: { name: 'احمد محمد علي', phone: '01012345678' },
      organizationId: result.organization.id,
      name: 'مدرسة د',
      governorateId: t.gov.id,
      gps,
      authenticatedUserId: result.applicant.userId,
    });
    expect(await codeOf(attempt)).toBe('PERSON_NAME_MISMATCH');
  });
});

describe('ORGANIZATION_MANAGER and SCHOOL_MANAGER on ONE account (approved case)', () => {
  it('reuses the account, phone and password; scopes the school role to the school; changes no security state', async () => {
    const t = await createSchoolsHarness();
    const registered = await t.registration.registerOrganization(orgForm(t));
    const userId = registered.applicant.userId;
    const orgId = registered.organization.id;
    const accounts = t.users.rows.size;

    // the organization manager creates two schools of their own organization; they apply to manage only the first
    const submitted = await t.service.submitSchool({ applicant: { name: NAME, phone: '01012345678' }, organizationId: orgId, name: 'المدرسة الأولى', governorateId: t.gov.id, gps, authenticatedUserId: userId });
    const second = await t.service.createSchool({ organizationId: orgId, name: 'المدرسة الثانية', governorateId: t.gov.id, gps, actorId: userId });
    await t.service.approveSchool(second.id, userId);
    await t.service.approveSchool(submitted.school.id, userId);

    expect(t.users.rows.size).toBe(accounts); // no duplicate account
    expect((await t.activeRoles(userId)).sort()).toEqual(['ORGANIZATION_MANAGER', 'SCHOOL_MANAGER']);
    const user = (await t.identity.findById(userId))!;
    expect(user.phone).toBe('+201012345678');
    expect(user.mustChangePassword).toBe(false);
    expect(await t.identity.verifyPassword(userId, 'Pass1234')).toBe(true); // the existing password is untouched
    expect(user.fullName).toBe(NAME);

    expect(await t.organizations.isOrganizationAdmin(userId, orgId)).toBe(true);
    expect(await t.service.isSchoolManager(userId, submitted.school.id)).toBe(true);
    expect(await t.service.isSchoolManager(userId, second.id)).toBe(false); // organization-wide role does not make them School Manager of every school
  });
});
