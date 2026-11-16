/**
 * Real-database checks for Module 32 (Notification Rules), MariaDB via XAMPP. NOT part of `npm test`.
 * Prerequisite: `npm run db:migrate` (creates notification_reminders and notification_exam_audience).
 * Run: npm run test:db. The module references exams and sessions by plain id (no foreign keys), so the tests use random ids and delete everything they created afterwards.
 */
import { randomUUID } from 'node:crypto';
import { QueryTypes } from 'sequelize';
import { afterAll, describe, expect, it } from 'vitest';
import { env } from '../../src/config/env';
import { createSequelize } from '../../src/modules/02-database/public';
import { REMINDER_KINDS, SequelizeRuleStateRepository } from '../../src/modules/32-notification-rules/public';

const sequelize = createSequelize(env.database);
const repo = new SequelizeRuleStateRepository(sequelize);
const subjects: string[] = [];
const exams: string[] = [];
const newSubject = (): string => {
  const id = randomUUID();
  subjects.push(id);
  return id;
};
const newExam = (): string => {
  const id = randomUUID();
  exams.push(id);
  return id;
};
const base = Date.now() - 60_000;
const at = (ms: number) => new Date(base + ms);

afterAll(async () => {
  if (subjects.length > 0) await sequelize.query('DELETE FROM notification_reminders WHERE subject_id IN (:subjects)', { replacements: { subjects } });
  if (exams.length > 0) await sequelize.query('DELETE FROM notification_exam_audience WHERE exam_id IN (:exams)', { replacements: { exams } });
  await sequelize.close();
});

const rowOf = async (subjectId: string, kind: string) =>
  (await sequelize.query<{ state: string; attempts: number; due_at: Date; locked_until: Date | null }>('SELECT state, attempts, due_at, locked_until FROM notification_reminders WHERE subject_id = :subjectId AND kind = :kind', {
    replacements: { subjectId, kind },
    type: QueryTypes.SELECT,
  }))[0];

describe('notification_reminders', () => {
  it('one row per (kind, subject): the same due time changes nothing, a moved due time re-arms the row', async () => {
    const s = newSubject();
    await repo.upsertReminder(REMINDER_KINDS.EXAM_24H, s, at(1000), at(0));
    await repo.upsertReminder(REMINDER_KINDS.EXAM_24H, s, at(1000), at(0));
    const [{ n }] = await sequelize.query<{ n: number }>('SELECT COUNT(*) AS n FROM notification_reminders WHERE subject_id = :s', { replacements: { s }, type: QueryTypes.SELECT });
    expect(Number(n)).toBe(1);
    const [claimed] = await repo.claimDue({ claimId: randomUUID(), now: at(5000), lockUntil: at(65_000), limit: 500 }).then((r) => r.filter((x) => x.subjectId === s));
    await repo.complete(claimed!.id, 'SENT', at(5000));
    await repo.upsertReminder(REMINDER_KINDS.EXAM_24H, s, at(1000), at(6000)); // redelivered event: stays SENT
    expect((await rowOf(s, REMINDER_KINDS.EXAM_24H))?.state).toBe('SENT');
    await repo.upsertReminder(REMINDER_KINDS.EXAM_24H, s, at(9000), at(7000)); // moved: PENDING again
    const re = await rowOf(s, REMINDER_KINDS.EXAM_24H);
    expect(re?.state).toBe('PENDING');
    expect(Number(re?.attempts)).toBe(0);
    expect((await repo.findReminder(REMINDER_KINDS.EXAM_24H, s))?.dueAt.getTime()).toBe(at(9000).getTime());
  });

  it('two concurrent claims never return the same row (the claim is a lock) and a locked row is not claimed again', async () => {
    const mine: string[] = Array.from({ length: 6 }, () => newSubject());
    for (const s of mine) await repo.upsertReminder(REMINDER_KINDS.SESSION_HALF_TIME, s, at(1000), at(0));
    const claim = () => repo.claimDue({ claimId: randomUUID(), now: at(5000), lockUntil: new Date(Date.now() + 60_000), limit: 500 });
    const [a, b] = await Promise.all([claim(), claim()]);
    const ofMine = (rows: Awaited<ReturnType<typeof claim>>) => rows.filter((r) => mine.includes(r.subjectId)).map((r) => r.id);
    const [x, y] = [ofMine(a), ofMine(b)];
    expect(x.filter((id) => y.includes(id))).toEqual([]);
    expect(x.length + y.length).toBe(6);
  });

  it('suppresses only PENDING rows of the subject and the kinds asked, and releases the lock when completed', async () => {
    const s = newSubject();
    await repo.upsertReminder(REMINDER_KINDS.SESSION_HALF_TIME, s, at(1000), at(0));
    await repo.upsertReminder(REMINDER_KINDS.SESSION_EVALUATION, s, at(2000), at(0));
    expect(await repo.suppressPending(s, [REMINDER_KINDS.SESSION_HALF_TIME], at(3000))).toBe(1);
    expect((await rowOf(s, REMINDER_KINDS.SESSION_EVALUATION))?.state).toBe('PENDING');
    expect(await repo.suppressPending(s, [REMINDER_KINDS.SESSION_HALF_TIME], at(4000))).toBe(0);
  });

  it('postpones, retries with a delay and gives up (FAILED) after the last attempt', async () => {
    const s = newSubject();
    await repo.upsertReminder(REMINDER_KINDS.SESSION_EVALUATION, s, at(1000), at(0));
    const [row] = (await repo.claimDue({ claimId: randomUUID(), now: at(5000), lockUntil: new Date(Date.now() + 60_000), limit: 500 })).filter((r) => r.subjectId === s);
    await repo.postpone(row!.id, at(70_000), at(5000));
    expect((await rowOf(s, REMINDER_KINDS.SESSION_EVALUATION))?.state).toBe('PENDING');
    await repo.recordFailure(row!.id, 2, at(80_000), 'temporary', at(6000));
    expect(Number((await rowOf(s, REMINDER_KINDS.SESSION_EVALUATION))?.attempts)).toBe(2);
    await repo.recordFailure(row!.id, 5, null, 'permanent', at(7000));
    expect((await rowOf(s, REMINDER_KINDS.SESSION_EVALUATION))?.state).toBe('FAILED');
  });

  it('rejects an unknown kind or state (CHECK constraints)', async () => {
    const s = newSubject();
    await expect(
      sequelize.query("INSERT INTO notification_reminders (id, kind, subject_id, due_at, state, attempts, created_at, updated_at) VALUES (UUID(), 'NOPE', :s, NOW(3), 'PENDING', 0, NOW(3), NOW(3))", { replacements: { s } }),
    ).rejects.toBeDefined();
    await expect(
      sequelize.query("INSERT INTO notification_reminders (id, kind, subject_id, due_at, state, attempts, created_at, updated_at) VALUES (UUID(), 'EXAM_24H', :s, NOW(3), 'NOPE', 0, NOW(3), NOW(3))", { replacements: { s } }),
    ).rejects.toBeDefined();
  });
});

describe('notification_exam_audience', () => {
  it('replaces by difference (idempotent), adds, removes and clears per exam and role', async () => {
    const e = newExam();
    const [s1, s2, s3] = [randomUUID(), randomUUID(), randomUUID()];
    await repo.replaceExamAudience(e, 'STUDENT', [s1, s2], at(0));
    await repo.replaceExamAudience(e, 'STUDENT', [s2, s3], at(1));
    await repo.replaceExamAudience(e, 'STUDENT', [s2, s3], at(2));
    expect((await repo.listExamAudience(e, 'STUDENT')).sort()).toEqual([s2, s3].sort());
    await repo.addExamAudience(e, 'EXAMINER', s1, at(3));
    await repo.addExamAudience(e, 'EXAMINER', s1, at(3));
    expect(await repo.listExamAudience(e, 'EXAMINER')).toEqual([s1]);
    await repo.removeExamAudience(e, 'STUDENT', s2);
    expect(await repo.listExamAudience(e, 'STUDENT')).toEqual([s3]);
    await repo.clearExamAudience(e);
    expect(await repo.listExamAudience(e, 'STUDENT')).toEqual([]);
    expect(await repo.listExamAudience(e, 'EXAMINER')).toEqual([]);
  });

  it('handles a whole-school sized audience in chunks', async () => {
    const e = newExam();
    const many = Array.from({ length: 450 }, () => randomUUID());
    await repo.replaceExamAudience(e, 'STUDENT', many, at(0));
    expect((await repo.listExamAudience(e, 'STUDENT')).length).toBe(450);
  });

  it('rejects an unknown role (CHECK constraint)', async () => {
    const e = newExam();
    await expect(sequelize.query("INSERT INTO notification_exam_audience (exam_id, role, subject_id, created_at) VALUES (:e, 'PARENT', UUID(), NOW(3))", { replacements: { e } })).rejects.toBeDefined();
  });
});
