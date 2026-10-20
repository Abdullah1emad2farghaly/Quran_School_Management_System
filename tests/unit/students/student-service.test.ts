import { describe, expect, it } from 'vitest';
import { AppError, businessDateOf } from '../../../src/modules/00-shared-kernel/public';
import { Student } from '../../../src/modules/19-students/public';
import { NATIONAL_ID, PARENT_NAME, STUDENT_NAME, createStudentsHarness } from '../../helpers/students-harness';

const codeOf = (p: Promise<unknown>) => p.then(() => 'NO_ERROR', (e: unknown) => (e instanceof AppError ? e.code : `NOT_APP_ERROR:${String(e)}`));
const UNKNOWN = '00000000-0000-4000-8000-000000000000';

async function setup() {
  const t = await createStudentsHarness();
  const school = await t.newSchool();
  const manager = await t.newSchoolManager(school.id);
  const parent = await t.newParent(school.id, manager.id);
  return { t, school, manager, parent };
}

describe('registering a Student', () => {
  it('creates an ACTIVE student with exactly one Parent, the derived address, a join date defaulting to today (Africa/Cairo), history and an event', async () => {
    const { t, school, manager, parent } = await setup();
    const s = await t.registerStudent(school.id, parent.id, manager.id, { nationalId: NATIONAL_ID });
    expect(s).toMatchObject({ schoolId: school.id, organizationId: t.org.id, parentId: parent.id, fullName: STUDENT_NAME, nationalId: NATIONAL_ID, status: 'ACTIVE' });
    expect(s.joinDate).toBe(businessDateOf(t.h.clock.now()));
    expect(s.address).toMatchObject({ governorateName: parent.address!.governorateName, centerName: 'سمالوط', villageName: 'برمشا' });
    expect((await t.students.listHistory(s.id)).map((h) => [h.action, h.actorId, h.newStatus])).toEqual([['REGISTERED', manager.id, 'ACTIVE']]);
    const events = t.h.store.messages.filter((m) => m.aggregateType === 'Student');
    expect(events.map((e) => e.eventType)).toEqual(['StudentRegistered']);
    expect(events[0]!.payload).not.toMatch(/عمر|3000101/);
  });

  it('has no login: registering creates no user, no role and no password', async () => {
    const { t, school, manager, parent } = await setup();
    const usersBefore = t.h.users.rows.size;
    await t.registerStudent(school.id, parent.id, manager.id);
    expect(t.h.users.rows.size).toBe(usersBefore);
  });

  it('stores the address nowhere: it is the Parent\'s CURRENT address and follows a Parent address change', async () => {
    const { t, school, manager, parent } = await setup();
    const s = await t.registerStudent(school.id, parent.id, manager.id);
    expect(JSON.stringify([...t.studentRepo.rows.values()])).not.toMatch(/سمالوط|المنيا/);
    await t.parents.updateParent(parent.id, { address: { kind: 'raw', text: 'المنيا / مطاي' } }, manager.id);
    expect((await t.students.getStudent(s.id)).address).toMatchObject({ centerName: 'مطاي', villageName: null });
  });

  it('enforces the name: at least three parts and the Parent\'s first and second names as parts 2 and 3', async () => {
    const { t, school, manager, parent } = await setup();
    const reg = (fullName: unknown) => t.registerStudent(school.id, parent.id, manager.id, { fullName });
    expect(await codeOf(reg('عمر أحمد'))).toBe('INVALID_STUDENT_NAME');
    expect(await codeOf(reg('عمر خالد محمد'))).toBe('STUDENT_NAME_PARENT_MISMATCH');
    expect(await codeOf(reg('عمر أحمد خالد'))).toBe('STUDENT_NAME_PARENT_MISMATCH');
    expect(await codeOf(reg('عمر محمد أحمد'))).toBe('STUDENT_NAME_PARENT_MISMATCH');
    expect((await reg('عمر أحمد محمد علي')).fullName).toBe('عمر أحمد محمد علي');
    expect(t.studentRepo.rows.size).toBe(1);
  });

  it('validates the National ID format and the join date, and creates nothing on failure', async () => {
    const { t, school, manager, parent } = await setup();
    expect(await codeOf(t.registerStudent(school.id, parent.id, manager.id, { nationalId: '123' }))).toBe('INVALID_STUDENT_NATIONAL_ID');
    expect(await codeOf(t.registerStudent(school.id, parent.id, manager.id, { nationalId: undefined }))).toBe('INVALID_STUDENT_NATIONAL_ID');
    expect(await codeOf(t.registerStudent(school.id, parent.id, manager.id, { joinDate: '2026-02-30' }))).toBe('INVALID_STUDENT_JOIN_DATE');
    expect(await codeOf(t.registerStudent(school.id, parent.id, manager.id, { joinDate: 20261020 }))).toBe('INVALID_STUDENT_JOIN_DATE');
    expect((await t.registerStudent(school.id, parent.id, manager.id, { joinDate: '2026-09-01' })).joinDate).toBe('2026-09-01');
    expect(t.studentRepo.rows.size).toBe(1);
    expect(t.studentRepo.history.length).toBe(1);
  });

  it('requires an ACTIVE school', async () => {
    const { t, school, manager, parent } = await setup();
    expect(await codeOf(t.registerStudent(UNKNOWN, parent.id, manager.id))).toBe('STUDENT_SCHOOL_NOT_ACTIVE');
    await t.service.deactivateSchool(school.id, t.orgAdmin.id);
    expect(await codeOf(t.registerStudent(school.id, parent.id, manager.id))).toBe('STUDENT_SCHOOL_NOT_ACTIVE');
  });

  it('requires a Parent of the SAME organization that is actively linked to THIS school (one neutral error otherwise)', async () => {
    const { t, school, manager, parent } = await setup();
    const school2 = await t.newSchool('مدرسة ثانية');
    const manager2 = await t.newSchoolManager(school2.id);
    expect(await codeOf(t.registerStudent(school.id, UNKNOWN, manager.id))).toBe('STUDENT_PARENT_NOT_LINKED_TO_SCHOOL');
    expect(await codeOf(t.registerStudent(school2.id, parent.id, manager2.id))).toBe('STUDENT_PARENT_NOT_LINKED_TO_SCHOOL'); // not linked to school 2
    const org2 = await t.otherOrg();
    const foreignSchool = await t.newSchool('مدرسة أخرى', org2.id);
    const foreignManager = await t.newSchoolManager(foreignSchool.id, org2.id);
    expect(await codeOf(t.registerStudent(foreignSchool.id, parent.id, foreignManager.id))).toBe('STUDENT_PARENT_NOT_LINKED_TO_SCHOOL'); // another organization
    await t.parents.registerParent({ schoolId: school2.id, name: PARENT_NAME, phone: '01010001001', address: { kind: 'raw', text: 'المنيا' } }, manager2.id); // reuse -> linked to school 2 too
    expect(t.studentRepo.rows.size).toBe(0);
  });

  it('a Parent linked to two schools can have a student in each; a removed link blocks new students', async () => {
    const { t, school, manager, parent } = await setup();
    const school2 = await t.newSchool('مدرسة ثانية');
    const manager2 = await t.newSchoolManager(school2.id);
    await t.parents.registerParent({ schoolId: school2.id, name: PARENT_NAME, phone: '01010001001', address: { kind: 'raw', text: 'المنيا' } }, manager2.id);
    expect((await t.registerStudent(school.id, parent.id, manager.id)).schoolId).toBe(school.id);
    expect((await t.registerStudent(school2.id, parent.id, manager2.id)).schoolId).toBe(school2.id);
    expect(await codeOf(t.parents.removeSchoolLink(parent.id, school2.id, manager2.id))).toBe('PARENT_HAS_STUDENTS_IN_SCHOOL'); // has a student: refused
    const lone = await t.newParent(school.id, manager.id, 'سعيد حسن محمود');
    await t.parents.removeSchoolLink(lone.id, school.id, manager.id); // no students: allowed
    expect(await codeOf(t.registerStudent(school.id, lone.id, manager.id, { fullName: 'علي سعيد حسن' }))).toBe('STUDENT_PARENT_NOT_LINKED_TO_SCHOOL');
  });
});

describe('National ID is unique across the WHOLE system', () => {
  it('refuses a duplicate in the same school, another school, another organization, and after archiving; moves and replaces nothing', async () => {
    const { t, school, manager, parent } = await setup();
    const school2 = await t.newSchool('مدرسة ثانية');
    const manager2 = await t.newSchoolManager(school2.id);
    const parent2 = await t.newParent(school2.id, manager2.id, 'سعيد حسن محمود');
    const org2 = await t.otherOrg();
    const foreignSchool = await t.newSchool('مدرسة أخرى', org2.id);
    const foreignManager = await t.newSchoolManager(foreignSchool.id, org2.id);
    const foreignParent = await t.newParent(foreignSchool.id, foreignManager.id, 'منى كمال فهمي');

    const first = await t.registerStudent(school.id, parent.id, manager.id, { nationalId: NATIONAL_ID });
    expect(await codeOf(t.registerStudent(school.id, parent.id, manager.id, { nationalId: NATIONAL_ID }))).toBe('STUDENT_NATIONAL_ID_CONFLICT');
    expect(await codeOf(t.registerStudent(school2.id, parent2.id, manager2.id, { nationalId: NATIONAL_ID, fullName: 'علي سعيد حسن' }))).toBe('STUDENT_NATIONAL_ID_CONFLICT');
    expect(await codeOf(t.registerStudent(foreignSchool.id, foreignParent.id, foreignManager.id, { nationalId: NATIONAL_ID, fullName: 'ياسر منى كمال' }))).toBe('STUDENT_NATIONAL_ID_CONFLICT');
    await t.students.archiveStudent(first.id, null, manager.id);
    expect(await codeOf(t.registerStudent(school.id, parent.id, manager.id, { nationalId: NATIONAL_ID }))).toBe('STUDENT_NATIONAL_ID_CONFLICT'); // ARCHIVED still reserves it
    expect(await codeOf(t.registerStudent(school.id, parent.id, manager.id, { nationalId: '٣٠٠٠١٠١٠١٢٣٤٥٦' }))).toBe('STUDENT_NATIONAL_ID_CONFLICT'); // same ID typed with Arabic digits
    expect(t.studentRepo.rows.size).toBe(1);
    expect(t.studentRepo.rows.get(first.id)).toMatchObject({ schoolId: school.id, parentId: parent.id, status: 'ARCHIVED' }); // nothing moved or replaced
  });

  it('the repository itself (the in-memory twin of the unique index) is the final guard against a concurrent duplicate', async () => {
    const { t, school, manager, parent } = await setup();
    const a = await t.registerStudent(school.id, parent.id, manager.id, { nationalId: NATIONAL_ID });
    const twin = Student.register({ schoolId: school.id, organizationId: t.org.id, parentId: parent.id, fullName: STUDENT_NAME, nationalId: a.nationalId, joinDate: a.joinDate, createdBy: manager.id, clock: t.h.clock });
    expect(await codeOf(t.unitOfWork.run((tx) => t.studentRepo.insert(twin, tx)))).toBe('STUDENT_NATIONAL_ID_CONFLICT');
  });

  it('a failed registration leaves nothing behind (atomic)', async () => {
    const { t, school, manager, parent } = await setup();
    await t.registerStudent(school.id, parent.id, manager.id, { nationalId: NATIONAL_ID });
    const before = { rows: t.studentRepo.rows.size, history: t.studentRepo.history.length, events: t.h.store.messages.length };
    await codeOf(t.registerStudent(school.id, parent.id, manager.id, { nationalId: NATIONAL_ID }));
    expect({ rows: t.studentRepo.rows.size, history: t.studentRepo.history.length, events: t.h.store.messages.length }).toEqual(before);
  });
});

describe('updating a Student', () => {
  it('corrects the join date and the name (history keeps the previous values); the Parent, school and National ID never change', async () => {
    const { t, school, manager, parent } = await setup();
    const s = await t.registerStudent(school.id, parent.id, manager.id, { nationalId: NATIONAL_ID, joinDate: '2026-09-01' });
    const updated = await t.students.updateStudent(s.id, { joinDate: '2026-09-15', fullName: 'يوسف أحمد محمد' }, manager.id);
    expect(updated).toMatchObject({ joinDate: '2026-09-15', fullName: 'يوسف أحمد محمد', nationalId: NATIONAL_ID, parentId: parent.id, schoolId: school.id });
    const history = await t.students.listHistory(s.id);
    expect(history.map((h) => h.action)).toEqual(['REGISTERED', 'DETAILS_UPDATED']);
    expect(history[1]).toMatchObject({ previousFullName: STUDENT_NAME, newFullName: 'يوسف أحمد محمد', previousJoinDate: '2026-09-01', newJoinDate: '2026-09-15', actorId: manager.id });
    // Attempts to smuggle immutable fields in are ignored.
    await t.students.updateStudent(s.id, { joinDate: '2026-09-16', nationalId: '30001010999999', parentId: UNKNOWN, schoolId: UNKNOWN } as never, manager.id);
    expect(t.studentRepo.rows.get(s.id)).toMatchObject({ nationalId: NATIONAL_ID, parentId: parent.id, schoolId: school.id });
  });

  it('a corrected name must keep the Parent\'s names; an empty or unchanged update changes nothing and records nothing', async () => {
    const { t, school, manager, parent } = await setup();
    const s = await t.registerStudent(school.id, parent.id, manager.id);
    expect(await codeOf(t.students.updateStudent(s.id, { fullName: 'يوسف خالد محمد' }, manager.id))).toBe('STUDENT_NAME_PARENT_MISMATCH');
    expect(await codeOf(t.students.updateStudent(s.id, { fullName: 'يوسف أحمد' }, manager.id))).toBe('INVALID_STUDENT_NAME');
    expect(await codeOf(t.students.updateStudent(s.id, {}, manager.id))).toBe('STUDENT_UPDATE_EMPTY');
    expect(await codeOf(t.students.updateStudent(s.id, { joinDate: 'x' }, manager.id))).toBe('INVALID_STUDENT_JOIN_DATE');
    const eventsBefore = t.h.store.messages.length;
    await t.students.updateStudent(s.id, { fullName: STUDENT_NAME, joinDate: s.joinDate }, manager.id);
    expect(t.h.store.messages.length).toBe(eventsBefore);
    expect((await t.students.listHistory(s.id)).length).toBe(1);
    expect(await codeOf(t.students.updateStudent(UNKNOWN, { joinDate: '2026-09-15' }, manager.id))).toBe('STUDENT_NOT_FOUND');
  });

  it('an ARCHIVED student is read-only; an INACTIVE one can still be corrected', async () => {
    const { t, school, manager, parent } = await setup();
    const s = await t.registerStudent(school.id, parent.id, manager.id);
    await t.students.deactivateStudent(s.id, null, manager.id);
    expect((await t.students.updateStudent(s.id, { joinDate: '2026-09-15' }, manager.id)).joinDate).toBe('2026-09-15');
    await t.students.archiveStudent(s.id, null, manager.id);
    expect(await codeOf(t.students.updateStudent(s.id, { joinDate: '2026-09-16' }, manager.id))).toBe('STUDENT_ARCHIVED');
  });
});

describe('Student lifecycle', () => {
  it('deactivate -> reactivate -> archive with reasons, history (who, when, previous status) and StudentStatusChanged events', async () => {
    const { t, school, manager, parent } = await setup();
    const s = await t.registerStudent(school.id, parent.id, manager.id);
    expect((await t.students.deactivateStudent(s.id, '  توقف مؤقت ', manager.id)).status).toBe('INACTIVE');
    expect((await t.students.reactivateStudent(s.id, null, manager.id)).status).toBe('ACTIVE');
    expect((await t.students.archiveStudent(s.id, 'تخرّج', manager.id)).status).toBe('ARCHIVED');
    const history = await t.students.listHistory(s.id);
    expect(history.slice(1).map((h) => [h.action, h.previousStatus, h.newStatus, h.reason, h.actorId])).toEqual([
      ['STATUS_CHANGED', 'ACTIVE', 'INACTIVE', 'توقف مؤقت', manager.id],
      ['STATUS_CHANGED', 'INACTIVE', 'ACTIVE', null, manager.id],
      ['STATUS_CHANGED', 'ACTIVE', 'ARCHIVED', 'تخرّج', manager.id],
    ]);
    const changed = t.h.store.messages.filter((m) => m.eventType === 'StudentStatusChanged');
    expect(changed.length).toBe(3);
    expect(JSON.parse(changed[2]!.payload)).toMatchObject({ studentId: s.id, previousStatus: 'ACTIVE', status: 'ARCHIVED', actorId: manager.id });
  });

  it('refuses invalid transitions; an ARCHIVED student can never be reactivated, deactivated or archived again', async () => {
    const { t, school, manager, parent } = await setup();
    const s = await t.registerStudent(school.id, parent.id, manager.id);
    expect(await codeOf(t.students.reactivateStudent(s.id, null, manager.id))).toBe('STUDENT_INVALID_STATUS_TRANSITION'); // already ACTIVE
    await t.students.deactivateStudent(s.id, null, manager.id);
    expect(await codeOf(t.students.deactivateStudent(s.id, null, manager.id))).toBe('STUDENT_INVALID_STATUS_TRANSITION');
    await t.students.archiveStudent(s.id, null, manager.id); // INACTIVE -> ARCHIVED
    for (const act of [t.students.reactivateStudent, t.students.deactivateStudent, t.students.archiveStudent]) {
      expect(await codeOf(act.call(t.students, s.id, null, manager.id))).toBe('STUDENT_ARCHIVED');
    }
    expect(await codeOf(t.students.archiveStudent(UNKNOWN, null, manager.id))).toBe('STUDENT_NOT_FOUND');
  });

  it('validates the reason (text, at most 500 characters); a blank reason is stored as none', async () => {
    const { t, school, manager, parent } = await setup();
    const s = await t.registerStudent(school.id, parent.id, manager.id);
    expect(await codeOf(t.students.deactivateStudent(s.id, 42, manager.id))).toBe('INVALID_STUDENT_REASON');
    expect(await codeOf(t.students.deactivateStudent(s.id, 'ا'.repeat(501), manager.id))).toBe('INVALID_STUDENT_REASON');
    expect((await t.students.deactivateStudent(s.id, '   ', manager.id)).status).toBe('INACTIVE');
    expect((await t.students.listHistory(s.id)).at(-1)!.reason).toBeNull();
  });

  it('reactivation needs an ACTIVE school', async () => {
    const { t, school, manager, parent } = await setup();
    const s = await t.registerStudent(school.id, parent.id, manager.id);
    await t.students.deactivateStudent(s.id, null, manager.id);
    await t.service.deactivateSchool(school.id, t.orgAdmin.id);
    expect(await codeOf(t.students.reactivateStudent(s.id, null, manager.id))).toBe('STUDENT_SCHOOL_NOT_ACTIVE');
    expect((await t.students.getStudent(s.id)).status).toBe('INACTIVE');
    await t.service.reactivateSchool(school.id, t.orgAdmin.id);
    expect((await t.students.reactivateStudent(s.id, null, manager.id)).status).toBe('ACTIVE');
  });

  it('there is no way to delete a student (no delete operation exists)', async () => {
    const { t } = await setup();
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(t.students)).filter((n) => /delete|remove|destroy/i.test(n))).toEqual([]);
  });
});

describe('Module 17 unlink guard (Parent-to-School link) with the REAL Students guard', () => {
  it('a Parent with a student in the school cannot be unlinked, in EVERY status (an archived student still anchors the link)', async () => {
    const { t, school, manager, parent } = await setup();
    const s = await t.registerStudent(school.id, parent.id, manager.id);
    expect(await codeOf(t.parents.removeSchoolLink(parent.id, school.id, manager.id))).toBe('PARENT_HAS_STUDENTS_IN_SCHOOL');
    await t.students.deactivateStudent(s.id, null, manager.id);
    expect(await codeOf(t.parents.removeSchoolLink(parent.id, school.id, manager.id))).toBe('PARENT_HAS_STUDENTS_IN_SCHOOL');
    await t.students.archiveStudent(s.id, null, manager.id);
    expect(await codeOf(t.parents.removeSchoolLink(parent.id, school.id, manager.id))).toBe('PARENT_HAS_STUDENTS_IN_SCHOOL');
    expect(await t.parents.isLinkedToSchool(parent.id, school.id)).toBe(true);
  });

  it('students of ANOTHER school do not block the unlink of this school', async () => {
    const { t, school, manager, parent } = await setup();
    const school2 = await t.newSchool('مدرسة ثانية');
    const manager2 = await t.newSchoolManager(school2.id);
    await t.parents.registerParent({ schoolId: school2.id, name: PARENT_NAME, phone: '01010001001', address: { kind: 'raw', text: 'المنيا' } }, manager2.id);
    await t.registerStudent(school2.id, parent.id, manager2.id);
    expect((await t.parents.removeSchoolLink(parent.id, school.id, manager.id)).isActive).toBe(false);
    expect(await t.parents.isLinkedToSchool(parent.id, school2.id)).toBe(true);
  });

  it('closes the race: the link is locked in the registration transaction, so a student can never attach to a removed link', async () => {
    const { t, school, manager } = await setup();
    const lone = await t.newParent(school.id, manager.id, 'سعيد حسن محمود');
    expect(await t.unitOfWork.run((tx) => t.parents.lockActiveSchoolLink(lone.id, school.id, tx))).toBe(true);
    await t.parents.removeSchoolLink(lone.id, school.id, manager.id);
    expect(await t.unitOfWork.run((tx) => t.parents.lockActiveSchoolLink(lone.id, school.id, tx))).toBe(false);
    expect(await t.unitOfWork.run((tx) => t.parents.lockActiveSchoolLink(UNKNOWN, school.id, tx))).toBe(false);
  });
});

describe('reads', () => {
  it('lists a school\'s students with status filter, sort and pagination; counts every status', async () => {
    const { t, school, manager, parent } = await setup();
    const a = await t.registerStudent(school.id, parent.id, manager.id, { fullName: 'أمين أحمد محمد', joinDate: '2026-01-03' });
    const b = await t.registerStudent(school.id, parent.id, manager.id, { fullName: 'بلال أحمد محمد', joinDate: '2026-01-01' });
    await t.registerStudent(school.id, parent.id, manager.id, { fullName: 'جاسر أحمد محمد', joinDate: '2026-01-02' });
    await t.students.deactivateStudent(b.id, null, manager.id);
    const page = { page: 1, pageSize: 2 };
    const byJoin = await t.students.listStudentsOfSchool(school.id, { sort: 'joinDate', direction: 'asc', page });
    expect(byJoin.items.map((s) => s.joinDate)).toEqual(['2026-01-01', '2026-01-02']);
    expect(byJoin).toMatchObject({ total: 3, totalPages: 2 });
    const inactive = await t.students.listStudentsOfSchool(school.id, { status: ['INACTIVE'], page });
    expect(inactive.items.map((s) => s.id)).toEqual([b.id]);
    const byName = await t.students.listStudentsOfSchool(school.id, { sort: 'fullName', direction: 'asc', page: { page: 1, pageSize: 10 } });
    expect(byName.items[0]!.id).toBe(a.id);
    expect((await t.students.listStudentsOfSchool(UNKNOWN, { page })).items).toEqual([]);
  });

  it('a Parent\'s own children come from the verified user id; a user without a Parent record gets an empty page', async () => {
    const { t, school, manager, parent } = await setup();
    const other = await t.newParent(school.id, manager.id, 'سعيد حسن محمود');
    const mine = await t.registerStudent(school.id, parent.id, manager.id);
    await t.registerStudent(school.id, other.id, manager.id, { fullName: 'علي سعيد حسن' });
    const own = await t.students.listChildrenOfParentUser(parent.userId, { page: { page: 1, pageSize: 10 } });
    expect(own.items.map((s) => s.id)).toEqual([mine.id]);
    expect((await t.students.listChildrenOfParentUser(manager.id, { page: { page: 1, pageSize: 10 } })).items).toEqual([]);
  });

  it('getStudent and history of an unknown student are STUDENT_NOT_FOUND', async () => {
    const { t } = await setup();
    expect(await codeOf(t.students.getStudent(UNKNOWN))).toBe('STUDENT_NOT_FOUND');
    expect(await codeOf(t.students.listHistory(UNKNOWN))).toBe('STUDENT_NOT_FOUND');
    expect(await t.students.findScopeById(UNKNOWN)).toBeUndefined();
  });
});
