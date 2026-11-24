import { describe, expect, it } from 'vitest';
import { GroupService, InMemoryGroupRepository, clipStint, teachingStints, type TeachingEvent } from '../../../src/modules/20-groups/public';

const T = 'teacher-1';
const OTHER = 'teacher-2';
const at = (iso: string) => new Date(iso);
const created = (iso: string, teacher: string | null): TeachingEvent => ({ action: 'CREATED', occurredAt: at(iso), newTeacherId: teacher });
const changed = (iso: string, teacher: string | null): TeachingEvent => ({ action: 'TEACHER_CHANGED', occurredAt: at(iso), newTeacherId: teacher });
const archived = (iso: string): TeachingEvent => ({ action: 'ARCHIVED', occurredAt: at(iso), newTeacherId: null });

describe('teaching stints come ONLY from the group\'s authoritative history', () => {
  it('the first teacher recorded at creation starts a stint that stays open while nothing ends it', () => {
    expect(teachingStints([created('2026-09-10T08:00:00Z', T)], T)).toEqual([{ from: at('2026-09-10T08:00:00Z'), to: null }]);
  });

  it('a TEACHER_CHANGED to someone else ends the stint, and the new teacher starts theirs at that instant', () => {
    const events = [created('2026-09-10T08:00:00Z', T), changed('2026-10-10T08:00:00Z', OTHER)];
    expect(teachingStints(events, T)).toEqual([{ from: at('2026-09-10T08:00:00Z'), to: at('2026-10-10T08:00:00Z') }]);
    expect(teachingStints(events, OTHER)).toEqual([{ from: at('2026-10-10T08:00:00Z'), to: null }]);
  });

  it('a teacher who is given the group later (created without one) starts at that change', () => {
    expect(teachingStints([created('2026-09-10T08:00:00Z', null), changed('2026-10-01T08:00:00Z', T)], T)).toEqual([{ from: at('2026-10-01T08:00:00Z'), to: null }]);
  });

  it('a teacher who leaves and comes back has two stints (never merged)', () => {
    const events = [created('2026-09-10T08:00:00Z', T), changed('2026-10-01T08:00:00Z', OTHER), changed('2026-11-01T08:00:00Z', T)];
    expect(teachingStints(events, T)).toEqual([{ from: at('2026-09-10T08:00:00Z'), to: at('2026-10-01T08:00:00Z') }, { from: at('2026-11-01T08:00:00Z'), to: null }]);
  });

  it('taking the group away from everyone (teacher null) ends the stint', () => {
    expect(teachingStints([created('2026-09-10T08:00:00Z', T), changed('2026-10-20T08:00:00Z', null)], T)).toEqual([{ from: at('2026-09-10T08:00:00Z'), to: at('2026-10-20T08:00:00Z') }]);
  });

  it('archiving the group ends the stint (an archived group is not taught)', () => {
    expect(teachingStints([created('2026-09-10T08:00:00Z', T), archived('2026-12-01T08:00:00Z')], T)).toEqual([{ from: at('2026-09-10T08:00:00Z'), to: at('2026-12-01T08:00:00Z') }]);
  });

  it('a teacher who never taught the group, or was given it and lost it at the same instant, has no stint', () => {
    expect(teachingStints([created('2026-09-10T08:00:00Z', OTHER)], T)).toEqual([]);
    expect(teachingStints([created('2026-09-10T08:00:00Z', null), changed('2026-10-01T08:00:00Z', T), changed('2026-10-01T08:00:00Z', OTHER)], T)).toEqual([]);
    expect(teachingStints([], T)).toEqual([]);
  });
});

describe('a stint is clipped to the reporting period', () => {
  const stint = { from: at('2026-09-10T08:00:00Z'), to: at('2026-10-20T08:00:00Z') };
  it('keeps only the part inside the half-open range', () => {
    expect(clipStint(stint, { from: at('2026-10-01T00:00:00Z'), toExclusive: at('2026-11-01T00:00:00Z') })).toEqual({ from: at('2026-10-01T00:00:00Z'), to: at('2026-10-20T08:00:00Z') });
    expect(clipStint(stint, { from: at('2026-09-01T00:00:00Z'), toExclusive: at('2026-10-01T00:00:00Z') })).toEqual({ from: at('2026-09-10T08:00:00Z'), to: at('2026-10-01T00:00:00Z') });
    expect(clipStint(stint, {})).toEqual(stint);
  });

  it('drops a stint entirely outside the range, including one that only touches its edge', () => {
    expect(clipStint(stint, { from: at('2026-10-20T08:00:00Z') })).toBeUndefined();
    expect(clipStint(stint, { toExclusive: at('2026-09-10T08:00:00Z') })).toBeUndefined();
    expect(clipStint(stint, { from: at('2026-11-01T00:00:00Z') })).toBeUndefined();
  });

  it('an open stint stays open without an upper bound and is closed by the range end otherwise', () => {
    const open = { from: at('2026-09-10T08:00:00Z'), to: null };
    expect(clipStint(open, {})).toEqual(open);
    expect(clipStint(open, { toExclusive: at('2026-11-01T00:00:00Z') })).toEqual({ from: at('2026-09-10T08:00:00Z'), to: at('2026-11-01T00:00:00Z') });
    expect(clipStint(open, { from: at('2026-10-01T00:00:00Z') })).toEqual({ from: at('2026-10-01T00:00:00Z'), to: null });
  });
});

describe('Module 20 read contract for the Teacher report: listGroupsTaughtByTeacherForReport', () => {
  const SA = 'school-a';
  const SB = 'school-b';
  const SC = 'school-c';
  function service() {
    const repo = new InMemoryGroupRepository();
    const group = (id: string, schoolId: string, name: string) => repo.groups.set(id, { id, schoolId, name, learningMode: 'GROUP' } as never);
    let n = 0;
    const history = (groupId: string, action: 'CREATED' | 'TEACHER_CHANGED' | 'ARCHIVED', iso: string, newTeacherId: string | null) =>
      repo.history.push({ id: `h${++n}`, groupId, action, actorId: 'u', occurredAt: at(iso), reason: null, previousName: null, newName: null, previousTeacherId: null, newTeacherId } as never);
    group('ga', SA, 'حلقة أ');
    group('gb', SB, 'حلقة ب');
    group('gc', SC, 'حلقة ج');
    group('gother', SA, 'حلقة أخرى');
    history('ga', 'CREATED', '2026-09-10T08:00:00Z', T);
    history('gb', 'CREATED', '2026-09-10T08:00:00Z', OTHER);
    history('gb', 'TEACHER_CHANGED', '2026-10-01T08:00:00Z', T);
    history('gc', 'CREATED', '2026-09-10T08:00:00Z', T);
    history('gc', 'TEACHER_CHANGED', '2026-10-20T08:00:00Z', null); // taught in school C, no longer does
    history('gother', 'CREATED', '2026-09-10T08:00:00Z', OTHER);
    return { repo, service: new GroupService({ groups: repo } as never) };
  }

  it('only the GIVEN schools are ever read: the same teacher\'s work in other schools is invisible', async () => {
    const { service: s } = service();
    expect((await s.listGroupsTaughtByTeacherForReport({ teacherId: T, schoolIds: [SA] })).map((r) => r.groupId)).toEqual(['ga']);
    expect((await s.listGroupsTaughtByTeacherForReport({ teacherId: T, schoolIds: [SB] })).map((r) => r.groupId)).toEqual(['gb']);
    expect((await s.listGroupsTaughtByTeacherForReport({ teacherId: T, schoolIds: [SC] })).map((r) => r.groupId)).toEqual(['gc']);
    expect((await s.listGroupsTaughtByTeacherForReport({ teacherId: T, schoolIds: [SA, SB, SC] })).map((r) => r.groupId)).toEqual(['ga', 'gb', 'gc']);
    expect(await s.listGroupsTaughtByTeacherForReport({ teacherId: T, schoolIds: [] })).toEqual([]);
    expect(await s.listGroupsTaughtByTeacherForReport({ teacherId: T, schoolIds: ['school-elsewhere'] })).toEqual([]);
    expect(JSON.stringify(await s.listGroupsTaughtByTeacherForReport({ teacherId: T, schoolIds: [SA] }))).not.toMatch(/حلقة ب|حلقة ج|school-b|school-c/);
  });

  it('a teacher keeps the history of a school they no longer teach in; the dates come from the history', async () => {
    const rows = await service().service.listGroupsTaughtByTeacherForReport({ teacherId: T, schoolIds: [SC] });
    expect(rows).toEqual([{ groupId: 'gc', schoolId: SC, groupName: 'حلقة ج', learningMode: 'GROUP', from: at('2026-09-10T08:00:00Z'), to: at('2026-10-20T08:00:00Z'), stillTeaching: false }]);
    const open = await service().service.listGroupsTaughtByTeacherForReport({ teacherId: T, schoolIds: [SB] });
    expect(open[0]).toMatchObject({ groupId: 'gb', from: at('2026-10-01T08:00:00Z'), to: null, stillTeaching: true }); // not the owner from the start: the change decides
  });

  it('never returns a group the teacher did not teach, and clips to the period', async () => {
    const { service: s } = service();
    expect((await s.listGroupsTaughtByTeacherForReport({ teacherId: T, schoolIds: [SA] })).some((r) => r.groupId === 'gother')).toBe(false);
    const october = await s.listGroupsTaughtByTeacherForReport({ teacherId: T, schoolIds: [SA, SB, SC], from: at('2026-10-10T00:00:00Z'), toExclusive: at('2026-10-31T22:00:00Z') });
    expect(october.map((r) => [r.groupId, r.from.toISOString(), r.to?.toISOString() ?? null, r.stillTeaching])).toEqual([
      ['ga', '2026-10-10T00:00:00.000Z', '2026-10-31T22:00:00.000Z', true],
      ['gb', '2026-10-10T00:00:00.000Z', '2026-10-31T22:00:00.000Z', true],
      ['gc', '2026-10-10T00:00:00.000Z', '2026-10-20T08:00:00.000Z', false],
    ]);
    const november = await s.listGroupsTaughtByTeacherForReport({ teacherId: T, schoolIds: [SA, SB, SC], from: at('2026-10-31T22:00:00Z') });
    expect(november.map((r) => r.groupId)).toEqual(['ga', 'gb']); // C ended in October
  });

  it('is read-only: the stored groups and history are unchanged', async () => {
    const { repo, service: s } = service();
    const before = JSON.stringify([[...repo.groups], repo.history]);
    await s.listGroupsTaughtByTeacherForReport({ teacherId: T, schoolIds: [SA, SB, SC] });
    expect(JSON.stringify([[...repo.groups], repo.history])).toBe(before);
  });
});
