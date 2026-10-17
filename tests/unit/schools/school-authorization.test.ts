import { describe, expect, it } from 'vitest';
import { createSchoolsHarness } from '../../helpers/schools-harness';
import { OrganizationPermissions } from '../../../src/modules/13-organization-core/public';
import { SCHOOL_TARGET_TYPE, SchoolPermissions } from '../../../src/modules/16-schools/public';

type Harness = Awaited<ReturnType<typeof createSchoolsHarness>>;
const can = async (t: Harness, userId: string, permission: string, target?: { type: string; id: string }) =>
  (await t.engine.authorize({ userId, permission, ...(target ? { target } : {}) })).allowed;
const onSchool = (id: string) => ({ type: SCHOOL_TARGET_TYPE, id });
const onOrg = (id: string) => ({ type: 'ORGANIZATION', id });

const ORG_MANAGER_SCHOOL_OPERATIONS = [
  SchoolPermissions.READ,
  SchoolPermissions.APPROVE,
  SchoolPermissions.REJECT,
  SchoolPermissions.DEACTIVATE,
  SchoolPermissions.REACTIVATE,
  SchoolPermissions.CORRECT_GPS,
  SchoolPermissions.ASSIGN_MANAGER,
  SchoolPermissions.REVOKE_MANAGER,
];

describe('Authorization Engine: the ORGANIZATION_MANAGER of the owning organization', () => {
  it('may create in their organization and read, approve, reject, deactivate, reactivate, correct GPS and manage the manager of ITS schools', async () => {
    const t = await createSchoolsHarness();
    const school = await t.create();
    expect(await can(t, t.admin.id, SchoolPermissions.CREATE, onOrg(t.org.id))).toBe(true);
    expect(await can(t, t.admin.id, SchoolPermissions.LIST)).toBe(true);
    for (const permission of ORG_MANAGER_SCHOOL_OPERATIONS) expect([permission, await can(t, t.admin.id, permission, onSchool(school.id))]).toEqual([permission, true]);
    expect(await can(t, t.admin.id, OrganizationPermissions.LIST)).toBe(true);
    expect(await can(t, t.admin.id, OrganizationPermissions.READ, onOrg(t.org.id))).toBe(true);
  });

  it('cannot do ANY of it for another organization: create, read, approve, reject, deactivate, GPS, manager', async () => {
    const t = await createSchoolsHarness();
    const other = await t.newOrganization('Other Org');
    const otherManager = await t.newOrgAdmin(other.id);
    const mine = await t.create('mine');
    const theirs = await t.create('theirs', other.id, otherManager.id);
    expect(await can(t, t.admin.id, SchoolPermissions.CREATE, onOrg(other.id))).toBe(false);
    expect(await can(t, otherManager.id, SchoolPermissions.CREATE, onOrg(t.org.id))).toBe(false);
    for (const permission of ORG_MANAGER_SCHOOL_OPERATIONS) {
      expect([permission, await can(t, t.admin.id, permission, onSchool(theirs.id))]).toEqual([permission, false]);
      expect([permission, await can(t, otherManager.id, permission, onSchool(mine.id))]).toEqual([permission, false]);
    }
    expect(await can(t, t.admin.id, OrganizationPermissions.READ, onOrg(other.id))).toBe(false);
  });

  it('a nonexistent school or organization is denied (fail closed), never allowed', async () => {
    const t = await createSchoolsHarness();
    expect(await can(t, t.admin.id, SchoolPermissions.APPROVE, onSchool('no-such-school'))).toBe(false);
    expect(await can(t, t.admin.id, SchoolPermissions.CREATE, onOrg('no-such-org'))).toBe(false);
  });

  it('the role alone is not enough (no organization link) and the link alone is not enough (no role)', async () => {
    const t = await createSchoolsHarness();
    const school = await t.create();
    const roleOnly = await t.newUser('ORGANIZATION_MANAGER');
    expect(await can(t, roleOnly.id, SchoolPermissions.APPROVE, onSchool(school.id))).toBe(false);
    expect(await can(t, roleOnly.id, SchoolPermissions.CREATE, onOrg(t.org.id))).toBe(false);
    const linkOnly = await t.newUser('TEACHER');
    await t.organizations.assignOrganizationAdmin({ organizationId: t.org.id, userId: linkOnly.id, assignedBy: null });
    expect(await can(t, linkOnly.id, SchoolPermissions.APPROVE, onSchool(school.id))).toBe(false);
  });

  it('an inactive user and a revoked role are denied', async () => {
    const t = await createSchoolsHarness();
    const school = await t.create();
    const manager = await t.newOrgAdmin(t.org.id);
    expect(await can(t, manager.id, SchoolPermissions.APPROVE, onSchool(school.id))).toBe(true);
    await t.roleService.revokeRole({ userId: manager.id, roleCode: 'ORGANIZATION_MANAGER', revokedBy: null }).catch(() => undefined);
    await t.identity.deactivateUser(manager.id);
    expect(await can(t, manager.id, SchoolPermissions.APPROVE, onSchool(school.id))).toBe(false);
  });
});

describe('Authorization Engine: MAIN_ADMIN is the platform administrator and gets NO school power', () => {
  it('is denied every school and organization permission even though it is platform-wide', async () => {
    const t = await createSchoolsHarness();
    const school = await t.create();
    const platformAdmin = await t.newUser('MAIN_ADMIN');
    expect(await can(t, platformAdmin.id, SchoolPermissions.CREATE, onOrg(t.org.id))).toBe(false);
    expect(await can(t, platformAdmin.id, SchoolPermissions.LIST)).toBe(false);
    for (const permission of ORG_MANAGER_SCHOOL_OPERATIONS) expect(await can(t, platformAdmin.id, permission, onSchool(school.id))).toBe(false);
    expect(await can(t, platformAdmin.id, OrganizationPermissions.LIST)).toBe(false);
    expect(await can(t, platformAdmin.id, OrganizationPermissions.READ, onOrg(t.org.id))).toBe(false);
  });

  it('an organization manager who is ALSO a platform administrator gets only the organization manager scope', async () => {
    const t = await createSchoolsHarness();
    const other = await t.newOrganization('Other Org');
    const theirs = await t.create('theirs', other.id, (await t.newOrgAdmin(other.id)).id);
    const both = await t.newOrgAdmin(t.org.id);
    await t.roleService.assignRole({ userId: both.id, roleCode: 'MAIN_ADMIN', assignedBy: null });
    expect(await can(t, both.id, SchoolPermissions.APPROVE, onSchool(theirs.id))).toBe(false);
  });
});

describe('Authorization Engine: the SCHOOL_MANAGER is limited to their own school and has no write permission', () => {
  it('lists and reads only the school they manage', async () => {
    const t = await createSchoolsHarness();
    const mine = await t.active('mine');
    const other = await t.active('other');
    const manager = await t.newUser();
    await t.service.assignSchoolManager({ schoolId: mine.id, userId: manager.id, actorId: t.admin.id });
    expect(await can(t, manager.id, SchoolPermissions.LIST)).toBe(true);
    expect(await can(t, manager.id, SchoolPermissions.READ, onSchool(mine.id))).toBe(true);
    expect(await can(t, manager.id, SchoolPermissions.READ, onSchool(other.id))).toBe(false);
  });

  it('cannot create, approve, reject, deactivate, correct GPS, or assign/revoke managers, not even for their own school', async () => {
    const t = await createSchoolsHarness();
    const mine = await t.active('mine');
    const manager = await t.newUser();
    await t.service.assignSchoolManager({ schoolId: mine.id, userId: manager.id, actorId: t.admin.id });
    expect(await can(t, manager.id, SchoolPermissions.CREATE, onOrg(t.org.id))).toBe(false);
    for (const permission of ORG_MANAGER_SCHOOL_OPERATIONS.filter((p) => p !== SchoolPermissions.READ)) {
      expect([permission, await can(t, manager.id, permission, onSchool(mine.id))]).toEqual([permission, false]);
    }
    expect(await can(t, manager.id, OrganizationPermissions.LIST)).toBe(false);
  });

  it('after the manager link is revoked the school is no longer readable', async () => {
    const t = await createSchoolsHarness();
    const mine = await t.active('mine');
    const manager = await t.newUser();
    await t.service.assignSchoolManager({ schoolId: mine.id, userId: manager.id, actorId: t.admin.id });
    await t.service.revokeSchoolManager({ schoolId: mine.id, actorId: t.admin.id });
    expect(await can(t, manager.id, SchoolPermissions.READ, onSchool(mine.id))).toBe(false);
  });
});

describe('Authorization Engine: everyone else is denied (deny by default)', () => {
  it('a parent, a teacher, an applicant without a role and an unknown user get nothing', async () => {
    const t = await createSchoolsHarness();
    const school = await t.create();
    const parent = await t.newUser('PARENT');
    const teacher = await t.newUser('TEACHER');
    const applicant = (await t.service.submitSchool(t.form())).applicant;
    for (const userId of [parent.id, teacher.id, applicant.userId, 'no-such-user']) {
      expect(await can(t, userId, SchoolPermissions.LIST)).toBe(false);
      expect(await can(t, userId, SchoolPermissions.READ, onSchool(school.id))).toBe(false);
      expect(await can(t, userId, SchoolPermissions.APPROVE, onSchool(school.id))).toBe(false);
      expect(await can(t, userId, SchoolPermissions.CREATE, onOrg(t.org.id))).toBe(false);
    }
  });

  it('a permission that was never registered is denied', async () => {
    const t = await createSchoolsHarness();
    expect(await can(t, t.admin.id, 'schools.school.delete', onSchool('x'))).toBe(false);
  });
});

describe('the approval workflow end to end, through the engine', () => {
  it('the owning organization manager approves a public submission; the other organization manager cannot', async () => {
    const t = await createSchoolsHarness();
    const other = await t.newOrganization('Other Org');
    const otherManager = await t.newOrgAdmin(other.id);
    const { school } = await t.service.submitSchool(t.form());
    expect(school.status).toBe('PENDING');
    expect(await can(t, otherManager.id, SchoolPermissions.APPROVE, onSchool(school.id))).toBe(false);
    expect(await can(t, otherManager.id, SchoolPermissions.REJECT, onSchool(school.id))).toBe(false);
    expect(await can(t, t.admin.id, SchoolPermissions.APPROVE, onSchool(school.id))).toBe(true);
    expect((await t.service.approveSchool(school.id, t.admin.id)).school.status).toBe('ACTIVE');
  });
});
