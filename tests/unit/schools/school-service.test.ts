import { describe, expect, it } from 'vitest';
import { codeOf, createSchoolsHarness, gps } from '../../helpers/schools-harness';

async function setup(options: { failRoleAssignment?: boolean } = {}) {
  return createSchoolsHarness(options);
}

describe('createMainSchool', () => {
  it('only an ACTIVE Main Admin creates it; it starts ACTIVE with a gap-free code and grants the creator nothing', async () => {
    const t = await setup();
    const school = await t.main();
    expect(school).toMatchObject({ code: 'SC-000001', type: 'MAIN', status: 'ACTIVE', parentSchoolId: null, createdBy: t.admin.id, decidedBy: null });
    expect(await t.roleService.listActiveRoles(t.admin.id)).toEqual(['MAIN_ADMIN']); // no automatic promotion or manager role
    expect(await t.service.isSchoolManager(t.admin.id, school.id)).toBe(false); // creator and manager are separate concepts
    expect(await t.service.getActiveManagerUserId(school.id)).toBeUndefined();
    expect(t.events()).toContain('SchoolCreated');
    expect((await t.service.listStatusHistory(school.id)).map((h) => [h.fromStatus, h.toStatus])).toEqual([[null, 'ACTIVE']]);
    expect((await t.main('مدرسة ثانية')).code).toBe('SC-000002');
  });

  it('refuses actors that are not an active Main Admin and consumes no code', async () => {
    const t = await setup();
    const teacher = await t.newUser('TEACHER');
    const inactiveAdmin = await t.newUser('MAIN_ADMIN');
    await t.identity.deactivateUser(inactiveAdmin.id);
    for (const actorId of [teacher.id, inactiveAdmin.id, 'no-such-user', undefined as never]) {
      expect(await codeOf(t.service.createMainSchool({ organizationId: t.org.id, name: 'x', ...t.address, gps, actorId }))).toBe('SCHOOL_ACTION_NOT_ALLOWED');
    }
    expect(t.schools.rows.size).toBe(0);
    expect((await t.main()).code).toBe('SC-000001');
  });

  it('enforces name, GPS accuracy/ranges and the structured address rules', async () => {
    const t = await setup();
    const create = (over: object) => t.service.createMainSchool({ organizationId: t.org.id, name: 'ok', ...t.address, gps, actorId: t.admin.id, ...over });
    expect(await codeOf(create({ name: '   ' }))).toBe('INVALID_SCHOOL_NAME');
    expect(await codeOf(create({ gps: { ...gps, accuracyMeters: 21 } }))).toBe('GPS_ACCURACY_EXCEEDS_LIMIT');
    expect(await codeOf(create({ gps: { ...gps, latitude: 91 } }))).toBe('INVALID_GPS_COORDINATES');
    expect(await codeOf(create({ gps: undefined }))).toBe('INVALID_GPS_COORDINATES');
    expect(await codeOf(create({ villageId: t.village.id }))).toBe('INVALID_GEOGRAPHY_HIERARCHY'); // village without center
    expect(await codeOf(create({ centerId: t.center.id, villageId: t.village.id, governorateId: t.gov2.id }))).toBe('INVALID_GEOGRAPHY_HIERARCHY');
    expect(await codeOf(create({ governorateId: 'no-such' }))).toBe('GEOGRAPHY_NODE_NOT_FOUND');
    t.geoRepo.setStatus(t.gov2.id, 'INACTIVE');
    expect(await codeOf(create({ governorateId: t.gov2.id }))).toBe('GEOGRAPHY_NODE_INACTIVE');
    expect(await create({ centerId: t.center.id, villageId: t.village.id })).toMatchObject({ centerId: t.center.id, villageId: t.village.id });
    expect(t.schools.rows.size).toBe(1);
  });

  it('names are unique per organization (case-insensitive), a failed creation leaves no gap in the codes', async () => {
    const t = await setup();
    await t.main('Al-Noor School');
    expect(await codeOf(t.main('  al-noor   SCHOOL '))).toBe('SCHOOL_NAME_ALREADY_EXISTS');
    expect(t.codes.last).toBe(1); // the failed attempt rolled its code back
    expect((await t.main('Another')).code).toBe('SC-000002');
  });

  it('does not create schools under an INACTIVE organization', async () => {
    const t = await setup();
    t.orgRepo.rows.set(t.org.id, { ...t.orgRepo.rows.get(t.org.id)!, status: 'INACTIVE' });
    expect(await codeOf(t.main())).toBe('SCHOOL_ORGANIZATION_INACTIVE');
  });
});

describe('requestSubSchool', () => {
  it('creates a PENDING request for an applicant with no roles, and grants nothing', async () => {
    const t = await setup();
    const parent = await t.main();
    const applicant = await t.newUser(); // no SCHOOL_MANAGER role and no other role is required
    const request = await t.request(applicant.id, parent.id);
    expect(request).toMatchObject({ type: 'SUB', status: 'PENDING', parentSchoolId: parent.id, createdBy: applicant.id, code: 'SC-000002' });
    expect(await t.roleService.listActiveRoles(applicant.id)).toEqual([]);
    expect(await t.service.isSchoolManager(applicant.id, request.id)).toBe(false);
    expect(t.managers.rows.size).toBe(0);
    expect(t.events().filter((e) => e === 'SchoolManagerAssigned' || e === 'RoleAssigned' || e === 'SchoolApproved')).toEqual(['RoleAssigned']); // only the admin's setup role
  });

  it('accepts requesters with other roles (no extra requirement) and rejects ineligible ones', async () => {
    const t = await setup();
    const parent = await t.main();
    const teacher = await t.newUser('TEACHER');
    expect((await t.request(teacher.id, parent.id)).status).toBe('PENDING');
    const inactive = await t.newUser();
    await t.identity.deactivateUser(inactive.id);
    expect(await codeOf(t.request(inactive.id, parent.id, 'another'))).toBe('SCHOOL_MANAGER_NOT_ELIGIBLE');
    expect(await codeOf(t.request('no-such-user', parent.id, 'another2'))).toBe('SCHOOL_MANAGER_NOT_ELIGIBLE');
  });

  it('the parent must be an existing ACTIVE Main School', async () => {
    const t = await setup();
    const parent = await t.main();
    const applicant = await t.newUser();
    expect(await codeOf(t.request(applicant.id, 'missing'))).toBe('SCHOOL_PARENT_INVALID');
    const sub = await t.request(applicant.id, parent.id, 'a');
    expect(await codeOf(t.request(applicant.id, sub.id, 'b'))).toBe('SCHOOL_PARENT_INVALID'); // a Sub-School cannot be a parent
    await t.service.deactivateSchool(parent.id, t.admin.id);
    expect(await codeOf(t.request(applicant.id, parent.id, 'c'))).toBe('SCHOOL_PARENT_INVALID'); // INACTIVE main school
  });
});

describe('approveSubSchool', () => {
  it('activates the school and makes the requester School Manager scoped to THAT school only', async () => {
    const t = await setup();
    const parent = await t.main();
    const applicant = await t.newUser();
    const request = await t.request(applicant.id, parent.id);
    const result = await t.service.approveSubSchool(request.id, t.admin.id);

    expect(result.school).toMatchObject({ status: 'ACTIVE', decidedBy: t.admin.id });
    expect(result.manager).toMatchObject({ schoolId: request.id, userId: applicant.id, source: 'SUB_SCHOOL_APPROVAL', assignedBy: t.admin.id, isActive: true });
    expect(await t.roleService.listActiveRoles(applicant.id)).toEqual(['SCHOOL_MANAGER']); // never MAIN_ADMIN
    expect(await t.service.isSchoolManager(applicant.id, request.id)).toBe(true);
    expect(await t.service.isSchoolManager(applicant.id, parent.id)).toBe(false); // no access to other schools
    expect(await t.service.listManagedSchoolIds(applicant.id)).toEqual([request.id]);
    expect(await t.service.getActiveManagerUserId(request.id)).toBe(applicant.id);
    expect(t.events()).toEqual(expect.arrayContaining(['SchoolApproved', 'SchoolManagerAssigned']));
    expect((await t.service.listStatusHistory(request.id)).map((h) => [h.fromStatus, h.toStatus])).toEqual([[null, 'PENDING'], ['PENDING', 'ACTIVE']]);
  });

  it('a requester who already holds the SCHOOL_MANAGER role keeps ONE role assignment and manages both schools', async () => {
    const t = await setup();
    const parent = await t.main();
    const manager = await t.newUser();
    await t.service.assignSchoolManager({ schoolId: parent.id, userId: manager.id, actorId: t.admin.id });
    const request = await t.request(manager.id, parent.id);
    await t.service.approveSubSchool(request.id, t.admin.id);
    expect((await t.roleService.listRoleHistory(manager.id)).filter((r) => r.roleCode === 'SCHOOL_MANAGER')).toHaveLength(1);
    expect((await t.service.listManagedSchoolIds(manager.id)).sort()).toEqual([parent.id, request.id].sort());
  });

  it('only an active Main Admin approves; a non-admin attempt changes nothing', async () => {
    const t = await setup();
    const parent = await t.main();
    const applicant = await t.newUser();
    const request = await t.request(applicant.id, parent.id);
    expect(await codeOf(t.service.approveSubSchool(request.id, applicant.id))).toBe('SCHOOL_ACTION_NOT_ALLOWED'); // not even the requester
    expect((await t.service.getById(request.id)).status).toBe('PENDING');
    expect(await t.roleService.listActiveRoles(applicant.id)).toEqual([]);
  });

  it('fails when the requester is no longer eligible: stays PENDING, no manager, no role; the Main Admin can then reject', async () => {
    const t = await setup();
    const parent = await t.main();
    const applicant = await t.newUser('TEACHER');
    const request = await t.request(applicant.id, parent.id);
    await t.identity.deactivateUser(applicant.id);
    expect(await codeOf(t.service.approveSubSchool(request.id, t.admin.id))).toBe('SCHOOL_MANAGER_NOT_ELIGIBLE');
    expect((await t.service.getById(request.id)).status).toBe('PENDING');
    expect(t.managers.rows.size).toBe(0);
    expect(await t.roleService.listActiveRoles(applicant.id)).toEqual(['TEACHER']); // unchanged
    const rejected = await t.service.rejectSubSchool(request.id, t.admin.id, 'الحساب غير مؤهل');
    expect(rejected.status).toBe('REJECTED');
    expect((await t.identity.findById(applicant.id))?.id).toBe(applicant.id); // the account is never deleted
  });

  it('is atomic: a failure while assigning the role rolls back the school, the manager link, the history and the events', async () => {
    const t = await setup({ failRoleAssignment: true });
    const parent = await t.main();
    const applicant = await t.newUser();
    const request = await t.request(applicant.id, parent.id);
    const eventsBefore = t.events().length;
    const historyBefore = (await t.service.listStatusHistory(request.id)).length;
    await expect(t.service.approveSubSchool(request.id, t.admin.id)).rejects.toThrow('injected role failure');
    expect((await t.service.getById(request.id)).status).toBe('PENDING');
    expect((await t.service.getById(request.id)).decidedBy).toBeNull();
    expect(t.managers.rows.size).toBe(0);
    expect(await t.roleService.listActiveRoles(applicant.id)).toEqual([]);
    expect(await t.service.isSchoolManager(applicant.id, request.id)).toBe(false);
    expect(t.events()).toHaveLength(eventsBefore);
    expect(await t.service.listStatusHistory(request.id)).toHaveLength(historyBefore);
  });

  it('cannot be repeated, applied to a Main School, or applied after a rejection', async () => {
    const t = await setup();
    const parent = await t.main();
    const a = await t.newUser();
    const request = await t.request(a.id, parent.id);
    await t.service.approveSubSchool(request.id, t.admin.id);
    expect(await codeOf(t.service.approveSubSchool(request.id, t.admin.id))).toBe('SCHOOL_INVALID_STATUS_TRANSITION');
    expect(await codeOf(t.service.approveSubSchool(parent.id, t.admin.id))).toBe('SCHOOL_INVALID_STATUS_TRANSITION');
    expect(await codeOf(t.service.approveSubSchool('missing', t.admin.id))).toBe('SCHOOL_NOT_FOUND');
    const b = await t.newUser();
    const other = await t.request(b.id, parent.id, 'other');
    await t.service.rejectSubSchool(other.id, t.admin.id, 'no');
    expect(await codeOf(t.service.approveSubSchool(other.id, t.admin.id))).toBe('SCHOOL_INVALID_STATUS_TRANSITION');
  });
});

describe('rejectSubSchool', () => {
  it('needs a nonblank reason, keeps it with the audit data, and grants nothing', async () => {
    const t = await setup();
    const parent = await t.main();
    const applicant = await t.newUser('TEACHER');
    const request = await t.request(applicant.id, parent.id);
    for (const bad of ['', '   ', undefined]) expect(await codeOf(t.service.rejectSubSchool(request.id, t.admin.id, bad))).toBe('INVALID_REJECTION_REASON');
    expect((await t.service.getById(request.id)).status).toBe('PENDING');

    const rejected = await t.service.rejectSubSchool(request.id, t.admin.id, '  الموقع بعيد  ');
    expect(rejected).toMatchObject({ status: 'REJECTED', rejectionReason: 'الموقع بعيد', decidedBy: t.admin.id });
    expect(rejected.decidedAt).toBeInstanceOf(Date);
    expect(t.managers.rows.size).toBe(0);
    expect(await t.roleService.listActiveRoles(applicant.id)).toEqual(['TEACHER']); // earlier role untouched, no SCHOOL_MANAGER
    expect(await t.service.isSchoolManager(applicant.id, request.id)).toBe(false);
    expect((await t.service.listStatusHistory(request.id)).at(-1)).toMatchObject({ fromStatus: 'PENDING', toStatus: 'REJECTED', changedBy: t.admin.id, reason: 'الموقع بعيد' });
    const event = t.store.messages.find((m) => m.eventType === 'SchoolRejected')!;
    expect(JSON.stringify(event.payload)).not.toContain('الموقع');
  });

  it('is terminal; a new attempt is a new request and may reuse the released name; only a Main Admin may reject', async () => {
    const t = await setup();
    const parent = await t.main();
    const applicant = await t.newUser();
    const request = await t.request(applicant.id, parent.id, 'فرع الأمل');
    expect(await codeOf(t.service.rejectSubSchool(request.id, applicant.id, 'x'))).toBe('SCHOOL_ACTION_NOT_ALLOWED');
    await t.service.rejectSubSchool(request.id, t.admin.id, 'x');
    for (const op of [t.service.rejectSubSchool(request.id, t.admin.id, 'y'), t.service.reactivateSchool(request.id, t.admin.id), t.service.deactivateSchool(request.id, t.admin.id)]) {
      expect(await codeOf(op)).toBe('SCHOOL_INVALID_STATUS_TRANSITION');
    }
    const again = await t.request(applicant.id, parent.id, 'فرع الأمل');
    expect(again.id).not.toBe(request.id);
    expect(again.status).toBe('PENDING');
  });
});

describe('GPS correction and status changes', () => {
  it('GPS can be corrected while PENDING (audited), never after approval', async () => {
    const t = await setup();
    const parent = await t.main();
    const applicant = await t.newUser();
    const request = await t.request(applicant.id, parent.id);
    const fix = { latitude: 30.05, longitude: 31.24, accuracyMeters: 7.5 };
    expect(await t.service.correctPendingGps(request.id, fix, t.admin.id)).toMatchObject({ latitude: 30.05, longitude: 31.24, gpsAccuracyMeters: 7.5 });
    expect(await t.service.listGpsHistory(request.id)).toMatchObject([{ previous: gps, current: fix, changedBy: t.admin.id }]);
    expect(t.events()).toContain('SchoolGpsCorrected');
    expect(await codeOf(t.service.correctPendingGps(request.id, { ...fix, accuracyMeters: 25 }, t.admin.id))).toBe('GPS_ACCURACY_EXCEEDS_LIMIT');
    expect(await codeOf(t.service.correctPendingGps(request.id, fix, applicant.id))).toBe('SCHOOL_ACTION_NOT_ALLOWED');
    await t.service.approveSubSchool(request.id, t.admin.id);
    expect(await codeOf(t.service.correctPendingGps(request.id, gps, t.admin.id))).toBe('SCHOOL_GPS_LOCKED');
    expect(await codeOf(t.service.correctPendingGps(parent.id, gps, t.admin.id))).toBe('SCHOOL_GPS_LOCKED'); // a Main School is never PENDING
    expect((await t.service.getById(request.id)).latitude).toBe(30.05);
    expect(await t.service.listGpsHistory(request.id)).toHaveLength(1);
  });

  it('supports ACTIVE -> INACTIVE -> ACTIVE with audit history and refuses everything else', async () => {
    const t = await setup();
    const parent = await t.main();
    expect(await codeOf(t.service.reactivateSchool(parent.id, t.admin.id))).toBe('SCHOOL_INVALID_STATUS_TRANSITION');
    expect((await t.service.deactivateSchool(parent.id, t.admin.id)).status).toBe('INACTIVE');
    expect(await codeOf(t.service.deactivateSchool(parent.id, t.admin.id))).toBe('SCHOOL_INVALID_STATUS_TRANSITION');
    expect((await t.service.reactivateSchool(parent.id, t.admin.id)).status).toBe('ACTIVE');
    expect((await t.service.listStatusHistory(parent.id)).map((h) => [h.fromStatus, h.toStatus])).toEqual([[null, 'ACTIVE'], ['ACTIVE', 'INACTIVE'], ['INACTIVE', 'ACTIVE']]);
    expect(t.events()).toEqual(expect.arrayContaining(['SchoolDeactivated', 'SchoolReactivated']));
    const applicant = await t.newUser();
    const request = await t.request(applicant.id, parent.id);
    expect(await codeOf(t.service.deactivateSchool(request.id, t.admin.id))).toBe('SCHOOL_INVALID_STATUS_TRANSITION'); // PENDING
    expect(await codeOf(t.service.deactivateSchool(parent.id, applicant.id))).toBe('SCHOOL_ACTION_NOT_ALLOWED');
  });
});

describe('school managers', () => {
  it('the Main Admin explicitly assigns a Main School manager; one active manager per school; history is kept', async () => {
    const t = await setup();
    const parent = await t.main();
    const first = await t.newUser();
    const second = await t.newUser();
    const a = await t.service.assignSchoolManager({ schoolId: parent.id, userId: first.id, actorId: t.admin.id });
    expect(a).toMatchObject({ source: 'MAIN_ADMIN_ASSIGNMENT', assignedBy: t.admin.id, isActive: true });
    expect(await t.roleService.listActiveRoles(first.id)).toEqual(['SCHOOL_MANAGER']);
    expect(await codeOf(t.service.assignSchoolManager({ schoolId: parent.id, userId: second.id, actorId: t.admin.id }))).toBe('SCHOOL_ALREADY_HAS_MANAGER');
    expect(await t.roleService.listActiveRoles(second.id)).toEqual([]); // the failed assignment left no role behind

    const revoked = await t.service.revokeSchoolManager({ schoolId: parent.id, actorId: t.admin.id });
    expect(revoked).toMatchObject({ isActive: false, revokedBy: t.admin.id });
    expect(await t.roleService.listActiveRoles(first.id)).toEqual(['SCHOOL_MANAGER']); // the role itself is not revoked here
    expect(await t.service.isSchoolManager(first.id, parent.id)).toBe(false);
    expect(await codeOf(t.service.revokeSchoolManager({ schoolId: parent.id, actorId: t.admin.id }))).toBe('SCHOOL_MANAGER_ASSIGNMENT_NOT_FOUND');

    await t.service.assignSchoolManager({ schoolId: parent.id, userId: second.id, actorId: t.admin.id });
    const history = await t.service.listManagerHistory(parent.id);
    expect(history.map((h) => [h.userId, h.isActive])).toEqual([[first.id, false], [second.id, true]]);
    expect(await t.service.getActiveManagerUserId(parent.id)).toBe(second.id);
  });

  it('requires an eligible user, an ACTIVE school and a Main Admin actor', async () => {
    const t = await setup();
    const parent = await t.main();
    const user = await t.newUser();
    const inactive = await t.newUser();
    await t.identity.deactivateUser(inactive.id);
    expect(await codeOf(t.service.assignSchoolManager({ schoolId: parent.id, userId: inactive.id, actorId: t.admin.id }))).toBe('SCHOOL_MANAGER_NOT_ELIGIBLE');
    expect(await codeOf(t.service.assignSchoolManager({ schoolId: parent.id, userId: user.id, actorId: user.id }))).toBe('SCHOOL_ACTION_NOT_ALLOWED');
    expect(await codeOf(t.service.assignSchoolManager({ schoolId: 'missing', userId: user.id, actorId: t.admin.id }))).toBe('SCHOOL_NOT_FOUND');
    const pending = await t.request(user.id, parent.id);
    expect(await codeOf(t.service.assignSchoolManager({ schoolId: pending.id, userId: user.id, actorId: t.admin.id }))).toBe('SCHOOL_NOT_ACTIVE');
    await t.service.deactivateSchool(parent.id, t.admin.id);
    expect(await codeOf(t.service.assignSchoolManager({ schoolId: parent.id, userId: user.id, actorId: t.admin.id }))).toBe('SCHOOL_NOT_ACTIVE');
    expect(t.managers.rows.size).toBe(0);
  });
});

describe('lookups', () => {
  it('finds by id and code; getById throws SCHOOL_NOT_FOUND', async () => {
    const t = await setup();
    const school = await t.main();
    expect(await t.service.findById(school.id)).toEqual(school);
    expect((await t.service.findByCode('SC-000001'))?.id).toBe(school.id);
    expect(await t.service.findById('missing')).toBeUndefined();
    expect(await t.service.findByCode('SC-999999')).toBeUndefined();
    expect(await codeOf(t.service.getById('missing'))).toBe('SCHOOL_NOT_FOUND');
  });
});
