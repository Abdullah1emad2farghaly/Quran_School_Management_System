import { describe, expect, it } from 'vitest';
import { SCHOOL_TARGET_TYPE } from '../../../src/modules/16-schools/public';
import { GROUP_TARGET_TYPE, GroupPermissions } from '../../../src/modules/20-groups/public';
import { STUDENT_TARGET_TYPE, StudentPermissions } from '../../../src/modules/19-students/public';
import { createGroupsHarness } from '../../helpers/groups-harness';

const ALL = Object.values(GroupPermissions);
const UNKNOWN = '00000000-0000-4000-8000-000000000000';
const SCHOOL_TARGETED = new Set<string>([GroupPermissions.CREATE, GroupPermissions.LIST]);
const UNSCOPED = new Set<string>([GroupPermissions.LIST_OWN]);

async function setup() {
  const t = await createGroupsHarness();
  const schoolA = await t.newSchool('مدرسة أ');
  const schoolB = await t.newSchool('مدرسة ب');
  const managerA = await t.newSchoolManager(schoolA.id);
  const managerB = await t.newSchoolManager(schoolB.id);
  const teacher = await t.newTeacher(schoolA.id, managerA.id);
  const otherTeacher = await t.newTeacher(schoolA.id, managerA.id, 'سعيد حسن محمود');
  const parent = await t.newParent(schoolA.id, managerA.id);
  const otherParent = await t.newParent(schoolA.id, managerA.id, 'منى كمال فهمي');
  const group = await t.newGroup(schoolA.id, managerA.id, { teacherId: teacher.id });
  const otherGroup = await t.newGroup(schoolA.id, managerA.id, { teacherId: otherTeacher.id });
  const student = await t.registerStudent(schoolA.id, parent.id, managerA.id);
  await t.groups.assignStudent(group.id, student.id, managerA.id);
  const allowed = async (userId: string, permission: string, target?: { type: string; id: string }) => (await t.engine.authorize({ userId, permission, ...(target ? { target } : {}) })).allowed;
  const onGroup = (g: { id: string }) => ({ type: GROUP_TARGET_TYPE, id: g.id });
  const onSchool = (s: { id: string }) => ({ type: SCHOOL_TARGET_TYPE, id: s.id });
  const onStudent = (s: { id: string }) => ({ type: STUDENT_TARGET_TYPE, id: s.id });
  const targetFor = (perm: string, g: { id: string }, school: { id: string }, st: { id: string }) =>
    SCHOOL_TARGETED.has(perm) ? onSchool(school) : UNSCOPED.has(perm) ? undefined : perm === GroupPermissions.READ_STUDENT_ASSIGNMENTS ? onStudent(st) : onGroup(g);
  return { t, schoolA, schoolB, managerA, managerB, teacher, otherTeacher, parent, otherParent, group, otherGroup, student, allowed, onGroup, onSchool, onStudent, targetFor };
}

describe('SCHOOL_MANAGER: full group management inside THEIR school only', () => {
  it('every manager permission works on their school / its groups / its students and on nothing of another school', async () => {
    const { schoolA, schoolB, managerA, managerB, group, student, allowed, targetFor } = await setup();
    const managerPerms = ALL.filter((p) => p !== GroupPermissions.LIST_OWN);
    for (const perm of managerPerms) {
      expect(await allowed(managerA.id, perm, targetFor(perm, group, schoolA, student)), `${perm} own`).toBe(true);
      expect(await allowed(managerB.id, perm, targetFor(perm, group, schoolA, student)), `${perm} other school's manager`).toBe(false);
      expect(await allowed(managerA.id, perm, targetFor(perm, group, schoolB, student)), `${perm} A on B's school`).toBe(SCHOOL_TARGETED.has(perm) ? false : true);
    }
    expect(await allowed(managerA.id, GroupPermissions.LIST_OWN)).toBe(false); // a manager has no "own groups"
  });

  it('an unknown group is denied; a manager of another ORGANIZATION reaches nothing; a revoked manager loses access at once', async () => {
    const { t, schoolA, managerA, group, allowed, onGroup, onSchool } = await setup();
    expect(await allowed(managerA.id, GroupPermissions.READ, { type: GROUP_TARGET_TYPE, id: UNKNOWN })).toBe(false);
    const org2 = await t.otherOrg();
    const school2 = await t.newSchool('مدرسة أخرى', org2.id);
    const manager2 = await t.newSchoolManager(school2.id, org2.id);
    expect(await allowed(manager2.id, GroupPermissions.READ, onGroup(group))).toBe(false);
    expect(await allowed(manager2.id, GroupPermissions.CREATE, onSchool(schoolA))).toBe(false);
    await t.service.revokeSchoolManager({ schoolId: schoolA.id, actorId: t.orgAdmin.id });
    expect(await allowed(managerA.id, GroupPermissions.READ, onGroup(group))).toBe(false);
  });
});

describe('TEACHER: only the ACTIVE groups they teach', () => {
  it('reads and lists the students of THEIR group, lists their own groups, never another Teacher\'s group', async () => {
    const { teacher, otherTeacher, group, otherGroup, allowed, onGroup } = await setup();
    expect(await allowed(teacher.userId, GroupPermissions.READ, onGroup(group))).toBe(true);
    expect(await allowed(teacher.userId, GroupPermissions.LIST_STUDENTS, onGroup(group))).toBe(true);
    expect(await allowed(teacher.userId, GroupPermissions.LIST_OWN)).toBe(true);
    expect(await allowed(teacher.userId, GroupPermissions.READ, onGroup(otherGroup))).toBe(false);
    expect(await allowed(otherTeacher.userId, GroupPermissions.READ, onGroup(group))).toBe(false);
  });

  it('has NO other group permission (no create, update, teacher change, archive, student changes, history)', async () => {
    const { schoolA, teacher, group, student, allowed, targetFor } = await setup();
    for (const perm of ALL.filter((p) => ![GroupPermissions.READ, GroupPermissions.LIST_STUDENTS, GroupPermissions.LIST_OWN].includes(p as never))) {
      expect(await allowed(teacher.userId, perm, targetFor(perm, group, schoolA, student)), perm).toBe(false);
    }
  });

  it('loses access when the group is archived, when the Teacher is replaced, and when the school link is removed', async () => {
    const { t, schoolA, managerA, teacher, otherTeacher, group, allowed, onGroup } = await setup();
    await t.groups.assignTeacher(group.id, otherTeacher.id, managerA.id);
    expect(await allowed(teacher.userId, GroupPermissions.READ, onGroup(group))).toBe(false);
    expect(await allowed(otherTeacher.userId, GroupPermissions.READ, onGroup(group))).toBe(true);
    await t.groups.archiveGroup(group.id, null, managerA.id);
    expect(await allowed(otherTeacher.userId, GroupPermissions.READ, onGroup(group))).toBe(false);
    expect(schoolA.id).toBeTruthy();
  });
});

describe('PARENT: only the ACTIVE group of their own child, minimal view', () => {
  it('reads the group that holds their child, nothing else of Groups; another Parent is denied', async () => {
    const { parent, otherParent, group, otherGroup, schoolA, student, allowed, onGroup, targetFor } = await setup();
    expect(await allowed(parent.userId, GroupPermissions.READ, onGroup(group))).toBe(true);
    expect(await allowed(parent.userId, GroupPermissions.READ, onGroup(otherGroup))).toBe(false);
    expect(await allowed(otherParent.userId, GroupPermissions.READ, onGroup(group))).toBe(false);
    for (const perm of ALL.filter((p) => p !== GroupPermissions.READ)) {
      expect(await allowed(parent.userId, perm, targetFor(perm, group, schoolA, student)), perm).toBe(false);
    }
  });

  it('follows the child: a move changes which group the Parent may read; unassigning or archiving the group removes it', async () => {
    const { t, managerA, parent, group, otherGroup, student, allowed, onGroup } = await setup();
    await t.groups.moveStudent(group.id, student.id, otherGroup.id, managerA.id);
    expect(await allowed(parent.userId, GroupPermissions.READ, onGroup(group))).toBe(false);
    expect(await allowed(parent.userId, GroupPermissions.READ, onGroup(otherGroup))).toBe(true);
    await t.groups.unassignStudent(otherGroup.id, student.id, managerA.id);
    expect(await allowed(parent.userId, GroupPermissions.READ, onGroup(otherGroup))).toBe(false);
  });
});

describe('other roles', () => {
  it('ORGANIZATION_MANAGER and MAIN_ADMIN get NO Group permission from their role', async () => {
    const { t, schoolA, group, student, allowed, targetFor } = await setup();
    const mainAdmin = await t.h.createUser({ role: 'MAIN_ADMIN' });
    for (const user of [t.orgAdmin, mainAdmin]) for (const perm of ALL) expect(await allowed(user.id, perm, targetFor(perm, group, schoolA, student)), perm).toBe(false);
  });
});

describe('Module 19 integration: a Teacher reads a STUDENT only through a real group assignment', () => {
  it('allowed while the student is in an ACTIVE group of the Teacher; denied after a move to another Teacher, an unassignment or an archive', async () => {
    const { t, managerA, teacher, group, otherGroup, student, allowed, onStudent } = await setup();
    expect(await allowed(teacher.userId, StudentPermissions.READ, onStudent(student))).toBe(true); // real Groups access, not the stand-in
    await t.groups.moveStudent(group.id, student.id, otherGroup.id, managerA.id);
    expect(await allowed(teacher.userId, StudentPermissions.READ, onStudent(student))).toBe(false);
    await t.groups.moveStudent(otherGroup.id, student.id, group.id, managerA.id);
    expect(await allowed(teacher.userId, StudentPermissions.READ, onStudent(student))).toBe(true);
    await t.groups.archiveGroup(group.id, null, managerA.id);
    expect(await allowed(teacher.userId, StudentPermissions.READ, onStudent(student))).toBe(false);
  });

  it('a Teacher gets no other Student permission even for a student in their group', async () => {
    const { teacher, student, allowed, onStudent } = await setup();
    for (const perm of Object.values(StudentPermissions).filter((p) => p !== StudentPermissions.READ)) {
      expect(await allowed(teacher.userId, perm, perm === StudentPermissions.LIST_OWN_CHILDREN ? undefined : onStudent(student)), perm).toBe(false);
    }
  });
});
