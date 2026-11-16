import { describe, expect, it } from 'vitest';
import { FixedClock } from '../../../src/modules/00-shared-kernel/public';
import { Exam, ExamResult, EXAM_SMART_GUARD_LEAD_MINUTES, EXAM_REMINDER_HOURS, isValidQuestionCount, parseMaxScore, totalOf, validateConfig, type ExamConfigInput } from '../../../src/modules/30-exams/public';

const clock = (iso = '2026-11-20T08:00:00.000Z') => new FixedClock(new Date(iso));
const config = (over: Partial<ExamConfigInput> = {}): ExamConfigInput => ({ wholeSchool: false, groupIds: ['g1'], startAt: new Date('2026-12-01T09:00:00Z'), endAt: new Date('2026-12-01T11:00:00Z'), questionCount: 5, maxScore: 10, ...over });
const make = (over: Partial<ExamConfigInput> = {}, c = clock()) => Exam.create({ ...config(over), schoolId: 's1', examinerTeacherIds: [], actorId: 'u1', clock: c });
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as { code: string }).code; } return undefined; };

describe('configuration rules (approved Module 30 decisions)', () => {
  it('a uniform maximum score is a number above 0 up to 1000, ROUNDED to two decimals (like Module 29); a value that rounds to 0 is refused', () => {
    expect(parseMaxScore(10)).toBe(10);
    expect(parseMaxScore(7.555)).toBe(7.56);
    expect(parseMaxScore(1000)).toBe(1000);
    for (const bad of [0, -1, 1001, 0.004, NaN, Infinity, '10', null, undefined]) expect(parseMaxScore(bad)).toBeUndefined();
  });
  it('the question count is a whole number from 1 to 200', () => {
    expect([1, 200].every(isValidQuestionCount)).toBe(true);
    for (const bad of [0, 201, 1.5, -3, '5', NaN]) expect(isValidQuestionCount(bad)).toBe(false);
  });
  it('the total is the EXACT sum of the question scores (no floating point noise)', () => {
    expect(totalOf([0.1, 0.2])).toBe(0.3);
    expect(totalOf([8, 9.5, 7, 10, 6.25])).toBe(40.75);
    expect(totalOf([])).toBe(0);
  });
  it('targets: groups XOR the whole school; the end is after the start', () => {
    expect(code(() => validateConfig(config({ groupIds: [] })))).toBe('EXAM_TARGET_REQUIRED');
    expect(code(() => validateConfig(config({ wholeSchool: true, groupIds: ['g1'] })))).toBe('EXAM_TARGET_REQUIRED');
    expect(code(() => validateConfig(config({ wholeSchool: true, groupIds: [] })))).toBeUndefined();
    expect(code(() => validateConfig(config({ groupIds: ['g1', 'g1'] })))).toBe('EXAM_INVALID_TARGET');
    expect(code(() => validateConfig(config({ endAt: new Date('2026-12-01T09:00:00Z') })))).toBe('EXAM_INVALID_END');
    expect(code(() => validateConfig(config({ endAt: null })))).toBeUndefined();
    expect(code(() => validateConfig(config({ startAt: new Date('nope') })))).toBe('EXAM_INVALID_START');
    expect(code(() => validateConfig(config({ questionCount: 0 })))).toBe('EXAM_INVALID_QUESTION_COUNT');
    expect(code(() => validateConfig(config({ maxScore: 0 })))).toBe('EXAM_INVALID_MAX_SCORE');
  });
  it('the approved constants', () => {
    expect(EXAM_SMART_GUARD_LEAD_MINUTES).toBe(15);
    expect(EXAM_REMINDER_HOURS).toBe(24);
  });
});

describe('the exam lifecycle state machine', () => {
  it('DRAFT -> SCHEDULED -> STARTED -> COMPLETED -> ENDED, each step one-way', () => {
    const c = clock();
    const exam = make();
    expect(exam.snapshot.status).toBe('DRAFT');
    exam.schedule('u1', c);
    expect(exam.snapshot.status).toBe('SCHEDULED');
    exam.start(clock('2026-12-01T09:00:00.000Z'), 7);
    expect(exam.snapshot.status).toBe('STARTED');
    exam.complete(clock('2026-12-01T11:00:01.000Z'), ['s1'], null);
    expect(exam.snapshot.status).toBe('COMPLETED');
    exam.end('u1', clock('2026-12-02T09:00:00.000Z'));
    expect(exam.snapshot.status).toBe('ENDED');
    for (const attempt of [() => exam.schedule('u1', c), () => exam.start(c, 0), () => exam.complete(c, [], null), () => exam.end('u1', c), () => exam.cancel('u1', c), () => exam.markDeleted('u1', c)]) {
      expect(code(attempt)).toMatch(/EXAM_INVALID_TRANSITION/);
    }
  });
  it('ENDED cannot be reached from anything but COMPLETED (no skipping, no automatic path)', () => {
    for (const status of ['DRAFT', 'SCHEDULED', 'STARTED'] as const) {
      const exam = make();
      if (status !== 'DRAFT') exam.schedule('u1', clock());
      if (status === 'STARTED') exam.start(clock(), 0);
      expect(code(() => exam.end('u1', clock()))).toBe('EXAM_INVALID_TRANSITION');
    }
  });
  it('cancellation and deletion (separate operations) are possible only before STARTED', () => {
    const draft = make();
    draft.cancel('u1', clock());
    expect(draft.snapshot.status).toBe('CANCELLED');
    const sched = make();
    sched.schedule('u1', clock());
    sched.markDeleted('u1', clock());
    expect(sched.snapshot.deletedAt).not.toBeNull();
    expect(sched.snapshot.status).toBe('SCHEDULED'); // deletion is not a status: it is a separate operation
    const started = make();
    started.schedule('u1', clock());
    started.start(clock(), 0);
    expect(code(() => started.cancel('u1', clock()))).toBe('EXAM_INVALID_TRANSITION');
    expect(code(() => started.markDeleted('u1', clock()))).toBe('EXAM_INVALID_TRANSITION');
  });
  it('scheduling needs a start strictly in the future', () => {
    expect(code(() => make().schedule('u1', clock('2026-12-01T09:00:00.000Z')))).toBe('EXAM_START_NOT_IN_FUTURE');
    expect(code(() => make().schedule('u1', clock('2026-12-02T00:00:00.000Z')))).toBe('EXAM_START_NOT_IN_FUTURE');
  });
});

describe('what can change when (approved decision B)', () => {
  it('DRAFT and SCHEDULED: every configuration field is editable; a SCHEDULED start must stay in the future', () => {
    const exam = make();
    expect(exam.updateConfiguration({ questionCount: 9, maxScore: 4, startAt: new Date('2026-12-05T09:00:00Z'), endAt: null }, 'u1', clock())).toEqual(['startAt', 'endAt', 'questionCount', 'maxScore']);
    exam.schedule('u1', clock());
    expect(exam.updateConfiguration({ wholeSchool: true }, 'u1', clock())).toEqual(['targets']);
    expect(exam.snapshot.groupIds).toEqual([]);
    expect(code(() => exam.updateConfiguration({ startAt: new Date('2026-11-01T09:00:00Z') }, 'u1', clock()))).toBe('EXAM_START_NOT_IN_FUTURE');
  });
  it('after STARTED the configuration (start, questions, maximum score, targets) is LOCKED; after COMPLETED/ENDED everything is', () => {
    const exam = make();
    exam.schedule('u1', clock());
    exam.start(clock(), 0);
    for (const patch of [{ startAt: new Date('2026-12-05T09:00:00Z') }, { questionCount: 6 }, { maxScore: 3 }, { groupIds: ['g2'] }, { endAt: new Date('2026-12-01T12:00:00Z') }]) {
      expect(code(() => exam.updateConfiguration(patch, 'u1', clock()))).toBe('EXAM_CONFIG_LOCKED');
    }
    exam.complete(clock(), [], null);
    expect(code(() => exam.updateConfiguration({ questionCount: 6 }, 'u1', clock()))).toBe('EXAM_LOCKED');
  });
  it('while STARTED the end time can be extended or reduced, ONLY to a time strictly in the future (the current instant and the past are refused); it cannot be cleared', () => {
    const exam = make();
    exam.schedule('u1', clock());
    exam.start(clock(), 0);
    const now = clock('2026-12-01T10:00:00.000Z');
    expect(code(() => exam.changeEndTime(new Date('2026-12-01T10:00:00.000Z'), 'u1', now))).toBe('EXAM_END_NOT_IN_FUTURE');
    expect(code(() => exam.changeEndTime(new Date('2026-12-01T09:59:59.999Z'), 'u1', now))).toBe('EXAM_END_NOT_IN_FUTURE');
    exam.changeEndTime(new Date('2026-12-01T10:00:00.001Z'), 'u1', now); // reduce, 1 ms in the future
    expect(exam.snapshot.endAt!.toISOString()).toBe('2026-12-01T10:00:00.001Z');
    exam.changeEndTime(new Date('2026-12-01T15:00:00.000Z'), 'u1', now); // extend
    expect(exam.snapshot.endAt!.toISOString()).toBe('2026-12-01T15:00:00.000Z');
    expect(code(() => exam.changeEndTime(new Date('nope'), 'u1', now))).toBe('EXAM_INVALID_END');
    expect(exam.snapshot.startAt.toISOString()).toBe('2026-12-01T09:00:00.000Z'); // the start is immutable
  });
  it('the end time is editable only while STARTED: not before (use the configuration) and never after COMPLETED', () => {
    const exam = make();
    expect(code(() => exam.changeEndTime(new Date('2027-01-01T00:00:00Z'), 'u1', clock()))).toBe('EXAM_END_TIME_NOT_EDITABLE');
    exam.schedule('u1', clock());
    exam.start(clock('2026-12-01T09:00:00Z'), 0);
    exam.complete(clock('2026-12-01T11:00:01Z'), [], null);
    expect(code(() => exam.changeEndTime(new Date('2027-01-01T00:00:00Z'), 'u1', clock('2026-12-01T11:30:00Z')))).toBe('EXAM_LOCKED');
  });
});

describe('examiners (approved decision E)', () => {
  it('can be added and removed until ENDED, also while STARTED and COMPLETED; ENDED locks them and releases every active examiner (the records are kept)', () => {
    const exam = Exam.create({ ...config(), schoolId: 's1', examinerTeacherIds: ['t1', 't2'], actorId: 'u1', clock: clock() });
    exam.schedule('u1', clock());
    exam.start(clock(), 0);
    exam.assignExaminer('t3', 'u1', clock());
    exam.removeExaminer('t1', 'u1', clock());
    expect(exam.activeExaminerIds.sort()).toEqual(['t2', 't3']);
    expect(code(() => exam.assignExaminer('t2', 'u1', clock()))).toBe('EXAM_EXAMINER_ALREADY_ASSIGNED');
    expect(code(() => exam.removeExaminer('t1', 'u1', clock()))).toBe('EXAM_EXAMINER_NOT_ASSIGNED');
    exam.complete(clock(), [], null);
    exam.assignExaminer('t1', 'u1', clock()); // a removed examiner can be assigned again, until ENDED
    expect(exam.isActiveExaminer('t1')).toBe(true);
    exam.end('u1', clock());
    expect(exam.activeExaminerIds).toEqual([]);
    expect(exam.snapshot.examiners.filter((e) => e.releaseReason === 'EXAM_ENDED').map((e) => e.teacherId).sort()).toEqual(['t1', 't2', 't3']);
    expect(exam.snapshot.examiners).toHaveLength(3); // nothing was deleted
    expect(code(() => exam.assignExaminer('t9', 'u1', clock()))).toBe('EXAM_LOCKED');
    expect(code(() => exam.removeExaminer('t2', 'u1', clock()))).toBe('EXAM_LOCKED');
  });
});

describe('a result is immutable (approved decision G)', () => {
  it('has no way to change: only the snapshot getter and the factory; the total is the exact sum, rounded scores are kept', () => {
    const result = ExamResult.create({ examId: 'e', schoolId: 's', groupId: 'g', studentId: 'st', scores: [8, 9.5, 7.005], maxScore: 10, examinerTeacherId: 't', examinerUserId: 'u', clock: clock() });
    expect(result.snapshot.total).toBe(totalOf([8, 9.5, 7.01]) - 0.01 + 0.01);
    const names = Object.getOwnPropertyNames(Object.getPrototypeOf(result)).filter((n) => n !== 'constructor');
    expect(names).toEqual(['snapshot']);
    expect(Object.getOwnPropertyNames(ExamResult).filter((n) => !['length', 'name', 'prototype'].includes(n)).sort()).toEqual(['create', 'rehydrate']);
  });
});
