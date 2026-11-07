import { describe, expect, it } from 'vitest';
import { GPS, OTHER_USER, MANAGER, STUDENTS, TEACHER, END, at, createEvaluationFakes, fakeSession } from '../../helpers/evaluation-fakes';

type Fakes = ReturnType<typeof createEvaluationFakes>;
const refused = async (promise: Promise<unknown>, code: string, details?: unknown) =>
  expect(promise).rejects.toMatchObject({ code, ...(details === undefined ? {} : { details }) });

const MEM3 = [{ category: 'MEMORIZATION', score: 8.5 }, { category: 'PERFORMANCE', score: 9 }, { category: 'TAJWEED', score: 7.75 }];
const ALL4 = [{ category: 'MEMORIZATION', score: 8 }, { category: 'REVISION', score: 9 }, { category: 'PERFORMANCE', score: 7 }, { category: 'TAJWEED', score: 6 }];
const send = (t: Fakes, records: unknown, over: { userId?: string; gps?: unknown; sessionId?: string } = {}) =>
  t.service.recordEvaluations(over.sessionId ?? 'session-1', over.userId ?? TEACHER.userId, { gps: over.gps ?? GPS, records });
const memFor = (...ids: string[]) => ids.map((studentId) => ({ studentId, scores: MEM3 }));

describe('only the assigned Teacher records, in one atomic batch, through Smart Guard (approved decision 1)', () => {
  it('creates an evaluation per student (RECORDED) and publishes EvaluationRecorded with the scores and the note', async () => {
    const t = createEvaluationFakes();
    const result = await send(t, [{ studentId: 'student-1', scores: MEM3, note: 'أداء ممتاز' }]);
    expect(result.results.map((r) => [r.studentId, r.outcome])).toEqual([['student-1', 'RECORDED']]);
    expect(result.results[0]!.evaluation).toMatchObject({ sessionId: 'session-1', schoolId: 'school-1', groupId: 'group-1', studentId: 'student-1', occurrenceDate: '2026-11-02', note: 'أداء ممتاز' });
    expect(t.types()).toEqual(['EvaluationRecorded']);
    expect(t.events[0]!.payload).toMatchObject({ studentId: 'student-1', note: 'أداء ممتاز', actorUserId: TEACHER.userId, scores: [{ category: 'MEMORIZATION', score: 8.5 }, { category: 'PERFORMANCE', score: 9 }, { category: 'TAJWEED', score: 7.75 }] });
  });

  it('calls Smart Guard ONCE for the whole batch, with the Teacher record, the GPS reading and the 15-minute grace exception (and nobody else asks for it)', async () => {
    const t = createEvaluationFakes();
    await send(t, memFor(...STUDENTS));
    expect(t.state.guardCalls).toEqual([{ teacherId: TEACHER.teacherId, sessionId: 'session-1', gps: GPS, allowAfterEndMinutes: 15 }]);
  });

  it('when Smart Guard refuses, nothing is written, nothing is published and the session is not even locked', async () => {
    const t = createEvaluationFakes();
    t.state.guardRejects = Object.assign(new Error('x'), { code: 'SMART_GUARD_OUTSIDE_SCHOOL_GEOFENCE' });
    await refused(send(t, memFor('student-1')), 'SMART_GUARD_OUTSIDE_SCHOOL_GEOFENCE');
    expect(t.repo.rows.size).toBe(0);
    expect(t.events).toHaveLength(0);
    expect(t.state.lockedSessions).toEqual([]);
  });

  it('a user who is not the Teacher (the School Manager, or anyone else) is refused like any non-owner, without reaching Smart Guard', async () => {
    const t = createEvaluationFakes();
    await refused(send(t, memFor('student-1'), { userId: OTHER_USER }), 'SMART_GUARD_NOT_SESSION_TEACHER');
    await refused(send(t, memFor('student-1'), { userId: MANAGER }), 'SMART_GUARD_NOT_SESSION_TEACHER');
    expect(t.state.guardCalls).toHaveLength(0);
    expect(t.repo.rows.size).toBe(0);
  });

  it('only students CURRENTLY in the session\'s group (the eligible roster): any other student rejects the WHOLE batch', async () => {
    const t = createEvaluationFakes();
    t.assigned.set('student-3', []);
    t.assigned.set('student-9', ['group-2']);
    await refused(send(t, memFor('student-1', 'student-3', 'student-9')), 'EVALUATION_STUDENT_NOT_IN_GROUP', { studentIds: ['student-3', 'student-9'] });
    expect(t.repo.rows.size).toBe(0);
    expect(t.events).toHaveLength(0);
  });

  it('rejects malformed requests before Smart Guard is called', async () => {
    const t = createEvaluationFakes();
    await refused(send(t, []), 'EVALUATION_RECORDS_REQUIRED');
    await refused(send(t, 'x'), 'EVALUATION_RECORDS_REQUIRED');
    await refused(send(t, Array.from({ length: 201 }, (_, i) => ({ studentId: `s-${i}`, scores: MEM3 }))), 'EVALUATION_TOO_MANY_RECORDS');
    await refused(send(t, [{ studentId: 'student-1' }]), 'EVALUATION_INVALID_RECORD');
    await refused(send(t, [{ studentId: 'student-1', scores: [] }]), 'EVALUATION_INVALID_RECORD');
    await refused(send(t, [{ scores: MEM3 }]), 'EVALUATION_INVALID_RECORD');
    await refused(send(t, [...memFor('student-1'), ...memFor('student-1')]), 'EVALUATION_DUPLICATE_STUDENT');
    await refused(send(t, [{ studentId: 'student-1', scores: [{ category: 'SPEED', score: 5 }] }]), 'EVALUATION_INVALID_CATEGORY');
    await refused(send(t, [{ studentId: 'student-1', scores: [{ category: 'TAJWEED', score: 5 }, { category: 'TAJWEED', score: 6 }] }]), 'EVALUATION_DUPLICATE_CATEGORY');
    expect(t.state.guardCalls).toHaveLength(0);
  });

  it('is atomic: one invalid student rejects ALL of the request, including the valid ones', async () => {
    const t = createEvaluationFakes();
    t.state.memorization = [{ id: 'mem-1', studentId: 'student-1' }]; // only student-1 has an assignment
    await refused(send(t, memFor('student-1', 'student-2')), 'EVALUATION_NO_APPLICABLE_ASSIGNMENT', { studentIds: ['student-2'] });
    expect(t.repo.rows.size).toBe(0);
    expect(t.events).toHaveLength(0);
  });
});

describe('an evaluation is based on ASSIGNMENTS (approved decision 3)', () => {
  it('Memorization only: MEMORIZATION, PERFORMANCE, TAJWEED, associated with the memorization assignment (the existence of the assignment is enough: no record is needed)', async () => {
    const t = createEvaluationFakes();
    const { results } = await send(t, memFor('student-1'));
    expect(results[0]!.evaluation.scores).toEqual([
      { category: 'MEMORIZATION', score: 8.5, memorizationAssignmentId: 'mem-group', revisionAssignmentId: null },
      { category: 'PERFORMANCE', score: 9, memorizationAssignmentId: 'mem-group', revisionAssignmentId: null },
      { category: 'TAJWEED', score: 7.75, memorizationAssignmentId: 'mem-group', revisionAssignmentId: null },
    ]);
  });

  it('Revision only: REVISION, PERFORMANCE, TAJWEED', async () => {
    const t = createEvaluationFakes();
    t.state.memorization = [];
    t.state.revision = [{ id: 'rev-group', studentId: null }];
    await send(t, [{ studentId: 'student-1', scores: [{ category: 'REVISION', score: 5 }, { category: 'PERFORMANCE', score: 6 }, { category: 'TAJWEED', score: 7 }] }]);
    expect(t.repo.rows.size).toBe(1);
    await refused(send(t, [{ studentId: 'student-2', scores: MEM3 }]), 'EVALUATION_CATEGORIES_MISMATCH');
  });

  it('Both: four categories, Performance and Tajweed once each, associated with the applicable context; each score independent', async () => {
    const t = createEvaluationFakes();
    t.state.revision = [{ id: 'rev-group', studentId: null }];
    const { results } = await send(t, [{ studentId: 'student-1', scores: ALL4 }]);
    const by = Object.fromEntries(results[0]!.evaluation.scores.map((s) => [s.category, s]));
    expect(Object.keys(by)).toEqual(['MEMORIZATION', 'REVISION', 'PERFORMANCE', 'TAJWEED']);
    expect(by.MEMORIZATION).toMatchObject({ score: 8, memorizationAssignmentId: 'mem-group', revisionAssignmentId: null });
    expect(by.REVISION).toMatchObject({ score: 9, memorizationAssignmentId: null, revisionAssignmentId: 'rev-group' });
    expect(by.PERFORMANCE).toMatchObject({ score: 7, memorizationAssignmentId: 'mem-group', revisionAssignmentId: 'rev-group' });
    expect(by.TAJWEED).toMatchObject({ score: 6, memorizationAssignmentId: 'mem-group', revisionAssignmentId: 'rev-group' });
  });

  it('Neither assignment: nothing to evaluate', async () => {
    const t = createEvaluationFakes();
    t.state.memorization = [];
    await refused(send(t, memFor('student-1')), 'EVALUATION_NO_APPLICABLE_ASSIGNMENT', { studentIds: ['student-1'] });
  });

  it('is per student: INDIVIDUAL assignments apply to their own student only, and a collective group still gets one evaluation per student (never a shared group score)', async () => {
    const t = createEvaluationFakes();
    t.state.memorization = [{ id: 'mem-s1', studentId: 'student-1' }, { id: 'mem-s2', studentId: 'student-2' }];
    const { results } = await send(t, memFor('student-1', 'student-2'));
    expect(results.map((r) => r.evaluation.scores[0]!.memorizationAssignmentId)).toEqual(['mem-s1', 'mem-s2']);
    expect(t.repo.rows.size).toBe(2);
    const group = createEvaluationFakes();
    await send(group, [{ studentId: 'student-1', scores: MEM3 }, { studentId: 'student-2', scores: [{ category: 'MEMORIZATION', score: 1 }, { category: 'PERFORMANCE', score: 2 }, { category: 'TAJWEED', score: 3 }] }]);
    expect([...group.repo.rows.values()].map((r) => r.scores[0]!.score)).toEqual([8.5, 1]);
  });

  it('creation needs EVERY available category, each once: a missing or an extra category is refused (with the available ones in the details)', async () => {
    const t = createEvaluationFakes();
    await refused(send(t, [{ studentId: 'student-1', scores: [{ category: 'MEMORIZATION', score: 8 }] }]), 'EVALUATION_CATEGORIES_MISMATCH', { studentId: 'student-1', availableCategories: ['MEMORIZATION', 'PERFORMANCE', 'TAJWEED'], submittedCategories: ['MEMORIZATION'] });
    await refused(send(t, [{ studentId: 'student-1', scores: [...MEM3, { category: 'REVISION', score: 8 }] }]), 'EVALUATION_CATEGORIES_MISMATCH');
    expect(t.repo.rows.size).toBe(0);
  });
});

describe('scores and the note (approved decision 5)', () => {
  it('a score is rounded to two decimals, not rejected', async () => {
    const t = createEvaluationFakes();
    const { results } = await send(t, [{ studentId: 'student-1', scores: [{ category: 'MEMORIZATION', score: 8.555 }, { category: 'PERFORMANCE', score: 9.999 }, { category: 'TAJWEED', score: 0.004 }] }]);
    expect(results[0]!.evaluation.scores.map((s) => s.score)).toEqual([8.56, 10, 0]);
  });

  it('a score outside 0..10, or not a number, rejects the request; 0 and 10 are valid', async () => {
    const t = createEvaluationFakes();
    for (const bad of [-0.01, 10.01, 10.004, '8', null, NaN]) await refused(send(t, [{ studentId: 'student-1', scores: [{ category: 'MEMORIZATION', score: bad }, { category: 'PERFORMANCE', score: 1 }, { category: 'TAJWEED', score: 1 }] }]), 'EVALUATION_INVALID_SCORE');
    const ok = await send(t, [{ studentId: 'student-1', scores: [{ category: 'MEMORIZATION', score: 0 }, { category: 'PERFORMANCE', score: 10 }, { category: 'TAJWEED', score: 5 }] }]);
    expect(ok.results[0]!.evaluation.scores.map((s) => s.score)).toEqual([0, 10, 5]);
  });

  it('ONE optional note per student evaluation, shared by all categories: at most 200 characters', async () => {
    const t = createEvaluationFakes();
    const withNote = await send(t, [{ studentId: 'student-1', scores: MEM3, note: 'ب'.repeat(200) }, { studentId: 'student-2', scores: MEM3 }, { studentId: 'student-3', scores: MEM3, note: '  ' }]);
    expect(withNote.results.map((r) => r.evaluation.note)).toEqual(['ب'.repeat(200), null, null]);
    const t2 = createEvaluationFakes();
    await refused(send(t2, [{ studentId: 'student-1', scores: MEM3, note: 'ب'.repeat(201) }]), 'EVALUATION_NOTE_TOO_LONG');
    await refused(send(t2, [{ studentId: 'student-1', scores: MEM3, note: 12 }]), 'EVALUATION_INVALID_NOTE');
    expect(t2.repo.rows.size).toBe(0);
  });

  it('there is no history and no previous value anywhere: a change overwrites, and the events and the DTO never carry one', async () => {
    const t = createEvaluationFakes();
    await send(t, [{ studentId: 'student-1', scores: MEM3 }]);
    t.events.length = 0;
    const changed = await send(t, [{ studentId: 'student-1', scores: [{ category: 'TAJWEED', score: 4 }] }]);
    expect(changed.results[0]!.outcome).toBe('UPDATED');
    expect(Object.keys(t.repo)).not.toContain('corrections');
    expect(JSON.stringify(t.events[0]!.payload)).not.toMatch(/previous|old|before|7\.75/i);
    expect(Object.keys(changed.results[0]!.evaluation)).not.toContain('updatedAt');
    expect(Object.keys(changed.results[0]!.evaluation)).not.toContain('updatedBy');
  });
});

describe('modifying scores while the session lasts, and the immutable note (approved decisions 5 and 6)', () => {
  const created = async (note?: string) => {
    const t = createEvaluationFakes();
    await send(t, [{ studentId: 'student-1', scores: MEM3, ...(note ? { note } : {}) }]);
    t.events.length = 0;
    return t;
  };

  it('the Teacher may modify previously recorded scores (any subset of the categories) while the session is in progress: UPDATED, with EvaluationScoresUpdated carrying ALL the current scores', async () => {
    const t = await created('ممتاز');
    const result = await send(t, [{ studentId: 'student-1', scores: [{ category: 'MEMORIZATION', score: 9.5 }] }]);
    expect(result.results[0]).toMatchObject({ outcome: 'UPDATED' });
    expect(result.results[0]!.evaluation.scores.map((s) => s.score)).toEqual([9.5, 9, 7.75]);
    expect(t.types()).toEqual(['EvaluationScoresUpdated']);
    expect(t.events[0]!.payload).toMatchObject({ studentId: 'student-1', scores: [{ category: 'MEMORIZATION', score: 9.5 }, { category: 'PERFORMANCE', score: 9 }, { category: 'TAJWEED', score: 7.75 }] });
    expect(t.events[0]!.payload).not.toHaveProperty('note'); // the note is immutable: no note-edit notification, and the update carries only grades
  });

  it('every subsequent modification is a new EvaluationScoresUpdated (so the Parent gets a new notification each time)', async () => {
    const t = await created();
    await send(t, [{ studentId: 'student-1', scores: [{ category: 'TAJWEED', score: 1 }] }]);
    await send(t, [{ studentId: 'student-1', scores: [{ category: 'TAJWEED', score: 2 }] }]);
    expect(t.types()).toEqual(['EvaluationScoresUpdated', 'EvaluationScoresUpdated']);
  });

  it('the same scores again change nothing and publish nothing (UNCHANGED); a rounded-equal score is also unchanged', async () => {
    const t = await created();
    const again = await send(t, [{ studentId: 'student-1', scores: MEM3 }]);
    expect(again.results[0]!.outcome).toBe('UNCHANGED');
    const rounded = await send(t, [{ studentId: 'student-1', scores: [{ category: 'MEMORIZATION', score: 8.5004 }] }]);
    expect(rounded.results[0]!.outcome).toBe('UNCHANGED');
    expect(t.events).toHaveLength(0);
  });

  it('the NOTE cannot be edited, replaced, added later or deleted: only the very same note (or none) is accepted again', async () => {
    const t = await created('ممتاز');
    await refused(send(t, [{ studentId: 'student-1', scores: [{ category: 'TAJWEED', score: 5 }], note: 'تعديل' }]), 'EVALUATION_NOTE_IMMUTABLE');
    const same = await send(t, [{ studentId: 'student-1', scores: [{ category: 'TAJWEED', score: 5 }], note: ' ممتاز ' }]);
    expect(same.results[0]!.evaluation.note).toBe('ممتاز');
    const noNote = await send(t, [{ studentId: 'student-1', scores: [{ category: 'TAJWEED', score: 6 }] }]);
    expect(noNote.results[0]!.evaluation.note).toBe('ممتاز'); // omitting the note never deletes it
    const t2 = await created(); // no note was saved at creation: it cannot be added afterwards
    await refused(send(t2, [{ studentId: 'student-1', scores: [{ category: 'TAJWEED', score: 5 }], note: 'متأخر' }]), 'EVALUATION_NOTE_IMMUTABLE');
    expect([...t2.repo.rows.values()][0]!.note).toBeNull();
  });

  it('a modification can only touch categories the evaluation already has', async () => {
    const t = await created();
    await refused(send(t, [{ studentId: 'student-1', scores: [{ category: 'REVISION', score: 5 }] }]), 'EVALUATION_CATEGORIES_MISMATCH');
  });

  it('modification works up to the very end instant of the session (inclusive), and 1 ms later it no longer does', async () => {
    const t = await created();
    t.clock.set(END);
    expect((await send(t, [{ studentId: 'student-1', scores: [{ category: 'TAJWEED', score: 3 }] }])).results[0]!.outcome).toBe('UPDATED');
    t.clock.set(new Date(END.getTime() + 1));
    await refused(send(t, [{ studentId: 'student-1', scores: [{ category: 'TAJWEED', score: 4 }] }]), 'EVALUATION_GRACE_CREATE_ONLY');
  });
});

describe('attendance consistency (approved decision 4)', () => {
  it('a student marked ABSENT cannot be evaluated: the whole request is rejected', async () => {
    const t = createEvaluationFakes();
    t.state.attendance.set('student-2', 'ABSENT');
    await refused(send(t, memFor('student-1', 'student-2')), 'EVALUATION_STUDENT_ABSENT', { studentIds: ['student-2'] });
    expect(t.repo.rows.size).toBe(0);
  });

  it('a PRESENT student and an UNMARKED student can be evaluated: unmarked is NEVER read as ABSENT', async () => {
    const t = createEvaluationFakes();
    t.state.attendance.set('student-1', 'PRESENT');
    const { results } = await send(t, memFor('student-1', 'student-2')); // student-2 has no attendance record
    expect(results.map((r) => r.outcome)).toEqual(['RECORDED', 'RECORDED']);
  });

  it('the attendance is read AFTER the session row lock (the order Module 26 uses), inside the transaction', async () => {
    const t = createEvaluationFakes();
    let lockedBeforeWrite = false;
    t.state.onLocked = () => { lockedBeforeWrite = t.repo.rows.size === 0 && t.events.length === 0; };
    await send(t, memFor('student-1'));
    expect(t.state.lockedSessions).toEqual(['session-1']);
    expect(lockedBeforeWrite).toBe(true);
  });

  it('Module 26 asks which students are evaluated (findEvaluatedStudents) to refuse marking them ABSENT', async () => {
    const t = createEvaluationFakes();
    await send(t, memFor('student-1'));
    expect(await t.service.findEvaluatedStudents('session-1', ['student-1', 'student-2'], {} as never)).toEqual(['student-1']);
  });
});

describe('time windows by the SCHEDULED end (approved decision 6)', () => {
  it('records before the start (inside Smart Guard\'s lead window: Smart Guard decides that edge) and during the session', async () => {
    const t = createEvaluationFakes({ session: fakeSession({ status: 'OPEN' }) });
    t.clock.set(at('2026-11-02T15:50:00Z'));
    expect((await send(t, memFor('student-1'))).results[0]!.outcome).toBe('RECORDED');
  });

  it('GRACE: after the scheduled end only MISSING evaluations can be recorded (Smart Guard and GPS still required, with the exception passed)', async () => {
    const t = createEvaluationFakes();
    await send(t, memFor('student-1'));
    t.events.length = 0;
    t.state.guardCalls.length = 0;
    t.clock.set(at('2026-11-02T17:10:00Z'));
    const late = await send(t, memFor('student-2'));
    expect(late.results[0]!.outcome).toBe('RECORDED');
    expect(t.state.guardCalls).toHaveLength(1);
    expect(t.state.guardCalls[0]!.allowAfterEndMinutes).toBe(15);
    expect(t.types()).toEqual(['EvaluationRecorded']);
  });

  it('GRACE: nothing already recorded can change: no score change, no duplicate, no note; a batch that includes one is rejected entirely (the missing one is not recorded either)', async () => {
    const t = createEvaluationFakes();
    await send(t, [{ studentId: 'student-1', scores: MEM3, note: 'ن' }]);
    t.events.length = 0;
    t.clock.set(at('2026-11-02T17:05:00Z'));
    await refused(send(t, [{ studentId: 'student-1', scores: [{ category: 'TAJWEED', score: 1 }] }]), 'EVALUATION_GRACE_CREATE_ONLY', { studentIds: ['student-1'], graceMinutes: 15 });
    await refused(send(t, memFor('student-1')), 'EVALUATION_GRACE_CREATE_ONLY'); // the same scores again is still "touching" it: no duplicate creation
    await refused(send(t, [...memFor('student-2'), { studentId: 'student-1', scores: MEM3 }]), 'EVALUATION_GRACE_CREATE_ONLY');
    expect(t.repo.rows.size).toBe(1);
    expect([...t.repo.rows.values()][0]!.scores.map((s) => s.score)).toEqual([8.5, 9, 7.75]);
    expect(t.events).toHaveLength(0);
  });

  it('the grace period lasts exactly 15 minutes after the scheduled end (inclusive); one millisecond later every write is closed for good', async () => {
    const t = createEvaluationFakes();
    t.clock.set(new Date(END.getTime() + 15 * 60_000));
    expect((await send(t, memFor('student-1'))).results[0]!.outcome).toBe('RECORDED');
    t.clock.set(new Date(END.getTime() + 15 * 60_000 + 1));
    await refused(send(t, memFor('student-2')), 'EVALUATION_WRITE_WINDOW_CLOSED');
    t.clock.set(at('2026-11-02T20:00:00Z'));
    await refused(send(t, memFor('student-2')), 'EVALUATION_WRITE_WINDOW_CLOSED');
    expect(t.repo.rows.size).toBe(1);
  });

  it('the window follows the SCHEDULED end, not the session status or when the background job ran: a session still marked IN_PROGRESS after its end is in grace, and a COMPLETED one before the grace ends still accepts missing evaluations', async () => {
    const lagging = createEvaluationFakes({ session: fakeSession({ status: 'IN_PROGRESS' }) });
    lagging.clock.set(at('2026-11-02T17:05:00Z'));
    await refused(send(lagging, memFor('student-1')).then(() => send(lagging, memFor('student-1'))), 'EVALUATION_GRACE_CREATE_ONLY'); // second send touches the existing one: grace is create-only
    const completed = createEvaluationFakes({ session: fakeSession({ status: 'COMPLETED' }) });
    completed.clock.set(at('2026-11-02T17:05:00Z'));
    expect((await send(completed, memFor('student-1'))).results[0]!.outcome).toBe('RECORDED');
  });

  it('missing evaluations stay missing: after the grace period nothing is created, no default and no zero score', async () => {
    const t = createEvaluationFakes();
    await send(t, memFor('student-1'));
    t.clock.set(at('2026-11-02T18:00:00Z'));
    await refused(send(t, memFor('student-2')), 'EVALUATION_WRITE_WINDOW_CLOSED');
    expect([...t.repo.rows.values()].map((r) => r.studentId)).toEqual(['student-1']);
  });

  it('no evaluation for a cancelled session', async () => {
    const t = createEvaluationFakes({ session: fakeSession({ status: 'CANCELLED' }) });
    await refused(send(t, memFor('student-1')), 'EVALUATION_SESSION_CANCELLED');
    expect(t.repo.rows.size).toBe(0);
  });
});

describe('concurrency inside the service', () => {
  it('a concurrent insert of the same student rolls the request back and retries; after 3 attempts it answers EVALUATION_CONCURRENT_CHANGE', async () => {
    const t = createEvaluationFakes();
    let calls = 0;
    const original = t.repo.insertIfAbsent.bind(t.repo);
    t.repo.insertIfAbsent = async (e, tx) => { calls += 1; return calls < 2 ? false : original(e, tx); };
    expect((await send(t, memFor('student-1'))).results[0]!.outcome).toBe('RECORDED');
    expect(calls).toBe(2);
    const t2 = createEvaluationFakes();
    t2.repo.insertIfAbsent = async () => false;
    await refused(send(t2, memFor('student-1')), 'EVALUATION_CONCURRENT_CHANGE');
  });
});

describe('reads (approved decision 2)', () => {
  it('the session\'s Teacher and the School Manager read a session\'s evaluations; nobody else', async () => {
    const t = createEvaluationFakes();
    await send(t, [{ studentId: 'student-1', scores: MEM3, note: 'ممتاز' }]);
    for (const userId of [TEACHER.userId, MANAGER]) {
      const read = await t.service.getSessionEvaluations('session-1', userId);
      expect(read.evaluations).toHaveLength(1);
      expect(read.evaluations[0]).toMatchObject({ note: 'ممتاز' });
    }
    await refused(t.service.getSessionEvaluations('session-1', OTHER_USER), 'EVALUATION_READ_NOT_ALLOWED');
  });

  it('a student\'s evaluations are listed newest first by default and paged; the DTO shows scores and the note, never modification details', async () => {
    const t = createEvaluationFakes();
    await send(t, [{ studentId: 'student-1', scores: MEM3, note: 'ن' }]);
    await send(t, [{ studentId: 'student-1', scores: [{ category: 'TAJWEED', score: 2 }] }]);
    const page = await t.service.listStudentEvaluations('student-1', { page: { page: 1, pageSize: 10 } });
    expect(page.total).toBe(1);
    expect(page.items[0]!.scores.map((s) => s.score)).toEqual([8.5, 9, 2]);
    expect(Object.keys(page.items[0]!).sort()).toEqual(['groupId', 'id', 'note', 'occurrenceDate', 'recordedAt', 'scheduledStart', 'schoolId', 'scores', 'sessionId', 'studentId']);
  });
});

describe('the integration data for the pre-end warning (approved decisions 6 and 8): nothing is notified or created here', () => {
  it('lists present students with an assignment and no evaluation as incomplete; ABSENT, UNMARKED, evaluated and assignment-less students are never required', async () => {
    const t = createEvaluationFakes();
    t.state.memorization = [{ id: 'mem-1', studentId: 'student-1' }, { id: 'mem-2', studentId: 'student-2' }]; // student-3 has no assignment
    t.state.attendance.set('student-1', 'PRESENT');
    t.state.attendance.set('student-2', 'PRESENT');
    t.state.attendance.set('student-3', 'PRESENT');
    await send(t, [{ studentId: 'student-2', scores: MEM3 }]);
    const status = await t.service.getSessionEvaluationStatus('session-1');
    expect(status.warningDueAt.toISOString()).toBe('2026-11-02T16:45:00.000Z');
    expect(status.graceEndsAt.toISOString()).toBe('2026-11-02T17:15:00.000Z');
    expect(Object.fromEntries(status.students.map((s) => [s.studentId, [s.attendance, s.evaluated, s.evaluationRequired]]))).toEqual({
      'student-1': ['PRESENT', false, true], 'student-2': ['PRESENT', true, false], 'student-3': ['PRESENT', false, false],
    });
    expect(status.incompleteStudentIds).toEqual(['student-1']);
    t.state.attendance.set('student-1', 'ABSENT');
    expect((await t.service.getSessionEvaluationStatus('session-1')).incompleteStudentIds).toEqual([]);
    t.state.attendance.delete('student-1'); // unmarked is not present
    const unmarked = await t.service.getSessionEvaluationStatus('session-1');
    expect(unmarked.students.find((s) => s.studentId === 'student-1')).toMatchObject({ attendance: 'UNMARKED', evaluationRequired: false });
    expect(t.repo.rows.size).toBe(1); // reading created nothing
  });
});
