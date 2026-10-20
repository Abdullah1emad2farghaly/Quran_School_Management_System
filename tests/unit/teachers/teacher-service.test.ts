import { describe, expect, it } from 'vitest';
import { AppError } from '../../../src/modules/00-shared-kernel/public';
import { createTeachersHarness } from '../../helpers/teachers-harness';

const NAME = 'خالد أحمد حسن';
const PHONE = '01001234568';
const E164 = '+201001234568';
const codeOf = (p: Promise<unknown>) => p.then(() => 'NO_ERROR', (e: unknown) => (e instanceof AppError ? e.code : `NOT_APP_ERROR:${String(e)}`));

async function setup() {
  const t = await createTeachersHarness();
  const school = await t.newSchool();
  const manager = await t.newSchoolManager(school.id);
  const register = (over: Record<string, unknown> = {}, schoolId = school.id, actor = manager.id) =>
    t.teachers.registerTeacher({ schoolId, name: NAME, phone: PHONE, ...over } as never, actor);
  return { t, school, manager, register };
}

describe('registering a NEW teacher: initial password and mandatory first-login change', () => {
  it('creates the account (name stored on it, initial password = last four phone digits, pending change), the TEACHER role, the Teacher and the school link', async () => {
    const { t, school, manager, register } = await setup();
    const result = await register();

    expect(result.accountCreated).toBe(true);
    expect(result.teacher).toMatchObject({ name: NAME, phone: E164, schoolIds: [school.id], organizationId: t.org.id });
    expect(result.link).toMatchObject({ schoolId: school.id, linkedBy: manager.id, isActive: true });

    const user = (await t.h.identity.findByPhone(PHONE))!;
    expect(user.fullName).toBe(NAME);
    expect(user.mustChangePassword).toBe(true);
    expect(await t.h.identity.verifyPassword(user.id, '4568')).toBe(true); // last four digits of +201001234568
    expect(await t.h.roles.listActiveRoles(user.id)).toEqual(['TEACHER']);
  });

  it('never returns or publishes the password, and stores only a hash', async () => {
    const { t, register } = await setup();
    const result = await register();
    expect(JSON.stringify(result)).not.toMatch(/password|hash/i);
    expect(t.h.store.messages.map((m) => m.payload).join('')).not.toMatch(/password|hash|4568/i);
    const user = (await t.h.identity.findByPhone(PHONE))!;
    const row = t.h.users.rows.get(user.id)!;
    expect(row.passwordHash).not.toContain('4568');
    expect(row.passwordHash).toMatch(/^\$2[aby]\$/); // bcrypt
  });

  it('publishes TeacherRegistered and TeacherSchoolLinked with identifiers only, and stores no name on the Teacher record', async () => {
    const { t, register } = await setup();
    await register();
    const events = t.h.store.messages.filter((m) => m.aggregateType.startsWith('Teacher'));
    expect(events.map((e) => e.eventType).sort()).toEqual(['TeacherRegistered', 'TeacherSchoolLinked']);
    for (const e of events) expect(e.payload).not.toMatch(/خالد|0100|\+20/);
    expect(JSON.stringify([...t.teacherRepo.rows.values()])).not.toContain('خالد');
  });

  it('requires an ACTIVE school and an exactly-three-part name and a valid phone, and creates nothing on failure', async () => {
    const { t, register, school } = await setup();
    expect(await codeOf(register({}, '00000000-0000-4000-8000-000000000000'))).toBe('TEACHER_SCHOOL_NOT_ACTIVE');
    expect(await codeOf(register({ name: 'خالد أحمد' }))).toBe('INVALID_TEACHER_NAME');
    expect(await codeOf(register({ name: 'خالد أحمد حسن علي' }))).toBe('INVALID_TEACHER_NAME');
    expect(await codeOf(register({ name: '   ' }))).toBe('INVALID_TEACHER_NAME');
    expect(await codeOf(register({ name: undefined }))).toBe('INVALID_TEACHER_NAME');
    expect(await codeOf(register({ phone: '123' }))).toBe('INVALID_PHONE_NUMBER');
    await t.service.deactivateSchool(school.id, t.orgAdmin.id);
    expect(await codeOf(register())).toBe('TEACHER_SCHOOL_NOT_ACTIVE');
    expect(await t.h.identity.findByPhone(PHONE)).toBeUndefined();
    expect(t.teacherRepo.rows.size).toBe(0);
  });

  it('is atomic: a failure after the account was created rolls the account, role, teacher and link back', async () => {
    const { t, register } = await setup();
    const original = t.teacherLinks.insert.bind(t.teacherLinks);
    t.teacherLinks.insert = async () => {
      throw new Error('boom');
    };
    await expect(register()).rejects.toThrow('boom');
    t.teacherLinks.insert = original;
    expect(await t.h.identity.findByPhone(PHONE)).toBeUndefined();
    expect(t.teacherRepo.rows.size).toBe(0);
    expect((await register()).accountCreated).toBe(true);
  });
});

describe('reusing an existing account: identity by the stored three-part name, security state untouched', () => {
  it('reuses a Teacher of the same organization for another school (same name) without touching name, password or flag', async () => {
    const { t, school, register } = await setup();
    const first = await register();
    const user = (await t.h.identity.findByPhone(PHONE))!;
    const second = await t.newSchool('مدرسة الهدى');
    const manager2 = await t.newSchoolManager(second.id);

    const result = await t.teachers.registerTeacher({ schoolId: second.id, name: '  خالد   أحمد حسن ', phone: '+20 100 123 4568' }, manager2.id);

    expect(result.accountCreated).toBe(false);
    expect(result.teacher.id).toBe(first.teacher.id);
    expect([...result.teacher.schoolIds].sort()).toEqual([school.id, second.id].sort());
    const after = (await t.h.identity.findByPhone(PHONE))!;
    expect(after.id).toBe(user.id);
    expect(after.mustChangePassword).toBe(true); // a pending requirement stays pending
    expect(await t.h.identity.verifyPassword(user.id, '4568')).toBe(true);
    expect(after.fullName).toBe(NAME);
    expect(await t.h.roles.listActiveRoles(user.id)).toEqual(['TEACHER']);
  });

  it('a Teacher who already changed the password gets no new requirement and keeps the chosen password when linked to another school', async () => {
    const { t, register } = await setup();
    await register();
    const user = (await t.h.identity.findByPhone(PHONE))!;
    await t.h.identity.changePassword(user.id, 'my-own-pass');
    const second = await t.newSchool('مدرسة الهدى');
    const manager2 = await t.newSchoolManager(second.id);
    await t.teachers.registerTeacher({ schoolId: second.id, name: NAME, phone: PHONE }, manager2.id);
    const after = (await t.h.identity.findByPhone(PHONE))!;
    expect(after.mustChangePassword).toBe(false);
    expect(await t.h.identity.verifyPassword(user.id, 'my-own-pass')).toBe(true);
  });

  it('an existing ORGANIZATION_MANAGER / SCHOOL_MANAGER / Parent with the SAME stored name becomes a Teacher on the SAME account, password and flag unchanged', async () => {
    const { t, school, manager, register } = await setup();
    const orgManager = await t.newNamedUser('ORGANIZATION_MANAGER', NAME, 'org-pass1');
    const result = await register({ phone: orgManager.phone });
    expect(result.accountCreated).toBe(false);
    expect(result.teacher.userId).toBe(orgManager.id);
    expect(result.teacher.schoolIds).toEqual([school.id]);
    expect((await t.h.roles.listActiveRoles(orgManager.id)).sort()).toEqual(['ORGANIZATION_MANAGER', 'TEACHER']);
    const after = (await t.h.identity.findById(orgManager.id))!;
    expect(after.mustChangePassword).toBe(false);
    expect(await t.h.identity.verifyPassword(orgManager.id, 'org-pass1')).toBe(true);

    // a Parent of the same organization: one account, Parent + Teacher
    const parentSchool = await t.newSchool('مدرسة أخرى');
    const parentManager = await t.newSchoolManager(parentSchool.id);
    const parent = await t.parents.registerParent({ schoolId: parentSchool.id, name: 'سارة محمد علي', phone: '01002223334', address: { kind: 'raw', text: 'المنيا' } }, parentManager.id);
    const asTeacher = await t.teachers.registerTeacher({ schoolId: school.id, name: 'سارة محمد علي', phone: '01002223334' }, manager.id);
    expect(asTeacher.teacher.userId).toBe(parent.parent.userId);
    expect((await t.h.roles.listActiveRoles(parent.parent.userId)).sort()).toEqual(['PARENT', 'TEACHER']);
    expect((await t.h.identity.findById(parent.parent.userId))!.mustChangePassword).toBe(true); // the Parent's own pending change is preserved
  });

  it('keeps a pending password change of a reused account, and never adds one to an account without it', async () => {
    const { t, register } = await setup();
    const pending = await t.h.createUser({ role: 'PARENT', password: '1111', mustChangePassword: true, fullName: NAME });
    await register({ phone: pending.phone });
    expect((await t.h.identity.findById(pending.id))!.mustChangePassword).toBe(true);
    expect(await t.h.identity.verifyPassword(pending.id, '1111')).toBe(true);
    const clean = await t.h.createUser({ role: 'SCHOOL_MANAGER', password: 'clean-pass1', fullName: 'منى حسن علي' });
    await register({ phone: clean.phone, name: 'منى حسن علي' });
    expect((await t.h.identity.findById(clean.id))!.mustChangePassword).toBe(false);
  });

  it('a missing or different stored name is TEACHER_IDENTITY_CONFLICT; nothing is overwritten, merged or added', async () => {
    const { t, register } = await setup();
    const nameless = await t.h.createUser({ role: 'ORGANIZATION_MANAGER', password: 'org-pass1' });
    expect(await codeOf(register({ phone: nameless.phone }))).toBe('TEACHER_IDENTITY_CONFLICT');
    const other = await t.newNamedUser('ORGANIZATION_MANAGER', 'محمود خالد سعيد', 'org-pass2');
    expect(await codeOf(register({ phone: other.phone }))).toBe('TEACHER_IDENTITY_CONFLICT');
    expect(await codeOf(register({ phone: other.phone, name: 'احمد خالد سعيد' }))).toBe('TEACHER_IDENTITY_CONFLICT');
    for (const u of [nameless, other]) {
      expect(await t.h.roles.listActiveRoles(u.id)).toEqual(['ORGANIZATION_MANAGER']);
      expect((await t.h.identity.findById(u.id))!.mustChangePassword).toBe(false);
    }
    expect((await t.h.identity.findById(nameless.id))!.fullName).toBeNull();
    expect((await t.h.identity.findById(other.id))!.fullName).toBe('محمود خالد سعيد');
    expect(t.teacherRepo.rows.size).toBe(0);
  });

  it('Arabic letters are never folded in the name match', async () => {
    const { t, register } = await setup();
    await register({ name: 'أحمد محمد علي', phone: '01005556667' });
    const second = await t.newSchool('مدرسة الهدى');
    const manager2 = await t.newSchoolManager(second.id);
    expect(await codeOf(t.teachers.registerTeacher({ schoolId: second.id, name: 'احمد محمد علي', phone: '01005556667' }, manager2.id))).toBe('TEACHER_IDENTITY_CONFLICT');
  });

  it('never reuses a Teacher, or a Parent account, across organizations; refuses an inactive account and a double link', async () => {
    const { t, register } = await setup();
    await register();
    const org2 = await t.otherOrg();
    const school2 = await t.newSchool('مدرسة المؤسسة الثانية', org2.id);
    const manager2 = await t.newSchoolManager(school2.id, org2.id);
    expect(await codeOf(t.teachers.registerTeacher({ schoolId: school2.id, name: NAME, phone: PHONE }, manager2.id))).toBe('TEACHER_ORGANIZATION_CONFLICT');

    // a Parent of the first organization cannot become a Teacher in the second one
    const school1 = await t.newSchool('مدرسة أ');
    const manager1 = await t.newSchoolManager(school1.id);
    const parent = await t.parents.registerParent({ schoolId: school1.id, name: 'سارة محمد علي', phone: '01007778889', address: { kind: 'raw', text: 'المنيا' } }, manager1.id);
    expect(await codeOf(t.teachers.registerTeacher({ schoolId: school2.id, name: 'سارة محمد علي', phone: '01007778889' }, manager2.id))).toBe('TEACHER_ORGANIZATION_CONFLICT');
    expect(await t.h.roles.listActiveRoles(parent.parent.userId)).toEqual(['PARENT']);

    expect(await codeOf(register())).toBe('TEACHER_ALREADY_LINKED_TO_SCHOOL');
    const user = (await t.h.identity.findByPhone(PHONE))!;
    await t.h.identity.deactivateUser(user.id);
    const second = await t.newSchool('مدرسة الهدى');
    const m = await t.newSchoolManager(second.id);
    expect(await codeOf(t.teachers.registerTeacher({ schoolId: second.id, name: NAME, phone: PHONE }, m.id))).toBe('TEACHER_ACCOUNT_INACTIVE');
  });
});

describe('school links, lists and own profile', () => {
  it('removing a link keeps the account, the Teacher and the other links; history is kept; re-linking works; the groups guard blocks removal', async () => {
    const { t, school, register } = await setup();
    const first = await register();
    const second = await t.newSchool('مدرسة الهدى');
    const manager2 = await t.newSchoolManager(second.id);
    await t.teachers.registerTeacher({ schoolId: second.id, name: NAME, phone: PHONE }, manager2.id);

    t.groupCounts.set(`${first.teacher.id}:${school.id}`, 2);
    expect(await codeOf(t.teachers.removeSchoolLink(first.teacher.id, school.id, manager2.id))).toBe('TEACHER_HAS_GROUPS_IN_SCHOOL');
    expect(await t.teachers.isLinkedToSchool(first.teacher.id, school.id)).toBe(true);
    t.groupCounts.set(`${first.teacher.id}:${school.id}`, 0);

    const removed = await t.teachers.removeSchoolLink(first.teacher.id, school.id, manager2.id);
    expect(removed).toMatchObject({ isActive: false, unlinkedBy: manager2.id });
    expect((await t.teachers.getTeacher(first.teacher.id)).schoolIds).toEqual([second.id]);
    expect(await t.h.identity.findByPhone(PHONE)).toBeTruthy();
    expect(await codeOf(t.teachers.removeSchoolLink(first.teacher.id, school.id, manager2.id))).toBe('TEACHER_SCHOOL_LINK_NOT_FOUND');
    expect(await codeOf(t.teachers.removeSchoolLink('00000000-0000-4000-8000-000000000000', school.id, manager2.id))).toBe('TEACHER_NOT_FOUND');

    await t.teachers.registerTeacher({ schoolId: school.id, name: NAME, phone: PHONE }, manager2.id);
    expect((await t.teachers.listSchoolLinkHistory(first.teacher.id)).map((l) => l.isActive).sort()).toEqual([false, true, true]);
  });

  it('lists only the Teachers actively linked to the school, paginated; own profile only for a Teacher', async () => {
    const { t, school, register } = await setup();
    await register({ phone: '01001111111', name: 'ب ب ب' });
    const { teacher } = await register({ phone: '01002222222', name: 'أ أ أ' });
    const other = await t.newSchool('مدرسة الهدى');
    const m2 = await t.newSchoolManager(other.id);
    await t.teachers.registerTeacher({ schoolId: other.id, name: 'ج ج ج', phone: '01003333333' }, m2.id);

    const page = await t.teachers.listTeachersOfSchool({ schoolId: school.id, sort: 'createdAt', direction: 'asc', page: { page: 1, pageSize: 1 } });
    expect(page.total).toBe(2);
    expect(page.items).toHaveLength(1);
    expect((await t.teachers.getOwnProfile(teacher.userId)).id).toBe(teacher.id);
    expect(await codeOf(t.teachers.getOwnProfile(t.orgAdmin.id))).toBe('TEACHER_NOT_FOUND');
  });
});
