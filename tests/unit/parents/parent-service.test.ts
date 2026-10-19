import { describe, expect, it } from 'vitest';
import { AppError } from '../../../src/modules/00-shared-kernel/public';
import { createParentsHarness } from '../../helpers/parents-harness';

const NAME = 'أحمد محمد علي';
const ADDRESS = { kind: 'raw', text: 'المنيا / سمالوط / برمشا' } as const;
const PHONE = '01001234567';
const E164 = '+201001234567';

const codeOf = (p: Promise<unknown>) => p.then(() => 'NO_ERROR', (e: unknown) => (e instanceof AppError ? e.code : `NOT_APP_ERROR:${String(e)}`));

async function setup() {
  const t = await createParentsHarness();
  const school = await t.newSchool();
  const manager = await t.newSchoolManager(school.id);
  const register = (over: Record<string, unknown> = {}, schoolId = school.id, actor = manager.id) =>
    t.parents.registerParent({ schoolId, name: NAME, phone: PHONE, address: ADDRESS, ...over } as never, actor);
  return { t, school, manager, register };
}

describe('registering a NEW parent', () => {
  it('creates the account (initial password = last four phone digits, flagged for a mandatory change), the PARENT role, the Parent, the address and the school link', async () => {
    const { t, school, manager, register } = await setup();
    const result = await register();

    expect(result.accountCreated).toBe(true);
    expect(result.parent).toMatchObject({ name: NAME, phone: E164, schoolIds: [school.id], organizationId: t.org.id });
    expect(result.parent.address).toMatchObject({ governorateName: 'المنيا', centerName: 'سمالوط', villageName: 'برمشا' });
    expect(result.link).toMatchObject({ schoolId: school.id, linkedBy: manager.id, isActive: true });

    const user = (await t.h.identity.findByPhone(PHONE))!;
    expect(user.mustChangePassword).toBe(true);
    expect(await t.h.identity.verifyPassword(user.id, '4567')).toBe(true);
    expect(await t.h.roles.listActiveRoles(user.id)).toEqual(['PARENT']);
    // the password (initial or otherwise) never appears in the result or the outbox payloads
    expect(JSON.stringify(result)).not.toMatch(/password|hash/i);
    expect(t.h.store.messages.map((m) => m.payload).join('')).not.toMatch(/password|hash/i);
  });

  it('publishes ParentRegistered and ParentSchoolLinked with identifiers only', async () => {
    const { t, register } = await setup();
    await register();
    const events = t.h.store.messages.filter((m) => m.aggregateType.startsWith('Parent'));
    expect(events.map((e) => e.eventType).sort()).toEqual(['ParentRegistered', 'ParentSchoolLinked']);
    for (const e of events) expect(e.payload).not.toMatch(/أحمد|0100|\+20/);
  });

  it('requires the school to exist and be ACTIVE', async () => {
    const { t, register, school } = await setup();
    expect(await codeOf(register({}, '00000000-0000-4000-8000-000000000000'))).toBe('PARENT_SCHOOL_NOT_ACTIVE');
    await t.service.deactivateSchool(school.id, t.orgAdmin.id);
    expect(await codeOf(register())).toBe('PARENT_SCHOOL_NOT_ACTIVE');
  });

  it('validates the name, the phone and the address before touching anything, and an invalid address creates no account', async () => {
    const { t, register } = await setup();
    expect(await codeOf(register({ name: 'أحمد محمد' }))).toBe('INVALID_PARENT_NAME'); // two parts
    expect(await codeOf(register({ name: 'أحمد محمد علي حسن' }))).toBe('INVALID_PARENT_NAME'); // four parts
    expect(await codeOf(register({ name: '   ' }))).toBe('INVALID_PARENT_NAME');
    expect(await codeOf(register({ name: undefined }))).toBe('INVALID_PARENT_NAME');
    expect(await codeOf(register({ phone: '123' }))).toBe('INVALID_PHONE_NUMBER');
    expect(await codeOf(register({ address: undefined }))).toBe('PARENT_ADDRESS_REQUIRED');
    expect(await codeOf(register({ address: { kind: 'raw', text: 'مدينة غير موجودة / سمالوط' } }))).toBe('PARENT_ADDRESS_GOVERNORATE_NOT_FOUND');
    expect(await codeOf(register({ address: { kind: 'structured', governorateId: t.gov.id, villageName: 'برمشا' } }))).toBe('INVALID_PARENT_ADDRESS');
    expect(await t.h.identity.findByPhone(PHONE)).toBeUndefined();
    expect(t.parentRepo.rows.size).toBe(0);
  });

  it('is atomic: a failure after the account was created rolls the account, role, parent and link back', async () => {
    const { t, register, school } = await setup();
    const original = t.links.insert.bind(t.links);
    t.links.insert = async () => {
      throw new Error('boom');
    };
    await expect(register()).rejects.toThrow('boom');
    t.links.insert = original;
    expect(await t.h.identity.findByPhone(PHONE)).toBeUndefined();
    expect(t.parentRepo.rows.size).toBe(0);
    expect(t.parentRepo.addresses).toHaveLength(0);
    // and the same registration works afterwards
    expect((await register()).parent.schoolIds).toEqual([school.id]);
  });
});

describe('address rules (§28)', () => {
  it('stores the components separately, accepts a governorate-only address and free-text center/village', async () => {
    const { register } = await setup();
    const governorateOnly = await register({ phone: '01002222222', address: { kind: 'raw', text: 'المنيا' } });
    expect(governorateOnly.parent.address).toMatchObject({ centerName: null, villageName: null });
    const free = await register({ phone: '01003333333', address: { kind: 'raw', text: 'المنيا / مدينة غير مسجلة / قرية غير مسجلة' } });
    expect(free.parent.address).toMatchObject({ centerName: 'مدينة غير مسجلة', villageName: 'قرية غير مسجلة' });
  });

  it('matches the governorate EXACTLY: no Arabic letter folding', async () => {
    const { register } = await setup();
    expect(await codeOf(register({ address: { kind: 'raw', text: 'المنيه' } }))).toBe('PARENT_ADDRESS_GOVERNORATE_NOT_FOUND');
    expect(await codeOf(register({ address: { kind: 'raw', text: 'المنيّا' } }))).toBe('PARENT_ADDRESS_GOVERNORATE_NOT_FOUND');
  });

  it('refuses a governorate of another country than the organization\'s (the country is never an input)', async () => {
    const { t, register } = await setup();
    expect(await codeOf(register({ address: { kind: 'structured', governorateId: t.paris.id } }))).toBe('PARENT_ADDRESS_COUNTRY_MISMATCH');
  });
});

describe('reusing an existing phone number', () => {
  it('reuses the Parent of the same organization (same full name) for another school WITHOUT touching the account, name or address', async () => {
    const { t, school, register } = await setup();
    const first = await register();
    const user = (await t.h.identity.findByPhone(PHONE))!;
    const second = await t.newSchool('مدرسة الهدى');
    const manager2 = await t.newSchoolManager(second.id);

    const result = await t.parents.registerParent({ schoolId: second.id, name: '  أحمد   محمد علي ', phone: '+20 100 123 4567', address: { kind: 'raw', text: 'المنيا / مطاي' } }, manager2.id);

    expect(result.accountCreated).toBe(false);
    expect(result.parent.id).toBe(first.parent.id);
    expect([...result.parent.schoolIds].sort()).toEqual([school.id, second.id].sort());
    expect(result.parent.address).toMatchObject({ centerName: 'سمالوط' }); // the stored address is NOT overwritten
    const after = (await t.h.identity.findByPhone(PHONE))!;
    expect(after.id).toBe(user.id);
    expect(after.mustChangePassword).toBe(true); // a pending requirement stays pending
    expect(await t.h.identity.verifyPassword(user.id, '4567')).toBe(true); // password untouched
    expect(await t.h.roles.listActiveRoles(user.id)).toEqual(['PARENT']);
  });

  it('does not create a new password-change requirement for a Parent who already changed the password', async () => {
    const { t, register } = await setup();
    await register();
    const user = (await t.h.identity.findByPhone(PHONE))!;
    await t.h.identity.changePassword(user.id, 'my-own-pass');
    const second = await t.newSchool('مدرسة الهدى');
    const manager2 = await t.newSchoolManager(second.id);
    await t.parents.registerParent({ schoolId: second.id, name: NAME, phone: PHONE, address: ADDRESS }, manager2.id);
    const after = (await t.h.identity.findByPhone(PHONE))!;
    expect(after.mustChangePassword).toBe(false);
    expect(await t.h.identity.verifyPassword(user.id, 'my-own-pass')).toBe(true);
  });

  it('answers a different name with PARENT_IDENTITY_CONFLICT and changes nothing', async () => {
    const { t, register } = await setup();
    await register();
    const second = await t.newSchool('مدرسة الهدى');
    const manager2 = await t.newSchoolManager(second.id);
    const attempt = t.parents.registerParent({ schoolId: second.id, name: 'محمود خالد سعيد', phone: PHONE, address: ADDRESS }, manager2.id);
    expect(await codeOf(attempt)).toBe('PARENT_IDENTITY_CONFLICT');
    expect(t.parentRepo.rows.size).toBe(1);
    expect(t.links.rows.size).toBe(1);
  });

  it('never folds Arabic letters when comparing the name (أحمد is not احمد)', async () => {
    const { t, register } = await setup();
    await register();
    const second = await t.newSchool('مدرسة الهدى');
    const manager2 = await t.newSchoolManager(second.id);
    expect(await codeOf(t.parents.registerParent({ schoolId: second.id, name: 'احمد محمد علي', phone: PHONE, address: ADDRESS }, manager2.id))).toBe('PARENT_IDENTITY_CONFLICT');
  });

  it('never reuses a Parent across organizations (PARENT_ORGANIZATION_CONFLICT)', async () => {
    const { t, register } = await setup();
    await register();
    const org2 = await t.otherOrg();
    const school2 = await t.newSchool('مدرسة المؤسسة الثانية', org2.id);
    const manager2 = await t.newSchoolManager(school2.id, org2.id);
    expect(await codeOf(t.parents.registerParent({ schoolId: school2.id, name: NAME, phone: PHONE, address: ADDRESS }, manager2.id))).toBe('PARENT_ORGANIZATION_CONFLICT');
  });

  it('refuses to link the same school twice, and an inactive account', async () => {
    const { t, register } = await setup();
    await register();
    expect(await codeOf(register())).toBe('PARENT_ALREADY_LINKED_TO_SCHOOL');
    const user = (await t.h.identity.findByPhone(PHONE))!;
    await t.h.identity.deactivateUser(user.id);
    const second = await t.newSchool('مدرسة الهدى');
    const manager2 = await t.newSchoolManager(second.id);
    expect(await codeOf(t.parents.registerParent({ schoolId: second.id, name: NAME, phone: PHONE, address: ADDRESS }, manager2.id))).toBe('PARENT_ACCOUNT_INACTIVE');
  });

  it('stores the personal name on the ACCOUNT (once) and nowhere else', async () => {
    const { t, register } = await setup();
    const { parent } = await register({ name: '  أحمد   محمد  علي ' });
    const user = (await t.h.identity.findByPhone(PHONE))!;
    expect(user.fullName).toBe(NAME);
    expect(parent.name).toBe(NAME);
    expect(JSON.stringify([...t.parentRepo.rows.values()])).not.toContain('أحمد');
  });

  it('an existing ORGANIZATION_MANAGER account with the SAME stored name is reused: same account, password and security state, plus the PARENT role', async () => {
    const { t, school, register } = await setup();
    const orgManager = await t.newNamedUser('ORGANIZATION_MANAGER', NAME, 'org-pass1');

    const result = await register({ phone: orgManager.phone, name: '  أحمد  محمد   علي ' });

    expect(result.accountCreated).toBe(false);
    expect(result.parent).toMatchObject({ userId: orgManager.id, schoolIds: [school.id], name: NAME });
    const after = (await t.h.identity.findById(orgManager.id))!;
    expect(after.mustChangePassword).toBe(false); // no new requirement merely because a role was added
    expect(after.fullName).toBe(NAME); // the stored name is untouched
    expect(await t.h.identity.verifyPassword(orgManager.id, 'org-pass1')).toBe(true); // password untouched
    expect((await t.h.roles.listActiveRoles(orgManager.id)).sort()).toEqual(['ORGANIZATION_MANAGER', 'PARENT']);
    expect(await t.h.identity.findByPhone(orgManager.phone)).toMatchObject({ id: orgManager.id }); // still ONE account for that phone
  });

  it('an existing SCHOOL_MANAGER account with the same stored name can also become a Parent (one account, two roles)', async () => {
    const { t, school, manager, register } = await setup();
    await t.h.identity.ensureFullName(manager.id, NAME);
    const managerPhone = (await t.h.identity.findById(manager.id))!.phone;
    const result = await register({ phone: managerPhone });
    expect(result.parent.userId).toBe(manager.id);
    expect((await t.h.roles.listActiveRoles(manager.id)).sort()).toEqual(['PARENT', 'SCHOOL_MANAGER']);
    expect(result.parent.schoolIds).toEqual([school.id]);
  });

  it('an existing account whose stored name is MISSING or DIFFERENT is PARENT_IDENTITY_CONFLICT and nothing changes', async () => {
    const { t, register } = await setup();
    const nameless = await t.h.createUser({ role: 'ORGANIZATION_MANAGER', password: 'org-pass1' });
    expect(await codeOf(register({ phone: nameless.phone }))).toBe('PARENT_IDENTITY_CONFLICT'); // existing name missing
    const other = await t.newNamedUser('ORGANIZATION_MANAGER', 'محمود خالد سعيد', 'org-pass2');
    expect(await codeOf(register({ phone: other.phone }))).toBe('PARENT_IDENTITY_CONFLICT'); // different name
    expect(await codeOf(register({ phone: other.phone, name: 'محمود خالد' }))).toBe('INVALID_PARENT_NAME');
    for (const u of [nameless, other]) {
      expect(await t.h.roles.listActiveRoles(u.id)).toEqual(['ORGANIZATION_MANAGER']);
      expect((await t.h.identity.findById(u.id))!.mustChangePassword).toBe(false);
    }
    expect((await t.h.identity.findById(nameless.id))!.fullName).toBeNull(); // the submitted name never fills or overwrites an account's name
    expect(t.parentRepo.rows.size).toBe(0);
  });

  it('keeps a pending password change of a reused account, and never adds one to an account without it', async () => {
    const { t, register } = await setup();
    const pending = await t.h.createUser({ role: 'TEACHER', password: '1111', mustChangePassword: true, fullName: NAME });
    await register({ phone: pending.phone });
    expect((await t.h.identity.findById(pending.id))!.mustChangePassword).toBe(true);
    expect(await t.h.identity.verifyPassword(pending.id, '1111')).toBe(true);
  });
});

describe('update, history and school links', () => {
  it('a new address becomes current and the previous one stays in the history with its governorate name', async () => {
    const { t, register } = await setup();
    const { parent } = await register();
    const manager = (await t.parents.listActiveSchoolIds(parent.id))[0]!;
    expect(manager).toBeTruthy();

    const updated = await t.parents.updateParent(parent.id, { address: { kind: 'raw', text: 'المنيا / مطاي' } }, t.orgAdmin.id);
    expect(updated.address).toMatchObject({ centerName: 'مطاي', villageName: null });
    const history = await t.parents.listAddressHistory(parent.id);
    expect(history.map((h) => h.centerName)).toEqual(['سمالوط', 'مطاي']);
    expect(history[0]!.endedAt).not.toBeNull();
    expect(history[1]!.endedAt).toBeNull();
    expect(history[0]!.governorateName).toBe('المنيا');
  });

  it('an unchanged address writes nothing; an empty update is refused; the name is not updatable here', async () => {
    const { t, register } = await setup();
    const { parent } = await register();
    const before = t.h.store.messages.length;
    await t.parents.updateParent(parent.id, { address: ADDRESS }, t.orgAdmin.id);
    expect(t.h.store.messages.length).toBe(before);
    expect((await t.parents.listAddressHistory(parent.id)).length).toBe(1);
    expect(await codeOf(t.parents.updateParent(parent.id, {}, t.orgAdmin.id))).toBe('PARENT_UPDATE_EMPTY');
    expect(await codeOf(t.parents.updateParent('00000000-0000-4000-8000-000000000000', { address: ADDRESS }, t.orgAdmin.id))).toBe('PARENT_NOT_FOUND');
    expect((await t.parents.getParent(parent.id)).name).toBe(NAME);
  });

  it('removing a school link keeps the account, the Parent, the address history and the OTHER links; the ended link stays in the history; re-linking works', async () => {
    const { t, school, register } = await setup();
    const first = await register();
    const second = await t.newSchool('مدرسة الهدى');
    const manager2 = await t.newSchoolManager(second.id);
    await t.parents.registerParent({ schoolId: second.id, name: NAME, phone: PHONE, address: ADDRESS }, manager2.id);

    const removed = await t.parents.removeSchoolLink(first.parent.id, school.id, manager2.id);
    expect(removed).toMatchObject({ isActive: false, unlinkedBy: manager2.id });
    const after = await t.parents.getParent(first.parent.id);
    expect(after.schoolIds).toEqual([second.id]);
    expect(await t.h.identity.findByPhone(PHONE)).toBeTruthy();
    expect((await t.parents.listAddressHistory(first.parent.id)).length).toBe(1);
    expect((await t.parents.listSchoolLinkHistory(first.parent.id)).map((l) => l.isActive).sort()).toEqual([false, true]); // the test clock is frozen, so only the content is checked
    expect(await t.parents.isLinkedToSchool(first.parent.id, school.id)).toBe(false);

    expect(await codeOf(t.parents.removeSchoolLink(first.parent.id, school.id, manager2.id))).toBe('PARENT_SCHOOL_LINK_NOT_FOUND');
    expect(await codeOf(t.parents.removeSchoolLink('00000000-0000-4000-8000-000000000000', school.id, manager2.id))).toBe('PARENT_NOT_FOUND');

    const relinked = await t.parents.registerParent({ schoolId: school.id, name: NAME, phone: PHONE, address: ADDRESS }, manager2.id);
    expect(relinked.accountCreated).toBe(false);
    expect((await t.parents.listSchoolLinkHistory(first.parent.id)).length).toBe(3);
  });

  it('lists only the Parents actively linked to the school, sorted and paginated', async () => {
    const { t, school, register } = await setup();
    await register({ phone: '01001111111', name: 'ب ب ب' });
    await register({ phone: '01002222222', name: 'أ أ أ' });
    const other = await t.newSchool('مدرسة الهدى');
    const m2 = await t.newSchoolManager(other.id);
    await t.parents.registerParent({ schoolId: other.id, name: 'ج ج ج', phone: '01003333333', address: ADDRESS }, m2.id);

    const page = await t.parents.listParentsOfSchool({ schoolId: school.id, sort: 'createdAt', direction: 'asc', page: { page: 1, pageSize: 1 } });
    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(2);
  });

  it('refuses to unlink a Parent who still has students in the school, and unlinks once none depend on it', async () => {
    const { t, school, manager, register } = await setup();
    const { parent } = await register();
    t.studentCounts.set(`${parent.id}:${school.id}`, 2);
    expect(await codeOf(t.parents.removeSchoolLink(parent.id, school.id, manager.id))).toBe('PARENT_HAS_STUDENTS_IN_SCHOOL');
    expect(await t.parents.isLinkedToSchool(parent.id, school.id)).toBe(true); // nothing changed
    expect((await t.parents.listSchoolLinkHistory(parent.id)).map((l) => l.isActive)).toEqual([true]);
    t.studentCounts.set(`${parent.id}:${school.id}`, 0);
    expect((await t.parents.removeSchoolLink(parent.id, school.id, manager.id)).isActive).toBe(false);
  });

  it('own profile: found for a Parent, PARENT_NOT_FOUND for any other account', async () => {
    const { t, register } = await setup();
    const { parent } = await register();
    expect((await t.parents.getOwnProfile(parent.userId)).id).toBe(parent.id);
    expect(await codeOf(t.parents.getOwnProfile(t.orgAdmin.id))).toBe('PARENT_NOT_FOUND');
  });
});
