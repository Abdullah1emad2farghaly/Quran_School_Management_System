import { beforeEach, describe, expect, it } from 'vitest';
import { GroupEventTypes } from '../../../src/modules/20-groups/public';
import { SchoolEventTypes } from '../../../src/modules/16-schools/public';
import { createRulesHarness, ids, type RulesHarness } from '../../helpers/notification-rules-harness';

let w: RulesHarness;
beforeEach(() => {
  w = createRulesHarness();
  w.schools.map.set(ids.school, { id: ids.school, name: 'Nour School', organizationId: ids.org, applicantUserId: ids.applicant, applicantName: 'Sara Said', rejectionReason: null });
});

describe('school request notifications', () => {
  it('a submitted request notifies the Organization Manager(s) only', async () => {
    await w.deliver(SchoolEventTypes.SCHOOL_CREATED, { schoolId: ids.school, actorId: ids.applicant });
    expect(w.notificationsOf(ids.manager1)).toHaveLength(1);
    expect(w.notificationsOf(ids.manager2)).toHaveLength(1);
    expect(w.notificationsOf(ids.applicant)).toHaveLength(0);
    expect(w.notificationsOf(ids.manager1)[0]?.body).toContain('Nour School');
  });
  it('a school an organization manager created directly (no applicant) is not a request: nobody is notified', async () => {
    w.schools.map.set(ids.school, { id: ids.school, name: 'Nour School', organizationId: ids.org, applicantUserId: null, applicantName: null, rejectionReason: null });
    await w.deliver(SchoolEventTypes.SCHOOL_CREATED, { schoolId: ids.school, actorId: ids.manager1 });
    await w.deliver(SchoolEventTypes.SCHOOL_APPROVED, { schoolId: ids.school, actorId: ids.manager1 });
    expect(w.allNotifications()).toHaveLength(0);
  });
  it('approval notifies the ORIGINAL REQUESTER only (not the managers, nobody else)', async () => {
    await w.deliver(SchoolEventTypes.SCHOOL_APPROVED, { schoolId: ids.school, actorId: ids.manager1 });
    expect(w.allNotifications()).toHaveLength(1);
    expect(w.notificationsOf(ids.applicant)).toHaveLength(1);
    expect(w.notificationsOf(ids.manager1)).toHaveLength(0);
  });
  it('a rejection carries the rejection reason', async () => {
    w.schools.map.set(ids.school, { id: ids.school, name: 'Nour School', organizationId: ids.org, applicantUserId: ids.applicant, applicantName: 'Sara Said', rejectionReason: 'Incomplete documents' });
    await w.deliver(SchoolEventTypes.SCHOOL_REJECTED, { schoolId: ids.school, actorId: ids.manager1 });
    const [n] = w.notificationsOf(ids.applicant);
    expect(n?.body).toContain('Incomplete documents');
    expect(w.allNotifications()).toHaveLength(1);
  });
  it('a redelivered event creates nothing twice', async () => {
    const event = await w.deliver(SchoolEventTypes.SCHOOL_CREATED, { schoolId: ids.school, actorId: ids.applicant });
    await w.redeliver(event);
    await w.redeliver(event);
    expect(w.notificationsOf(ids.manager1)).toHaveLength(1);
  });
  it('an unknown school or a payload without an id does nothing', async () => {
    await w.deliver(SchoolEventTypes.SCHOOL_APPROVED, { schoolId: '00000000-0000-4000-8000-0000000000ff' });
    await w.deliver(SchoolEventTypes.SCHOOL_APPROVED, {});
    expect(w.allNotifications()).toHaveLength(0);
  });
});

describe('group change notifications', () => {
  it('a student assignment tells the parent of THAT student and the responsible Teacher — never another parent', async () => {
    await w.deliver(GroupEventTypes.GROUP_STUDENT_ASSIGNED, { groupId: ids.group1, studentId: ids.studentA, schoolId: ids.school });
    expect(w.notificationsOf(ids.parentA)).toHaveLength(1);
    expect(w.notificationsOf(ids.parentA)[0]?.body).toContain('Ali Ahmed');
    expect(w.notificationsOf(ids.parentB)).toHaveLength(0);
    expect(w.notificationsOf(ids.teacherUser1)).toHaveLength(1);
    expect(w.notificationsOf(ids.teacherUser2)).toHaveLength(0);
  });
  it('a move is a removal then an assignment: parents hear both, and each group Teacher hears their own side', async () => {
    await w.deliver(GroupEventTypes.GROUP_STUDENT_UNASSIGNED, { groupId: ids.group1, studentId: ids.studentA, reason: 'MOVED' });
    await w.deliver(GroupEventTypes.GROUP_STUDENT_ASSIGNED, { groupId: ids.group2, studentId: ids.studentA });
    const parent = w.notificationsOf(ids.parentA);
    expect(parent).toHaveLength(2);
    expect(parent.map((n) => n.type).sort()).toEqual(['GROUP_STUDENT_ASSIGNED', 'GROUP_STUDENT_UNASSIGNED']);
    expect(parent.some((n) => n.body.includes('Fajr'))).toBe(true);
    expect(parent.some((n) => n.body.includes('Asr'))).toBe(true);
    expect(w.notificationsOf(ids.teacherUser1)).toHaveLength(1);
    expect(w.notificationsOf(ids.teacherUser2)).toHaveLength(1);
  });
  it('removal caused by archiving the group says so to the parent, and the Teacher is still told', async () => {
    await w.deliver(GroupEventTypes.GROUP_STUDENT_UNASSIGNED, { groupId: ids.group1, studentId: ids.studentB, reason: 'GROUP_ARCHIVED' });
    expect(w.notificationsOf(ids.parentB)[0]?.body).toContain('archived');
    expect(w.notificationsOf(ids.teacherUser1)).toHaveLength(1);
  });
  it('a Teacher change tells BOTH the newly assigned Teacher and the previous Teacher, and no parent', async () => {
    w.groups.map.set(ids.group1, { id: ids.group1, name: 'Fajr', schoolId: ids.school, teacherId: ids.teacher3 });
    await w.deliver(GroupEventTypes.GROUP_TEACHER_CHANGED, { groupId: ids.group1, teacherId: ids.teacher3, previousTeacherId: ids.teacher1 });
    expect(w.allNotifications()).toHaveLength(2);
    const added = w.notificationsOf(ids.teacherUser3);
    const removed = w.notificationsOf(ids.teacherUser1);
    expect(added).toHaveLength(1);
    expect(added[0]?.type).toBe('GROUP_TEACHER_ASSIGNED');
    expect(added[0]?.body).toContain('assigned as the responsible Teacher');
    expect(removed).toHaveLength(1);
    expect(removed[0]?.type).toBe('GROUP_TEACHER_REMOVED');
    expect(removed[0]?.body).toContain('no longer the responsible Teacher');
    expect(w.notificationsOf(ids.parentA)).toHaveLength(0);
    expect(w.notificationsOf(ids.teacherUser2)).toHaveLength(0);
  });
  it('the Teacher notification names the group in both messages, and redelivery creates nothing twice', async () => {
    const event = await w.deliver(GroupEventTypes.GROUP_TEACHER_CHANGED, { groupId: ids.group1, teacherId: ids.teacher3, previousTeacherId: ids.teacher1 });
    await w.redeliver(event);
    expect(w.allNotifications()).toHaveLength(2);
    expect(w.allNotifications().every((n) => n.body.includes('Fajr'))).toBe(true);
  });
  it('when the Teacher was removed (nobody responsible now) only the previous Teacher is told', async () => {
    w.groups.map.set(ids.group1, { id: ids.group1, name: 'Fajr', schoolId: ids.school, teacherId: null });
    await w.deliver(GroupEventTypes.GROUP_TEACHER_CHANGED, { groupId: ids.group1, teacherId: null, previousTeacherId: ids.teacher1 });
    expect(w.allNotifications()).toHaveLength(1);
    expect(w.notificationsOf(ids.teacherUser1)[0]?.type).toBe('GROUP_TEACHER_REMOVED');
  });
  it('a first assignment (no previous Teacher) tells only the new Teacher', async () => {
    await w.deliver(GroupEventTypes.GROUP_TEACHER_CHANGED, { groupId: ids.group1, teacherId: ids.teacher2, previousTeacherId: null });
    expect(w.allNotifications()).toHaveLength(1);
    expect(w.notificationsOf(ids.teacherUser2)).toHaveLength(1);
  });
  it('archiving a group tells the responsible Teacher once; each student’s parent is told through that student’s own removal event (unchanged behaviour)', async () => {
    await w.deliver(GroupEventTypes.GROUP_ARCHIVED, { groupId: ids.group1, schoolId: ids.school });
    expect(w.notificationsOf(ids.teacherUser1)).toHaveLength(1);
    expect(w.allNotifications()).toHaveLength(1);
    for (const studentId of [ids.studentA, ids.studentB]) await w.deliver(GroupEventTypes.GROUP_STUDENT_UNASSIGNED, { groupId: ids.group1, studentId, reason: 'GROUP_ARCHIVED' });
    expect(w.notificationsOf(ids.parentA)).toHaveLength(1);
    expect(w.notificationsOf(ids.parentB)).toHaveLength(1);
    expect(w.notificationsOf(ids.parentA)[0]?.body).toContain('Ali Ahmed');
    expect(w.notificationsOf(ids.parentA)[0]?.body).not.toContain('Bilal');
  });
  it('every linked Parent account of the student is told (multiple parents), each once', async () => {
    w.students.map.set(ids.studentA, { id: ids.studentA, fullName: 'Ali Ahmed', schoolId: ids.school, parentUserIds: [ids.parentA, ids.parentA2] });
    const event = await w.deliver(GroupEventTypes.GROUP_STUDENT_ASSIGNED, { groupId: ids.group1, studentId: ids.studentA });
    await w.redeliver(event);
    expect(w.notificationsOf(ids.parentA)).toHaveLength(1);
    expect(w.notificationsOf(ids.parentA2)).toHaveLength(1);
    expect(w.notificationsOf(ids.parentB)).toHaveLength(0);
  });
  it('a missing group or student does nothing', async () => {
    await w.deliver(GroupEventTypes.GROUP_STUDENT_ASSIGNED, { groupId: '00000000-0000-4000-8000-0000000000ff', studentId: ids.studentA });
    await w.deliver(GroupEventTypes.GROUP_STUDENT_ASSIGNED, { groupId: ids.group1, studentId: '00000000-0000-4000-8000-0000000000ff' });
    expect(w.allNotifications()).toHaveLength(0);
  });
});

describe('language', () => {
  it('renders Arabic by default (no account language exists), English when the account language is English', async () => {
    const ar = createRulesHarness({ language: 'default' });
    ar.schools.map.set(ids.school, { id: ids.school, name: 'Nour School', organizationId: ids.org, applicantUserId: ids.applicant, applicantName: 'Sara Said', rejectionReason: null });
    await ar.deliver(SchoolEventTypes.SCHOOL_APPROVED, { schoolId: ids.school });
    expect(ar.notificationsOf(ids.applicant)[0]?.body).toContain('تمت الموافقة');
    w.schools.map.set(ids.school, { id: ids.school, name: 'Nour School', organizationId: ids.org, applicantUserId: ids.applicant, applicantName: 'Sara Said', rejectionReason: null });
    await w.deliver(SchoolEventTypes.SCHOOL_APPROVED, { schoolId: ids.school });
    expect(w.notificationsOf(ids.applicant)[0]?.body).toContain('was approved');
  });
});
