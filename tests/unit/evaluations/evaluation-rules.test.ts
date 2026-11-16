import { describe, expect, it } from 'vitest';
import { cairoWallClockToUtc } from '../../../src/modules/24-sessions/public';
import {
  GRACE_MINUTES, MAX_NOTE_LENGTH, PRE_END_WARNING_MINUTES, assignmentRefsOf, availableCategories, evaluationPhaseAt, graceEndsAt, isAcceptableScore, normalizeNote, roundScore, sameScore, warningDueAt,
} from '../../../src/modules/29-evaluations/public';

const M = 'mem-1';
const R = 'rev-1';

describe('which categories a student can be evaluated on follows the assignments (approved decision 3)', () => {
  it.each([
    ['Memorization only', M, null, ['MEMORIZATION', 'PERFORMANCE', 'TAJWEED']],
    ['Revision only', null, R, ['REVISION', 'PERFORMANCE', 'TAJWEED']],
    ['both', M, R, ['MEMORIZATION', 'REVISION', 'PERFORMANCE', 'TAJWEED']],
    ['neither', null, null, []],
  ])('%s', (_name, memorizationAssignmentId, revisionAssignmentId, expected) => {
    expect(availableCategories({ memorizationAssignmentId, revisionAssignmentId })).toEqual(expected);
  });

  it('Performance and Tajweed appear ONCE each, even when both assignments exist', () => {
    const categories = availableCategories({ memorizationAssignmentId: M, revisionAssignmentId: R });
    expect(categories.filter((c) => c === 'PERFORMANCE')).toHaveLength(1);
    expect(categories.filter((c) => c === 'TAJWEED')).toHaveLength(1);
  });

  it('the Memorization score is tied to the memorization assignment, Revision to the revision one, Performance and Tajweed to the applicable context', () => {
    const both = { memorizationAssignmentId: M, revisionAssignmentId: R };
    expect(assignmentRefsOf('MEMORIZATION', both)).toEqual({ memorizationAssignmentId: M, revisionAssignmentId: null });
    expect(assignmentRefsOf('REVISION', both)).toEqual({ memorizationAssignmentId: null, revisionAssignmentId: R });
    expect(assignmentRefsOf('PERFORMANCE', both)).toEqual(both);
    expect(assignmentRefsOf('TAJWEED', { memorizationAssignmentId: null, revisionAssignmentId: R })).toEqual({ memorizationAssignmentId: null, revisionAssignmentId: R });
  });
});

describe('scores are 0.00-10.00 and ROUNDED to two decimals, not rejected (approved decision 5)', () => {
  it.each([[8.555, 8.56], [1.005, 1.01], [2.675, 2.68], [9.999, 10], [0.004, 0], [7.5, 7.5], [8, 8], [0.1 + 0.2, 0.3], [10, 10], [0, 0]])('%s is stored as %s', (input, expected) => {
    expect(roundScore(input)).toBe(expected);
  });

  it('accepts exactly 0 and 10 and anything between; refuses outside 0..10 BEFORE rounding, and anything that is not a finite number', () => {
    for (const ok of [0, 10, 5, 9.999, 0.004]) expect(isAcceptableScore(ok)).toBe(true);
    for (const bad of [-0.01, 10.004, 10.01, 11, NaN, Infinity, '8', null, undefined, true, {}, []]) expect(isAcceptableScore(bad)).toBe(false);
  });

  it('compares scores by hundredths', () => {
    expect(sameScore(8.5, 8.5)).toBe(true);
    expect(sameScore(0.1 + 0.2, 0.3)).toBe(true);
    expect(sameScore(8.5, 8.51)).toBe(false);
  });
});

describe('the optional note: one per evaluation, at most 200 characters, trimmed (approved decision 5)', () => {
  it('missing, null and blank mean no note; a text is trimmed', () => {
    expect(normalizeNote(undefined)).toBeNull();
    expect(normalizeNote(null)).toBeNull();
    expect(normalizeNote('   ')).toBeNull();
    expect(normalizeNote('  ممتاز  ')).toBe('ممتاز');
  });
  it('allows exactly 200 characters and refuses 201; refuses a non-text', () => {
    expect(normalizeNote('ب'.repeat(MAX_NOTE_LENGTH))).toHaveLength(MAX_NOTE_LENGTH);
    expect(() => normalizeNote('ب'.repeat(MAX_NOTE_LENGTH + 1))).toThrowError(expect.objectContaining({ code: 'EVALUATION_NOTE_TOO_LONG' }));
    expect(() => normalizeNote(5)).toThrowError(expect.objectContaining({ code: 'EVALUATION_INVALID_NOTE' }));
  });
});

describe('the write window follows the SCHEDULED end (approved decision 6)', () => {
  const end = new Date('2026-11-02T17:00:00.000Z');
  const ms = (n: number) => new Date(end.getTime() + n);
  it('the approved constants', () => {
    expect(GRACE_MINUTES).toBe(15);
    expect(PRE_END_WARNING_MINUTES).toBe(15);
    expect(graceEndsAt(end).toISOString()).toBe('2026-11-02T17:15:00.000Z');
    expect(warningDueAt(end).toISOString()).toBe('2026-11-02T16:45:00.000Z');
  });
  it('IN_SESSION through the end instant, GRACE from 1 ms after the end through exactly 15 minutes, CLOSED after', () => {
    expect(evaluationPhaseAt(ms(-1), end)).toBe('IN_SESSION');
    expect(evaluationPhaseAt(end, end)).toBe('IN_SESSION');
    expect(evaluationPhaseAt(ms(1), end)).toBe('GRACE');
    expect(evaluationPhaseAt(ms(15 * 60_000), end)).toBe('GRACE');
    expect(evaluationPhaseAt(ms(15 * 60_000 + 1), end)).toBe('CLOSED');
  });
  it('uses the instant Module 24 computed from the Africa/Cairo schedule: on the day Egypt changes to summer time the same wall clock is a different UTC instant, and the window follows it', () => {
    // Egypt moves to summer time on the last Friday of April (2026-04-24): 20:00-21:00 Cairo is UTC+2 the day before and UTC+3 that day.
    const before = cairoWallClockToUtc('2026-04-23', 21 * 60);
    const onDay = cairoWallClockToUtc('2026-04-24', 21 * 60);
    expect(before.toISOString()).toBe('2026-04-23T19:00:00.000Z');
    expect(onDay.toISOString()).toBe('2026-04-24T18:00:00.000Z');
    expect(evaluationPhaseAt(new Date('2026-04-24T18:10:00.000Z'), onDay)).toBe('GRACE');
    expect(evaluationPhaseAt(new Date('2026-04-24T18:16:00.000Z'), onDay)).toBe('CLOSED');
    expect(evaluationPhaseAt(new Date('2026-04-24T19:10:00.000Z'), onDay)).toBe('CLOSED'); // the winter-time reading (+2) would still have been open
  });
});
