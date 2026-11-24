import { describe, expect, it } from 'vitest';
import { InMemoryEvaluationRepository, type EvaluationCategory } from '../../../src/modules/29-evaluations/public';

/** The read-only evaluation aggregate Module 38 needs from Module 29 (additive: no existing behaviour changes). */
describe('Module 29 summarizeForReport', () => {
  const repo = new InMemoryEvaluationRepository();
  let n = 0;
  const add = (schoolId: string, groupId: string, studentId: string, recordedBy: string, start: string, scores: Partial<Record<EvaluationCategory, number>>) => {
    n += 1;
    const at = new Date(start);
    repo.rows.set(`e${n}`, {
      id: `e${n}`, sessionId: `s${n}`, schoolId, groupId, studentId, occurrenceDate: start.slice(0, 10), scheduledStart: at, note: 'never returned',
      scores: (Object.entries(scores) as Array<[EvaluationCategory, number]>).map(([category, score]) => ({ category, score, memorizationAssignmentId: null, revisionAssignmentId: null })),
      recordedBy, recordedAt: at, updatedBy: recordedBy, updatedAt: at,
    });
  };
  add('s1', 'g1', 'a', 't1', '2026-10-05T09:00:00Z', { MEMORIZATION: 8.5, PERFORMANCE: 9 });
  add('s1', 'g1', 'a', 't1', '2026-10-12T09:00:00Z', { MEMORIZATION: 7.25, REVISION: 6, TAJWEED: 10 });
  add('s1', 'g2', 'a', 't2', '2026-11-16T09:00:00Z', { REVISION: 5 });
  add('s2', 'g3', 'b', 't3', '2026-11-04T09:00:00Z', { MEMORIZATION: 3.33 });
  const shape = (r: { schoolId: string; groupId: string; studentId: string; evaluations: number; firstStart: Date; categories: ReadonlyArray<{ category: string; count: number; sumHundredths: number }> }) =>
    `${r.schoolId}/${r.groupId}/${r.studentId} n=${r.evaluations} @${r.firstStart.toISOString()} ${r.categories.map((c) => `${c.category}:${c.count}:${c.sumHundredths}`).join(',')}`;

  it('counts evaluations per school, group and student with, per category, the count and the exact sum in hundredths (integers), in a stable order', async () => {
    const rows = await repo.summarizeForReport({});
    expect(rows.map(shape)).toEqual([
      's1/g1/a n=2 @2026-10-05T09:00:00.000Z MEMORIZATION:2:1575,REVISION:1:600,PERFORMANCE:1:900,TAJWEED:1:1000',
      's1/g2/a n=1 @2026-11-16T09:00:00.000Z REVISION:1:500',
      's2/g3/b n=1 @2026-11-04T09:00:00.000Z MEMORIZATION:1:333',
    ]);
  });

  it('every filter narrows (AND): schools, groups, students, recorders and the half-open instant range', async () => {
    expect((await repo.summarizeForReport({ schoolIds: ['s1'] })).map((r) => r.groupId)).toEqual(['g1', 'g2']);
    expect((await repo.summarizeForReport({ groupIds: ['g2'] })).map((r) => r.studentId)).toEqual(['a']);
    expect((await repo.summarizeForReport({ studentIds: ['b'] })).map((r) => r.schoolId)).toEqual(['s2']);
    expect((await repo.summarizeForReport({ recordedByUserIds: ['t2'] })).map(shape)).toEqual(['s1/g2/a n=1 @2026-11-16T09:00:00.000Z REVISION:1:500']);
    expect((await repo.summarizeForReport({ recordedByUserIds: ['t1'], groupIds: ['g2'] }))).toEqual([]); // AND, not OR
    const from = new Date('2026-10-12T09:00:00Z');
    const toExclusive = new Date('2026-11-16T09:00:00Z');
    expect((await repo.summarizeForReport({ schoolIds: ['s1'], from, toExclusive })).map(shape)).toEqual(['s1/g1/a n=1 @2026-10-12T09:00:00.000Z MEMORIZATION:1:725,REVISION:1:600,TAJWEED:1:1000']); // from inclusive, toExclusive exclusive
  });

  it('an empty list matches nothing (never everything)', async () => {
    for (const query of [{ schoolIds: [] }, { groupIds: [] }, { studentIds: [] }, { recordedByUserIds: [] }]) expect(await repo.summarizeForReport(query)).toEqual([]);
  });

  it('counts the CURRENT scores (a modified score replaces the old one; no history exists) and never exposes the note', async () => {
    const before = await repo.summarizeForReport({ studentIds: ['b'] });
    const original = repo.rows.get('e4')!;
    repo.rows.set('e4', { ...original, scores: [{ category: 'MEMORIZATION', score: 9.99, memorizationAssignmentId: null, revisionAssignmentId: null }] });
    const after = await repo.summarizeForReport({ studentIds: ['b'] });
    expect(before[0]!.categories).toEqual([{ category: 'MEMORIZATION', count: 1, sumHundredths: 333 }]);
    expect(after[0]!.categories).toEqual([{ category: 'MEMORIZATION', count: 1, sumHundredths: 999 }]);
    expect(JSON.stringify(after)).not.toContain('never returned');
    repo.rows.set('e4', original);
  });
});
