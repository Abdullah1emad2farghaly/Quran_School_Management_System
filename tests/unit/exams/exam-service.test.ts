import { describe, expect, it } from 'vitest';
import { GPS, MANAGER, START, END, at, createExamFakes, teacher } from '../../helpers/exam-fakes';

const refused = async (promise: Promise<unknown>, code: string, details?: unknown) => expect(promise).rejects.toMatchObject({ code, ...(details === undefined ? {} : { details }) });
const world = () => {
  const t = createExamFakes();
  t.addGroup('group-1', ['s1', 's2', 's3']);
  t.addGroup('group-2', ['s4', 's5']);
  t.addTeacher(teacher(1));
  t.addTeacher(teacher(2));
  return t;
};
type World = ReturnType<typeof world>;
const submit = (t: World, examId: string, studentId: string, scores: unknown = [8, 9, 10], over: { userId?: string; gps?: unknown } = {}) =>
  t.service.submitResult(examId, over.userId ?? 'user-teacher-1', { studentId, scores, gps: 'gps' in over ? over.gps : GPS });
const afterStart = (t: World, ms = 1000) => t.clock.set(new Date(START.getTime() + ms));

describe('creating and scheduling (approved decision A)', () => {
  it('the School Manager creates any number of exams at any time; each starts as DRAFT with the examiners already assigned', async () => {
    const t = world();
    const a = await t.service.createExam(MANAGER, t.config() as never);
    const b = await t.service.createExam(MANAGER, t.config() as never);
    expect([a.status, b.status]).toEqual(['DRAFT', 'DRAFT']);
    expect(a.id).not.toBe(b.id);
    expect(a.maxTotal).toBe(30);
    expect(a.examiners.map((e) => e.teacherId)).toEqual(['teacher-1']);
    expect(t.types()).toEqual(['ExamExaminerAssigned', 'ExamExaminerAssigned']); // no parent event for a DRAFT
  });

  it('SCHEDULED publishes ExamScheduled; it needs a start strictly in the future', async () => {
    const t = world();
    const exam = await t.service.createExam(MANAGER, t.config() as never);
    t.events.length = 0;
    expect((await t.service.scheduleExam(exam.id, MANAGER)).status).toBe('SCHEDULED');
    expect(t.types()).toEqual(['ExamScheduled']);
    const late = await t.service.createExam(MANAGER, t.config() as never);
    t.clock.set(START);
    await refused(t.service.scheduleExam(late.id, MANAGER), 'EXAM_START_NOT_IN_FUTURE');
  });

  it('examiners must be Teachers registered in the SAME school (another school, even of the same organization, is not eligible); the whole request fails', async () => {
    const t = world();
    t.addTeacher(teacher(3, ['school-2']));
    await refused(t.service.createExam(MANAGER, t.config({ examinerTeacherIds: ['teacher-1', 'teacher-3', 'ghost'] }) as never), 'EXAM_EXAMINER_NOT_ELIGIBLE', { teacherIds: ['teacher-3', 'ghost'] });
    expect(t.repo.exams.size).toBe(0);
    const exam = await t.service.createExam(MANAGER, t.config() as never);
    await refused(t.service.assignExaminer(exam.id, MANAGER, 'teacher-3'), 'EXAM_EXAMINER_NOT_ELIGIBLE');
  });

  it('a School Manager who is also a Teacher registered in that school can be an examiner, exactly like any Teacher (the check is the Teacher registration only)', async () => {
    const t = world();
    t.addTeacher({ id: 'teacher-m', userId: MANAGER, schoolIds: ['school-1'] });
    const exam = await t.service.createExam(MANAGER, t.config({ examinerTeacherIds: ['teacher-m'] }) as never);
    expect(exam.examiners.map((e) => e.teacherId)).toEqual(['teacher-m']);
  });

  it('target groups must be ACTIVE groups of the exam\'s school (all of them, or none); a whole-school exam has no groups', async () => {
    const t = world();
    t.addGroup('group-x', ['s9'], { schoolId: 'school-2' });
    t.addGroup('group-old', [], { status: 'ARCHIVED' });
    await refused(t.service.createExam(MANAGER, t.config({ groupIds: ['group-1', 'group-x', 'group-old', 'nope'] }) as never), 'EXAM_INVALID_TARGET', { groupIds: ['group-x', 'group-old', 'nope'] });
    await refused(t.service.createExam(MANAGER, t.config({ groupIds: [] }) as never), 'EXAM_TARGET_REQUIRED');
    expect((await t.service.createExam(MANAGER, t.config({ groupIds: [], wholeSchool: true }) as never)).wholeSchool).toBe(true);
  });

  it('cancellation and deletion are separate operations, both only before STARTED; a deleted exam disappears from every read', async () => {
    const t = world();
    const a = await t.scheduled();
    expect((await t.service.cancelExam(a, MANAGER)).status).toBe('CANCELLED');
    expect(t.types()).toContain('ExamCancelled');
    const b = await t.scheduled();
    await t.service.deleteExam(b, MANAGER);
    await refused(t.service.getExam(b), 'EXAM_NOT_FOUND');
    await refused(t.service.deleteExam(b, MANAGER), 'EXAM_NOT_FOUND');
    expect(t.types()).toContain('ExamDeleted');
    expect(t.repo.exams.get(b)!.deletedAt).not.toBeNull(); // the record is kept
    expect((await t.service.listSchoolExams('school-1', { page: { page: 1, pageSize: 10 } })).items.map((e) => e.id)).toEqual([a]);
    const c = await t.started();
    await refused(t.service.cancelExam(c, MANAGER), 'EXAM_INVALID_TRANSITION'); // "regardless of special permissions": there is no permission that allows it
    await refused(t.service.deleteExam(c, MANAGER), 'EXAM_INVALID_TRANSITION');
  });
});

describe('STARTED: automatic at the start time, and the target list is FROZEN (approved decisions A and C)', () => {
  it('does not start before the start time, starts exactly at it, and publishes ExamStarted with the number of students', async () => {
    const t = world();
    const id = await t.scheduled();
    t.clock.set(new Date(START.getTime() - 1));
    expect(await t.service.runCycle()).toEqual({ started: 0, completed: 0, failed: 0 });
    t.clock.set(START);
    t.events.length = 0;
    expect(await t.service.runCycle()).toEqual({ started: 1, completed: 0, failed: 0 });
    expect((await t.service.getExam(id)).status).toBe('STARTED');
    expect(t.events.map((e) => [e.eventType, (e.payload as { frozenStudentCount?: number }).frozenStudentCount])).toEqual([['ExamStarted', 3]]);
  });

  it('before STARTED the target list follows the CURRENT membership (add, remove, move) and is rebuilt when the targeted groups change; nothing to synchronize can drift', async () => {
    const t = world();
    const id = await t.scheduled();
    const pending = async () => (await t.service.listPendingGroups(id)).map((g) => [g.groupId, g.total]);
    expect(await pending()).toEqual([['group-1', 3]]);
    t.state.groups.get('group-1')!.students.push({ studentId: 's6', fullName: 'Student s6' }); // a student joins a targeted group
    expect(await pending()).toEqual([['group-1', 4]]);
    t.state.groups.get('group-1')!.students.shift(); // a student leaves
    expect(await pending()).toEqual([['group-1', 3]]);
    const moved = t.state.groups.get('group-1')!.students.shift()!; // a student moves to a group that is not targeted: leaves the list
    t.state.groups.get('group-2')!.students.push(moved);
    expect(await pending()).toEqual([['group-1', 2]]);
    await t.service.updateExam(id, MANAGER, { groupIds: ['group-2'] }); // changing the targeted groups rebuilds the list from the new groups' current members
    expect(await pending()).toEqual([['group-2', 3]]);
    expect((await t.service.listPendingStudents(id, 'group-2', { page: 1, pageSize: 10 })).items.map((s) => s.studentId)).toEqual(['s4', 's5', moved.studentId]);
  });

  it('a whole-school exam targets every student who belongs to a ACTIVE group of the school, and follows new groups until STARTED', async () => {
    const t = world();
    t.addGroup('group-old', ['s7'], { status: 'ARCHIVED' });
    const id = await t.scheduled({ wholeSchool: true, groupIds: [] });
    expect((await t.service.listPendingGroups(id)).map((g) => g.groupId).sort()).toEqual(['group-1', 'group-2']);
    t.addGroup('group-3', ['s8']);
    expect((await t.service.listPendingGroups(id)).map((g) => g.groupId).sort()).toEqual(['group-1', 'group-2', 'group-3']);
    afterStart(t);
    await t.service.advanceExam(id);
    expect(await t.repo.countStudents(id)).toBe(6);
  });

  it('after STARTED the list is FROZEN: students who leave stay, students who join are not added, and group changes never touch it', async () => {
    const t = world();
    const id = await t.started();
    t.state.groups.get('group-1')!.students.push({ studentId: 's-new', fullName: 'New' });
    t.state.groups.get('group-1')!.students.shift(); // s1 leaves the group
    t.state.groups.get('group-2')!.students.push({ studentId: 's-moved', fullName: 'Moved' });
    const groups = await t.service.listPendingGroups(id);
    expect(groups).toEqual([{ groupId: 'group-1', groupName: 'Group group-1', total: 3, pending: 3 }]);
    expect((await t.service.listPendingStudents(id, 'group-1', { page: 1, pageSize: 10 })).items.map((s) => s.studentId).sort()).toEqual(['s1', 's2', 's3']);
    await submit(t, id, 's1'); // s1 left the group but remains in the exam
    await refused(submit(t, id, 's-new'), 'EXAM_STUDENT_NOT_TARGET'); // the student who joined is not in the exam
  });

  it('the start is driven by the stored time: a lazily advanced exam (a submission right at the start) starts without waiting for a scheduler tick', async () => {
    const t = world();
    const id = await t.scheduled();
    afterStart(t, 0);
    expect((await submit(t, id, 's1')).studentId).toBe('s1');
    expect((await t.service.getExam(id)).status).toBe('STARTED');
  });
});

describe('editing (approved decision B)', () => {
  it('before STARTED everything can be edited, including the start and end times, the questions, the groups and the examiners', async () => {
    const t = world();
    const id = await t.scheduled();
    const edited = await t.service.updateExam(id, MANAGER, { startAt: at('2026-12-02T09:00:00Z'), endAt: null, questionCount: 8, maxScore: 5.555, groupIds: ['group-2'] });
    expect([edited.questionCount, edited.maxScore, edited.maxTotal, edited.groupIds, edited.endAt]).toEqual([8, 5.56, 44.48, ['group-2'], null]);
    expect(t.types()).toContain('ExamUpdated');
    await t.service.assignExaminer(id, MANAGER, 'teacher-2');
    await t.service.removeExaminer(id, MANAGER, 'teacher-1');
    expect((await t.service.getExam(id)).examiners.map((e) => e.teacherId)).toEqual(['teacher-2']);
  });

  it('after STARTED the configuration is locked (start, questions, maximum score, targets), but the examiners and the end time stay editable', async () => {
    const t = world();
    const id = await t.started();
    for (const patch of [{ startAt: at('2026-12-02T09:00:00Z') }, { questionCount: 9 }, { maxScore: 3 }, { groupIds: ['group-2'] }, { wholeSchool: true }]) await refused(t.service.updateExam(id, MANAGER, patch), 'EXAM_CONFIG_LOCKED');
    await t.service.assignExaminer(id, MANAGER, 'teacher-2');
    await t.service.removeExaminer(id, MANAGER, 'teacher-1');
    expect((await t.service.getExam(id)).examiners.map((e) => e.teacherId)).toEqual(['teacher-2']);
  });

  it('the end time can be extended or reduced while STARTED, only to a time strictly in the future; the updated end time decides the automatic completion', async () => {
    const t = world();
    const id = await t.started();
    t.clock.set(at('2026-12-01T10:00:00.000Z'));
    await refused(t.service.changeEndTime(id, MANAGER, at('2026-12-01T10:00:00.000Z')), 'EXAM_END_NOT_IN_FUTURE');
    await refused(t.service.changeEndTime(id, MANAGER, at('2026-12-01T09:30:00.000Z')), 'EXAM_END_NOT_IN_FUTURE');
    await t.service.changeEndTime(id, MANAGER, at('2026-12-01T10:30:00.000Z')); // reduce
    t.clock.set(at('2026-12-01T10:30:00.001Z'));
    expect((await t.service.runCycle()).completed).toBe(1);
    expect((await t.service.getExam(id)).status).toBe('COMPLETED');
    await refused(t.service.changeEndTime(id, MANAGER, at('2026-12-01T18:00:00.000Z')), 'EXAM_LOCKED'); // no extension once COMPLETED
  });

  it('extending the end time while STARTED gives the students more time: the exam does not complete at the old end time', async () => {
    const t = world();
    const id = await t.started();
    t.clock.set(at('2026-12-01T10:59:59.000Z'));
    await t.service.changeEndTime(id, MANAGER, at('2026-12-01T13:00:00.000Z'));
    t.clock.set(at('2026-12-01T11:30:00.000Z'));
    expect((await t.service.runCycle()).completed).toBe(0);
    expect((await submit(t, id, 's1')).studentId).toBe('s1'); // still accepting results after the old end
  });

  it('the end time is only editable while STARTED', async () => {
    const t = world();
    const id = await t.scheduled();
    await refused(t.service.changeEndTime(id, MANAGER, at('2027-01-01T00:00:00Z')), 'EXAM_END_TIME_NOT_EDITABLE');
  });
});

describe('COMPLETED, ABSENT and ENDED (approved decisions H and I)', () => {
  it('completes automatically at the end time: every target without a result becomes ABSENT, with NO fabricated score or result; the examined stay as they are', async () => {
    const t = world();
    const id = await t.started();
    await submit(t, id, 's1', [10, 10, 10]);
    t.clock.set(new Date(END.getTime() + 1));
    t.events.length = 0;
    expect(await t.service.runCycle()).toEqual({ started: 0, completed: 1, failed: 0 });
    const results = await t.service.getResults(id);
    expect(results.status).toBe('COMPLETED');
    expect(results.results.map((r) => r.studentId)).toEqual(['s1']); // exactly one result: no zero-score result for the absent
    expect(results.absent.map((a) => a.studentId)).toEqual(['s2', 's3']);
    expect(t.repo.results.size).toBe(1);
    const completed = t.events.find((e) => e.eventType === 'ExamCompleted')!;
    expect((completed.payload as { absentStudentIds: string[] }).absentStudentIds).toEqual(['s2', 's3']);
    expect(await t.service.listPendingGroups(id)).toEqual([{ groupId: 'group-1', groupName: 'Group group-1', total: 3, pending: 0 }]);
  });

  it('after COMPLETED no new score can be submitted, the end cannot be extended and the exam is not reopened', async () => {
    const t = world();
    const id = await t.started();
    t.clock.set(new Date(END.getTime() + 1));
    await t.service.runCycle();
    await refused(submit(t, id, 's1'), 'EXAM_SUBMISSION_CLOSED');
    await refused(t.service.changeEndTime(id, MANAGER, at('2030-01-01T00:00:00Z')), 'EXAM_LOCKED');
    await refused(t.service.scheduleExam(id, MANAGER), 'EXAM_INVALID_TRANSITION');
    expect((await t.service.getExam(id)).status).toBe('COMPLETED');
  });

  it('manual completion exists ONLY for an exam without an end time; with an end time the system completes it', async () => {
    const t = world();
    const open = await t.scheduled({ endAt: null });
    const withEnd = await t.scheduled();
    afterStart(t);
    await t.service.runCycle();
    await refused(t.service.completeExam(withEnd, MANAGER), 'EXAM_END_TIME_DEFINED');
    await submit(t, open, 's1');
    t.clock.set(at('2027-06-01T00:00:00Z')); // an exam without an end time never completes by itself (the one with an end time does)
    await t.service.runCycle();
    expect((await t.service.getExam(open)).status).toBe('STARTED');
    expect((await t.service.getExam(withEnd)).status).toBe('COMPLETED');
    expect((await t.service.completeExam(open, MANAGER)).status).toBe('COMPLETED');
    expect((await t.service.getResults(open)).absent.map((a) => a.studentId)).toEqual(['s2', 's3']);
    await refused(t.service.completeExam(open, MANAGER), 'EXAM_INVALID_TRANSITION');
    const notStarted = await t.scheduled({ startAt: at('2028-01-01T00:00:00Z'), endAt: null });
    await refused(t.service.completeExam(notStarted, MANAGER), 'EXAM_INVALID_TRANSITION');
  });

  it('ENDED is manual, only after COMPLETED, final: it removes every examiner\'s exam-scoped permission, locks everything and keeps every record', async () => {
    const t = world();
    const id = await t.started();
    await submit(t, id, 's1');
    await refused(t.service.endExam(id, MANAGER), 'EXAM_INVALID_TRANSITION'); // not COMPLETED yet
    t.clock.set(new Date(END.getTime() + 1));
    await t.service.runCycle();
    expect((await t.service.getExam(id)).status).toBe('COMPLETED'); // it never ends by itself, however long we wait
    t.clock.set(at('2030-01-01T00:00:00Z'));
    await t.service.runCycle();
    expect((await t.service.getExam(id)).status).toBe('COMPLETED');
    expect(await t.service.findScopeById(id)).toMatchObject({ status: 'COMPLETED', examinerTeacherIds: ['teacher-1'] }); // examiners keep the permission until ENDED
    t.events.length = 0;
    expect((await t.service.endExam(id, MANAGER)).status).toBe('ENDED');
    expect(t.types()).toEqual(['ExamEnded']);
    expect(await t.service.findScopeById(id)).toMatchObject({ status: 'ENDED', examinerTeacherIds: [] });
    expect((await t.service.listAssignedExams('user-teacher-1', { page: 1, pageSize: 10 })).items).toEqual([]);
    await refused(t.service.endExam(id, MANAGER), 'EXAM_INVALID_TRANSITION'); // one way: no second ENDED, no going back
    for (const attempt of [t.service.assignExaminer(id, MANAGER, 'teacher-2'), t.service.removeExaminer(id, MANAGER, 'teacher-1')]) await refused(attempt, 'EXAM_LOCKED');
    await refused(t.service.updateExam(id, MANAGER, { questionCount: 4 }), 'EXAM_LOCKED');
    await refused(t.service.changeEndTime(id, MANAGER, at('2031-01-01T00:00:00Z')), 'EXAM_LOCKED');
    await refused(t.service.cancelExam(id, MANAGER), 'EXAM_INVALID_TRANSITION');
    await refused(t.service.deleteExam(id, MANAGER), 'EXAM_INVALID_TRANSITION');
    await refused(submit(t, id, 's2'), 'EXAM_NOT_EXAMINER');
    expect((await t.service.getResults(id)).results).toHaveLength(1); // everything is preserved
    expect(t.repo.exams.get(id)!.examiners).toHaveLength(1);
  });
});

describe('recording results (approved decisions D, E, F, G, J)', () => {
  it('an assigned examiner records ALL the question scores of one student; the total is the exact sum; the student leaves the pending list; the result event carries the scores', async () => {
    const t = world();
    const id = await t.started({ questionCount: 5 });
    t.events.length = 0;
    const receipt = await submit(t, id, 's1', [8, 9.5, 7, 10, 6.25]);
    expect(receipt).toEqual({ examId: id, studentId: 's1', groupId: 'group-1' });
    const [result] = (await t.service.getResults(id)).results;
    expect([result!.scores, result!.total, result!.maxTotal]).toEqual([[8, 9.5, 7, 10, 6.25], 40.75, 50]);
    expect((await t.service.listPendingStudents(id, 'group-1', { page: 1, pageSize: 10 })).items.map((s) => s.studentId)).toEqual(['s2', 's3']);
    expect(t.events.map((e) => e.eventType)).toEqual(['ExamResultRecorded']);
    expect(t.events[0]!.payload).toMatchObject({ studentId: 's1', scores: [8, 9.5, 7, 10, 6.25], total: 40.75, maxTotal: 50 });
  });

  it('each score is 0 <= score <= maximum and is rounded to two decimals; one numeric score per question is required', async () => {
    const t = world();
    const id = await t.started({ maxScore: 10 });
    expect((await submit(t, id, 's1', [0, 10, 7.555])).studentId).toBe('s1');
    expect((await t.service.getResults(id)).results[0]!.scores).toEqual([0, 10, 7.56]);
    for (const bad of [[-0.01, 1, 1], [1, 10.01, 1], [1, 2], [1, 2, 3, 4], 'x', [1, '2', 3], [1, NaN, 3], [1, null, 3], []]) {
      await expect(submit(t, id, 's2', bad)).rejects.toMatchObject({ code: expect.stringMatching(/EXAM_INVALID_SCORES|EXAM_SCORE_OUT_OF_RANGE/) });
    }
    await refused(submit(t, id, 's2', [1, 11, 1]), 'EXAM_SCORE_OUT_OF_RANGE', { question: 2, maxScore: 10 });
  });

  it('is ATOMIC: a rejected submission stores nothing and the student stays pending', async () => {
    const t = world();
    const id = await t.started();
    await refused(submit(t, id, 's1', [1, 2, 99]), 'EXAM_SCORE_OUT_OF_RANGE');
    expect(t.repo.results.size).toBe(0);
    expect((await t.service.listPendingGroups(id))[0]!.pending).toBe(3);
    t.state.guardRejects = Object.assign(new Error('x'), { code: 'SMART_GUARD_OUTSIDE_SCHOOL_GEOFENCE' });
    await refused(submit(t, id, 's1'), 'SMART_GUARD_OUTSIDE_SCHOOL_GEOFENCE');
    expect(t.repo.results.size).toBe(0);
    expect((await t.service.listPendingGroups(id))[0]!.pending).toBe(3);
  });

  it('a student has ONE result per exam: a second submission is refused and the first result stays exactly as it was', async () => {
    const t = world();
    const id = await t.started();
    await submit(t, id, 's1', [1, 2, 3]);
    await refused(submit(t, id, 's1', [9, 9, 9]), 'EXAM_RESULT_ALREADY_RECORDED');
    await refused(submit(t, id, 's1', [1, 2, 3], { userId: 'user-teacher-2' }), 'EXAM_NOT_EXAMINER');
    expect((await t.service.getResults(id)).results.map((r) => r.scores)).toEqual([[1, 2, 3]]);
  });

  it('ANY assigned examiner can examine ANY pending student of ANY targeted group; the second examiner sees the student already gone', async () => {
    const t = world();
    const id = await t.started({ groupIds: ['group-1', 'group-2'], examinerTeacherIds: ['teacher-1', 'teacher-2'] });
    await submit(t, id, 's1', [1, 1, 1], { userId: 'user-teacher-1' });
    await submit(t, id, 's4', [2, 2, 2], { userId: 'user-teacher-2' }); // another group, another examiner
    await refused(submit(t, id, 's1', [3, 3, 3], { userId: 'user-teacher-2' }), 'EXAM_RESULT_ALREADY_RECORDED');
    expect((await t.service.listPendingGroups(id)).map((g) => [g.groupId, g.total, g.pending])).toEqual([['group-1', 3, 2], ['group-2', 2, 1]]);
  });

  it('only a CURRENTLY assigned examiner records: a Teacher who is not assigned, or was removed, cannot, and results already recorded by a removed examiner stay', async () => {
    const t = world();
    const id = await t.started({ examinerTeacherIds: ['teacher-1', 'teacher-2'] });
    await submit(t, id, 's1', [5, 5, 5], { userId: 'user-teacher-2' });
    await t.service.removeExaminer(id, MANAGER, 'teacher-2');
    await refused(submit(t, id, 's2', [1, 1, 1], { userId: 'user-teacher-2' }), 'EXAM_NOT_EXAMINER');
    await refused(submit(t, id, 's2', [1, 1, 1], { userId: 'someone-else' }), 'EXAM_NOT_EXAMINER');
    expect((await t.service.getResults(id)).results.map((r) => r.studentId)).toEqual(['s1']); // removal does not affect recorded results
    expect([...t.repo.results.values()][0]!.examinerTeacherId).toBe('teacher-2');
  });

  it('only while STARTED: not before the start, not after the end (even before the job completes the exam), not once COMPLETED', async () => {
    const t = world();
    const id = await t.scheduled();
    t.clock.set(new Date(START.getTime() - 60_000));
    await refused(submit(t, id, 's1'), 'EXAM_NOT_STARTED');
    afterStart(t);
    await submit(t, id, 's1');
    t.clock.set(END); // the end instant itself is still inside (like Smart Guard's window)
    await submit(t, id, 's2');
    t.clock.set(new Date(END.getTime() + 1)); // after the end, before the job ran
    await refused(submit(t, id, 's3'), 'EXAM_SUBMISSION_CLOSED');
  });

  it('goes through Smart Guard with the examiner, the exam\'s school, the GPS and the window: 15 minutes before the start through the effective end (open-ended when there is no end time)', async () => {
    const t = world();
    const id = await t.scheduled();
    const open = await t.scheduled({ endAt: null });
    afterStart(t);
    await submit(t, id, 's1');
    expect(t.state.smartGuardCalls).toEqual([{ teacherId: 'teacher-1', schoolId: 'school-1', gps: GPS, window: { opensAt: new Date(START.getTime() - 15 * 60_000), closesAt: END } }]);
    t.state.smartGuardCalls.length = 0;
    await submit(t, open, 's1');
    expect(t.state.smartGuardCalls[0]!.window.closesAt).toBeNull();
  });

  it('a non-target student is refused', async () => {
    const t = world();
    const id = await t.started();
    await refused(submit(t, id, 's4'), 'EXAM_STUDENT_NOT_TARGET');
    await refused(submit(t, id, ''), 'EXAM_INVALID_SCORES');
  });
});

describe('reads (approved read permissions)', () => {
  it('the examiner sees their exams (SCHEDULED to COMPLETED) and ONLY pending students, grouped; never a result', async () => {
    const t = world();
    const id = await t.started({ groupIds: ['group-1', 'group-2'] });
    await submit(t, id, 's1', [10, 10, 10]);
    const assigned = await t.service.listAssignedExams('user-teacher-1', { page: 1, pageSize: 10 });
    expect(assigned.items.map((e) => e.id)).toEqual([id]);
    expect(JSON.stringify(assigned)).not.toMatch(/"(scores|results|recordedAt)"/);
    const pending = await t.service.listPendingStudents(id, 'group-1', { page: 1, pageSize: 10 });
    expect(pending.items).toEqual([
      { studentId: 's2', fullName: 'Student s2', groupId: 'group-1', groupName: 'Group group-1', examinationStatus: 'PENDING' },
      { studentId: 's3', fullName: 'Student s3', groupId: 'group-1', groupName: 'Group group-1', examinationStatus: 'PENDING' },
    ]);
    expect(await t.service.listAssignedExams('user-teacher-2', { page: 1, pageSize: 10 })).toMatchObject({ items: [] });
    const draft = await t.service.createExam(MANAGER, t.config() as never);
    expect((await t.service.listAssignedExams('user-teacher-1', { page: 1, pageSize: 10 })).items.map((e) => e.id)).not.toContain(draft.id); // a DRAFT is the Manager's working copy
  });

  it('the exam-scoped examiner permission resolves only for a currently assigned examiner of a SCHEDULED/STARTED/COMPLETED exam', async () => {
    const t = world();
    const id = await t.scheduled();
    expect((await t.service.findScopeById(id))!.examinerTeacherIds).toEqual(['teacher-1']);
    await t.service.removeExaminer(id, MANAGER, 'teacher-1');
    expect((await t.service.findScopeById(id))!.examinerTeacherIds).toEqual([]);
    expect(await t.service.findScopeById('nope')).toBeUndefined();
  });

  it('a Parent sees the schedule of their children\'s schools (never a DRAFT or a deleted exam) and only recorded results or ABSENT of the students they ask for', async () => {
    const t = world();
    t.state.parentSchools.set('user-parent', ['school-1']);
    await t.service.createExam(MANAGER, t.config() as never); // a DRAFT
    const gone = await t.scheduled();
    await t.service.deleteExam(gone, MANAGER);
    const id = await t.started();
    expect((await t.service.listParentSchedule('user-parent', { page: 1, pageSize: 10 })).items.map((e) => e.id)).toEqual([id]);
    expect(await t.service.listParentSchedule('user-other', { page: 1, pageSize: 10 })).toMatchObject({ items: [], total: 0 });
    await submit(t, id, 's1', [8, 9, 10]);
    t.clock.set(new Date(END.getTime() + 1));
    await t.service.runCycle();
    const examined = (await t.service.listStudentOutcomes('s1', { page: 1, pageSize: 10 })).items[0]!;
    expect([examined.outcome, examined.result]).toEqual(['EXAMINED', expect.objectContaining({ scores: [8, 9, 10], total: 27, maxTotal: 30 })]);
    const absent = (await t.service.listStudentOutcomes('s2', { page: 1, pageSize: 10 })).items[0]!;
    expect([absent.outcome, absent.result]).toEqual(['ABSENT', null]);
    expect((await t.service.listStudentOutcomes('s4', { page: 1, pageSize: 10 })).items).toEqual([]); // a student of another group/exam: nothing
  });

  it('the pending information of an exam in progress is never shown as an outcome (no result yet, not absent yet)', async () => {
    const t = world();
    await t.started();
    expect((await t.service.listStudentOutcomes('s1', { page: 1, pageSize: 10 })).items).toEqual([]);
  });

  it('the 24-hour reminder data: due 24 hours before the start, with the current examiners; it creates nothing', async () => {
    const t = world();
    const id = await t.scheduled();
    const reminder = await t.service.getExamReminderStatus(id);
    expect(reminder.reminderDueAt.toISOString()).toBe('2026-11-30T09:00:00.000Z');
    expect(reminder).toMatchObject({ status: 'SCHEDULED', examinerTeacherIds: ['teacher-1'], schoolId: 'school-1' });
  });
});

describe('restarts, delayed jobs and idempotence (approved decision, safeguards)', () => {
  it('after downtime ONE pass starts and completes an exam whose start AND end have both passed, in order, and the pass is idempotent', async () => {
    const t = world();
    const id = await t.scheduled();
    t.clock.set(at('2026-12-09T00:00:00Z')); // the server was down for a week
    expect(await t.service.runCycle()).toEqual({ started: 1, completed: 1, failed: 0 });
    expect(t.types().slice(-2)).toEqual(['ExamStarted', 'ExamCompleted']);
    expect((await t.service.getResults(id)).absent.map((a) => a.studentId)).toEqual(['s1', 's2', 's3']); // everyone absent: nobody could be examined
    t.events.length = 0;
    expect(await t.service.runCycle()).toEqual({ started: 0, completed: 0, failed: 0 });
    await t.service.advanceExam(id);
    expect(t.events).toEqual([]);
    expect((await t.service.getExam(id)).status).toBe('COMPLETED'); // never ENDED automatically
  });

  it('a deleted or cancelled exam is never started', async () => {
    const t = world();
    const a = await t.scheduled();
    const b = await t.scheduled();
    await t.service.cancelExam(a, MANAGER);
    await t.service.deleteExam(b, MANAGER);
    t.clock.set(at('2026-12-02T00:00:00Z'));
    expect(await t.service.runCycle()).toEqual({ started: 0, completed: 0, failed: 0 });
  });

  it('a failure in one exam does not stop the others', async () => {
    const t = world();
    const bad = await t.scheduled();
    const good = await t.scheduled();
    const original = t.repo.insertStudents.bind(t.repo);
    let first = true;
    t.repo.insertStudents = async (rows, tx) => { if (first) { first = false; throw new Error('boom'); } return original(rows, tx); };
    afterStart(t);
    const result = await t.service.runCycle();
    expect([result.started, result.failed]).toEqual([1, 1]);
    expect([bad, good]).toHaveLength(2);
  });
});

describe('notification integration events (nothing is notified inside the module)', () => {
  it('examiner changes, group membership changes before STARTED, and the result publish events', async () => {
    const t = world();
    const id = await t.scheduled();
    t.events.length = 0;
    await t.service.assignExaminer(id, MANAGER, 'teacher-2');
    await t.service.removeExaminer(id, MANAGER, 'teacher-2');
    expect(t.types()).toEqual(['ExamExaminerAssigned', 'ExamExaminerRemoved']);
    t.events.length = 0;
    expect(await t.service.onGroupMembershipChanged({ kind: 'ASSIGNED', schoolId: 'school-1', groupId: 'group-1', studentId: 's-new' })).toBe(1);
    expect(await t.service.onGroupMembershipChanged({ kind: 'UNASSIGNED', schoolId: 'school-1', groupId: 'group-1', studentId: 's1', reason: 'REMOVED' })).toBe(1);
    expect(await t.service.onGroupMembershipChanged({ kind: 'ASSIGNED', schoolId: 'school-1', groupId: 'group-2', studentId: 's9' })).toBe(0); // a group the exam does not target
    expect(await t.service.onGroupMembershipChanged({ kind: 'ASSIGNED', schoolId: 'school-2', groupId: 'group-1', studentId: 's9' })).toBe(0); // another school
    expect(t.events.map((e) => [e.eventType, (e.payload as { studentId: string }).studentId])).toEqual([['ExamStudentTargeted', 's-new'], ['ExamStudentUntargeted', 's1']]);
  });

  it('after STARTED group membership events change nothing and publish nothing', async () => {
    const t = world();
    await t.started();
    t.events.length = 0;
    expect(await t.service.onGroupMembershipChanged({ kind: 'ASSIGNED', schoolId: 'school-1', groupId: 'group-1', studentId: 's-new' })).toBe(0);
    expect(t.events).toEqual([]);
  });

  it('a move inside a whole-school exam is not a change of target', async () => {
    const t = world();
    await t.scheduled({ wholeSchool: true, groupIds: [] });
    t.events.length = 0;
    expect(await t.service.onGroupMembershipChanged({ kind: 'UNASSIGNED', schoolId: 'school-1', groupId: 'group-1', studentId: 's1', reason: 'MOVED' })).toBe(0);
    expect(await t.service.onGroupMembershipChanged({ kind: 'UNASSIGNED', schoolId: 'school-1', groupId: 'group-1', studentId: 's1', reason: 'REMOVED' })).toBe(1);
  });
});
