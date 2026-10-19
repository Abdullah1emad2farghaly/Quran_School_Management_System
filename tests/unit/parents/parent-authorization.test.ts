import { describe, expect, it } from 'vitest';
import { createParentsHarness } from '../../helpers/parents-harness';
import { ParentPermissions, PARENT_TARGET_TYPE } from '../../../src/modules/17-parents/public';
import { SCHOOL_TARGET_TYPE } from '../../../src/modules/16-schools/public';

const ADDRESS = { kind: 'raw', text: 'المنيا / سمالوط' } as const;

async function setup() {
  const t = await createParentsHarness();
  const schoolA = await t.newSchool('مدرسة أ');
  const schoolB = await t.newSchool('مدرسة ب');
  const managerA = await t.newSchoolManager(schoolA.id);
  const managerB = await t.newSchoolManager(schoolB.id);
  const parent = await t.parents.registerParent({ schoolId: schoolA.id, name: 'أحمد محمد علي', phone: '01001234567', address: ADDRESS }, managerA.id);
  const allowed = async (userId: string, permission: string, target?: { type: string; id: string }) =>
    (await t.engine.authorize({ userId, permission, ...(target ? { target } : {}) })).allowed;
  return { t, schoolA, schoolB, managerA, managerB, parent: parent.parent, allowed };
}

describe('Parent permissions (deny by default, approved grants only)', () => {
  it('SCHOOL_MANAGER: create/list/remove-link on THEIR school only; read/update only a Parent linked to a school they manage', async () => {
    const { schoolA, schoolB, managerA, managerB, parent, allowed } = await setup();
    const onSchool = (s: { id: string }) => ({ type: SCHOOL_TARGET_TYPE, id: s.id });
    const onParent = { type: PARENT_TARGET_TYPE, id: parent.id };

    for (const perm of [ParentPermissions.CREATE, ParentPermissions.LIST, ParentPermissions.REMOVE_SCHOOL_LINK]) {
      expect(await allowed(managerA.id, perm, onSchool(schoolA)), `${perm} own school`).toBe(true);
      expect(await allowed(managerA.id, perm, onSchool(schoolB)), `${perm} other school`).toBe(false);
      expect(await allowed(managerB.id, perm, onSchool(schoolA)), `${perm} B on A`).toBe(false);
    }
    for (const perm of [ParentPermissions.READ, ParentPermissions.UPDATE]) {
      expect(await allowed(managerA.id, perm, onParent)).toBe(true);
      expect(await allowed(managerB.id, perm, onParent)).toBe(false); // linked only to school A
    }
  });

  it('a Parent linked to two schools is reachable by the manager of EITHER; ending a link removes only that school\'s access', async () => {
    const { t, schoolA, schoolB, managerA, managerB, parent, allowed } = await setup();
    await t.parents.registerParent({ schoolId: schoolB.id, name: 'أحمد محمد علي', phone: '01001234567', address: ADDRESS }, managerB.id);
    const onParent = { type: PARENT_TARGET_TYPE, id: parent.id };
    expect(await allowed(managerA.id, ParentPermissions.READ, onParent)).toBe(true);
    expect(await allowed(managerB.id, ParentPermissions.READ, onParent)).toBe(true);

    await t.parents.removeSchoolLink(parent.id, schoolA.id, managerA.id);
    expect(await allowed(managerA.id, ParentPermissions.READ, onParent)).toBe(false);
    expect(await allowed(managerB.id, ParentPermissions.READ, onParent)).toBe(true);
  });

  it('a manager of ANOTHER ORGANIZATION never reaches the parent or the school', async () => {
    const { t, schoolA, parent, allowed } = await setup();
    const org2 = await t.otherOrg();
    const school2 = await t.newSchool('مدرسة ثانية', org2.id);
    const manager2 = await t.newSchoolManager(school2.id, org2.id);
    expect(await allowed(manager2.id, ParentPermissions.READ, { type: PARENT_TARGET_TYPE, id: parent.id })).toBe(false);
    expect(await allowed(manager2.id, ParentPermissions.CREATE, { type: SCHOOL_TARGET_TYPE, id: schoolA.id })).toBe(false);
  });

  it('ORGANIZATION_MANAGER and MAIN_ADMIN get NO Parent permission merely from their role (even though the engine gives MAIN_ADMIN global scope)', async () => {
    const { t, schoolA, parent, allowed } = await setup();
    const mainAdmin = await t.h.createUser({ role: 'MAIN_ADMIN' });
    for (const user of [t.orgAdmin, mainAdmin]) {
      for (const perm of [ParentPermissions.CREATE, ParentPermissions.LIST, ParentPermissions.REMOVE_SCHOOL_LINK]) {
        expect(await allowed(user.id, perm, { type: SCHOOL_TARGET_TYPE, id: schoolA.id }), `${perm}`).toBe(false);
      }
      for (const perm of [ParentPermissions.READ, ParentPermissions.UPDATE]) {
        expect(await allowed(user.id, perm, { type: PARENT_TARGET_TYPE, id: parent.id }), `${perm}`).toBe(false);
      }
      expect(await allowed(user.id, ParentPermissions.READ_OWN)).toBe(false);
    }
  });

  it('PARENT may read their OWN profile only: no management permission, and read-own is unscoped (no id to forge)', async () => {
    const { schoolA, parent, allowed } = await setup();
    expect(await allowed(parent.userId, ParentPermissions.READ_OWN)).toBe(true);
    expect(await allowed(parent.userId, ParentPermissions.READ, { type: PARENT_TARGET_TYPE, id: parent.id })).toBe(false);
    expect(await allowed(parent.userId, ParentPermissions.UPDATE, { type: PARENT_TARGET_TYPE, id: parent.id })).toBe(false);
    expect(await allowed(parent.userId, ParentPermissions.CREATE, { type: SCHOOL_TARGET_TYPE, id: schoolA.id })).toBe(false);
  });

  it('a SCHOOL_MANAGER who is also a reused Parent keeps each role\'s own scope (scope through one role never authorizes the other)', async () => {
    const { t, managerA, parent, allowed } = await setup();
    expect(await allowed(managerA.id, ParentPermissions.READ_OWN)).toBe(false); // not a PARENT
    expect(parent.userId).not.toBe(managerA.id);
    expect(await t.h.roles.listActiveRoles(managerA.id)).toEqual(['SCHOOL_MANAGER']);
  });

  it('an unknown parent or school is never covered', async () => {
    const { managerA, allowed } = await setup();
    expect(await allowed(managerA.id, ParentPermissions.READ, { type: PARENT_TARGET_TYPE, id: '00000000-0000-4000-8000-000000000000' })).toBe(false);
    expect(await allowed(managerA.id, ParentPermissions.CREATE, { type: SCHOOL_TARGET_TYPE, id: '00000000-0000-4000-8000-000000000000' })).toBe(false);
  });
});
