import { describe, expect, it } from 'vitest';
import { codeOf, createSchoolsHarness, gps } from '../../helpers/schools-harness';

describe('public Sub-School submission: the applicant account', () => {
  const submit = async (t: Awaited<ReturnType<typeof createSchoolsHarness>>, over: Parameters<typeof t.form>[0] = {}) => {
    const parent = (await t.schools.list({ type: 'MAIN', page: { page: 1, pageSize: 5 }, sort: 'createdAt', direction: 'asc' })).items[0] ?? (await t.main());
    const id = 'id' in parent && typeof parent.id === 'string' ? parent.id : (parent as { id: string }).id;
    return t.service.submitSubSchool(t.form({ ...over, parentSchoolId: id }));
  };

  it('creates the applicant account and a PENDING request in one step, granting nothing', async () => {
    const t = await createSchoolsHarness();
    await t.main();
    const usersBefore = t.users.rows.size;
    const result = await submit(t, { phone: '01012345678', name: '  أحمد   محمد ' });

    expect(result.applicant.accountCreated).toBe(true);
    expect(t.users.rows.size).toBe(usersBefore + 1);
    const user = (await t.identity.findByPhone('+201012345678'))!; // normalized to E.164
    expect(user).toMatchObject({ id: result.applicant.userId, isActive: true });
    expect(result.school).toMatchObject({ type: 'SUB', status: 'PENDING', createdBy: user.id, applicantName: 'أحمد محمد', decidedBy: null, organizationId: t.org.id, countryId: t.country.id });
    expect(await t.activeRoles(user.id)).toEqual([]); // no role at all: not MAIN_ADMIN, not SCHOOL_MANAGER
    expect(await t.service.isSchoolManager(user.id, result.school.id)).toBe(false);
    expect(t.managers.rows.size).toBe(0);
    expect(t.events()).toEqual(expect.arrayContaining(['UserCreated', 'SchoolCreated']));
  });

  it('the new account has an unguessable password: the phone-derived initial password and the phone itself do not log in', async () => {
    const t = await createSchoolsHarness();
    await t.main();
    const { applicant } = await submit(t, { phone: '01012345678' });
    for (const guess of ['5678', '01012345678', '+201012345678', 'secret1', '12345678']) expect(await t.identity.verifyPassword(applicant.userId, guess)).toBe(false);
    expect(await t.identity.verifyPassword(applicant.userId, t.generated[0]!)).toBe(true); // only the generated value (never returned)
    expect(JSON.stringify(applicant)).not.toContain(t.generated[0]!);
  });

  it('rejects an invalid form before writing anything (no user, no school, no code consumed)', async () => {
    const t = await createSchoolsHarness();
    const parent = await t.main();
    const schoolsBefore = t.schools.rows.size;
    const codeBefore = t.codes.last;
    const usersBefore = t.users.rows.size;
    const bad = async (form: object, code: string) => {
      expect(await codeOf(t.service.submitSubSchool({ ...t.form({ parentSchoolId: parent.id }), ...form } as never))).toBe(code);
      expect(t.users.rows.size).toBe(usersBefore);
      expect(t.schools.rows.size).toBe(schoolsBefore);
      expect(t.codes.last).toBe(codeBefore);
    };
    await bad({ applicant: { name: '   ', phone: '01012345678' } }, 'INVALID_APPLICANT_NAME');
    await bad({ applicant: { name: 5, phone: '01012345678' } }, 'INVALID_APPLICANT_NAME');
    await bad({ applicant: undefined }, 'INVALID_APPLICANT_NAME');
    await bad({ applicant: { name: 'x'.repeat(201), phone: '01012345678' } }, 'INVALID_APPLICANT_NAME');
    await bad({ applicant: { name: 'أحمد', phone: '12345' } }, 'INVALID_PHONE_NUMBER');
    await bad({ applicant: { name: 'أحمد', phone: undefined } }, 'INVALID_PHONE_NUMBER');
    await bad({ name: '   ' }, 'INVALID_SCHOOL_NAME');
    await bad({ gps: { ...gps, accuracyMeters: 20.5 } }, 'GPS_ACCURACY_EXCEEDS_LIMIT');
    await bad({ gps: { ...gps, latitude: 120 } }, 'INVALID_GPS_COORDINATES');
  });

  it('normalizes every accepted Egyptian phone format to the same E.164 identity', async () => {
    const t = await createSchoolsHarness();
    await t.main();
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
    await t.main();
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
    await t.main();
    await submit(t, { phone: '01011111111', schoolName: 'Al-Noor School' });
    const usersBefore = t.users.rows.size;
    const codeBefore = t.codes.last;
    expect(await codeOf(submit(t, { phone: '01022222222', schoolName: 'al-noor   SCHOOL' }))).toBe('SCHOOL_NAME_ALREADY_EXISTS');
    expect(await t.identity.findByPhone('+201022222222')).toBeUndefined();
    expect(t.users.rows.size).toBe(usersBefore);
    expect(t.codes.last).toBe(codeBefore);
    // an invalid address fails after the account was created inside the transaction: it is rolled back as well
    const parent = (await t.schools.list({ type: 'MAIN', page: { page: 1, pageSize: 1 }, sort: 'createdAt', direction: 'asc' })).items[0]!;
    expect(await codeOf(t.service.submitSubSchool({ ...t.form({ phone: '01033333333', schoolName: 'other', parentSchoolId: parent.id }), governorateId: 'no-such-governorate' }))).toBe('GEOGRAPHY_NODE_NOT_FOUND');
    expect(await t.identity.findByPhone('+201033333333')).toBeUndefined();
    expect(t.users.rows.size).toBe(usersBefore);
  });

  it('an organization that is INACTIVE blocks the submission and the account is not kept', async () => {
    const t = await createSchoolsHarness();
    const parent = await t.main();
    t.orgRepo.rows.set(t.org.id, { ...t.orgRepo.rows.get(t.org.id)!, status: 'INACTIVE' });
    expect(await codeOf(t.service.submitSubSchool(t.form({ parentSchoolId: parent.id })))).toBe('SCHOOL_ORGANIZATION_INACTIVE');
    expect(await t.identity.findByPhone('+201012345678')).toBeUndefined();
  });
});

describe('logged-in applicant (the session is the proof of identity)', () => {
  it('reuses the authenticated account when the submitted phone is its own: no new user, no role change', async () => {
    const t = await createSchoolsHarness();
    const parent = await t.main();
    const teacher = await t.newUser('TEACHER');
    const usersBefore = t.users.rows.size;
    const result = await t.service.submitSubSchool({ ...t.form({ phone: teacher.phone, parentSchoolId: parent.id }), authenticatedUserId: teacher.id });
    expect(result.applicant).toEqual({ userId: teacher.id, accountCreated: false });
    expect(result.school.createdBy).toBe(teacher.id);
    expect(t.users.rows.size).toBe(usersBefore);
    expect(await t.activeRoles(teacher.id)).toEqual(['TEACHER']);
    expect(t.generated).toHaveLength(0); // no password was generated
  });

  it('refuses a different phone, an inactive account and an unknown user', async () => {
    const t = await createSchoolsHarness();
    const parent = await t.main();
    const user = await t.newUser();
    expect(await codeOf(t.service.submitSubSchool({ ...t.form({ phone: '01099999999', parentSchoolId: parent.id }), authenticatedUserId: user.id }))).toBe('SCHOOL_APPLICANT_IDENTITY_MISMATCH');
    await t.identity.deactivateUser(user.id);
    expect(await codeOf(t.service.submitSubSchool({ ...t.form({ phone: user.phone, parentSchoolId: parent.id, schoolName: 'x' }), authenticatedUserId: user.id }))).toBe('SCHOOL_MANAGER_NOT_ELIGIBLE');
    expect(await codeOf(t.service.submitSubSchool({ ...t.form({ parentSchoolId: parent.id, schoolName: 'y' }), authenticatedUserId: 'nobody' }))).toBe('SCHOOL_MANAGER_NOT_ELIGIBLE');
  });
});

describe('public Sub-School submission and approval', () => {
  it('creates a PENDING request with a new account and NO role or manager link', async () => {
    const t = await createSchoolsHarness();
    const parent = await t.main();
    const result = await t.service.submitSubSchool(t.form({ parentSchoolId: parent.id }));
    expect(result.school).toMatchObject({ type: 'SUB', status: 'PENDING', parentSchoolId: parent.id, createdBy: result.applicant.userId, applicantName: 'أحمد محمد' });
    expect(result.applicant.accountCreated).toBe(true);
    expect(await t.activeRoles(result.applicant.userId)).toEqual([]);
    expect(t.managers.rows.size).toBe(0);
    expect(await t.service.isSchoolManager(result.applicant.userId, result.school.id)).toBe(false);
    expect(t.events().filter((e) => e === 'SchoolApproved' || e === 'SchoolManagerAssigned')).toEqual([]);
  });

  it('the parent must be an ACTIVE Main School; otherwise nothing is created', async () => {
    const t = await createSchoolsHarness();
    const parent = await t.main();
    const first = await t.service.submitSubSchool(t.form({ parentSchoolId: parent.id }));
    const usersBefore = t.users.rows.size;
    for (const parentSchoolId of ['missing', first.school.id]) {
      expect(await codeOf(t.service.submitSubSchool(t.form({ phone: '01077777777', schoolName: 'x', parentSchoolId })))).toBe('SCHOOL_PARENT_INVALID');
    }
    await t.service.deactivateSchool(parent.id, t.admin.id);
    expect(await codeOf(t.service.submitSubSchool(t.form({ phone: '01077777777', schoolName: 'x', parentSchoolId: parent.id })))).toBe('SCHOOL_PARENT_INVALID');
    expect(t.users.rows.size).toBe(usersBefore);
  });

  it('approval makes the submitted account the School Manager of that school only; the account owner needs OTP recovery to log in', async () => {
    const t = await createSchoolsHarness();
    const parent = await t.main();
    const { school, applicant } = await t.service.submitSubSchool(t.form({ parentSchoolId: parent.id }));
    const approved = await t.service.approveSubSchool(school.id, t.admin.id);
    expect(approved.school.status).toBe('ACTIVE');
    expect(approved.manager).toMatchObject({ userId: applicant.userId, schoolId: school.id, source: 'SUB_SCHOOL_APPROVAL' });
    expect(await t.activeRoles(applicant.userId)).toEqual(['SCHOOL_MANAGER']);
    expect(await t.service.isSchoolManager(applicant.userId, parent.id)).toBe(false);
  });

  it('an applicant who is no longer eligible cannot be approved; the request stays PENDING and can be rejected, keeping the account', async () => {
    const t = await createSchoolsHarness();
    const parent = await t.main();
    const { school, applicant } = await t.service.submitSubSchool(t.form({ parentSchoolId: parent.id }));
    await t.identity.deactivateUser(applicant.userId);
    expect(await codeOf(t.service.approveSubSchool(school.id, t.admin.id))).toBe('SCHOOL_MANAGER_NOT_ELIGIBLE');
    expect((await t.service.getById(school.id)).status).toBe('PENDING');
    expect(t.managers.rows.size).toBe(0);
    expect(await t.activeRoles(applicant.userId)).toEqual([]);
    expect((await t.service.rejectSubSchool(school.id, t.admin.id, 'غير مؤهل')).status).toBe('REJECTED');
    expect(await t.identity.findById(applicant.userId)).toBeDefined();
  });

  it('a role-assignment failure rolls back the approval (the account created by the submission is untouched)', async () => {
    const t = await createSchoolsHarness({ failRoleAssignment: true });
    const parent = await t.main();
    const { school, applicant } = await t.service.submitSubSchool(t.form({ parentSchoolId: parent.id }));
    await expect(t.service.approveSubSchool(school.id, t.admin.id)).rejects.toThrow('injected role failure');
    expect((await t.service.getById(school.id)).status).toBe('PENDING');
    expect(t.managers.rows.size).toBe(0);
    expect(await t.activeRoles(applicant.userId)).toEqual([]);
    expect(await t.identity.findById(applicant.userId)).toBeDefined();
  });

  it('rejection keeps the account and earlier roles, assigns nothing, and is terminal', async () => {
    const t = await createSchoolsHarness();
    const parent = await t.main();
    const { school, applicant } = await t.service.submitSubSchool(t.form({ parentSchoolId: parent.id }));
    const rejected = await t.service.rejectSubSchool(school.id, t.admin.id, 'الموقع غير مناسب');
    expect(rejected).toMatchObject({ status: 'REJECTED', rejectionReason: 'الموقع غير مناسب', decidedBy: t.admin.id });
    expect(await t.identity.findById(applicant.userId)).toMatchObject({ isActive: true });
    expect(await t.activeRoles(applicant.userId)).toEqual([]);
    expect(t.managers.rows.size).toBe(0);
    expect(await codeOf(t.service.approveSubSchool(school.id, t.admin.id))).toBe('SCHOOL_INVALID_STATUS_TRANSITION');
    expect(await codeOf(t.service.rejectSubSchool(school.id, t.admin.id, 'again'))).toBe('SCHOOL_INVALID_STATUS_TRANSITION');
  });

  it('two simultaneous approvals: exactly one succeeds, one manager link and one role assignment result', async () => {
    const t = await createSchoolsHarness({ rollback: false }); // no snapshot restore: the optimistic version check is what protects
    const parent = await t.main();
    const { school, applicant } = await t.service.submitSubSchool(t.form({ parentSchoolId: parent.id }));
    const results = await Promise.allSettled([t.service.approveSubSchool(school.id, t.admin.id), t.service.approveSubSchool(school.id, t.admin.id)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect([...t.managers.rows.values()].filter((r) => r.revokedAt === null)).toHaveLength(1);
    expect((await t.roleService.listRoleHistory(applicant.userId)).filter((r) => r.roleCode === 'SCHOOL_MANAGER')).toHaveLength(1);
    expect((await t.service.getById(school.id)).status).toBe('ACTIVE');
  });

  it('only an active Main Admin approves or rejects (the applicant cannot approve their own request)', async () => {
    const t = await createSchoolsHarness();
    const parent = await t.main();
    const { school, applicant } = await t.service.submitSubSchool(t.form({ parentSchoolId: parent.id }));
    expect(await codeOf(t.service.approveSubSchool(school.id, applicant.userId))).toBe('SCHOOL_ACTION_NOT_ALLOWED');
    expect(await codeOf(t.service.rejectSubSchool(school.id, applicant.userId, 'x'))).toBe('SCHOOL_ACTION_NOT_ALLOWED');
    expect((await t.service.getById(school.id)).status).toBe('PENDING');
  });
});

describe('what the caller may see', () => {
  it('a Main Admin lists every school; others only what they submitted or manage; paging, filters and sort work', async () => {
    const t = await createSchoolsHarness();
    const parent = await t.main('الرئيسية');
    const a = await t.service.submitSubSchool(t.form({ parentSchoolId: parent.id, phone: '01011110001', schoolName: 'فرع أ' }));
    const b = await t.service.submitSubSchool(t.form({ parentSchoolId: parent.id, phone: '01011110002', schoolName: 'فرع ب' }));
    await t.service.approveSubSchool(a.school.id, t.admin.id);

    const page1 = await t.service.listSchools({ actorId: t.admin.id, page: { page: 1, pageSize: 2 }, sort: 'code', direction: 'asc' });
    expect(page1).toMatchObject({ page: 1, pageSize: 2, total: 3, totalPages: 2 });
    expect(page1.items.map((s) => s.code)).toEqual(['SC-000001', 'SC-000002']);
    expect((await t.service.listSchools({ actorId: t.admin.id, statuses: ['PENDING'], page: { page: 1, pageSize: 20 } })).items.map((s) => s.id)).toEqual([b.school.id]);
    expect((await t.service.listSchools({ actorId: t.admin.id, type: 'MAIN', page: { page: 1, pageSize: 20 } })).total).toBe(1);

    const mine = await t.service.listSchools({ actorId: a.applicant.userId, page: { page: 1, pageSize: 20 } });
    expect(mine.items.map((s) => s.id)).toEqual([a.school.id]); // own submission, now also managed
    const others = await t.service.listSchools({ actorId: b.applicant.userId, page: { page: 1, pageSize: 20 } });
    expect(others.items.map((s) => s.id)).toEqual([b.school.id]); // still only their own pending request
    const stranger = await t.newUser();
    expect((await t.service.listSchools({ actorId: stranger.id, page: { page: 1, pageSize: 20 } })).total).toBe(0);
  });

  it('a single school is visible to the submitter, its manager and a Main Admin; anyone else gets SCHOOL_NOT_FOUND', async () => {
    const t = await createSchoolsHarness();
    const parent = await t.main();
    const { school, applicant } = await t.service.submitSubSchool(t.form({ parentSchoolId: parent.id }));
    const stranger = await t.newUser('TEACHER');
    expect((await t.service.getSchoolForActor(school.id, applicant.userId)).id).toBe(school.id);
    expect((await t.service.getSchoolForActor(school.id, t.admin.id)).id).toBe(school.id);
    expect(await codeOf(t.service.getSchoolForActor(school.id, stranger.id))).toBe('SCHOOL_NOT_FOUND');
    expect(await codeOf(t.service.getSchoolForActor(parent.id, applicant.userId))).toBe('SCHOOL_NOT_FOUND'); // the applicant sees no other school
    expect(await codeOf(t.service.getSchoolForActor('missing', t.admin.id))).toBe('SCHOOL_NOT_FOUND');
    await t.service.assignSchoolManager({ schoolId: parent.id, userId: stranger.id, actorId: t.admin.id });
    expect((await t.service.getSchoolForActor(parent.id, stranger.id)).id).toBe(parent.id); // a manager sees the school they manage
    expect(await codeOf(t.service.getSchoolForActor(school.id, stranger.id))).toBe('SCHOOL_NOT_FOUND'); // ...and not the others
  });
});
