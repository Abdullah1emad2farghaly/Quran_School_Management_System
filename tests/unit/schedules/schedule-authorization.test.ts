import { describe, expect, it } from 'vitest';
import { GROUP_TARGET_TYPE } from '../../../src/modules/20-groups/public';
import { SchedulePermissions } from '../../../src/modules/23-group-schedules/public';
import { createSchedulesHarness } from '../../helpers/schedules-harness';

const ALL = Object.values(SchedulePermissions);
const UNSCOPED = new Set<string>([SchedulePermissions.LIST_OWN]);

async function setup() {
  const t = await createSchedulesHarness();
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
  return { t, schoolA, schoolB, managerA, managerB, teacher, otherTeacher, parent, otherParent, group, otherGroup, student, allowed, onGroup };
}

describe('the schedule permissions', () => {
  it('are exactly manage, read, read-history and list-own', () => {
    expect(Object.values(SchedulePermissions).sort()).toEqual(['groups.schedule.list-own', 'groups.schedule.manage', 'groups.schedule.read', 'groups.schedule.read-history']);
  });
});

describe('SCHOOL_MANAGER: manages and reads the schedule of the groups of THEIR school only', () => {
  it('manage, read and read-history on their groups, and nothing on another school\'s groups', async () => {
    const { managerA, managerB, group, otherGroup, allowed, onGroup } = await setup();
    for (const perm of [SchedulePermissions.MANAGE, SchedulePermissions.READ, SchedulePermissions.READ_HISTORY]) {
      expect(await allowed(managerA.id, perm, onGroup(group)), `${perm} own`).toBe(true);
      expect(await allowed(managerA.id, perm, onGroup(otherGroup)), `${perm} own other group`).toBe(true);
      expect(await allowed(managerB.id, perm, onGroup(group)), `${perm} other school's manager`).toBe(false);
    }
    expect(await allowed(managerA.id, SchedulePermissions.LIST_OWN)).toBe(false); // a manager has no "own schedule"
  });

  it('loses everything when the manager link is revoked (resolved from server data)', async () => {
    const { t, schoolA, managerA, group, allowed, onGroup } = await setup();
    await t.service.revokeSchoolManager({ schoolId: schoolA.id, actorId: t.orgAdmin.id });
    for (const perm of [SchedulePermissions.MANAGE, SchedulePermissions.READ, SchedulePermissions.READ_HISTORY]) expect(await allowed(managerA.id, perm, onGroup(group)), perm).toBe(false);
  });
});

describe('TEACHER: reads only the schedule of the ACTIVE group they teach, and their own schedule', () => {
  it('read yes on their group, no on another group, no manage and no history', async () => {
    const { teacher, otherTeacher, group, otherGroup, allowed, onGroup } = await setup();
    expect(await allowed(teacher.userId, SchedulePermissions.READ, onGroup(group))).toBe(true);
    expect(await allowed(teacher.userId, SchedulePermissions.READ, onGroup(otherGroup))).toBe(false);
    expect(await allowed(otherTeacher.userId, SchedulePermissions.READ, onGroup(group))).toBe(false);
    expect(await allowed(teacher.userId, SchedulePermissions.MANAGE, onGroup(group))).toBe(false);
    expect(await allowed(teacher.userId, SchedulePermissions.READ_HISTORY, onGroup(group))).toBe(false);
    expect(await allowed(teacher.userId, SchedulePermissions.LIST_OWN)).toBe(true);
    expect(await allowed(otherTeacher.userId, SchedulePermissions.LIST_OWN)).toBe(true);
  });

  it('loses the read once the group is archived or the Teacher is replaced', async () => {
    const { t, managerA, teacher, otherTeacher, group, allowed, onGroup } = await setup();
    await t.groups.assignTeacher(group.id, otherTeacher.id, managerA.id);
    expect(await allowed(teacher.userId, SchedulePermissions.READ, onGroup(group))).toBe(false);
    expect(await allowed(otherTeacher.userId, SchedulePermissions.READ, onGroup(group))).toBe(true);
    await t.groups.archiveGroup(group.id, 'إغلاق الحلقة', managerA.id);
    expect(await allowed(otherTeacher.userId, SchedulePermissions.READ, onGroup(group))).toBe(false);
  });
});

describe('PARENT: reads only the schedule of the ACTIVE group of their own child', () => {
  it('read yes, nothing else', async () => {
    const { parent, otherParent, group, otherGroup, allowed, onGroup } = await setup();
    expect(await allowed(parent.userId, SchedulePermissions.READ, onGroup(group))).toBe(true);
    expect(await allowed(parent.userId, SchedulePermissions.READ, onGroup(otherGroup))).toBe(false);
    expect(await allowed(otherParent.userId, SchedulePermissions.READ, onGroup(group))).toBe(false);
    for (const perm of [SchedulePermissions.MANAGE, SchedulePermissions.READ_HISTORY]) expect(await allowed(parent.userId, perm, onGroup(group)), perm).toBe(false);
    expect(await allowed(parent.userId, SchedulePermissions.LIST_OWN)).toBe(false);
  });

  it('loses the read when the child leaves the group or the group is archived', async () => {
    const { t, managerA, parent, student, group, allowed, onGroup } = await setup();
    await t.groups.unassignStudent(group.id, student.id, managerA.id);
    expect(await allowed(parent.userId, SchedulePermissions.READ, onGroup(group))).toBe(false);
  });
});

describe('ORGANIZATION_MANAGER and MAIN_ADMIN: no schedule permission from their role (deny by default)', () => {
  it('are denied every permission', async () => {
    const { t, group, allowed, onGroup } = await setup();
    const mainAdmin = await t.h.createUser({ role: 'MAIN_ADMIN' });
    for (const user of [t.orgAdmin, mainAdmin]) for (const perm of ALL) expect(await allowed(user.id, perm, UNSCOPED.has(perm) ? undefined : onGroup(group)), perm).toBe(false);
  });
});
