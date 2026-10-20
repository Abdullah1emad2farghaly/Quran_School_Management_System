import { describe, expect, it } from 'vitest';
import { SCHOOL_TARGET_TYPE } from '../../../src/modules/16-schools/public';
import { TEACHER_TARGET_TYPE, TeacherPermissions } from '../../../src/modules/18-teachers/public';
import { createTeachersHarness } from '../../helpers/teachers-harness';

async function setup() {
  const t = await createTeachersHarness();
  const schoolA = await t.newSchool('مدرسة أ');
  const schoolB = await t.newSchool('مدرسة ب');
  const managerA = await t.newSchoolManager(schoolA.id);
  const managerB = await t.newSchoolManager(schoolB.id);
  const { teacher } = await t.teachers.registerTeacher({ schoolId: schoolA.id, name: 'خالد أحمد حسن', phone: '01001234568' }, managerA.id);
  const allowed = async (userId: string, permission: string, target?: { type: string; id: string }) =>
    (await t.engine.authorize({ userId, permission, ...(target ? { target } : {}) })).allowed;
  return { t, schoolA, schoolB, managerA, managerB, teacher, allowed };
}

describe('Teacher permissions (deny by default)', () => {
  it('SCHOOL_MANAGER: create/list/remove-link on THEIR school only; read only a Teacher linked to a school they manage', async () => {
    const { schoolA, schoolB, managerA, managerB, teacher, allowed } = await setup();
    const onSchool = (s: { id: string }) => ({ type: SCHOOL_TARGET_TYPE, id: s.id });
    for (const perm of [TeacherPermissions.CREATE, TeacherPermissions.LIST, TeacherPermissions.REMOVE_SCHOOL_LINK]) {
      expect(await allowed(managerA.id, perm, onSchool(schoolA)), `${perm} own school`).toBe(true);
      expect(await allowed(managerA.id, perm, onSchool(schoolB)), `${perm} other school`).toBe(false);
      expect(await allowed(managerB.id, perm, onSchool(schoolA)), `${perm} B on A`).toBe(false);
    }
    expect(await allowed(managerA.id, TeacherPermissions.READ, { type: TEACHER_TARGET_TYPE, id: teacher.id })).toBe(true);
    expect(await allowed(managerB.id, TeacherPermissions.READ, { type: TEACHER_TARGET_TYPE, id: teacher.id })).toBe(false);
  });

  it('a Teacher linked to two schools is reachable by the manager of EITHER; ending a link removes only that school\'s access', async () => {
    const { t, schoolA, schoolB, managerA, managerB, teacher, allowed } = await setup();
    await t.teachers.registerTeacher({ schoolId: schoolB.id, name: 'خالد أحمد حسن', phone: '01001234568' }, managerB.id);
    const onTeacher = { type: TEACHER_TARGET_TYPE, id: teacher.id };
    expect(await allowed(managerA.id, TeacherPermissions.READ, onTeacher)).toBe(true);
    expect(await allowed(managerB.id, TeacherPermissions.READ, onTeacher)).toBe(true);
    await t.teachers.removeSchoolLink(teacher.id, schoolA.id, managerA.id);
    expect(await allowed(managerA.id, TeacherPermissions.READ, onTeacher)).toBe(false);
    expect(await allowed(managerB.id, TeacherPermissions.READ, onTeacher)).toBe(true);
  });

  it('a manager of ANOTHER ORGANIZATION never reaches the Teacher or the school', async () => {
    const { t, schoolA, teacher, allowed } = await setup();
    const org2 = await t.otherOrg();
    const school2 = await t.newSchool('مدرسة ثانية', org2.id);
    const manager2 = await t.newSchoolManager(school2.id, org2.id);
    expect(await allowed(manager2.id, TeacherPermissions.READ, { type: TEACHER_TARGET_TYPE, id: teacher.id })).toBe(false);
    expect(await allowed(manager2.id, TeacherPermissions.CREATE, { type: SCHOOL_TARGET_TYPE, id: schoolA.id })).toBe(false);
  });

  it('ORGANIZATION_MANAGER and MAIN_ADMIN get NO Teacher permission from their role', async () => {
    const { t, schoolA, teacher, allowed } = await setup();
    const mainAdmin = await t.h.createUser({ role: 'MAIN_ADMIN' });
    for (const user of [t.orgAdmin, mainAdmin]) {
      for (const perm of [TeacherPermissions.CREATE, TeacherPermissions.LIST, TeacherPermissions.REMOVE_SCHOOL_LINK]) {
        expect(await allowed(user.id, perm, { type: SCHOOL_TARGET_TYPE, id: schoolA.id }), perm).toBe(false);
      }
      expect(await allowed(user.id, TeacherPermissions.READ, { type: TEACHER_TARGET_TYPE, id: teacher.id })).toBe(false);
      expect(await allowed(user.id, TeacherPermissions.READ_OWN)).toBe(false);
    }
  });

  it('TEACHER may read their OWN profile only; a Parent-only account has no Teacher permission', async () => {
    const { t, schoolA, managerA, teacher, allowed } = await setup();
    expect(await allowed(teacher.userId, TeacherPermissions.READ_OWN)).toBe(true);
    expect(await allowed(teacher.userId, TeacherPermissions.READ, { type: TEACHER_TARGET_TYPE, id: teacher.id })).toBe(false);
    expect(await allowed(teacher.userId, TeacherPermissions.CREATE, { type: SCHOOL_TARGET_TYPE, id: schoolA.id })).toBe(false);
    const parent = await t.parents.registerParent({ schoolId: schoolA.id, name: 'سارة محمد علي', phone: '01002223334', address: { kind: 'raw', text: 'المنيا' } }, managerA.id);
    expect(await allowed(parent.parent.userId, TeacherPermissions.READ_OWN)).toBe(false);
  });

  it('adding the TEACHER role to a SCHOOL_MANAGER account does not widen the school-manager scope, and a Teacher role gives no school-manager permission', async () => {
    const { t, schoolA, schoolB, managerA, managerB, allowed } = await setup();
    await t.h.identity.ensureFullName(managerA.id, 'منى حسن علي');
    const phone = (await t.h.identity.findById(managerA.id))!.phone;
    // the manager of school A (same person) is registered by school B's manager as a Teacher of school B: same account, now SCHOOL_MANAGER + TEACHER
    await t.teachers.registerTeacher({ schoolId: schoolB.id, name: 'منى حسن علي', phone }, managerB.id);
    expect((await t.h.roles.listActiveRoles(managerA.id)).sort()).toEqual(['SCHOOL_MANAGER', 'TEACHER']);
    expect(await allowed(managerA.id, TeacherPermissions.CREATE, { type: SCHOOL_TARGET_TYPE, id: schoolB.id })).toBe(false);
    expect(await allowed(managerA.id, TeacherPermissions.CREATE, { type: SCHOOL_TARGET_TYPE, id: schoolA.id })).toBe(true);
  });

  it('an unknown teacher or school is never covered', async () => {
    const { managerA, allowed } = await setup();
    expect(await allowed(managerA.id, TeacherPermissions.READ, { type: TEACHER_TARGET_TYPE, id: '00000000-0000-4000-8000-000000000000' })).toBe(false);
    expect(await allowed(managerA.id, TeacherPermissions.CREATE, { type: SCHOOL_TARGET_TYPE, id: '00000000-0000-4000-8000-000000000000' })).toBe(false);
  });
});
