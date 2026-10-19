import { describe, expect, it } from 'vitest';
import { ParentPermissions, PARENT_TARGET_TYPE } from '../../../src/modules/17-parents/public';
import { SCHOOL_TARGET_TYPE } from '../../../src/modules/16-schools/public';
import { createParentsHarness } from '../../helpers/parents-harness';

const NAME = 'أحمد محمد علي';
const ADDRESS = { kind: 'raw', text: 'المنيا / سمالوط' } as const;

/**
 * One account, several roles: the scope of each role stays the scope of ITS OWN assignments. Adding a role never widens another role's reach.
 */
describe('multi-role accounts and Parent scope', () => {
  it('an ORGANIZATION_MANAGER who manages ONE school (SCHOOL_MANAGER) can register Parents only for THAT school, not for the other schools of the organization', async () => {
    const t = await createParentsHarness();
    const schoolA = await t.newSchool('مدرسة أ');
    const schoolB = await t.newSchool('مدرسة ب');
    // the organization manager of the harness organization also becomes the School Manager of A only (same account, same password)
    await t.service.assignSchoolManager({ schoolId: schoolA.id, userId: t.orgAdmin.id, actorId: t.orgAdmin.id });
    expect((await t.h.roles.listActiveRoles(t.orgAdmin.id)).sort()).toEqual(['ORGANIZATION_MANAGER', 'SCHOOL_MANAGER']);

    const can = async (perm: string, target: { type: string; id: string }) => (await t.engine.authorize({ userId: t.orgAdmin.id, permission: perm, target })).allowed;
    expect(await can(ParentPermissions.CREATE, { type: SCHOOL_TARGET_TYPE, id: schoolA.id })).toBe(true);
    expect(await can(ParentPermissions.CREATE, { type: SCHOOL_TARGET_TYPE, id: schoolB.id })).toBe(false); // organization role grants no Parent permission
    expect(await can(ParentPermissions.LIST, { type: SCHOOL_TARGET_TYPE, id: schoolB.id })).toBe(false);

    const { parent } = await t.parents.registerParent({ schoolId: schoolA.id, name: 'محمود خالد سعيد', phone: '01001234567', address: ADDRESS }, t.orgAdmin.id);
    expect(await can(ParentPermissions.READ, { type: PARENT_TARGET_TYPE, id: parent.id })).toBe(true); // linked to the school they manage
    const otherManager = await t.newSchoolManager(schoolB.id);
    expect((await t.engine.authorize({ userId: otherManager.id, permission: ParentPermissions.READ, target: { type: PARENT_TARGET_TYPE, id: parent.id } })).allowed).toBe(false);
  });

  it('the same person as ORGANIZATION_MANAGER + SCHOOL_MANAGER + PARENT is ONE account; the Parent role adds only own-profile access and changes no password', async () => {
    const t = await createParentsHarness();
    const school = await t.newSchool('مدرسة أ');
    const person = await t.newNamedUser('ORGANIZATION_MANAGER', NAME, 'orgPass12');
    await t.service.assignSchoolManager({ schoolId: school.id, userId: person.id, actorId: t.orgAdmin.id });
    const accounts = t.h.users.rows.size;

    const result = await t.parents.registerParent({ schoolId: school.id, name: NAME, phone: person.phone, address: ADDRESS }, person.id);

    expect(result.accountCreated).toBe(false);
    expect(t.h.users.rows.size).toBe(accounts);
    expect((await t.h.roles.listActiveRoles(person.id)).sort()).toEqual(['ORGANIZATION_MANAGER', 'PARENT', 'SCHOOL_MANAGER']);
    const user = (await t.h.identity.findById(person.id))!;
    expect(user.mustChangePassword).toBe(false);
    expect(await t.h.identity.verifyPassword(person.id, 'orgPass12')).toBe(true);
    const auth = (perm: string, target?: { type: string; id: string }) => t.engine.authorize({ userId: person.id, permission: perm, ...(target ? { target } : {}) }).then((d) => d.allowed);
    expect(await auth(ParentPermissions.READ_OWN)).toBe(true);
    expect(await auth(ParentPermissions.CREATE, { type: SCHOOL_TARGET_TYPE, id: school.id })).toBe(true); // still only through the school manager link
  });
});
