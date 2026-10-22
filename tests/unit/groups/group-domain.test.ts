import { describe, expect, it } from 'vitest';
import { AppError, FixedClock } from '../../../src/modules/00-shared-kernel/public';
import { Group, GroupAssignment, SURAH_COUNT } from '../../../src/modules/20-groups/public';
import { groupNameKey, normalizeGroupName, normalizeGroupReason, requireLearningMode, requireProgression, requireStartingSurah } from '../../../src/modules/20-groups/domain/value-objects/group-settings';

const codeOf = (fn: () => unknown): string => {
  try {
    fn();
    return 'NO_ERROR';
  } catch (e) {
    return e instanceof AppError ? e.code : `NOT_APP_ERROR:${String(e)}`;
  }
};
const clock = new FixedClock(new Date('2026-10-21T09:00:00.000Z'));
const base = { schoolId: 's1', organizationId: 'o1', name: 'حلقة الفجر', teacherId: null, learningMode: 'GROUP', progression: 'FORWARD', startingSurah: 78, createdBy: 'u1', clock } as const;

describe('group value objects', () => {
  it('normalizes the name; rejects blank, non-text, control characters and more than 200 characters', () => {
    expect(normalizeGroupName('  حلقة   الفجر\t')).toBe('حلقة الفجر');
    for (const bad of ['', '   ', null, undefined, 7, 'abc\u0000', 'ا'.repeat(201)]) expect(codeOf(() => normalizeGroupName(bad)), String(bad)).toBe('INVALID_GROUP_NAME');
    expect(normalizeGroupName('ا'.repeat(200))).toHaveLength(200);
  });
  it('the uniqueness key folds Latin case only, never Arabic letters', () => {
    expect(groupNameKey('Fajr Circle')).toBe(groupNameKey('fajr circle'));
    expect(groupNameKey('حلقة أحمد')).not.toBe(groupNameKey('حلقة احمد'));
  });
  it('accepts exactly the documented learning modes, progressions and surah numbers 1..114', () => {
    expect(requireLearningMode('GROUP')).toBe('GROUP');
    expect(requireLearningMode('INDIVIDUAL')).toBe('INDIVIDUAL');
    expect(requireProgression('FORWARD')).toBe('FORWARD');
    expect(requireProgression('BACKWARD')).toBe('BACKWARD');
    expect(SURAH_COUNT).toBe(114);
    expect(requireStartingSurah(1)).toBe(1);
    expect(requireStartingSurah(114)).toBe(114);
    for (const bad of ['group', 'Group', '', null, undefined, 1]) expect(codeOf(() => requireLearningMode(bad)), String(bad)).toBe('INVALID_GROUP_LEARNING_MODE');
    for (const bad of ['forward', '', null, undefined, 'BOTH']) expect(codeOf(() => requireProgression(bad)), String(bad)).toBe('INVALID_GROUP_PROGRESSION');
    for (const bad of [0, 115, -1, 1.5, '5', null, undefined, NaN]) expect(codeOf(() => requireStartingSurah(bad)), String(bad)).toBe('INVALID_GROUP_STARTING_SURAH');
  });
  it('the reason is optional text of at most 500 characters', () => {
    expect(normalizeGroupReason(undefined)).toBeNull();
    expect(normalizeGroupReason('   ')).toBeNull();
    expect(normalizeGroupReason(' سبب ')).toBe('سبب');
    expect(codeOf(() => normalizeGroupReason(5))).toBe('INVALID_GROUP_REASON');
    expect(codeOf(() => normalizeGroupReason('ا'.repeat(501)))).toBe('INVALID_GROUP_REASON');
  });
});

describe('Group entity', () => {
  it('registers ACTIVE with one history row and one event of identifiers only', () => {
    const g = Group.register(base);
    expect(g.snapshot).toMatchObject({ status: 'ACTIVE', version: 1, teacherId: null, startingSurah: 78 });
    expect(g.pullHistory().map((h) => h.action)).toEqual(['CREATED']);
    const events = g.pullDomainEvents();
    expect(events.map((e) => e.eventType)).toEqual(['GroupCreated']);
    expect(JSON.stringify(events[0]!.payload)).not.toMatch(/حلقة/);
  });

  it('records only what changed, with previous values; a change of mode or progression never touches earlier history', () => {
    const g = Group.register(base);
    g.pullHistory();
    g.pullDomainEvents();
    expect(g.updateSettings({ name: base.name, learningMode: 'GROUP', progression: 'FORWARD', startingSurah: 78 }, 'u1', clock)).toEqual([]);
    expect(g.pullHistory()).toEqual([]);
    expect(g.updateSettings({ progression: 'BACKWARD', startingSurah: 114 }, 'u1', clock)).toEqual(['PROGRESSION', 'STARTING_SURAH']);
    const [h] = g.pullHistory();
    expect(h).toMatchObject({ action: 'UPDATED', previousProgression: 'FORWARD', newProgression: 'BACKWARD', previousStartingSurah: 78, newStartingSurah: 114, previousName: null, previousLearningMode: null });
    expect(g.snapshot.schoolId).toBe('s1');
  });

  it('sets, changes and removes the Teacher (one at most) and archives for good', () => {
    const g = Group.register(base);
    g.pullHistory();
    expect(g.setTeacher('t1', 'u1', clock)).toBe(true);
    expect(g.setTeacher('t1', 'u1', clock)).toBe(false);
    expect(g.setTeacher('t2', 'u1', clock)).toBe(true);
    expect(g.setTeacher(null, 'u1', clock)).toBe(true);
    expect(g.pullHistory().map((h) => [h.previousTeacherId, h.newTeacherId])).toEqual([[null, 't1'], ['t1', 't2'], ['t2', null]]);
    g.archive('u1', 'سبب', clock);
    expect(g.status).toBe('ARCHIVED');
    expect(codeOf(() => g.archive('u1', null, clock))).toBe('GROUP_ARCHIVED');
    expect(codeOf(() => g.setTeacher('t1', 'u1', clock))).toBe('GROUP_ARCHIVED');
    expect(codeOf(() => g.updateSettings({ name: 'x' }, 'u1', clock))).toBe('GROUP_ARCHIVED');
    expect(g.pullHistory().at(-1)).toMatchObject({ action: 'ARCHIVED', reason: 'سبب' });
  });
});

describe('GroupAssignment entity', () => {
  it('starts current, ends once with a reason (system end has no actor) and publishes events', () => {
    const a = GroupAssignment.start({ groupId: 'g1', studentId: 'st1', schoolId: 's1', organizationId: 'o1', assignedBy: 'u1', clock });
    expect(a.isCurrent).toBe(true);
    expect(a.pullDomainEvents().map((e) => e.eventType)).toEqual(['GroupStudentAssigned']);
    expect(a.end('STUDENT_ARCHIVED', null, clock)).toBe(true);
    expect(a.end('MANUAL', 'u1', clock)).toBe(false);
    expect(a.snapshot).toMatchObject({ endReason: 'STUDENT_ARCHIVED', unassignedBy: null });
    expect(a.pullDomainEvents().map((e) => e.eventType)).toEqual(['GroupStudentUnassigned']);
  });
});
