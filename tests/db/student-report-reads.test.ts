/**
 * Real-database checks for the two READ-ONLY contracts that the Student report (Module 38, 0.57.0) added to the owning modules: Module 30 `listOutcomesOfStudentForReport` and
 * Module 33 `listForStudentReport`, over MariaDB. NOT part of `npm test`. Prerequisite: `npm run db:migrate`. Run: npm run test:db
 * Everything runs inside ONE outer transaction that is ALWAYS rolled back (random ids, no other table is touched), so it is safe on any database.
 * The new methods have NO migration: they read the existing tables through the existing student indexes (`ix_exam_students_student`, `uq_subscriptions_student_month`).
 */
import { randomUUID } from 'node:crypto';
import { QueryTypes } from 'sequelize';
import { afterAll, describe, expect, it } from 'vitest';
import { env } from '../../src/config/env';
import type { TransactionContext } from '../../src/modules/00-shared-kernel/public';
import { SequelizeUnitOfWork, createSequelize, sequelizeTransactionOf } from '../../src/modules/02-database/public';
import { SequelizeExamRepository } from '../../src/modules/30-exams/public';
import { SequelizeSubscriptionRepository } from '../../src/modules/33-subscriptions/public';

const sequelize = createSequelize(env.database);
const uow = new SequelizeUnitOfWork(sequelize);
const exams = new SequelizeExamRepository(sequelize);
const subscriptions = new SequelizeSubscriptionRepository(sequelize);

class Rollback extends Error {}
afterAll(async () => {
  await sequelize.close();
});

async function inRolledBackTransaction(work: (tx: TransactionContext, run: (sql: string, replacements?: Record<string, unknown>) => Promise<void>) => Promise<void>): Promise<void> {
  try {
    await uow.run(async (tx) => {
      const transaction = sequelizeTransactionOf(tx) ?? null;
      await work(tx, async (sql, replacements = {}) => {
        await sequelize.query(sql, { replacements, transaction, type: QueryTypes.RAW });
      });
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

describe('Module 30: listOutcomesOfStudentForReport (real MariaDB)', () => {
  const insertExam = (run: (sql: string, r?: Record<string, unknown>) => Promise<void>, id: string, school: string, startAt: string, over: { questions?: number; maxScore?: number; deleted?: boolean } = {}) =>
    run(
      `INSERT INTO exams (id, school_id, whole_school, status, start_at, end_at, question_count, max_score, created_by, created_at, updated_at, deleted_at)
       VALUES (:id, :school, 0, 'ENDED', :startAt, NULL, :questions, :maxScore, UUID(), NOW(3), NOW(3), ${over.deleted ? 'NOW(3)' : 'NULL'})`,
      { id, school, startAt: new Date(`${startAt.replace(' ', 'T')}Z`), questions: over.questions ?? 3, maxScore: over.maxScore ?? 10 },
    );
  const target = (run: (sql: string, r?: Record<string, unknown>) => Promise<void>, exam: string, student: string, group: string, status: string) =>
    run("INSERT INTO exam_students (exam_id, student_id, group_id, group_name, full_name, status) VALUES (:exam, :student, :group, 'g', 'n', :status)", { exam, student, group, status });
  const result = async (run: (sql: string, r?: Record<string, unknown>) => Promise<void>, exam: string, school: string, student: string, group: string, scores: number[]) => {
    const id = randomUUID();
    await run(
      'INSERT INTO exam_results (id, exam_id, school_id, group_id, student_id, total_score, examiner_teacher_id, examiner_user_id, recorded_at) VALUES (:id, :exam, :school, :group, :student, :total, UUID(), UUID(), NOW(3))',
      { id, exam, school, group, student, total: scores.reduce((a, b) => a + b, 0) },
    );
    for (const [i, score] of scores.entries()) await run('INSERT INTO exam_result_scores (result_id, question_number, score) VALUES (:id, :n, :score)', { id, n: i + 1, score });
  };

  it('returns the recorded outcomes of ONE student, oldest first, with the stored scores and total; pending, deleted and other students\' rows never', async () => {
    await inRolledBackTransaction(async (tx, run) => {
      const [school, student, other, g1, g2] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
      const [oct, nov1, nov2, pending, deleted, otherGroup] = Array.from({ length: 6 }, () => randomUUID());
      await insertExam(run, oct!, school, '2026-10-05 07:00:00.000');
      await insertExam(run, nov1!, school, '2026-11-02 07:00:00.000');
      await insertExam(run, nov2!, school, '2026-11-09 07:00:00.000', { questions: 2, maxScore: 7.5 });
      await insertExam(run, pending!, school, '2026-11-10 07:00:00.000');
      await insertExam(run, deleted!, school, '2026-11-11 07:00:00.000', { deleted: true });
      await insertExam(run, otherGroup!, school, '2026-11-13 07:00:00.000');
      await target(run, oct!, student, g1, 'EXAMINED');
      await result(run, oct!, school, student, g1, [9, 8, 10]);
      await target(run, nov1!, student, g1, 'ABSENT');
      await target(run, nov2!, student, g1, 'EXAMINED');
      await result(run, nov2!, school, student, g1, [7.5, 6.25]);
      await target(run, pending!, student, g1, 'PENDING');
      await target(run, deleted!, student, g1, 'EXAMINED');
      await target(run, otherGroup!, student, g2, 'ABSENT');
      await target(run, nov1!, other, g1, 'EXAMINED');
      await result(run, nov1!, school, other, g1, [1, 1, 1]);

      const rows = await exams.listOutcomesOfStudentForReport({ studentId: student }, tx);
      expect(rows.map((r) => [r.examId, r.outcome, r.groupId])).toEqual([[oct, 'EXAMINED', g1], [nov1, 'ABSENT', g1], [nov2, 'EXAMINED', g1], [otherGroup, 'ABSENT', g2]]);
      expect(rows[0]).toMatchObject({ schoolId: school, questionCount: 3, maxScore: 10, scores: [9, 8, 10], total: 27 });
      expect(rows[1]).toMatchObject({ scores: [], total: null });
      expect(rows[2]).toMatchObject({ questionCount: 2, maxScore: 7.5, scores: [7.5, 6.25], total: 13.75 });
      expect(rows[0]!.startAt).toBeInstanceOf(Date);
      expect((await exams.listOutcomesOfStudentForReport({ studentId: other }, tx)).map((r) => r.examId)).toEqual([nov1]);
      expect(await exams.listOutcomesOfStudentForReport({ studentId: randomUUID() }, tx)).toEqual([]);

      // period on the exam START (inclusive from, exclusive end) and the group limit
      const ids = async (q: { from?: Date; toExclusive?: Date; groupIds?: string[] }) => (await exams.listOutcomesOfStudentForReport({ studentId: student, ...q }, tx)).map((r) => r.examId);
      expect(await ids({ from: new Date('2026-11-02T07:00:00.000Z') })).toEqual([nov1, nov2, otherGroup]);
      expect(await ids({ toExclusive: new Date('2026-11-02T07:00:00.000Z') })).toEqual([oct]);
      expect(await ids({ groupIds: [g2] })).toEqual([otherGroup]);
      expect(await ids({ groupIds: [g1] })).toEqual([oct, nov1, nov2]);
      expect(await ids({ groupIds: [] })).toEqual([]);
    });
  });
});

describe('Module 33: listForStudentReport (real MariaDB)', () => {
  const insertSub = (run: (sql: string, r?: Record<string, unknown>) => Promise<void>, student: string, month: string, status: 'UNPAID' | 'PAID' | 'WAIVED') =>
    run(
      `INSERT INTO subscriptions (id, student_id, school_id, organization_id, month, status, batch_id, created_by, paid_at, paid_by, waived_at, waived_by, version, created_at, updated_at)
       VALUES (:id, :student, :school, :org, :month, :status, NULL, UUID(), ${status === 'PAID' ? 'UTC_TIMESTAMP(3)' : 'NULL'}, ${status === 'PAID' ? 'UUID()' : 'NULL'}, ${status === 'WAIVED' ? 'UTC_TIMESTAMP(3)' : 'NULL'}, ${status === 'WAIVED' ? 'UUID()' : 'NULL'}, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      { id: randomUUID(), student, school: randomUUID(), org: randomUUID(), month, status },
    );

  it('returns ONE student\'s subscriptions, oldest month first, with the status stored now; month bounds are inclusive', async () => {
    await inRolledBackTransaction(async (tx, run) => {
      const [student, other] = [randomUUID(), randomUUID()];
      await insertSub(run, student, '2026-11', 'UNPAID');
      await insertSub(run, student, '2026-09', 'PAID');
      await insertSub(run, student, '2026-10', 'WAIVED');
      await insertSub(run, other, '2026-10', 'PAID');
      expect(await subscriptions.listForStudentReport({ studentId: student }, tx)).toEqual([{ month: '2026-09', status: 'PAID' }, { month: '2026-10', status: 'WAIVED' }, { month: '2026-11', status: 'UNPAID' }]);
      const months = async (q: { fromMonth?: string; toMonth?: string }) => (await subscriptions.listForStudentReport({ studentId: student, ...q }, tx)).map((r) => r.month);
      expect(await months({ fromMonth: '2026-10' })).toEqual(['2026-10', '2026-11']);
      expect(await months({ toMonth: '2026-10' })).toEqual(['2026-09', '2026-10']);
      expect(await months({ fromMonth: '2026-10', toMonth: '2026-10' })).toEqual(['2026-10']);
      expect(await subscriptions.listForStudentReport({ studentId: randomUUID() }, tx)).toEqual([]);
    });
  });
});
