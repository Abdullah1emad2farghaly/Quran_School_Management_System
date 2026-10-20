import { describe, expect, it } from 'vitest';
import { SCHOOL_TARGET_TYPE } from '../../../src/modules/16-schools/public';
import { GROUPS_MODULE_NOT_IMPLEMENTED_YET_FOR_STUDENTS, STUDENT_TARGET_TYPE, StudentPermissions } from '../../../src/modules/19-students/public';
import { createStudentsHarness } from '../../helpers/students-harness';

const ALL = Object.values(StudentPermissions);
const READ_ONLY_FOR_RELATED = new Set<string>([StudentPermissions.READ]);
const UNKNOWN = '00000000-0000-4000-8000-000000000000';

async function setup() {
  const t = await createStudentsHarness();
  const schoolA = await t.newSchool('مدرسة أ');
  const schoolB = await t.newSchool('مدرسة ب');
  const managerA = await t.newSchoolManager(schoolA.id);
  const managerB = await t.newSchoolManager(schoolB.id);
  const parent = await t.newParent(schoolA.id, managerA.id);
  const otherParent = await t.newParent(schoolA.id, managerA.id, 'سعيد حسن محمود');
  const student = await t.registerStudent(schoolA.id, parent.id, managerA.id);
  const otherStudent = await t.registerStudent(schoolA.id, otherParent.id, managerA.id, { fullName: 'علي سعيد حسن' });
  const { teacher } = await t.teachers.registerTeacher({ schoolId: schoolA.id, name: 'خالد أحمد حسن', phone: '01001234568' }, managerA.id);
  const allowed = async (userId: string, permission: string, target?: { type: string; id: string }) =>
    (await t.engine.authorize({ userId, permission, ...(target ? { target } : {}) })).allowed;
  const onStudent = (s: { id: string }) => ({ type: STUDENT_TARGET_TYPE, id: s.id });
  const onSchool = (s: { id: string }) => ({ type: SCHOOL_TARGET_TYPE, id: s.id });
  return { t, schoolA, schoolB, managerA, managerB, parent, otherParent, student, otherStudent, teacher, allowed, onStudent, onSchool };
}

describe('SCHOOL_MANAGER: full Student management inside THEIR school only', () => {
  it('create and list on their school; read, update, deactivate, reactivate, archive and read history of a student of their school', async () => {
    const { schoolA, schoolB, managerA, managerB, student, allowed, onStudent, onSchool } = await setup();
    for (const perm of [StudentPermissions.CREATE, StudentPermissions.LIST]) {
      expect(await allowed(managerA.id, perm, onSchool(schoolA)), `${perm} own school`).toBe(true);
      expect(await allowed(managerA.id, perm, onSchool(schoolB)), `${perm} other school`).toBe(false);
      expect(await allowed(managerB.id, perm, onSchool(schoolA)), `${perm} B on A`).toBe(false);
    }
    for (const perm of [StudentPermissions.READ, StudentPermissions.UPDATE, StudentPermissions.DEACTIVATE, StudentPermissions.REACTIVATE, StudentPermissions.ARCHIVE, StudentPermissions.READ_HISTORY]) {
      expect(await allowed(managerA.id, perm, onStudent(student)), `${perm} A`).toBe(true);
      expect(await allowed(managerB.id, perm, onStudent(student)), `${perm} B (other school)`).toBe(false);
    }
  });

  it('an unknown student is denied (never reveals existence); a manager of another ORGANIZATION reaches nothing', async () => {
    const { t, schoolA, managerA, student, allowed, onStudent, onSchool } = await setup();
    expect(await allowed(managerA.id, StudentPermissions.READ, { type: STUDENT_TARGET_TYPE, id: UNKNOWN })).toBe(false);
    const org2 = await t.otherOrg();
    const school2 = await t.newSchool('مدرسة أخرى', org2.id);
    const manager2 = await t.newSchoolManager(school2.id, org2.id);
    expect(await allowed(manager2.id, StudentPermissions.READ, onStudent(student))).toBe(false);
    expect(await allowed(manager2.id, StudentPermissions.CREATE, onSchool(schoolA))).toBe(false);
  });

  it('after a manager is revoked from the school the access disappears at once', async () => {
    const { t, schoolA, managerA, student, allowed, onStudent } = await setup();
    await t.service.revokeSchoolManager({ schoolId: schoolA.id, actorId: t.orgAdmin.id });
    expect(await allowed(managerA.id, StudentPermissions.READ, onStudent(student))).toBe(false);
  });
});

describe('PARENT: reads ONLY their own linked children; no write, no lifecycle', () => {
  it('reads own child, never another Parent\'s child; may list their own children', async () => {
    const { parent, otherParent, student, otherStudent, allowed, onStudent } = await setup();
    expect(await allowed(parent.userId, StudentPermissions.READ, onStudent(student))).toBe(true);
    expect(await allowed(parent.userId, StudentPermissions.READ, onStudent(otherStudent))).toBe(false);
    expect(await allowed(otherParent.userId, StudentPermissions.READ, onStudent(student))).toBe(false);
    expect(await allowed(parent.userId, StudentPermissions.LIST_OWN_CHILDREN)).toBe(true);
  });

  it('has no other Student permission, not even on their own child', async () => {
    const { parent, student, schoolA, allowed, onStudent, onSchool } = await setup();
    for (const perm of ALL.filter((p) => !['students.student.read', 'students.student.list-own-children'].includes(p))) {
      expect(await allowed(parent.userId, perm, perm === StudentPermissions.CREATE || perm === StudentPermissions.LIST ? onSchool(schoolA) : onStudent(student)), perm).toBe(false);
    }
  });

  it('keeps reading an INACTIVE or ARCHIVED child (history), but the relationship decides, not the status', async () => {
    const { t, schoolA, managerA, parent, student, allowed, onStudent } = await setup();
    await t.students.archiveStudent(student.id, null, managerA.id);
    expect(await allowed(parent.userId, StudentPermissions.READ, onStudent(student))).toBe(true);
    expect(schoolA.id).toBeTruthy();
  });
});

describe('TEACHER: reads ONLY students of groups assigned to them, in a school they are linked to; nothing else', () => {
  it('is denied until a group assignment exists, then may read that student only', async () => {
    const { t, teacher, student, otherStudent, allowed, onStudent } = await setup();
    expect(await allowed(teacher.userId, StudentPermissions.READ, onStudent(student))).toBe(false); // linked to the school but no group
    t.assignToGroup(teacher.id, student.id);
    expect(await allowed(teacher.userId, StudentPermissions.READ, onStudent(student))).toBe(true);
    expect(await allowed(teacher.userId, StudentPermissions.READ, onStudent(otherStudent))).toBe(false);
  });

  it('has no write, lifecycle, history, create, list or own-children permission, even for an assigned student', async () => {
    const { t, schoolA, teacher, student, allowed, onStudent, onSchool } = await setup();
    t.assignToGroup(teacher.id, student.id);
    for (const perm of ALL.filter((p) => !READ_ONLY_FOR_RELATED.has(p))) {
      const target = perm === StudentPermissions.CREATE || perm === StudentPermissions.LIST ? onSchool(schoolA) : perm === StudentPermissions.LIST_OWN_CHILDREN ? undefined : onStudent(student);
      expect(await allowed(teacher.userId, perm, target), perm).toBe(false);
    }
  });

  it('an assignment alone is not enough: the Teacher must still be actively linked to the student\'s school', async () => {
    const { t, schoolA, managerA, teacher, student, allowed, onStudent } = await setup();
    t.assignToGroup(teacher.id, student.id);
    await t.teachers.removeSchoolLink(teacher.id, schoolA.id, managerA.id);
    expect(await allowed(teacher.userId, StudentPermissions.READ, onStudent(student))).toBe(false);
  });

  it('the temporary stand-in used until Module 20 exists denies every Teacher (fail closed)', async () => {
    expect(await GROUPS_MODULE_NOT_IMPLEMENTED_YET_FOR_STUDENTS.isStudentInGroupOfTeacher('any', 'any')).toBe(false);
  });
});

describe('other roles', () => {
  it('ORGANIZATION_MANAGER and MAIN_ADMIN get NO Student permission from their role', async () => {
    const { t, schoolA, student, allowed, onStudent, onSchool } = await setup();
    const mainAdmin = await t.h.createUser({ role: 'MAIN_ADMIN' });
    for (const user of [t.orgAdmin, mainAdmin]) {
      for (const perm of ALL) {
        const target = perm === StudentPermissions.CREATE || perm === StudentPermissions.LIST ? onSchool(schoolA) : perm === StudentPermissions.LIST_OWN_CHILDREN ? undefined : onStudent(student);
        expect(await allowed(user.id, perm, target), perm).toBe(false);
      }
    }
  });

  it('a school manager who is ALSO a Parent is checked per role: Parent proof only reads THEIR child; manager rights stay with their own school', async () => {
    const { t, schoolA, managerA, student, allowed, onStudent } = await setup();
    const schoolC = await t.newSchool('مدرسة ج');
    const dual = await t.newNamedUser('SCHOOL_MANAGER', 'منى كمال فهمي');
    await t.service.assignSchoolManager({ schoolId: schoolC.id, userId: dual.id, actorId: t.orgAdmin.id });
    const asParent = (await t.parents.registerParent({ schoolId: schoolA.id, name: 'منى كمال فهمي', phone: dual.phone, address: { kind: 'raw', text: 'المنيا' } }, managerA.id)).parent;
    expect(asParent.userId).toBe(dual.id); // the same account now also holds the PARENT role
    const child = await t.registerStudent(schoolA.id, asParent.id, managerA.id, { fullName: 'ياسر منى كمال' });
    expect(await allowed(dual.id, StudentPermissions.READ, onStudent(child))).toBe(true); // as the Parent
    expect(await allowed(dual.id, StudentPermissions.UPDATE, onStudent(child))).toBe(false); // manager of school C, not A
    expect(await allowed(dual.id, StudentPermissions.READ, onStudent(student))).toBe(false); // not their child, not their school
  });
});
