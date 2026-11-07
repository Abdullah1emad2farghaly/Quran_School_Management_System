import { beforeEach, describe, expect, it } from 'vitest';
import { EvaluationEventTypes } from '../../../src/modules/29-evaluations/public';
import { MemorizationEventTypes } from '../../../src/modules/27-memorization/public';
import { RevisionEventTypes } from '../../../src/modules/28-revision/public';
import { createRulesHarness, ids, type RulesHarness } from '../../helpers/notification-rules-harness';

let w: RulesHarness;
beforeEach(() => {
  w = createRulesHarness();
});

const assignment = (studentId: string | null) => ({ assignmentId: '00000000-0000-4000-8000-0000000000aa', groupId: ids.group1, schoolId: ids.school, studentId, definedInSessionId: ids.session });

describe('student assignment change notifications', () => {
  it('an individual assignment change tells only the parent of that student', async () => {
    await w.deliver(MemorizationEventTypes.ASSIGNMENT_MODIFIED, assignment(ids.studentB));
    expect(w.allNotifications()).toHaveLength(1);
    expect(w.notificationsOf(ids.parentB)).toHaveLength(1);
    expect(w.notificationsOf(ids.parentB)[0]?.type).toBe('MEMORIZATION_ASSIGNMENT_MODIFIED');
    expect(w.notificationsOf(ids.parentA)).toHaveLength(0);
  });
  it('the Teacher who made the change (or any Teacher) is not notified', async () => {
    await w.deliver(RevisionEventTypes.ASSIGNMENT_CANCELLED, { ...assignment(ids.studentA), actorUserId: ids.teacherUser1 });
    expect(w.notificationsOf(ids.teacherUser1)).toHaveLength(0);
    expect(w.notificationsOf(ids.parentA)).toHaveLength(1);
    expect(w.notificationsOf(ids.parentA)[0]?.type).toBe('REVISION_ASSIGNMENT_CANCELLED');
  });
  it('a shared GROUP assignment tells the parent of every current student, one notification per child with that child’s name only', async () => {
    await w.deliver(MemorizationEventTypes.ASSIGNMENT_DEFINED, assignment(null));
    const a = w.notificationsOf(ids.parentA);
    expect(a).toHaveLength(2); // two children of parent A
    expect(a.some((n) => n.body.includes('Ali Ahmed'))).toBe(true);
    expect(a.some((n) => n.body.includes('Amal Ahmed'))).toBe(true);
    expect(a.some((n) => n.body.includes('Bilal'))).toBe(false); // never another child
    const b = w.notificationsOf(ids.parentB);
    expect(b).toHaveLength(1);
    expect(b[0]?.body).not.toContain('Ali');
  });
  it('is idempotent on redelivery', async () => {
    const event = await w.deliver(MemorizationEventTypes.ASSIGNMENT_DEFINED, assignment(ids.studentA));
    await w.redeliver(event);
    expect(w.notificationsOf(ids.parentA)).toHaveLength(1);
  });
});

const recorded = (extra: Record<string, unknown> = {}) => ({
  evaluationId: '00000000-0000-4000-8000-0000000000ee',
  sessionId: ids.session,
  studentId: ids.studentA,
  schoolId: ids.school,
  scores: [
    { category: 'MEMORIZATION', score: 9 },
    { category: 'REVISION', score: 8.5 },
    { category: 'TAJWEED', score: 7.25 },
  ],
  ...extra,
});

describe('evaluation notifications to parents', () => {
  it('shows the scores, the total, the assignment and the Teacher note, to the linked parent only', async () => {
    w.sessions.texts.set(`${ids.session}|${ids.studentA}`, { memorization: '2:5 → 2:10', revision: '1:1 → 1:7' });
    await w.deliver(EvaluationEventTypes.RECORDED, recorded({ note: 'Excellent effort' }));
    const [n] = w.notificationsOf(ids.parentA);
    expect(w.allNotifications()).toHaveLength(1);
    expect(n?.body).toContain('Memorization: 9 (2:5 → 2:10)');
    expect(n?.body).toContain('Revision: 8.5 (1:1 → 1:7)');
    expect(n?.body).toContain('Tajweed: 7.25');
    expect(n?.body).not.toContain('Performance');
    expect(n?.body).toContain('Total: 24.75');
    expect(n?.body).toContain('Teacher note: Excellent effort');
    expect(w.notificationsOf(ids.parentB)).toHaveLength(0);
  });
  it('omits the note line when there is no note (and for a blank note)', async () => {
    await w.deliver(EvaluationEventTypes.RECORDED, recorded());
    await w.deliver(EvaluationEventTypes.RECORDED, recorded({ note: '   ' }));
    for (const n of w.notificationsOf(ids.parentA)) expect(n.body).not.toContain('note');
  });
  it('an update carries the CURRENT scores only, never a superseded value and no note', async () => {
    await w.deliver(EvaluationEventTypes.SCORES_UPDATED, recorded({ scores: [{ category: 'MEMORIZATION', score: 10 }], note: 'must not appear', previousScores: [{ category: 'MEMORIZATION', score: 3 }] }));
    const [n] = w.notificationsOf(ids.parentA);
    expect(n?.type).toBe('EVALUATION_UPDATED');
    expect(n?.body).toContain('Memorization: 10');
    expect(n?.body).toContain('Total: 10');
    expect(n?.body).not.toContain('must not appear');
    expect(n?.body).not.toContain('3');
  });
  it('leaves the assignment out (never invents it) when it cannot be read', async () => {
    w.sessions.failTexts = true;
    await w.deliver(EvaluationEventTypes.RECORDED, recorded());
    expect(w.notificationsOf(ids.parentA)[0]?.body).toContain('Memorization: 9');
    expect(w.notificationsOf(ids.parentA)[0]?.body).not.toContain('(');
  });
  it('every linked parent is told, once; redelivery creates nothing', async () => {
    w.students.map.set(ids.studentA, { id: ids.studentA, fullName: 'Ali Ahmed', schoolId: ids.school, parentUserIds: [ids.parentA, ids.parentA2] });
    const event = await w.deliver(EvaluationEventTypes.RECORDED, recorded());
    await w.redeliver(event);
    expect(w.notificationsOf(ids.parentA)).toHaveLength(1);
    expect(w.notificationsOf(ids.parentA2)).toHaveLength(1);
  });
  it('ignores an evaluation without a known category or a missing student', async () => {
    await w.deliver(EvaluationEventTypes.RECORDED, recorded({ scores: [{ category: 'UNKNOWN', score: 5 }] }));
    await w.deliver(EvaluationEventTypes.RECORDED, recorded({ studentId: '00000000-0000-4000-8000-0000000000ff' }));
    expect(w.allNotifications()).toHaveLength(0);
  });
});
