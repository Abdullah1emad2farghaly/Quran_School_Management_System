import { describe, expect, it } from 'vitest';
import { codeOf, createSchoolsHarness, gps } from '../../helpers/schools-harness';

type Harness = Awaited<ReturnType<typeof createSchoolsHarness>>;
const submit = (t: Harness, over: Parameters<Harness['form']>[0] = {}) => t.service.submitSchool(t.form(over));

describe('public school submission: the applicant account', () => {
  it('creates the applicant account and a PENDING school in one step, granting nothing', async () => {
    const t = await createSchoolsHarness();
    const usersBefore = t.users.rows.size;
    const result = await submit(t, { phone: '01012345678', name: '  أحمد   محمد   علي ' });

    expect(result.applicant.accountCreated).toBe(true);
    expect(t.users.rows.size).toBe(usersBefore + 1);
    const user = (await t.identity.findByPhone('+201012345678'))!; // normalized to E.164
    expect(user).toMatchObject({ id: result.applicant.userId, isActive: true });
    expect(result.school).toMatchObject({ status: 'PENDING', createdBy: user.id, applicantUserId: user.id, applicantName: 'أحمد محمد علي', decidedBy: null, organizationId: t.org.id, countryId: t.country.id });
    expect(result.school).not.toHaveProperty('type');
    expect(await t.activeRoles(user.id)).toEqual([]); // no role at all: not MAIN_ADMIN, not ORGANIZATION_MANAGER, not SCHOOL_MANAGER
    expect(await t.service.isSchoolManager(user.id, result.school.id)).toBe(false);
    expect(t.managers.rows.size).toBe(0);
    expect(t.events()).toEqual(expect.arrayContaining(['UserCreated', 'SchoolCreated']));
  });

  it('takes the free-text address like every other school', async () => {
    const t = await createSchoolsHarness();
    const result = await t.service.submitSchool({ ...t.form(), centerName: 'مركز غير مسجل', villageName: 'قرية غير مسجلة' });
    expect(result.school).toMatchObject({ centerName: 'مركز غير مسجل', villageName: 'قرية غير مسجلة' });
    expect(await codeOf(t.service.submitSchool({ ...t.form({ phone: '01055555555', schoolName: 'x' }), villageName: 'قرية' }))).toBe('INVALID_PARENT_ADDRESS');
  });

  it('the new account is created with the password the applicant typed: they can log in with it, the phone-derived password does not work, and it is never returned', async () => {
    const t = await createSchoolsHarness();
    const { applicant } = await submit(t, { phone: '01012345678' });
    expect(await t.identity.verifyPassword(applicant.userId, 'Pass1234')).toBe(true);
    for (const guess of ['5678', '01012345678', '+201012345678', 'secret1', '12345678']) expect(await t.identity.verifyPassword(applicant.userId, guess)).toBe(false);
    expect(JSON.stringify(applicant)).not.toContain('Pass1234');
    expect(t.generated).toHaveLength(0); // no password was generated
  });

  it('requires a valid password (4-12 characters) for a new account; nothing is created when it is missing or invalid', async () => {
    const t = await createSchoolsHarness();
    const schoolsBefore = t.schools.rows.size;
    const usersBefore = t.users.rows.size;
    for (const password of [undefined, '', 'abc', 'x'.repeat(13), 12345678, null]) {
      const body = t.form();
      expect(await codeOf(t.service.submitSchool({ ...body, applicant: { ...body.applicant, password } } as never))).toBe('INVALID_PASSWORD');
    }
    expect(t.schools.rows.size).toBe(schoolsBefore);
    expect(t.users.rows.size).toBe(usersBefore);
  });

  it('rejects an invalid form before writing anything (no user, no school, no code consumed)', async () => {
    const t = await createSchoolsHarness();
    const schoolsBefore = t.schools.rows.size;
    const codeBefore = t.codes.last;
    const usersBefore = t.users.rows.size;
    const bad = async (form: object, code: string) => {
      expect(await codeOf(t.service.submitSchool({ ...t.form(), ...form } as never))).toBe(code);
      expect(t.users.rows.size).toBe(usersBefore);
      expect(t.schools.rows.size).toBe(schoolsBefore);
      expect(t.codes.last).toBe(codeBefore);
    };
    await bad({ applicant: { name: '   ', phone: '01012345678' } }, 'INVALID_APPLICANT_NAME');
    await bad({ applicant: { name: 5, phone: '01012345678' } }, 'INVALID_APPLICANT_NAME');
    await bad({ applicant: undefined }, 'INVALID_APPLICANT_NAME');
    await bad({ applicant: { name: 'x'.repeat(201), phone: '01012345678' } }, 'INVALID_APPLICANT_NAME');
    await bad({ applicant: { name: 'أحمد محمد علي', phone: '12345' } }, 'INVALID_PHONE_NUMBER');
    await bad({ applicant: { name: 'أحمد محمد علي', phone: undefined } }, 'INVALID_PHONE_NUMBER');
    await bad({ name: '   ' }, 'INVALID_SCHOOL_NAME');
    await bad({ gps: { ...gps, accuracyMeters: 20.5 } }, 'GPS_ACCURACY_EXCEEDS_LIMIT');
    await bad({ gps: { ...gps, latitude: 120 } }, 'INVALID_GPS_COORDINATES');
  });

  it('normalizes every accepted Egyptian phone format to the same E.164 identity', async () => {
    const t = await createSchoolsHarness();
    await submit(t, { phone: '01012345678', schoolName: 'a' });
    expect(await codeOf(submit(t, { phone: '201012345678', schoolName: 'no plus' }))).toBe('INVALID_PHONE_NUMBER'); // IAM: digits without + / 00 / 010 prefix are rejected
    for (const same of ['+201012345678', '0020 101 234 5678', '010-1234-5678', '٠١٠١٢٣٤٥٦٧٨']) {
      const code = await codeOf(submit(t, { phone: same, schoolName: `b ${same}` }));
      expect([same, code]).toEqual([same, 'USER_PHONE_ALREADY_EXISTS']);
    }
    for (const prefix of ['011', '012', '015']) expect((await submit(t, { phone: `${prefix}12345678`, schoolName: prefix })).applicant.accountCreated).toBe(true);
  });

  it('an existing phone is the IAM conflict: no account is reused, merged or created, and no school is created', async () => {
    const t = await createSchoolsHarness();
    const existing = await t.newUser('TEACHER');
    const usersBefore = t.users.rows.size;
    const schoolsBefore = t.schools.rows.size;
    const rolesBefore = JSON.stringify([...t.roleRepo.rows]);
    expect(await codeOf(submit(t, { phone: existing.phone }))).toBe('USER_PHONE_ALREADY_EXISTS');
    expect(await codeOf(submit(t, { phone: existing.phone, name: 'someone else entirely' }))).toBe('USER_PHONE_ALREADY_EXISTS');
    expect(t.users.rows.size).toBe(usersBefore);
    expect(JSON.stringify([...t.roleRepo.rows])).toBe(rolesBefore);
    expect(t.schools.rows.size).toBe(schoolsBefore);
    expect(await t.activeRoles(existing.id)).toEqual(['TEACHER']); // nothing was given to the account owner
  });

  it('is atomic: if the school cannot be created, the account is rolled back too (and the code is not consumed)', async () => {
    const t = await createSchoolsHarness();
    await submit(t, { phone: '01011111111', schoolName: 'Al-Noor School' });
    const usersBefore = t.users.rows.size;
    const codeBefore = t.codes.last;
    expect(await codeOf(submit(t, { phone: '01022222222', schoolName: 'al-noor   SCHOOL' }))).toBe('SCHOOL_NAME_ALREADY_EXISTS');
    expect(await t.identity.findByPhone('+201022222222')).toBeUndefined();
    expect(t.users.rows.size).toBe(usersBefore);
    expect(t.codes.last).toBe(codeBefore);
    // an invalid address fails after the account was created inside the transaction: it is rolled back as well
    expect(await codeOf(t.service.submitSchool({ ...t.form({ phone: '01033333333', schoolName: 'other' }), governorateId: 'no-such-governorate' }))).toBe('PARENT_ADDRESS_GOVERNORATE_NOT_FOUND');
    expect(await t.identity.findByPhone('+201033333333')).toBeUndefined();
    expect(t.users.rows.size).toBe(usersBefore);
  });

  it('the organization is chosen by the applicant and must exist and be ACTIVE; the account is not kept otherwise', async () => {
    const t = await createSchoolsHarness();
    expect(await codeOf(t.service.submitSchool(t.form({ organizationId: 'no-such-org' })))).toBe('ORGANIZATION_NOT_FOUND');
    t.orgRepo.rows.set(t.org.id, { ...t.orgRepo.rows.get(t.org.id)!, status: 'INACTIVE' });
    expect(await codeOf(t.service.submitSchool(t.form()))).toBe('SCHOOL_ORGANIZATION_INACTIVE');
    expect(await t.identity.findByPhone('+201012345678')).toBeUndefined();
  });

  it('the school belongs to the CHOSEN organization; an Organization Manager of another organization is not involved', async () => {
    const t = await createSchoolsHarness();
    const other = await t.newOrganization('Other Org');
    const result = await submit(t, { organizationId: other.id });
    expect(result.school.organizationId).toBe(other.id);
    expect((await t.service.listSchools({ actorId: t.admin.id, page: { page: 1, pageSize: 10 } })).total).toBe(0); // not the default organization's manager's school
  });
});

describe('logged-in applicant (the session is the proof of identity)', () => {
  it('reuses the authenticated account when the submitted phone is its own: no new user, no role change', async () => {
    const t = await createSchoolsHarness();
    const teacher = await t.newUser('TEACHER');
    const usersBefore = t.users.rows.size;
    const result = await t.service.submitSchool({ ...t.form({ phone: teacher.phone }), authenticatedUserId: teacher.id });
    expect(result.applicant).toEqual({ userId: teacher.id, accountCreated: false });
    expect(result.school.createdBy).toBe(teacher.id);
    expect(t.users.rows.size).toBe(usersBefore);
    expect(await t.activeRoles(teacher.id)).toEqual(['TEACHER']);
    expect(t.generated).toHaveLength(0); // no password was generated
  });

  it('refuses a different phone, an inactive account and an unknown user', async () => {
    const t = await createSchoolsHarness();
    const user = await t.newUser();
    expect(await codeOf(t.service.submitSchool({ ...t.form({ phone: '01099999999' }), authenticatedUserId: user.id }))).toBe('SCHOOL_APPLICANT_IDENTITY_MISMATCH');
    await t.identity.deactivateUser(user.id);
    expect(await codeOf(t.service.submitSchool({ ...t.form({ phone: user.phone, schoolName: 'x' }), authenticatedUserId: user.id }))).toBe('SCHOOL_MANAGER_NOT_ELIGIBLE');
    expect(await codeOf(t.service.submitSchool({ ...t.form({ schoolName: 'y' }), authenticatedUserId: 'nobody' }))).toBe('SCHOOL_MANAGER_NOT_ELIGIBLE');
  });
});

describe('public submission and approval by the organization manager', () => {
  it('approval makes the submitted account the School Manager of that school only', async () => {
    const t = await createSchoolsHarness();
    const other = await t.active('other school');
    const { school, applicant } = await submit(t);
    const approved = await t.service.approveSchool(school.id, t.admin.id);
    expect(approved.school.status).toBe('ACTIVE');
    expect(approved.manager).toMatchObject({ userId: applicant.userId, schoolId: school.id, source: 'APPROVAL' });
    expect(await t.activeRoles(applicant.userId)).toEqual(['SCHOOL_MANAGER']);
    expect(await t.service.isSchoolManager(applicant.userId, other.id)).toBe(false);
  });

  it('an applicant who is no longer eligible cannot be approved; the request stays PENDING and can be rejected, keeping the account', async () => {
    const t = await createSchoolsHarness();
    const { school, applicant } = await submit(t);
    await t.identity.deactivateUser(applicant.userId);
    expect(await codeOf(t.service.approveSchool(school.id, t.admin.id))).toBe('SCHOOL_MANAGER_NOT_ELIGIBLE');
    expect((await t.service.getById(school.id)).status).toBe('PENDING');
    expect(t.managers.rows.size).toBe(0);
    expect(await t.activeRoles(applicant.userId)).toEqual([]);
    expect((await t.service.rejectSchool(school.id, t.admin.id, 'غير مؤهل')).status).toBe('REJECTED');
    expect(await t.identity.findById(applicant.userId)).toBeDefined();
  });

  it('a role-assignment failure rolls back the approval (the account created by the submission is untouched)', async () => {
    const t = await createSchoolsHarness({ failRoleAssignment: true });
    const { school, applicant } = await submit(t);
    await expect(t.service.approveSchool(school.id, t.admin.id)).rejects.toThrow('injected role failure');
    expect((await t.service.getById(school.id)).status).toBe('PENDING');
    expect(t.managers.rows.size).toBe(0);
    expect(await t.activeRoles(applicant.userId)).toEqual([]);
    expect(await t.identity.findById(applicant.userId)).toBeDefined();
  });

  it('rejection keeps the account and earlier roles, assigns nothing, and is terminal', async () => {
    const t = await createSchoolsHarness();
    const teacher = await t.newUser('TEACHER');
    const { school } = await t.service.submitSchool({ ...t.form({ phone: teacher.phone }), authenticatedUserId: teacher.id });
    const rejected = await t.service.rejectSchool(school.id, t.admin.id, 'الموقع غير مناسب');
    expect(rejected.status).toBe('REJECTED');
    expect(await t.activeRoles(teacher.id)).toEqual(['TEACHER']);
    expect(t.managers.rows.size).toBe(0);
    expect(await codeOf(t.service.approveSchool(school.id, t.admin.id))).toBe('SCHOOL_INVALID_STATUS_TRANSITION');
  });
});
