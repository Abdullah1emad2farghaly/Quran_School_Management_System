import { describe, expect, it } from 'vitest';
import { codeOf, createSchoolsHarness, gps } from '../../helpers/schools-harness';

async function setup(options: { failRoleAssignment?: boolean } = {}) {
  return createSchoolsHarness(options);
}

describe('createSchool', () => {
  it('starts PENDING with a gap-free code, no applicant, no manager, and grants the creator nothing', async () => {
    const t = await setup();
    const school = await t.create();
    expect(school).toMatchObject({ code: 'SC-000001', status: 'PENDING', createdBy: t.admin.id, applicantUserId: null, decidedBy: null, organizationId: t.org.id, countryId: t.country.id });
    expect(school).not.toHaveProperty('type');
    expect(school).not.toHaveProperty('parentSchoolId');
    expect(await t.roleService.listActiveRoles(t.admin.id)).toEqual(['ORGANIZATION_MANAGER']); // no automatic promotion or manager role
    expect(await t.service.isSchoolManager(t.admin.id, school.id)).toBe(false); // creator and manager are separate concepts
    expect(await t.service.getActiveManagerUserId(school.id)).toBeUndefined();
    expect(t.events()).toContain('SchoolCreated');
    expect((await t.service.listStatusHistory(school.id)).map((h) => [h.fromStatus, h.toStatus])).toEqual([[null, 'PENDING']]);
    expect((await t.create('مدرسة ثانية')).code).toBe('SC-000002');
  });

  it('a school can never be ACTIVE before approval: no creation path produces ACTIVE', async () => {
    const t = await setup();
    const created = await t.create('a');
    const submitted = (await t.service.submitSchool(t.form({ schoolName: 'b' }))).school;
    expect([created.status, submitted.status]).toEqual(['PENDING', 'PENDING']);
    expect(await codeOf(t.service.reactivateSchool(created.id, t.admin.id))).toBe('SCHOOL_INVALID_STATUS_TRANSITION');
    expect(await codeOf(t.service.assignSchoolManager({ schoolId: created.id, userId: (await t.newUser()).id, actorId: t.admin.id }))).toBe('SCHOOL_NOT_ACTIVE');
  });

  it('enforces name and GPS rules', async () => {
    const t = await setup();
    const create = (over: object) => t.service.createSchool({ organizationId: t.org.id, name: 'ok', ...t.address, gps, actorId: t.admin.id, ...over });
    expect(await codeOf(create({ name: '   ' }))).toBe('INVALID_SCHOOL_NAME');
    expect(await codeOf(create({ gps: { ...gps, accuracyMeters: 21 } }))).toBe('GPS_ACCURACY_EXCEEDS_LIMIT');
    expect(await codeOf(create({ gps: { ...gps, latitude: 91 } }))).toBe('INVALID_GPS_COORDINATES');
    expect(await codeOf(create({ gps: undefined }))).toBe('INVALID_GPS_COORDINATES');
    expect(t.schools.rows.size).toBe(0);
  });

  it('address: registered governorate, FREE-TEXT center and village (no registered node needed), country from the organization', async () => {
    const t = await setup();
    const create = (over: object, name = 'ok') => t.service.createSchool({ organizationId: t.org.id, name, ...t.address, gps, actorId: t.admin.id, ...over });
    // free text that exists nowhere in the geography tables
    const free = await create({ centerName: '  مركز   جديد  ', villageName: 'قرية لا وجود لها' }, 'free');
    expect(free).toMatchObject({ governorateId: t.gov.id, centerName: 'مركز جديد', villageName: 'قرية لا وجود لها', countryId: t.country.id });
    // the registered nodes are ordinary text too: no id is ever required or stored
    expect(await create({ centerName: 'سمالوط' }, 'center only')).toMatchObject({ centerName: 'سمالوط', villageName: null });
    expect(await create({}, 'none')).toMatchObject({ centerName: null, villageName: null });
    expect(await create({ centerName: '   ', villageName: null }, 'blank')).toMatchObject({ centerName: null, villageName: null });
    // rules that remain
    expect(await codeOf(create({ villageName: 'قرية' }, 'v'))).toBe('INVALID_PARENT_ADDRESS'); // a village needs a center
    expect(await codeOf(create({ centerName: 'x'.repeat(201) }, 'long'))).toBe('INVALID_PARENT_ADDRESS');
    expect(await codeOf(create({ centerName: 'a\u0000b' }, 'ctl'))).toBe('INVALID_PARENT_ADDRESS');
    expect(await codeOf(create({ governorateId: 'no-such' }, 'g1'))).toBe('PARENT_ADDRESS_GOVERNORATE_NOT_FOUND');
    expect(await codeOf(create({ governorateId: t.paris.id }, 'g2'))).toBe('PARENT_ADDRESS_COUNTRY_MISMATCH'); // France governorate, Egyptian organization
    t.geoRepo.setStatus(t.gov2.id, 'INACTIVE');
    expect(await codeOf(create({ governorateId: t.gov2.id }, 'g3'))).toBe('PARENT_ADDRESS_GOVERNORATE_INACTIVE');
    expect(await codeOf(create({ governorateId: undefined }, 'g4'))).toBe('INVALID_PARENT_ADDRESS');
    expect(t.schools.rows.size).toBe(4);
  });

  it('the country is the organization country: a conflicting client country is refused and never used', async () => {
    const t = await setup();
    const base = { organizationId: t.org.id, name: 'ok', ...t.address, gps, actorId: t.admin.id };
    expect(await codeOf(t.service.createSchool({ ...base, countryId: t.france.id }))).toBe('SCHOOL_COUNTRY_MISMATCH');
    expect(await t.service.createSchool({ ...base, countryId: t.country.id })).toMatchObject({ countryId: t.country.id });
  });

  it('names are unique per organization (case-insensitive) but not across organizations; a failed creation leaves no gap in the codes', async () => {
    const t = await setup();
    await t.create('Al-Noor School');
    expect(await codeOf(t.create('  al-noor   SCHOOL '))).toBe('SCHOOL_NAME_ALREADY_EXISTS');
    expect(t.codes.last).toBe(1); // the failed attempt rolled its code back
    const other = await t.newOrganization('Other Org');
    const otherManager = await t.newOrgAdmin(other.id);
    expect((await t.create('Al-Noor School', other.id, otherManager.id)).code).toBe('SC-000002');
  });

  it('does not create schools under an INACTIVE organization, or an unknown one', async () => {
    const t = await setup();
    t.orgRepo.rows.set(t.org.id, { ...t.orgRepo.rows.get(t.org.id)!, status: 'INACTIVE' });
    expect(await codeOf(t.create())).toBe('SCHOOL_ORGANIZATION_INACTIVE');
    expect(await codeOf(t.create('x', 'no-such-org'))).toBe('ORGANIZATION_NOT_FOUND');
  });
});

describe('approveSchool', () => {
  it('activates the school and makes the applicant School Manager scoped to THAT school only', async () => {
    const t = await setup();
    const other = await t.active('مدرسة أخرى');
    const applicant = await t.newUser(); // no role is required
    const request = await t.request(applicant.id);
    expect(request).toMatchObject({ status: 'PENDING', applicantUserId: applicant.id, createdBy: applicant.id });
    expect(await t.roleService.listActiveRoles(applicant.id)).toEqual([]); // the request itself grants nothing
    const result = await t.service.approveSchool(request.id, t.admin.id);

    expect(result.school).toMatchObject({ status: 'ACTIVE', decidedBy: t.admin.id });
    expect(result.manager).toMatchObject({ schoolId: request.id, userId: applicant.id, source: 'APPROVAL', assignedBy: t.admin.id, isActive: true });
    expect(await t.roleService.listActiveRoles(applicant.id)).toEqual(['SCHOOL_MANAGER']); // never MAIN_ADMIN or ORGANIZATION_MANAGER
    expect(await t.service.isSchoolManager(applicant.id, request.id)).toBe(true);
    expect(await t.service.isSchoolManager(applicant.id, other.id)).toBe(false); // no access to other schools
    expect(await t.service.listManagedSchoolIds(applicant.id)).toEqual([request.id]);
    expect(t.events()).toEqual(expect.arrayContaining(['SchoolApproved', 'SchoolManagerAssigned']));
    expect((await t.service.listStatusHistory(request.id)).map((h) => [h.fromStatus, h.toStatus])).toEqual([[null, 'PENDING'], ['PENDING', 'ACTIVE']]);
  });

  it('a school created by an organization manager (no applicant) is approved WITHOUT a manager; one is assigned explicitly afterwards', async () => {
    const t = await setup();
    const school = await t.create();
    const result = await t.service.approveSchool(school.id, t.admin.id);
    expect(result.manager).toBeNull();
    expect(result.school.status).toBe('ACTIVE');
    expect(t.managers.rows.size).toBe(0);
    const user = await t.newUser();
    expect(await t.service.assignSchoolManager({ schoolId: school.id, userId: user.id, actorId: t.admin.id })).toMatchObject({ source: 'ASSIGNMENT', isActive: true });
  });

  it('an applicant who already holds SCHOOL_MANAGER keeps ONE role assignment and manages both schools', async () => {
    const t = await setup();
    const first = await t.active();
    const manager = await t.newUser();
    await t.service.assignSchoolManager({ schoolId: first.id, userId: manager.id, actorId: t.admin.id });
    const request = await t.request(manager.id, 'فرع ثان');
    await t.service.approveSchool(request.id, t.admin.id);
    expect((await t.roleService.listRoleHistory(manager.id)).filter((r) => r.roleCode === 'SCHOOL_MANAGER')).toHaveLength(1);
    expect((await t.service.listManagedSchoolIds(manager.id)).sort()).toEqual([first.id, request.id].sort());
  });

  it('fails when the applicant is no longer eligible: stays PENDING, no manager, no role; it can then be rejected', async () => {
    const t = await setup();
    const applicant = await t.newUser('TEACHER');
    const request = await t.request(applicant.id);
    await t.identity.deactivateUser(applicant.id);
    expect(await codeOf(t.service.approveSchool(request.id, t.admin.id))).toBe('SCHOOL_MANAGER_NOT_ELIGIBLE');
    expect((await t.service.getById(request.id)).status).toBe('PENDING');
    expect(t.managers.rows.size).toBe(0);
    expect(await t.roleService.listActiveRoles(applicant.id)).toEqual(['TEACHER']); // unchanged
    expect((await t.service.rejectSchool(request.id, t.admin.id, 'الحساب غير مؤهل')).status).toBe('REJECTED');
    expect((await t.identity.findById(applicant.id))?.id).toBe(applicant.id); // the account is never deleted
  });

  it('is atomic: a failure while assigning the role rolls back the school, the manager link, the history and the events', async () => {
    const t = await setup({ failRoleAssignment: true });
    const applicant = await t.newUser();
    const request = await t.request(applicant.id);
    const eventsBefore = t.events().length;
    const historyBefore = (await t.service.listStatusHistory(request.id)).length;
    await expect(t.service.approveSchool(request.id, t.admin.id)).rejects.toThrow('injected role failure');
    expect((await t.service.getById(request.id)).status).toBe('PENDING');
    expect((await t.service.getById(request.id)).decidedBy).toBeNull();
    expect(t.managers.rows.size).toBe(0);
    expect(await t.roleService.listActiveRoles(applicant.id)).toEqual([]);
    expect(await t.service.isSchoolManager(applicant.id, request.id)).toBe(false);
    expect(t.events()).toHaveLength(eventsBefore);
    expect(await t.service.listStatusHistory(request.id)).toHaveLength(historyBefore);
  });

  it('cannot be repeated, applied to an ACTIVE school, or applied after a rejection; an INACTIVE organization cannot approve', async () => {
    const t = await setup();
    const a = await t.newUser();
    const request = await t.request(a.id);
    await t.service.approveSchool(request.id, t.admin.id);
    expect(await codeOf(t.service.approveSchool(request.id, t.admin.id))).toBe('SCHOOL_INVALID_STATUS_TRANSITION');
    expect(await codeOf(t.service.approveSchool('missing', t.admin.id))).toBe('SCHOOL_NOT_FOUND');
    const b = await t.newUser();
    const other = await t.request(b.id, 'other');
    await t.service.rejectSchool(other.id, t.admin.id, 'no');
    expect(await codeOf(t.service.approveSchool(other.id, t.admin.id))).toBe('SCHOOL_INVALID_STATUS_TRANSITION');
    const pending = await t.create('pending one');
    t.orgRepo.rows.set(t.org.id, { ...t.orgRepo.rows.get(t.org.id)!, status: 'INACTIVE' });
    expect(await codeOf(t.service.approveSchool(pending.id, t.admin.id))).toBe('SCHOOL_ORGANIZATION_INACTIVE');
  });
});

describe('rejectSchool', () => {
  it('needs a nonblank reason, keeps it with the audit data, and grants nothing', async () => {
    const t = await setup();
    const applicant = await t.newUser('TEACHER');
    const request = await t.request(applicant.id);
    for (const bad of ['', '   ', undefined]) expect(await codeOf(t.service.rejectSchool(request.id, t.admin.id, bad))).toBe('INVALID_REJECTION_REASON');
    expect((await t.service.getById(request.id)).status).toBe('PENDING');

    const rejected = await t.service.rejectSchool(request.id, t.admin.id, '  الموقع بعيد  ');
    expect(rejected).toMatchObject({ status: 'REJECTED', rejectionReason: 'الموقع بعيد', decidedBy: t.admin.id });
    expect(rejected.decidedAt).toBeInstanceOf(Date);
    expect(t.managers.rows.size).toBe(0);
    expect(await t.roleService.listActiveRoles(applicant.id)).toEqual(['TEACHER']); // earlier role untouched, no SCHOOL_MANAGER
    expect(await t.service.isSchoolManager(applicant.id, request.id)).toBe(false);
    expect((await t.service.listStatusHistory(request.id)).at(-1)).toMatchObject({ fromStatus: 'PENDING', toStatus: 'REJECTED', changedBy: t.admin.id, reason: 'الموقع بعيد' });
    const event = t.store.messages.find((m) => m.eventType === 'SchoolRejected')!;
    expect(JSON.stringify(event.payload)).not.toContain('الموقع');
  });

  it('is terminal; a new attempt is a new request and may reuse the released name', async () => {
    const t = await setup();
    const applicant = await t.newUser();
    const request = await t.request(applicant.id, 'فرع الأمل');
    await t.service.rejectSchool(request.id, t.admin.id, 'x');
    for (const op of [t.service.rejectSchool(request.id, t.admin.id, 'y'), t.service.reactivateSchool(request.id, t.admin.id), t.service.deactivateSchool(request.id, t.admin.id)]) {
      expect(await codeOf(op)).toBe('SCHOOL_INVALID_STATUS_TRANSITION');
    }
    const again = await t.request(applicant.id, 'فرع الأمل');
    expect(again.id).not.toBe(request.id);
    expect(again.status).toBe('PENDING');
  });
});

describe('GPS correction and status changes', () => {
  it('GPS can be corrected while PENDING (audited), never after approval', async () => {
    const t = await setup();
    const applicant = await t.newUser();
    const request = await t.request(applicant.id);
    const fix = { latitude: 30.05, longitude: 31.24, accuracyMeters: 7.5 };
    expect(await t.service.correctPendingGps(request.id, fix, t.admin.id)).toMatchObject({ latitude: 30.05, longitude: 31.24, gpsAccuracyMeters: 7.5 });
    expect(await t.service.listGpsHistory(request.id)).toMatchObject([{ previous: gps, current: fix, changedBy: t.admin.id }]);
    expect(t.events()).toContain('SchoolGpsCorrected');
    expect(await codeOf(t.service.correctPendingGps(request.id, { ...fix, accuracyMeters: 25 }, t.admin.id))).toBe('GPS_ACCURACY_EXCEEDS_LIMIT');
    await t.service.approveSchool(request.id, t.admin.id);
    expect(await codeOf(t.service.correctPendingGps(request.id, gps, t.admin.id))).toBe('SCHOOL_GPS_LOCKED');
    expect((await t.service.getById(request.id)).latitude).toBe(30.05);
    expect(await t.service.listGpsHistory(request.id)).toHaveLength(1);
  });

  it('supports ACTIVE -> INACTIVE -> ACTIVE with audit history and refuses everything else', async () => {
    const t = await setup();
    const school = await t.active();
    expect(await codeOf(t.service.reactivateSchool(school.id, t.admin.id))).toBe('SCHOOL_INVALID_STATUS_TRANSITION');
    expect((await t.service.deactivateSchool(school.id, t.admin.id)).status).toBe('INACTIVE');
    expect(await codeOf(t.service.deactivateSchool(school.id, t.admin.id))).toBe('SCHOOL_INVALID_STATUS_TRANSITION');
    expect((await t.service.reactivateSchool(school.id, t.admin.id)).status).toBe('ACTIVE');
    expect((await t.service.listStatusHistory(school.id)).map((h) => [h.fromStatus, h.toStatus])).toEqual([[null, 'PENDING'], ['PENDING', 'ACTIVE'], ['ACTIVE', 'INACTIVE'], ['INACTIVE', 'ACTIVE']]);
    expect(t.events()).toEqual(expect.arrayContaining(['SchoolDeactivated', 'SchoolReactivated']));
    const pending = await t.create('pending');
    expect(await codeOf(t.service.deactivateSchool(pending.id, t.admin.id))).toBe('SCHOOL_INVALID_STATUS_TRANSITION'); // PENDING
  });
});

describe('school managers', () => {
  it('assigns a manager explicitly; one active manager per school; history is kept', async () => {
    const t = await setup();
    const school = await t.active();
    const first = await t.newUser();
    const second = await t.newUser();
    const a = await t.service.assignSchoolManager({ schoolId: school.id, userId: first.id, actorId: t.admin.id });
    expect(a).toMatchObject({ source: 'ASSIGNMENT', assignedBy: t.admin.id, isActive: true });
    expect(await t.roleService.listActiveRoles(first.id)).toEqual(['SCHOOL_MANAGER']);
    expect(await codeOf(t.service.assignSchoolManager({ schoolId: school.id, userId: second.id, actorId: t.admin.id }))).toBe('SCHOOL_ALREADY_HAS_MANAGER');
    expect(await t.roleService.listActiveRoles(second.id)).toEqual([]); // the failed assignment left no role behind

    const revoked = await t.service.revokeSchoolManager({ schoolId: school.id, actorId: t.admin.id });
    expect(revoked).toMatchObject({ isActive: false, revokedBy: t.admin.id });
    expect(await t.roleService.listActiveRoles(first.id)).toEqual(['SCHOOL_MANAGER']); // the role itself is not revoked here
    expect(await t.service.isSchoolManager(first.id, school.id)).toBe(false);
    expect(await codeOf(t.service.revokeSchoolManager({ schoolId: school.id, actorId: t.admin.id }))).toBe('SCHOOL_MANAGER_ASSIGNMENT_NOT_FOUND');

    await t.service.assignSchoolManager({ schoolId: school.id, userId: second.id, actorId: t.admin.id });
    const history = await t.service.listManagerHistory(school.id);
    expect(history.map((h) => [h.userId, h.isActive])).toEqual([[first.id, false], [second.id, true]]);
    expect(await t.service.getActiveManagerUserId(school.id)).toBe(second.id);
  });

  it('requires an eligible user and an ACTIVE school', async () => {
    const t = await setup();
    const school = await t.active();
    const user = await t.newUser();
    const inactive = await t.newUser();
    await t.identity.deactivateUser(inactive.id);
    expect(await codeOf(t.service.assignSchoolManager({ schoolId: school.id, userId: inactive.id, actorId: t.admin.id }))).toBe('SCHOOL_MANAGER_NOT_ELIGIBLE');
    expect(await codeOf(t.service.assignSchoolManager({ schoolId: 'missing', userId: user.id, actorId: t.admin.id }))).toBe('SCHOOL_NOT_FOUND');
    const pending = await t.create('pending');
    expect(await codeOf(t.service.assignSchoolManager({ schoolId: pending.id, userId: user.id, actorId: t.admin.id }))).toBe('SCHOOL_NOT_ACTIVE');
    await t.service.deactivateSchool(school.id, t.admin.id);
    expect(await codeOf(t.service.assignSchoolManager({ schoolId: school.id, userId: user.id, actorId: t.admin.id }))).toBe('SCHOOL_NOT_ACTIVE');
    expect(t.managers.rows.size).toBe(0);
  });
});

describe('listSchools: visibility derived from the caller\'s own links (deny by default)', () => {
  const page = { page: 1, pageSize: 50 };

  it('an organization manager sees ONLY the schools of their organization; another organization is invisible', async () => {
    const t = await setup();
    const mine = await t.create('mine');
    const other = await t.newOrganization('Other Org');
    const otherManager = await t.newOrgAdmin(other.id);
    const theirs = await t.create('theirs', other.id, otherManager.id);
    expect((await t.service.listSchools({ actorId: t.admin.id, page })).items.map((s) => s.id)).toEqual([mine.id]);
    expect((await t.service.listSchools({ actorId: otherManager.id, page })).items.map((s) => s.id)).toEqual([theirs.id]);
  });

  it('a school manager sees only the school they manage; a user with no role or link sees nothing; the status filter works', async () => {
    const t = await setup();
    const school = await t.active('managed');
    await t.create('pending one');
    const manager = await t.newUser();
    await t.service.assignSchoolManager({ schoolId: school.id, userId: manager.id, actorId: t.admin.id });
    expect((await t.service.listSchools({ actorId: manager.id, page })).items.map((s) => s.id)).toEqual([school.id]);
    const nobody = await t.newUser();
    expect((await t.service.listSchools({ actorId: nobody.id, page })).total).toBe(0);
    expect((await t.service.listSchools({ actorId: 'no-such-user', page })).total).toBe(0);
    expect((await t.service.listSchools({ actorId: t.admin.id, statuses: ['PENDING'], page })).items.map((s) => s.status)).toEqual(['PENDING']);
  });

  it('holding the ORGANIZATION_MANAGER role without an organization link (or a link without the role) shows nothing', async () => {
    const t = await setup();
    await t.create('mine');
    const roleOnly = await t.newUser('ORGANIZATION_MANAGER');
    expect((await t.service.listSchools({ actorId: roleOnly.id, page })).total).toBe(0);
    const linkOnly = await t.newUser();
    await t.organizations.assignOrganizationAdmin({ organizationId: t.org.id, userId: linkOnly.id, assignedBy: null });
    expect((await t.service.listSchools({ actorId: linkOnly.id, page })).total).toBe(0);
  });
});

describe('lookups', () => {
  it('finds by id and code; getById throws SCHOOL_NOT_FOUND', async () => {
    const t = await setup();
    const school = await t.create();
    expect(await t.service.findById(school.id)).toEqual(school);
    expect((await t.service.findByCode('SC-000001'))?.id).toBe(school.id);
    expect(await t.service.findById('missing')).toBeUndefined();
    expect(await t.service.findByCode('SC-999999')).toBeUndefined();
    expect(await codeOf(t.service.getById('missing'))).toBe('SCHOOL_NOT_FOUND');
  });
});
