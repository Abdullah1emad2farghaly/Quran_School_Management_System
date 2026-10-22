import { describe, expect, it } from 'vitest';
import { AppError } from '../../../src/modules/00-shared-kernel/public';
import { Group } from '../../../src/modules/20-groups/public';
import { GROUP_NAME, createGroupsHarness } from '../../helpers/groups-harness';

const codeOf = (p: Promise<unknown>) => p.then(() => 'NO_ERROR', (e: unknown) => (e instanceof AppError ? e.code : `NOT_APP_ERROR:${String(e)}`));
const UNKNOWN = '00000000-0000-4000-8000-000000000000';
const page = { page: 1, pageSize: 20 };

async function setup() {
  const t = await createGroupsHarness();
  const school = await t.newSchool();
  const manager = await t.newSchoolManager(school.id);
  const teacher = await t.newTeacher(school.id, manager.id);
  const parent = await t.newParent(school.id, manager.id);
  return { t, school, manager, teacher, parent };
}

describe('creating a group', () => {
  it('creates an ACTIVE group with its settings, optional Teacher, history and a GroupCreated event of identifiers only', async () => {
    const { t, school, manager, teacher } = await setup();
    const g = await t.newGroup(school.id, manager.id, { name: GROUP_NAME, teacherId: teacher.id });
    expect(g).toMatchObject({ schoolId: school.id, organizationId: t.org.id, name: GROUP_NAME, learningMode: 'GROUP', progression: 'FORWARD', startingSurah: 78, status: 'ACTIVE', teacher: { id: teacher.id } });
    expect(g.teacher!.name).toBeTruthy();
    expect((await t.groups.listHistory(g.id)).map((h) => [h.action, h.actorId, h.newTeacherId])).toEqual([['CREATED', manager.id, teacher.id]]);
    const events = t.h.store.messages.filter((m) => m.aggregateType === 'Group');
    expect(events.map((e) => e.eventType)).toEqual(['GroupCreated']);
    expect(events[0]!.payload).not.toMatch(/حلقة/);
    expect((await t.newGroup(school.id, manager.id)).teacher).toBeNull(); // a group may exist without a Teacher
  });

  it('validates the input and creates nothing on failure', async () => {
    const { t, school, manager } = await setup();
    const make = (over: Record<string, unknown>) => t.newGroup(school.id, manager.id, over);
    expect(await codeOf(make({ name: '   ' }))).toBe('INVALID_GROUP_NAME');
    expect(await codeOf(make({ learningMode: 'x' }))).toBe('INVALID_GROUP_LEARNING_MODE');
    expect(await codeOf(make({ progression: 'x' }))).toBe('INVALID_GROUP_PROGRESSION');
    for (const bad of [0, 115, 1.5, '5', undefined]) expect(await codeOf(make({ startingSurah: bad })), String(bad)).toBe('INVALID_GROUP_STARTING_SURAH');
    expect(t.groupRepo.groups.size).toBe(0);
    expect(t.groupRepo.history.length).toBe(0);
  });

  it('needs an ACTIVE school', async () => {
    const { t, school, manager } = await setup();
    expect(await codeOf(t.newGroup(UNKNOWN, manager.id))).toBe('GROUP_SCHOOL_NOT_ACTIVE');
    await t.service.deactivateSchool(school.id, t.orgAdmin.id);
    expect(await codeOf(t.newGroup(school.id, manager.id))).toBe('GROUP_SCHOOL_NOT_ACTIVE');
  });

  it('the Teacher must exist, belong to the school\'s organization and be actively linked to THIS school (one neutral error)', async () => {
    const { t, school, manager, teacher } = await setup();
    const school2 = await t.newSchool('مدرسة ثانية');
    expect(await codeOf(t.newGroup(school.id, manager.id, { teacherId: UNKNOWN }))).toBe('GROUP_TEACHER_NOT_LINKED_TO_SCHOOL');
    expect(await codeOf(t.newGroup(school2.id, manager.id, { teacherId: teacher.id }))).toBe('GROUP_TEACHER_NOT_LINKED_TO_SCHOOL'); // not linked to school 2
    const org2 = await t.otherOrg();
    const foreign = await t.newSchool('مدرسة أخرى', org2.id);
    expect(await codeOf(t.newGroup(foreign.id, manager.id, { teacherId: teacher.id }))).toBe('GROUP_TEACHER_NOT_LINKED_TO_SCHOOL'); // another organization
    expect(t.groupRepo.groups.size).toBe(0);
  });
});

describe('group names: unique among the ACTIVE groups of a school (an ARCHIVED name is free again)', () => {
  it('refuses a duplicate ACTIVE name in the same school (Latin case ignored), allows it in another school, never folds Arabic letters', async () => {
    const { t, school, manager } = await setup();
    const school2 = await t.newSchool('مدرسة ثانية');
    const manager2 = await t.newSchoolManager(school2.id);
    await t.newGroup(school.id, manager.id, { name: 'Fajr Circle' });
    expect(await codeOf(t.newGroup(school.id, manager.id, { name: 'fajr  CIRCLE' }))).toBe('GROUP_NAME_CONFLICT');
    expect((await t.newGroup(school2.id, manager2.id, { name: 'Fajr Circle' })).schoolId).toBe(school2.id);
    await t.newGroup(school.id, manager.id, { name: 'حلقة أحمد' });
    expect((await t.newGroup(school.id, manager.id, { name: 'حلقة احمد' })).name).toBe('حلقة احمد');
  });

  it('an ARCHIVED group\'s name can be reused in the same school and the archived group keeps its history', async () => {
    const { t, school, manager } = await setup();
    const old = await t.newGroup(school.id, manager.id, { name: GROUP_NAME });
    await t.groups.archiveGroup(old.id, 'انتهت', manager.id);
    const reused = await t.newGroup(school.id, manager.id, { name: GROUP_NAME });
    expect(reused.id).not.toBe(old.id);
    expect((await t.groups.getGroup(old.id)).status).toBe('ARCHIVED');
    expect((await t.groups.listHistory(old.id)).map((h) => h.action)).toEqual(['CREATED', 'ARCHIVED']);
    expect(await codeOf(t.newGroup(school.id, manager.id, { name: GROUP_NAME }))).toBe('GROUP_NAME_CONFLICT'); // now the ACTIVE one holds it
  });

  it('renaming to a taken ACTIVE name is refused; renaming to its own name changes nothing; the repository (twin of the unique index) is the final guard', async () => {
    const { t, school, manager } = await setup();
    const a = await t.newGroup(school.id, manager.id, { name: 'أ' });
    await t.newGroup(school.id, manager.id, { name: 'ب' });
    expect(await codeOf(t.groups.updateGroup(a.id, { name: 'ب' }, manager.id))).toBe('GROUP_NAME_CONFLICT');
    const events = t.h.store.messages.length;
    await t.groups.updateGroup(a.id, { name: 'أ' }, manager.id);
    expect(t.h.store.messages.length).toBe(events);
    const twin = Group.register({ schoolId: school.id, organizationId: t.org.id, name: 'ب', teacherId: null, learningMode: 'GROUP', progression: 'FORWARD', startingSurah: 1, createdBy: manager.id, clock: t.h.clock });
    expect(await codeOf(t.unitOfWork.run((tx) => t.groupRepo.insert(twin, tx)))).toBe('GROUP_NAME_CONFLICT');
  });
});

describe('updating a group', () => {
  it('changes the settings with the previous values in the history; empty update refused; ARCHIVED is read-only', async () => {
    const { t, school, manager } = await setup();
    const g = await t.newGroup(school.id, manager.id);
    const u = await t.groups.updateGroup(g.id, { learningMode: 'INDIVIDUAL', progression: 'BACKWARD', startingSurah: 114, name: 'حلقة العصر' }, manager.id);
    expect(u).toMatchObject({ learningMode: 'INDIVIDUAL', progression: 'BACKWARD', startingSurah: 114, name: 'حلقة العصر', schoolId: school.id });
    const history = await t.groups.listHistory(g.id);
    expect(history[1]).toMatchObject({ action: 'UPDATED', previousLearningMode: 'GROUP', newLearningMode: 'INDIVIDUAL', previousProgression: 'FORWARD', newProgression: 'BACKWARD', previousStartingSurah: 78, newStartingSurah: 114 });
    expect(history[0]).toMatchObject({ action: 'CREATED', newLearningMode: 'GROUP', newProgression: 'FORWARD' }); // the past is untouched
    expect(await codeOf(t.groups.updateGroup(g.id, {}, manager.id))).toBe('GROUP_UPDATE_EMPTY');
    expect(await codeOf(t.groups.updateGroup(g.id, { startingSurah: 200 }, manager.id))).toBe('INVALID_GROUP_STARTING_SURAH');
    expect(await codeOf(t.groups.updateGroup(UNKNOWN, { name: 'x' }, manager.id))).toBe('GROUP_NOT_FOUND');
    await t.groups.archiveGroup(g.id, null, manager.id);
    expect(await codeOf(t.groups.updateGroup(g.id, { name: 'y' }, manager.id))).toBe('GROUP_ARCHIVED');
  });
});

describe('the Teacher of a group', () => {
  it('has at most ONE Teacher, may change or leave, and one Teacher can teach several groups', async () => {
    const { t, school, manager, teacher } = await setup();
    const teacher2 = await t.newTeacher(school.id, manager.id, 'سعيد حسن محمود');
    const g1 = await t.newGroup(school.id, manager.id);
    const g2 = await t.newGroup(school.id, manager.id);
    expect((await t.groups.assignTeacher(g1.id, teacher.id, manager.id)).teacher!.id).toBe(teacher.id);
    expect((await t.groups.assignTeacher(g2.id, teacher.id, manager.id)).teacher!.id).toBe(teacher.id);
    expect((await t.groups.assignTeacher(g1.id, teacher2.id, manager.id)).teacher!.id).toBe(teacher2.id); // replaces: still ONE
    const history = await t.groups.listHistory(g1.id);
    expect(history.at(-1)).toMatchObject({ action: 'TEACHER_CHANGED', previousTeacherId: teacher.id, newTeacherId: teacher2.id });
    const events = t.h.store.messages.length;
    await t.groups.assignTeacher(g1.id, teacher2.id, manager.id); // same Teacher: nothing changes
    expect(t.h.store.messages.length).toBe(events);
    expect((await t.groups.removeTeacher(g1.id, manager.id)).teacher).toBeNull();
    expect(await codeOf(t.groups.removeTeacher(g1.id, manager.id))).toBe('GROUP_HAS_NO_TEACHER');
  });

  it('must be actively linked to the school; a Teacher with ACTIVE groups cannot be unlinked (real guard), an archived group no longer blocks', async () => {
    const { t, school, manager, teacher } = await setup();
    const g = await t.newGroup(school.id, manager.id, { teacherId: teacher.id });
    expect(await codeOf(t.teachers.removeSchoolLink(teacher.id, school.id, manager.id))).toBe('TEACHER_HAS_GROUPS_IN_SCHOOL');
    expect(await t.unitOfWork.run((tx) => t.groups.countGroupsOfTeacherInSchool(teacher.id, school.id, tx))).toBe(1);
    await t.groups.archiveGroup(g.id, null, manager.id);
    expect((await t.teachers.removeSchoolLink(teacher.id, school.id, manager.id)).isActive).toBe(false);
    const g2 = await t.newGroup(school.id, manager.id);
    expect(await codeOf(t.groups.assignTeacher(g2.id, teacher.id, manager.id))).toBe('GROUP_TEACHER_NOT_LINKED_TO_SCHOOL'); // link removed
  });

  it('closes the race: the link is locked in the transaction that assigns the Teacher', async () => {
    const { t, school, manager } = await setup();
    const lone = await t.newTeacher(school.id, manager.id, 'سعيد حسن محمود');
    expect(await t.unitOfWork.run((tx) => t.teachers.lockActiveSchoolLink(lone.id, school.id, tx))).toBe(true);
    await t.teachers.removeSchoolLink(lone.id, school.id, manager.id);
    expect(await t.unitOfWork.run((tx) => t.teachers.lockActiveSchoolLink(lone.id, school.id, tx))).toBe(false);
    expect(await t.unitOfWork.run((tx) => t.teachers.lockActiveSchoolLink(UNKNOWN, school.id, tx))).toBe(false);
  });
});

describe('students in groups: ONE group at a time, same school, ACTIVE students only', () => {
  it('assigns an ACTIVE student of the school, publishes GroupStudentAssigned, and lists them', async () => {
    const { t, school, manager, parent } = await setup();
    const g = await t.newGroup(school.id, manager.id);
    const s = await t.registerStudent(school.id, parent.id, manager.id);
    const row = await t.groups.assignStudent(g.id, s.id, manager.id);
    expect(row).toMatchObject({ studentId: s.id, fullName: s.fullName, status: 'ACTIVE' });
    expect(t.h.store.messages.filter((m) => m.eventType === 'GroupStudentAssigned').length).toBe(1);
    expect((await t.groups.listStudentsOfGroup(g.id, page)).items.map((x) => x.studentId)).toEqual([s.id]);
  });

  it('refuses unknown / foreign / inactive students, a student already in a group (same or another), and an archived group', async () => {
    const { t, school, manager, parent } = await setup();
    const school2 = await t.newSchool('مدرسة ثانية');
    const manager2 = await t.newSchoolManager(school2.id);
    const parent2 = await t.newParent(school2.id, manager2.id, 'سعيد حسن محمود');
    const g = await t.newGroup(school.id, manager.id);
    const g2 = await t.newGroup(school.id, manager.id);
    const s = await t.registerStudent(school.id, parent.id, manager.id);
    const foreign = await t.registerStudent(school2.id, parent2.id, manager2.id, { fullName: 'علي سعيد حسن' });
    expect(await codeOf(t.groups.assignStudent(g.id, UNKNOWN, manager.id))).toBe('GROUP_STUDENT_NOT_IN_SCHOOL');
    expect(await codeOf(t.groups.assignStudent(g.id, foreign.id, manager.id))).toBe('GROUP_STUDENT_NOT_IN_SCHOOL');
    await t.students.deactivateStudent(s.id, null, manager.id);
    expect(await codeOf(t.groups.assignStudent(g.id, s.id, manager.id))).toBe('GROUP_STUDENT_NOT_ACTIVE');
    await t.students.reactivateStudent(s.id, null, manager.id);
    await t.groups.assignStudent(g.id, s.id, manager.id);
    expect(await codeOf(t.groups.assignStudent(g.id, s.id, manager.id))).toBe('GROUP_STUDENT_ALREADY_ASSIGNED');
    expect(await codeOf(t.groups.assignStudent(g2.id, s.id, manager.id))).toBe('GROUP_STUDENT_ALREADY_ASSIGNED');
    await t.groups.archiveGroup(g2.id, null, manager.id);
    expect(await codeOf(t.groups.assignStudent(g2.id, s.id, manager.id))).toBe('GROUP_ARCHIVED');
  });

  it('unassigns (the student stays a student) and refuses a student that is not in that group', async () => {
    const { t, school, manager, parent } = await setup();
    const g = await t.newGroup(school.id, manager.id);
    const g2 = await t.newGroup(school.id, manager.id);
    const s = await t.registerStudent(school.id, parent.id, manager.id);
    expect(await codeOf(t.groups.unassignStudent(g.id, s.id, manager.id))).toBe('GROUP_STUDENT_NOT_ASSIGNED');
    await t.groups.assignStudent(g.id, s.id, manager.id);
    expect(await codeOf(t.groups.unassignStudent(g2.id, s.id, manager.id))).toBe('GROUP_STUDENT_NOT_ASSIGNED'); // wrong group
    await t.groups.unassignStudent(g.id, s.id, manager.id);
    expect((await t.students.getStudent(s.id)).status).toBe('ACTIVE');
    expect((await t.groups.listStudentsOfGroup(g.id, page)).items).toEqual([]);
    expect((await t.groups.listAssignmentHistoryOfStudent(s.id))[0]).toMatchObject({ endReason: 'MANUAL', unassignedBy: manager.id });
    await t.groups.assignStudent(g2.id, s.id, manager.id); // free to join another group afterwards
  });

  it('moves a student within the school: one period ends (MOVED), another starts; old periods keep their group', async () => {
    const { t, school, manager, parent } = await setup();
    const a = await t.newGroup(school.id, manager.id, { name: 'A' });
    const b = await t.newGroup(school.id, manager.id, { name: 'B' });
    const s = await t.registerStudent(school.id, parent.id, manager.id);
    await t.groups.assignStudent(a.id, s.id, manager.id);
    await t.groups.moveStudent(a.id, s.id, b.id, manager.id);
    const periods = await t.groups.listAssignmentHistoryOfStudent(s.id);
    expect(periods.map((p) => [p.groupName, p.endReason])).toEqual([['A', 'MOVED'], ['B', null]]);
    expect((await t.groups.listStudentsOfGroup(a.id, page)).items).toEqual([]);
    expect((await t.groups.listStudentsOfGroup(b.id, page)).items.map((x) => x.studentId)).toEqual([s.id]);
    const types = t.h.store.messages.filter((m) => m.aggregateType === 'GroupAssignment').map((m) => m.eventType);
    expect(types).toEqual(['GroupStudentAssigned', 'GroupStudentUnassigned', 'GroupStudentAssigned']);
  });

  it('refuses invalid move targets and a student that is not in the source group; a failed move changes nothing', async () => {
    const { t, school, manager, parent } = await setup();
    const school2 = await t.newSchool('مدرسة ثانية');
    const manager2 = await t.newSchoolManager(school2.id);
    const a = await t.newGroup(school.id, manager.id);
    const b = await t.newGroup(school.id, manager.id);
    const other = await t.newGroup(school2.id, manager2.id);
    const s = await t.registerStudent(school.id, parent.id, manager.id);
    expect(await codeOf(t.groups.moveStudent(a.id, s.id, b.id, manager.id))).toBe('GROUP_STUDENT_NOT_ASSIGNED');
    await t.groups.assignStudent(a.id, s.id, manager.id);
    expect(await codeOf(t.groups.moveStudent(a.id, s.id, a.id, manager.id))).toBe('GROUP_MOVE_TARGET_INVALID');
    expect(await codeOf(t.groups.moveStudent(a.id, s.id, UNKNOWN, manager.id))).toBe('GROUP_MOVE_TARGET_INVALID');
    expect(await codeOf(t.groups.moveStudent(a.id, s.id, other.id, manager.id))).toBe('GROUP_MOVE_TARGET_INVALID'); // another school
    await t.groups.archiveGroup(b.id, null, manager.id);
    expect(await codeOf(t.groups.moveStudent(a.id, s.id, b.id, manager.id))).toBe('GROUP_MOVE_TARGET_INVALID'); // archived target
    expect((await t.groups.listAssignmentHistoryOfStudent(s.id)).length).toBe(1);
    expect((await t.groups.listStudentsOfGroup(a.id, page)).items.length).toBe(1);
  });
});

describe('archiving a group (final)', () => {
  it('unassigns EVERY student in the same transaction (GROUP_ARCHIVED), keeps them as students and publishes the events', async () => {
    const { t, school, manager, parent } = await setup();
    const g = await t.newGroup(school.id, manager.id);
    const s1 = await t.registerStudent(school.id, parent.id, manager.id);
    const s2 = await t.registerStudent(school.id, parent.id, manager.id, { fullName: 'يوسف أحمد محمد' });
    await t.groups.assignStudent(g.id, s1.id, manager.id);
    await t.groups.assignStudent(g.id, s2.id, manager.id);
    const archived = await t.groups.archiveGroup(g.id, ' انتهى ', manager.id);
    expect(archived.status).toBe('ARCHIVED');
    for (const s of [s1, s2]) {
      expect((await t.students.getStudent(s.id)).status).toBe('ACTIVE');
      expect((await t.groups.listAssignmentHistoryOfStudent(s.id))[0]).toMatchObject({ endReason: 'GROUP_ARCHIVED', unassignedBy: manager.id, groupName: g.name });
    }
    expect(t.h.store.messages.filter((m) => m.eventType === 'GroupStudentUnassigned').length).toBe(2);
    expect((await t.groups.listHistory(g.id)).at(-1)).toMatchObject({ action: 'ARCHIVED', reason: 'انتهى' });
    expect(await codeOf(t.groups.archiveGroup(g.id, null, manager.id))).toBe('GROUP_ARCHIVED');
    await t.groups.assignStudent((await t.newGroup(school.id, manager.id)).id, s1.id, manager.id); // free again
  });

  it('is atomic: a failure while ending the assignments rolls the archive back', async () => {
    const { t, school, manager, parent } = await setup();
    const g = await t.newGroup(school.id, manager.id);
    const s = await t.registerStudent(school.id, parent.id, manager.id);
    await t.groups.assignStudent(g.id, s.id, manager.id);
    const before = { events: t.h.store.messages.length, history: t.groupRepo.history.length, status: t.groupRepo.groups.get(g.id)!.status };
    const original = t.groupRepo.updateAssignment.bind(t.groupRepo);
    t.groupRepo.updateAssignment = async () => {
      throw new Error('boom');
    };
    await expect(t.groups.archiveGroup(g.id, null, manager.id)).rejects.toThrow('boom');
    t.groupRepo.updateAssignment = original;
    expect({ events: t.h.store.messages.length, history: t.groupRepo.history.length, status: t.groupRepo.groups.get(g.id)!.status }).toEqual(before);
    expect((await t.groups.listStudentsOfGroup(g.id, page)).items.length).toBe(1);
  });
});

describe('an archived or deactivated STUDENT (Students event consumer)', () => {
  it('an ARCHIVED student is hidden at once and unassigned by the consumer (STUDENT_ARCHIVED, no actor), idempotently', async () => {
    const { t, school, manager, parent } = await setup();
    const g = await t.newGroup(school.id, manager.id);
    const s = await t.registerStudent(school.id, parent.id, manager.id);
    await t.groups.assignStudent(g.id, s.id, manager.id);
    await t.students.archiveStudent(s.id, null, manager.id);
    expect((await t.groups.listStudentsOfGroup(g.id, page)).items).toEqual([]); // hidden before the consumer ran
    expect(await t.groups.isParentOfAnAssignedStudent(g.id, parent.id)).toBe(false);
    await t.deliverStudentEvents();
    await t.deliverStudentEvents(); // at-least-once delivery
    const periods = await t.groups.listAssignmentHistoryOfStudent(s.id);
    expect(periods.length).toBe(1);
    expect(periods[0]).toMatchObject({ endReason: 'STUDENT_ARCHIVED', unassignedBy: null });
    expect(t.h.store.messages.filter((m) => m.eventType === 'GroupStudentUnassigned').length).toBe(1);
  });

  it('a DEACTIVATED student keeps the assignment and returns to the same group when reactivated; a status event that is not ARCHIVED is ignored', async () => {
    const { t, school, manager, parent } = await setup();
    const g = await t.newGroup(school.id, manager.id);
    const s = await t.registerStudent(school.id, parent.id, manager.id);
    await t.groups.assignStudent(g.id, s.id, manager.id);
    await t.students.deactivateStudent(s.id, null, manager.id);
    await t.deliverStudentEvents();
    expect((await t.groups.listStudentsOfGroup(g.id, page)).items.map((x) => [x.studentId, x.status])).toEqual([[s.id, 'INACTIVE']]);
    await t.students.reactivateStudent(s.id, null, manager.id);
    expect((await t.groups.listStudentsOfGroup(g.id, page)).items.map((x) => x.status)).toEqual(['ACTIVE']);
    expect(await t.groups.unassignArchivedStudent(s.id)).toBe(false); // not archived: nothing happens
    expect(await t.groups.unassignArchivedStudent(UNKNOWN)).toBe(false);
  });
});

describe('reads', () => {
  it('lists a school\'s groups with status filter, sort and pagination', async () => {
    const { t, school, manager } = await setup();
    const a = await t.newGroup(school.id, manager.id, { name: 'ب' });
    await t.newGroup(school.id, manager.id, { name: 'أ' });
    await t.newGroup(school.id, manager.id, { name: 'ج' });
    await t.groups.archiveGroup(a.id, null, manager.id);
    const byName = await t.groups.listGroupsOfSchool(school.id, { sort: 'name', direction: 'asc', page: { page: 1, pageSize: 2 } });
    expect(byName.items.map((g) => g.name)).toEqual(['أ', 'ب']);
    expect(byName).toMatchObject({ total: 3, totalPages: 2 });
    expect((await t.groups.listGroupsOfSchool(school.id, { status: ['ARCHIVED'], page })).items.map((g) => g.id)).toEqual([a.id]);
    expect((await t.groups.listGroupsOfSchool(UNKNOWN, { page })).items).toEqual([]);
  });

  it('a Teacher\'s own groups come from the verified user id (ACTIVE only); a user without a Teacher record gets an empty page', async () => {
    const { t, school, manager, teacher } = await setup();
    const mine = await t.newGroup(school.id, manager.id, { teacherId: teacher.id });
    const archived = await t.newGroup(school.id, manager.id, { teacherId: teacher.id });
    await t.groups.archiveGroup(archived.id, null, manager.id);
    await t.newGroup(school.id, manager.id);
    expect((await t.groups.listOwnGroups(teacher.userId, page)).items.map((g) => g.id)).toEqual([mine.id]);
    expect((await t.groups.listOwnGroups(manager.id, page)).items).toEqual([]);
  });

  it('exposes the lookups other modules use', async () => {
    const { t, school, manager, teacher, parent } = await setup();
    const g = await t.newGroup(school.id, manager.id, { teacherId: teacher.id });
    const s = await t.registerStudent(school.id, parent.id, manager.id);
    expect(await t.groups.findScopeById(g.id)).toEqual({ id: g.id, schoolId: school.id, teacherId: teacher.id, status: 'ACTIVE' });
    expect(await t.groups.findScopeById(UNKNOWN)).toBeUndefined();
    expect(await t.groups.isStudentInGroupOfTeacher(s.id, teacher.id)).toBe(false);
    await t.groups.assignStudent(g.id, s.id, manager.id);
    expect(await t.groups.isStudentInGroupOfTeacher(s.id, teacher.id)).toBe(true);
    expect(await t.groups.isParentOfAnAssignedStudent(g.id, parent.id)).toBe(true);
    expect(await codeOf(t.groups.getGroup(UNKNOWN))).toBe('GROUP_NOT_FOUND');
    expect(await codeOf(t.groups.listHistory(UNKNOWN))).toBe('GROUP_NOT_FOUND');
    expect(await codeOf(t.groups.listStudentsOfGroup(UNKNOWN, page))).toBe('GROUP_NOT_FOUND');
  });
});
