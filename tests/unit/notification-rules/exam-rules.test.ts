import { beforeEach, describe, expect, it } from 'vitest';
import { ExamEventTypes } from '../../../src/modules/30-exams/public';
import { REMINDER_KINDS } from '../../../src/modules/32-notification-rules/public';
import { HOUR, MIN, createRulesHarness, ids, type RulesHarness } from '../../helpers/notification-rules-harness';

let w: RulesHarness;
const START = '2026-11-10T10:00:00.000Z'; // 12:00 in Cairo
const END = '2026-11-10T11:30:00.000Z'; // 13:30 in Cairo

const exam = (extra: Record<string, unknown> = {}) => ({ examId: ids.exam, schoolId: ids.school, status: 'SCHEDULED', startAt: START, endAt: END, ...extra });

beforeEach(() => {
  w = createRulesHarness();
  w.exams.map.set(ids.exam, { examId: ids.exam, schoolId: ids.school, status: 'SCHEDULED', startAt: new Date(START), examinerTeacherIds: [ids.teacher1] });
  w.exams.targets.set(ids.exam, [ids.studentA, ids.studentB]);
});

describe('exam scheduled', () => {
  it('tells the parents of the target students, each only about their own child, and schedules the reminder', async () => {
    await w.deliver(ExamEventTypes.SCHEDULED, exam());
    expect(w.notificationsOf(ids.parentA)).toHaveLength(1);
    expect(w.notificationsOf(ids.parentA)[0]?.body).toContain('Ali Ahmed');
    expect(w.notificationsOf(ids.parentA)[0]?.body).toContain('2026-11-10 12:00');
    expect(w.notificationsOf(ids.parentA)[0]?.body).not.toContain('Bilal');
    expect(w.notificationsOf(ids.parentB)[0]?.body).toContain('Bilal Badr');
    expect(w.notificationsOf(ids.teacherUser1)).toHaveLength(0);
    const reminder = await w.state.findReminder(REMINDER_KINDS.EXAM_24H, ids.exam);
    expect(reminder?.dueAt.toISOString()).toBe('2026-11-09T10:00:00.000Z');
    expect(await w.state.listExamAudience(ids.exam, 'STUDENT')).toEqual([ids.studentA, ids.studentB]);
  });
  it('is idempotent on redelivery', async () => {
    const event = await w.deliver(ExamEventTypes.SCHEDULED, exam());
    await w.redeliver(event);
    expect(w.allNotifications()).toHaveLength(2);
  });
});

describe('exam examiners', () => {
  it('an assigned examiner is told, a removed one is told, nobody else', async () => {
    await w.deliver(ExamEventTypes.EXAMINER_ASSIGNED, exam({ teacherId: ids.teacher2 }));
    await w.deliver(ExamEventTypes.EXAMINER_REMOVED, exam({ teacherId: ids.teacher2 }));
    const n = w.notificationsOf(ids.teacherUser2);
    expect(n.map((x) => x.type)).toEqual(['EXAM_EXAMINER_ASSIGNED', 'EXAM_EXAMINER_REMOVED']);
    expect(w.allNotifications()).toHaveLength(2);
    expect(await w.state.listExamAudience(ids.exam, 'EXAMINER')).toEqual([]);
  });
});

describe('exam modifications (decision 4)', () => {
  beforeEach(async () => {
    await w.deliver(ExamEventTypes.SCHEDULED, exam());
    w.h.repository.notifications.clear();
  });

  it('a start/end change tells the parents of every target student and the current examiners, with the current schedule', async () => {
    await w.deliver(ExamEventTypes.UPDATED, exam({ changedFields: ['startAt', 'endAt'], startAt: '2026-11-11T10:00:00.000Z' }));
    expect(w.notificationsOf(ids.parentA)).toHaveLength(1);
    expect(w.notificationsOf(ids.parentA)[0]?.body).toContain('2026-11-11 12:00');
    expect(w.notificationsOf(ids.parentB)).toHaveLength(1);
    expect(w.notificationsOf(ids.teacherUser1)).toHaveLength(1);
    expect(w.notificationsOf(ids.teacherUser2)).toHaveLength(0); // not an examiner
  });
  it('moving the start re-arms the 24-hour reminder for the new time', async () => {
    await w.deliver(ExamEventTypes.UPDATED, exam({ changedFields: ['startAt'], startAt: '2026-11-11T10:00:00.000Z' }));
    const reminder = await w.state.findReminder(REMINDER_KINDS.EXAM_24H, ids.exam);
    expect(reminder?.dueAt.toISOString()).toBe('2026-11-10T10:00:00.000Z');
    expect(reminder?.state).toBe('PENDING');
  });
  it('a configuration change (question count / maximum score) is also a modification', async () => {
    await w.deliver(ExamEventTypes.UPDATED, exam({ changedFields: ['questionCount', 'maxScore'] }));
    expect(w.notificationsOf(ids.parentA)).toHaveLength(1);
    expect(w.notificationsOf(ids.parentB)).toHaveLength(1);
  });
  it('a target change tells the parents of students ADDED and REMOVED, not the unchanged ones; examiners are told', async () => {
    w.exams.targets.set(ids.exam, [ids.studentB, ids.studentA2]); // A removed, A2 added, B unchanged
    await w.deliver(ExamEventTypes.UPDATED, exam({ changedFields: ['targets'] }));
    const a = w.notificationsOf(ids.parentA);
    expect(a).toHaveLength(2); // Ali removed + Amal added (both children of parent A)
    expect(a.some((n) => n.type === 'EXAM_TARGET_REMOVED' && n.body.includes('Ali Ahmed'))).toBe(true);
    expect(a.some((n) => n.type === 'EXAM_SCHEDULED' && n.body.includes('Amal Ahmed'))).toBe(true);
    expect(w.notificationsOf(ids.parentB)).toHaveLength(0);
    expect(w.notificationsOf(ids.teacherUser1)).toHaveLength(1);
    expect(await w.state.listExamAudience(ids.exam, 'STUDENT')).toEqual([ids.studentB, ids.studentA2]);
  });
  it('a student added by a target change is not told twice when other fields changed in the same update', async () => {
    w.exams.targets.set(ids.exam, [ids.studentA, ids.studentB, ids.studentA2]);
    await w.deliver(ExamEventTypes.UPDATED, exam({ changedFields: ['targets', 'endAt'] }));
    const amal = w.notificationsOf(ids.parentA).filter((n) => n.body.includes('Amal Ahmed'));
    expect(amal).toHaveLength(1);
    expect(amal[0]?.type).toBe('EXAM_SCHEDULED');
  });
  it('an end-time change after the exam started still reaches the students told earlier', async () => {
    w.exams.map.set(ids.exam, { examId: ids.exam, schoolId: ids.school, status: 'STARTED', startAt: new Date(START), examinerTeacherIds: [ids.teacher1] });
    await w.deliver(ExamEventTypes.END_TIME_CHANGED, exam({ status: 'STARTED', endAt: '2026-11-10T12:00:00.000Z' }));
    expect(w.notificationsOf(ids.parentA)).toHaveLength(1);
    expect(w.notificationsOf(ids.parentB)).toHaveLength(1);
    expect(w.notificationsOf(ids.teacherUser1)).toHaveLength(1);
  });
  it('a student targeted / untargeted before the start tells that student’s parent only, once', async () => {
    w.exams.targets.set(ids.exam, [ids.studentA, ids.studentB, ids.studentA2]);
    const event = await w.deliver(ExamEventTypes.STUDENT_TARGETED, exam({ studentId: ids.studentA2, groupId: ids.group1 }));
    await w.redeliver(event);
    expect(w.allNotifications()).toHaveLength(1);
    expect(w.notificationsOf(ids.parentA)).toHaveLength(1);
    await w.deliver(ExamEventTypes.STUDENT_UNTARGETED, exam({ studentId: ids.studentA2, groupId: ids.group1 }));
    expect(w.notificationsOf(ids.parentA)).toHaveLength(2);
    expect(await w.state.listExamAudience(ids.exam, 'STUDENT')).toEqual([ids.studentA, ids.studentB]);
  });
  it('a modification of a cancelled exam is not notified (the cancellation covers it)', async () => {
    w.exams.map.set(ids.exam, { examId: ids.exam, schoolId: ids.school, status: 'CANCELLED', startAt: new Date(START), examinerTeacherIds: [] });
    await w.deliver(ExamEventTypes.UPDATED, exam({ changedFields: ['endAt'] }));
    expect(w.allNotifications()).toHaveLength(0);
  });
  it('redelivering the update creates nothing twice', async () => {
    const event = await w.deliver(ExamEventTypes.UPDATED, exam({ changedFields: ['endAt'] }));
    await w.redeliver(event);
    expect(w.notificationsOf(ids.parentA)).toHaveLength(1);
    expect(w.notificationsOf(ids.teacherUser1)).toHaveLength(1);
  });
});

describe('exam cancellation and deletion', () => {
  beforeEach(async () => {
    await w.deliver(ExamEventTypes.SCHEDULED, exam());
    w.h.repository.notifications.clear();
  });
  it('a cancelled scheduled exam tells the parents and examiners and suppresses the pending reminder', async () => {
    w.exams.map.set(ids.exam, { examId: ids.exam, schoolId: ids.school, status: 'CANCELLED', startAt: new Date(START), examinerTeacherIds: [ids.teacher1] });
    await w.deliver(ExamEventTypes.CANCELLED, exam({ status: 'CANCELLED', wasScheduled: true }));
    expect(w.notificationsOf(ids.parentA)).toHaveLength(1);
    expect(w.notificationsOf(ids.parentB)).toHaveLength(1);
    expect(w.notificationsOf(ids.teacherUser1)).toHaveLength(1);
    expect((await w.state.findReminder(REMINDER_KINDS.EXAM_24H, ids.exam))?.state).toBe('SUPPRESSED');
    expect(await w.state.listExamAudience(ids.exam, 'STUDENT')).toEqual([]);
  });
  it('a deleted scheduled exam (invisible to Module 30 afterwards) still reaches its parents and examiners from the snapshot', async () => {
    await w.state.addExamAudience(ids.exam, 'EXAMINER', ids.teacher1, w.h.clock.now());
    w.exams.map.delete(ids.exam);
    await w.deliver(ExamEventTypes.DELETED, exam({ wasScheduled: true }));
    expect(w.notificationsOf(ids.parentA)).toHaveLength(1);
    expect(w.notificationsOf(ids.teacherUser1)).toHaveLength(1);
  });
  it('a draft that was never scheduled notifies nobody', async () => {
    await w.deliver(ExamEventTypes.CANCELLED, exam({ status: 'CANCELLED', wasScheduled: false }));
    expect(w.allNotifications()).toHaveLength(0);
  });
  it('a retried cancellation creates nothing twice', async () => {
    w.exams.map.set(ids.exam, { examId: ids.exam, schoolId: ids.school, status: 'CANCELLED', startAt: new Date(START), examinerTeacherIds: [ids.teacher1] });
    const event = await w.deliver(ExamEventTypes.CANCELLED, exam({ status: 'CANCELLED', wasScheduled: true }));
    await w.redeliver(event);
    expect(w.allNotifications()).toHaveLength(3);
  });
});

describe('exam result', () => {
  it('tells only the parent of that student, with the question scores and the total', async () => {
    await w.deliver(ExamEventTypes.RESULT_RECORDED, { examId: ids.exam, studentId: ids.studentB, schoolId: ids.school, scores: [8, 9.5, 7], total: 24.5, maxTotal: 30 });
    expect(w.allNotifications()).toHaveLength(1);
    const [n] = w.notificationsOf(ids.parentB);
    expect(n?.body).toContain('Bilal Badr');
    expect(n?.body).toContain('24.5 out of 30');
    expect(n?.body).toContain('8, 9.5, 7');
  });
  it('is idempotent and ignores a malformed payload', async () => {
    const event = await w.deliver(ExamEventTypes.RESULT_RECORDED, { examId: ids.exam, studentId: ids.studentB, scores: [1], total: 1, maxTotal: 2 });
    await w.redeliver(event);
    await w.deliver(ExamEventTypes.RESULT_RECORDED, { examId: ids.exam, studentId: ids.studentB });
    expect(w.allNotifications()).toHaveLength(1);
  });
});

describe('exam reminder (24 hours before)', () => {
  const schedule = async (startOffsetMs: number) => {
    const start = new Date(w.h.clock.now().getTime() + startOffsetMs);
    w.exams.map.set(ids.exam, { examId: ids.exam, schoolId: ids.school, status: 'SCHEDULED', startAt: start, examinerTeacherIds: [ids.teacher1, ids.teacher2] });
    await w.deliver(ExamEventTypes.SCHEDULED, exam({ startAt: start.toISOString(), endAt: new Date(start.getTime() + HOUR).toISOString() }));
    w.h.repository.notifications.clear();
    return start;
  };

  it('is not sent before it is due, then goes to the parents of all targets and all current examiners', async () => {
    await schedule(30 * HOUR);
    expect(await w.processor.processDue()).toEqual({ sent: 0, suppressed: 0, postponed: 0, retried: 0, failed: 0 });
    w.h.advance(6 * HOUR + MIN);
    expect((await w.processor.processDue()).sent).toBe(1);
    expect(w.notificationsOf(ids.parentA)).toHaveLength(1);
    expect(w.notificationsOf(ids.parentB)).toHaveLength(1);
    expect(w.notificationsOf(ids.teacherUser1)).toHaveLength(1);
    expect(w.notificationsOf(ids.teacherUser2)).toHaveLength(1);
    expect(w.notificationsOf(ids.teacherUser3)).toHaveLength(0);
  });
  it('an exam scheduled less than 24 hours before the start is reminded IMMEDIATELY, not skipped', async () => {
    await schedule(5 * HOUR);
    expect((await w.processor.processDue()).sent).toBe(1);
    expect(w.notificationsOf(ids.parentA)).toHaveLength(1);
  });
  it('is sent once only: a second pass and a crash-style replay create nothing more', async () => {
    await schedule(5 * HOUR);
    await w.processor.processDue();
    await w.processor.processDue();
    expect(w.allNotifications()).toHaveLength(4);
  });
  it('is suppressed when the exam was cancelled before the reminder was sent', async () => {
    await schedule(30 * HOUR);
    w.exams.map.set(ids.exam, { examId: ids.exam, schoolId: ids.school, status: 'CANCELLED', startAt: new Date(w.h.clock.now().getTime() + 30 * HOUR), examinerTeacherIds: [] });
    await w.deliver(ExamEventTypes.CANCELLED, exam({ status: 'CANCELLED', wasScheduled: true }));
    w.h.repository.notifications.clear();
    w.h.advance(10 * HOUR);
    expect(await w.processor.processDue()).toEqual({ sent: 0, suppressed: 0, postponed: 0, retried: 0, failed: 0 }); // already suppressed by the event
    expect(w.allNotifications()).toHaveLength(0);
  });
  it('is suppressed at fire time when the exam is no longer SCHEDULED even if the cancellation event has not been processed yet', async () => {
    await schedule(5 * HOUR);
    w.exams.map.set(ids.exam, { examId: ids.exam, schoolId: ids.school, status: 'CANCELLED', startAt: new Date(w.h.clock.now().getTime() + 5 * HOUR), examinerTeacherIds: [] });
    expect((await w.processor.processDue()).suppressed).toBe(1);
    expect(w.allNotifications()).toHaveLength(0);
  });
  it('a start moved later postpones the reminder to the new time (and it is sent then)', async () => {
    await schedule(5 * HOUR); // due now
    const later = new Date(w.h.clock.now().getTime() + 40 * HOUR);
    w.exams.map.set(ids.exam, { examId: ids.exam, schoolId: ids.school, status: 'SCHEDULED', startAt: later, examinerTeacherIds: [ids.teacher1] });
    expect((await w.processor.processDue()).postponed).toBe(1);
    w.h.advance(17 * HOUR);
    expect((await w.processor.processDue()).sent).toBe(1);
  });
  it('is not sent once the start time has passed', async () => {
    await schedule(5 * HOUR);
    w.h.advance(6 * HOUR);
    expect((await w.processor.processDue()).suppressed).toBe(1);
    expect(w.allNotifications()).toHaveLength(0);
  });
  it('a technical failure retries with a delay and then succeeds without duplicates', async () => {
    await schedule(5 * HOUR);
    const original = w.exams.listLiveTargetStudentIds.bind(w.exams);
    let failing = true;
    w.exams.listLiveTargetStudentIds = async (id: string) => {
      if (failing) throw new Error('database unavailable');
      return original(id);
    };
    expect((await w.processor.processDue()).retried).toBe(1);
    expect(w.allNotifications()).toHaveLength(0);
    failing = false;
    expect((await w.processor.processDue()).sent).toBe(0); // not due yet: the retry waits
    w.h.advance(31_000);
    expect((await w.processor.processDue()).sent).toBe(1);
    expect(w.allNotifications()).toHaveLength(4);
  });
});

describe('no backfill (decision 5)', () => {
  it('an exam whose start is already past gets no reminder (no historical reminder)', async () => {
    const past = new Date(w.h.clock.now().getTime() - HOUR);
    w.exams.map.set(ids.exam, { examId: ids.exam, schoolId: ids.school, status: 'SCHEDULED', startAt: past, examinerTeacherIds: [] });
    await w.deliver(ExamEventTypes.SCHEDULED, exam({ startAt: past.toISOString() }));
    expect(await w.state.findReminder(REMINDER_KINDS.EXAM_24H, ids.exam)).toBeUndefined();
    expect(await w.processor.processDue()).toEqual({ sent: 0, suppressed: 0, postponed: 0, retried: 0, failed: 0 });
  });
  it('an exam scheduled before deployment (never seen by Module 32) gets NO reminder even when its start is later modified', async () => {
    await w.deliver(ExamEventTypes.UPDATED, exam({ changedFields: ['startAt'], startAt: '2026-11-11T10:00:00.000Z' }));
    expect(await w.state.findReminder(REMINDER_KINDS.EXAM_24H, ids.exam)).toBeUndefined();
    w.h.advance(10 * 24 * HOUR);
    expect(await w.processor.processDue()).toEqual({ sent: 0, suppressed: 0, postponed: 0, retried: 0, failed: 0 });
  });
  it('a target change on such an exam is not expressed as "added / removed"; its current targets learn the current schedule, and the snapshot is seeded', async () => {
    w.exams.targets.set(ids.exam, [ids.studentA, ids.studentB]);
    await w.deliver(ExamEventTypes.UPDATED, exam({ changedFields: ['targets'] }));
    expect(w.allNotifications().filter((n) => n.type === 'EXAM_SCHEDULED')).toHaveLength(0);
    expect(w.allNotifications().filter((n) => n.type === 'EXAM_UPDATED').length).toBe(3); // 2 parents + the examiner
    expect(await w.state.listExamAudience(ids.exam, 'STUDENT')).toEqual([ids.studentA, ids.studentB]);
    expect(await w.state.findReminder(REMINDER_KINDS.EXAM_24H, ids.exam)).toBeUndefined();
  });
  it('once seeded, a later target change is a normal added / removed change', async () => {
    w.exams.targets.set(ids.exam, [ids.studentA, ids.studentB]);
    await w.deliver(ExamEventTypes.UPDATED, exam({ changedFields: ['targets'] }));
    w.h.repository.notifications.clear();
    w.exams.targets.set(ids.exam, [ids.studentB]);
    await w.deliver(ExamEventTypes.UPDATED, exam({ changedFields: ['targets'] }));
    expect(w.notificationsOf(ids.parentA).map((n) => n.type)).toEqual(['EXAM_TARGET_REMOVED']);
    expect(w.notificationsOf(ids.parentB)).toHaveLength(0);
  });
  it('a tracked exam (scheduled after deployment) still has its reminder moved when the start changes', async () => {
    await w.deliver(ExamEventTypes.SCHEDULED, exam());
    await w.deliver(ExamEventTypes.UPDATED, exam({ changedFields: ['startAt'], startAt: '2026-11-12T10:00:00.000Z' }));
    expect((await w.state.findReminder(REMINDER_KINDS.EXAM_24H, ids.exam))?.dueAt.toISOString()).toBe('2026-11-11T10:00:00.000Z');
  });
});
