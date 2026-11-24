import { describe, expect, it } from 'vitest';
import { InMemoryRevisionRepository, type RevisionRange } from '../../../src/modules/28-revision/public';

const RANGE: RevisionRange = {
  input: { form: 'START_UNIT_AMOUNT', unit: 'AYAHS', surah: 1, start: 1, amount: 7, direction: 'FORWARD' },
  request: { start: { surah: 1, ayah: 1 }, unit: 'AYAHS', amount: 7, direction: 'FORWARD' },
  first: { surah: 1, ayah: 1 },
  last: { surah: 1, ayah: 7 },
  segments: [{ surah: 1, firstAyah: 1, lastAyah: 7 }],
  ayahCount: 7,
};

/** The read-only revision aggregate Module 38 needs from Module 28 (additive: no existing behaviour changes). */
describe('Module 28 summarizeForReport', () => {
  const repo = new InMemoryRevisionRepository();
  let n = 0;
  const add = (schoolId: string, groupId: string, studentId: string, matches: boolean | null, start: string) => {
    n += 1;
    const at = new Date(start);
    repo.records.set(`r${n}`, {
      id: `r${n}`, sessionId: `s${n}`, schoolId, groupId, studentId, assignmentId: matches === null ? null : `a${n}`, range: RANGE, matchesAssignment: matches,
      recordedBy: 'u', recordedAt: at, updatedBy: 'u', updatedAt: at, sessionScheduledStart: at,
    });
  };
  add('s1', 'g1', 'a', true, '2026-10-05T09:00:00Z');
  add('s1', 'g1', 'a', true, '2026-10-12T09:00:00Z');
  add('s1', 'g1', 'a', false, '2026-11-02T09:00:00Z');
  add('s1', 'g2', 'a', null, '2026-11-16T09:00:00Z');
  add('s2', 'g3', 'b', true, '2026-11-04T09:00:00Z');
  const key = (r: { schoolId: string; groupId: string; studentId: string; matches: boolean | null; count: number; firstStart: Date }) =>
    `${r.schoolId}/${r.groupId}/${r.studentId}/${r.matches === null ? 'none' : r.matches ? 'match' : 'differ'}=${r.count}@${r.firstStart.toISOString()}`;

  it('counts per school, group, student and fulfilment state with the earliest session start, in a stable order', async () => {
    const rows = await repo.summarizeForReport({});
    expect(rows.map(key)).toEqual([
      's1/g1/a/differ=1@2026-11-02T09:00:00.000Z',
      's1/g1/a/match=2@2026-10-05T09:00:00.000Z',
      's1/g2/a/none=1@2026-11-16T09:00:00.000Z',
      's2/g3/b/match=1@2026-11-04T09:00:00.000Z',
    ]);
  });

  it('every filter narrows (AND): schools, groups, students and the half-open instant range', async () => {
    expect((await repo.summarizeForReport({ schoolIds: ['s1'] })).map((r) => r.studentId)).toEqual(['a', 'a', 'a']);
    expect((await repo.summarizeForReport({ groupIds: ['g1'] })).map((r) => r.groupId)).toEqual(['g1', 'g1']);
    expect((await repo.summarizeForReport({ studentIds: ['b'] })).map(key)).toEqual(['s2/g3/b/match=1@2026-11-04T09:00:00.000Z']);
    const from = new Date('2026-11-02T09:00:00Z');
    const toExclusive = new Date('2026-11-16T09:00:00Z');
    expect((await repo.summarizeForReport({ schoolIds: ['s1'], from, toExclusive })).map(key)).toEqual(['s1/g1/a/differ=1@2026-11-02T09:00:00.000Z']); // from is inclusive, toExclusive is exclusive
    expect(await repo.summarizeForReport({ schoolIds: ['s2'], toExclusive: new Date('2026-11-04T09:00:00Z') })).toEqual([]);
  });

  it('an empty list matches nothing (never everything)', async () => {
    expect(await repo.summarizeForReport({ schoolIds: [] })).toEqual([]);
    expect(await repo.summarizeForReport({ groupIds: [] })).toEqual([]);
    expect(await repo.summarizeForReport({ studentIds: [] })).toEqual([]);
  });

  it('counts the CURRENT value of a corrected record once (a correction never adds a row)', async () => {
    const before = await repo.summarizeForReport({ studentIds: ['a'] });
    const record = repo.records.get('r3')!;
    repo.records.set('r3', { ...record, matchesAssignment: true });
    const after = await repo.summarizeForReport({ studentIds: ['a'] });
    expect(before.reduce((sum, r) => sum + r.count, 0)).toBe(after.reduce((sum, r) => sum + r.count, 0));
    expect(after.filter((r) => r.matches === false)).toEqual([]);
    repo.records.set('r3', record); // restore for any later test
  });
});
