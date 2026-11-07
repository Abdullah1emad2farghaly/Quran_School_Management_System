/**
 * Real-database checks for Module 30 (Exams): the schema (CHECKs, uniqueness, own foreign keys only), the SQL repository, and the CONCURRENCY and RECOVERY guarantees of the
 * approved decisions, over MariaDB: first-submission-wins, examiner changes racing with submissions, end-time changes racing with the automatic completion, the freeze at STARTED
 * racing with edits, ENDED as a one-way final transition, and a restart / delayed job catching up. NOT part of `npm test`. Prerequisite: `npm run db:migrate`. Run: npm run test:db
 * Safe on any database: the schema and repository tests run in ONE outer transaction that is ALWAYS rolled back; the concurrency tests must COMMIT (other connections have to see
 * the rows), using random identifiers, and remove exactly those rows afterwards (also when they fail).
 */
import { randomUUID } from 'node:crypto';
import { QueryTypes } from 'sequelize';
import { afterAll, describe, expect, it } from 'vitest';
import { env } from '../../src/config/env';
import { FixedClock, type TransactionContext } from '../../src/modules/00-shared-kernel/public';
import { SequelizeUnitOfWork, createSequelize, sequelizeTransactionOf } from '../../src/modules/02-database/public';
import { Exam, ExamResult, ExamService, SequelizeExamRepository, type ExamStatus, type LockMode } from '../../src/modules/30-exams/public';

const sequelize = createSequelize(env.database);
const uow = new SequelizeUnitOfWork(sequelize);
const repo = new SequelizeExamRepository(sequelize);
const clock = new FixedClock(new Date('2026-11-20T08:00:00.000Z'));
const START = new Date('2026-12-01T09:00:00.000Z');
const END = new Date('2026-12-01T11:00:00.000Z');

class Rollback extends Error {}
afterAll(async () => {
  await sequelize.close();
});

interface Fixture {
  tx: TransactionContext;
  q: <T extends object>(sql: string, replacements?: Record<string, unknown>) => Promise<T[]>;
  run: (sql: string, replacements?: Record<string, unknown>) => Promise<void>;
  fails: (sql: string, replacements?: Record<string, unknown>) => Promise<void>;
}
async function withFixture(work: (f: Fixture) => Promise<void>): Promise<void> {
  try {
    await uow.run(async (tx) => {
      const transaction = sequelizeTransactionOf(tx) ?? null;
      const q: Fixture['q'] = (sql, replacements = {}) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction });
      const run: Fixture['run'] = async (sql, replacements = {}) => { await sequelize.query(sql, { replacements, transaction }); };
      let sp = 0;
      const fails: Fixture['fails'] = async (sql, replacements = {}) => {
        const name = `sp_${++sp}`;
        await run(`SAVEPOINT ${name}`);
        await expect(run(sql, replacements)).rejects.toThrow();
        await run(`ROLLBACK TO SAVEPOINT ${name}`);
      };
      await work({ tx, q, run, fails });
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

const newExam = (over: Partial<Parameters<typeof Exam.create>[0]> = {}) =>
  Exam.create({ schoolId: randomUUID(), wholeSchool: false, groupIds: [randomUUID()], startAt: START, endAt: END, questionCount: 3, maxScore: 10, examinerTeacherIds: [randomUUID()], actorId: randomUUID(), clock, ...over });
const EX = `INSERT INTO exams (id, school_id, whole_school, status, start_at, end_at, question_count, max_score, created_by, created_at, updated_at)
            VALUES (:id, UUID(), 0, :status, :startAt, :endAt, :questions, :maxScore, UUID(), NOW(3), NOW(3))`;
const ex = (over: Record<string, unknown> = {}) => ({ id: randomUUID(), status: 'DRAFT', startAt: START, endAt: END, questions: 3, maxScore: 10, ...over });

describe('exams schema (migration create-exams)', () => {
  it('has foreign keys only to its own parent tables, and no history table for results', async () => {
    await withFixture(async ({ q }) => {
      const fks = await q<{ t: string; r: string }>("SELECT TABLE_NAME AS t, REFERENCED_TABLE_NAME AS r FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'exam%' AND REFERENCED_TABLE_NAME IS NOT NULL");
      expect(fks.map((f) => `${f.t}->${f.r}`).sort()).toEqual(['exam_examiners->exams', 'exam_groups->exams', 'exam_result_scores->exam_results', 'exam_results->exams', 'exam_students->exams']);
      const tables = await q<{ n: string }>("SELECT TABLE_NAME AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'exam%'");
      expect(tables.map((t) => t.n).sort()).toEqual(['exam_examiners', 'exam_groups', 'exam_result_scores', 'exam_results', 'exam_students', 'exams']);
    });
  });

  it('exams: status in the six statuses, 1-200 questions, a maximum score above 0 up to 1000, and an end after the start (an end is optional)', async () => {
    await withFixture(async ({ run, fails }) => {
      for (const status of ['DRAFT', 'SCHEDULED', 'STARTED', 'COMPLETED', 'ENDED', 'CANCELLED']) await run(EX, ex({ status }));
      await fails(EX, ex({ status: 'DELETED' }));
      await fails(EX, ex({ status: 'PAUSED' }));
      await fails(EX, ex({ questions: 0 }));
      await fails(EX, ex({ questions: 201 }));
      await run(EX, ex({ questions: 200 }));
      await fails(EX, ex({ maxScore: 0 }));
      await fails(EX, ex({ maxScore: -1 }));
      await fails(EX, ex({ maxScore: 1000.01 }));
      await run(EX, ex({ maxScore: 1000 }));
      await run(EX, ex({ endAt: null }));
      await fails(EX, ex({ endAt: START }));
      await fails(EX, ex({ endAt: new Date(START.getTime() - 1000) }));
    });
  });

  it('children: an examiner is released with a reason or not at all; a target row has a valid status; nothing exists without its exam; an exam with children cannot be deleted', async () => {
    await withFixture(async ({ run, fails }) => {
      const e = ex();
      await run(EX, e);
      const EXR = 'INSERT INTO exam_examiners (exam_id, teacher_id, assigned_at, assigned_by, released_at, release_reason) VALUES (:id, :teacher, NOW(3), UUID(), :releasedAt, :reason)';
      const teacher = randomUUID();
      await run(EXR, { id: e.id, teacher, releasedAt: null, reason: null });
      await fails(EXR, { id: e.id, teacher, releasedAt: null, reason: null }); // the same examiner twice
      await run(EXR, { id: e.id, teacher: randomUUID(), releasedAt: new Date(), reason: 'REMOVED' });
      await run(EXR, { id: e.id, teacher: randomUUID(), releasedAt: new Date(), reason: 'EXAM_ENDED' });
      await fails(EXR, { id: e.id, teacher: randomUUID(), releasedAt: new Date(), reason: null }); // released without a reason
      await fails(EXR, { id: e.id, teacher: randomUUID(), releasedAt: null, reason: 'REMOVED' }); // a reason without a release
      await fails(EXR, { id: e.id, teacher: randomUUID(), releasedAt: new Date(), reason: 'FIRED' });
      await fails(EXR, { id: randomUUID(), teacher: randomUUID(), releasedAt: null, reason: null }); // no such exam
      const ST = "INSERT INTO exam_students (exam_id, student_id, group_id, group_name, full_name, status) VALUES (:id, :student, UUID(), 'g', 'n', :status)";
      const student = randomUUID();
      await run(ST, { id: e.id, student, status: 'PENDING' });
      await fails(ST, { id: e.id, student, status: 'PENDING' });
      await fails(ST, { id: e.id, student: randomUUID(), status: 'MISSING' });
      await fails('DELETE FROM exams WHERE id = :id', { id: e.id });
    });
  });

  it('results: ONE per (exam, student); a score from 0 to 1000 per question number from 1; a total of at least 0; no result without its exam; a result with scores cannot be deleted', async () => {
    await withFixture(async ({ run, fails }) => {
      const e = ex();
      await run(EX, e);
      const R = 'INSERT INTO exam_results (id, exam_id, school_id, group_id, student_id, total_score, examiner_teacher_id, examiner_user_id, recorded_at) VALUES (:id, :exam, UUID(), UUID(), :student, :total, UUID(), UUID(), NOW(3))';
      const result = { id: randomUUID(), exam: e.id, student: randomUUID(), total: 27 };
      await run(R, result);
      await fails(R, { ...result, id: randomUUID() }); // the same student twice
      await fails(R, { id: randomUUID(), exam: e.id, student: randomUUID(), total: -0.01 });
      await fails(R, { id: randomUUID(), exam: randomUUID(), student: randomUUID(), total: 1 });
      const SC = 'INSERT INTO exam_result_scores (result_id, question_number, score) VALUES (:id, :n, :score)';
      await run(SC, { id: result.id, n: 1, score: 8 });
      await run(SC, { id: result.id, n: 2, score: 0 });
      await run(SC, { id: result.id, n: 3, score: 1000 });
      await fails(SC, { id: result.id, n: 3, score: 1 });
      await fails(SC, { id: result.id, n: 4, score: -0.01 });
      await fails(SC, { id: result.id, n: 4, score: 1000.01 });
      await fails(SC, { id: result.id, n: 0, score: 1 });
      await fails(SC, { id: randomUUID(), n: 1, score: 1 });
      await fails('DELETE FROM exam_results WHERE id = :id', { id: result.id });
    });
  });
});

describe('SequelizeExamRepository', () => {
  it('round-trips an exam with its groups and examiners, locks it, saves changes (and rewrites the groups), and a deleted exam is invisible everywhere', async () => {
    await withFixture(async ({ tx }) => {
      const exam = newExam({ groupIds: ['g-b', 'g-a'].map(() => randomUUID()), examinerTeacherIds: [randomUUID(), randomUUID()] });
      await repo.insert(exam, tx);
      const read = (await repo.lockById(exam.snapshot.id, 'UPDATE', tx))!;
      expect(read.snapshot).toMatchObject({ id: exam.snapshot.id, status: 'DRAFT', questionCount: 3, maxScore: 10, wholeSchool: false, deletedAt: null });
      expect([...read.snapshot.groupIds].sort()).toEqual([...exam.snapshot.groupIds].sort());
      expect(read.activeExaminerIds.sort()).toEqual(exam.activeExaminerIds.sort());
      read.updateConfiguration({ wholeSchool: true, questionCount: 9, maxScore: 5.555, endAt: null }, 'u', clock);
      read.schedule('u', clock);
      read.removeExaminer(read.activeExaminerIds[0]!, 'u', clock);
      await repo.save(read, tx);
      const after = (await repo.findById(exam.snapshot.id, tx))!;
      expect(after.snapshot).toMatchObject({ status: 'SCHEDULED', wholeSchool: true, groupIds: [], questionCount: 9, maxScore: 5.56, endAt: null });
      expect(after.snapshot.examiners.filter((e) => e.releasedAt !== null).map((e) => e.releaseReason)).toEqual(['REMOVED']);
      after.markDeleted('u', clock);
      await repo.save(after, tx);
      expect(await repo.findById(exam.snapshot.id, tx)).toBeUndefined();
      expect(await repo.lockById(exam.snapshot.id, 'SHARE', tx)).toBeUndefined();
      expect((await repo.listBySchool(exam.snapshot.schoolId, undefined, { page: 1, pageSize: 10 }, tx)).total).toBe(0);
    });
  });

  it('lists by school (filtered, newest start first), for an examiner (current assignments only), and the Parent schedule (scheduled exams only)', async () => {
    await withFixture(async ({ tx }) => {
      const schoolId = randomUUID();
      const teacher = randomUUID();
      const mk = async (startAt: Date, status: 'DRAFT' | 'SCHEDULED', examiners: string[]) => {
        const e = newExam({ schoolId, startAt, endAt: null, examinerTeacherIds: examiners });
        if (status === 'SCHEDULED') e.schedule('u', clock);
        await repo.insert(e, tx);
        return e.snapshot.id;
      };
      const d1 = await mk(new Date('2026-12-01T09:00:00Z'), 'SCHEDULED', [teacher]);
      const d2 = await mk(new Date('2026-12-03T09:00:00Z'), 'SCHEDULED', []);
      const d3 = await mk(new Date('2026-12-02T09:00:00Z'), 'DRAFT', [teacher]);
      expect((await repo.listBySchool(schoolId, undefined, { page: 1, pageSize: 10 }, tx)).items.map((e) => e.snapshot.id)).toEqual([d2, d3, d1]);
      expect((await repo.listBySchool(schoolId, ['SCHEDULED'], { page: 1, pageSize: 10 }, tx)).items.map((e) => e.snapshot.id)).toEqual([d2, d1]);
      expect((await repo.listBySchool(schoolId, undefined, { page: 2, pageSize: 2 }, tx)).items.map((e) => e.snapshot.id)).toEqual([d1]);
      expect((await repo.listAssignedToTeacher(teacher, ['SCHEDULED', 'STARTED', 'COMPLETED'], { page: 1, pageSize: 10 }, tx)).items.map((e) => e.snapshot.id)).toEqual([d1]); // the DRAFT is excluded
      expect((await repo.listScheduleOfSchools([schoolId], { page: 1, pageSize: 10 }, tx)).items.map((e) => e.snapshot.id)).toEqual([d2, d1]);
      expect((await repo.listScheduleOfSchools([randomUUID()], { page: 1, pageSize: 10 }, tx)).total).toBe(0);
    });
  });

  it('finds the exams due to start (SCHEDULED, start reached) and due to complete (STARTED, end passed, with an end time), in order', async () => {
    await withFixture(async ({ tx }) => {
      const past = new FixedClock(new Date('2019-01-01T00:00:00Z')); // scheduled long ago, so that its start is long past now
      const mk = async (status: ExamStatus, startAt: Date, endAt: Date | null) => {
        const e = newExam({ startAt, endAt });
        e.schedule('u', past);
        if (status === 'STARTED' || status === 'COMPLETED') e.start(new FixedClock(startAt), 0);
        await repo.insert(e, tx);
        return e.snapshot.id;
      };
      const due = await mk('SCHEDULED', new Date('2020-01-01T09:00:00Z'), new Date('2020-01-01T10:00:00Z'));
      const future = await mk('SCHEDULED', new Date('2099-01-01T09:00:00Z'), null);
      const over = await mk('STARTED', new Date('2020-01-01T09:00:00Z'), new Date('2020-01-01T10:00:00Z'));
      const open = await mk('STARTED', new Date('2020-01-01T09:00:00Z'), null);
      const now = new Date('2026-11-20T08:00:00Z');
      const starts = await repo.idsDueToStart(now, 1000, tx);
      expect(starts).toContain(due);
      expect([future, over, open].some((id) => starts.includes(id))).toBe(false);
      const completes = await repo.idsDueToComplete(now, 1000, tx);
      expect(completes).toContain(over);
      expect([due, future, open].some((id) => completes.includes(id))).toBe(false);
    });
  });

  it('target students: marking examined takes a PENDING row once; absent marks the rest; the groups and pending lists follow', async () => {
    await withFixture(async ({ tx }) => {
      const exam = newExam();
      await repo.insert(exam, tx);
      const id = exam.snapshot.id;
      const g1 = randomUUID();
      const g2 = randomUUID();
      const rows = ['a', 'b', 'c'].map((n, i) => ({ examId: id, studentId: randomUUID(), groupId: i < 2 ? g1 : g2, groupName: i < 2 ? 'ب' : 'أ', fullName: `طالب ${n}`, status: 'PENDING' as const }));
      await repo.insertStudents(rows, tx);
      expect(await repo.countStudents(id, tx)).toBe(3);
      expect(await repo.markStudentExamined(id, rows[0]!.studentId, tx)).toEqual({ outcome: 'OK', groupId: g1 });
      expect(await repo.markStudentExamined(id, rows[0]!.studentId, tx)).toEqual({ outcome: 'NOT_PENDING' });
      expect(await repo.markStudentExamined(id, randomUUID(), tx)).toEqual({ outcome: 'MISSING' });
      expect(await repo.listGroupsWithCounts(id, tx)).toEqual([{ groupId: g2, groupName: 'أ', total: 1, pending: 1 }, { groupId: g1, groupName: 'ب', total: 2, pending: 1 }]);
      expect((await repo.listPendingStudents(id, g1, { page: 1, pageSize: 10 }, tx)).items.map((s) => s.studentId)).toEqual([rows[1]!.studentId]);
      expect((await repo.markPendingAbsent(id, tx)).sort()).toEqual([rows[1]!.studentId, rows[2]!.studentId].sort());
      expect((await repo.listAbsentStudents(id, tx)).map((s) => s.groupName)).toEqual(['أ', 'ب']);
      expect(await repo.markPendingAbsent(id, tx)).toEqual([]);
      expect((await repo.listPendingStudents(id, g1, { page: 1, pageSize: 10 }, tx)).total).toBe(0);
    });
  });

  it('results are written once (a second insert answers false), read back with numeric scores in question order, and appear in a student\'s outcomes together with ABSENT, never PENDING', async () => {
    await withFixture(async ({ tx }) => {
      const exam = newExam();
      exam.schedule('u', clock);
      await repo.insert(exam, tx);
      const id = exam.snapshot.id;
      const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()];
      const group = randomUUID();
      await repo.insertStudents([a, b, c].map((s) => ({ examId: id, studentId: s, groupId: group, groupName: 'g', fullName: 'n', status: 'PENDING' as const })), tx);
      await repo.markStudentExamined(id, a, tx);
      const result = ExamResult.create({ examId: id, schoolId: exam.snapshot.schoolId, groupId: group, studentId: a, scores: [8, 9.5, 7.25], maxScore: 10, examinerTeacherId: randomUUID(), examinerUserId: randomUUID(), clock });
      expect(await repo.insertResult(result, tx)).toBe(true);
      const duplicate = ExamResult.create({ examId: id, schoolId: exam.snapshot.schoolId, groupId: group, studentId: a, scores: [1, 1, 1], maxScore: 10, examinerTeacherId: randomUUID(), examinerUserId: randomUUID(), clock });
      expect(await repo.insertResult(duplicate, tx)).toBe(false);
      const [read] = await repo.listResultsOfExam(id, tx);
      expect(read!.scores).toEqual([8, 9.5, 7.25]);
      expect(read!.total).toBe(24.75);
      expect(typeof read!.total).toBe('number');
      await repo.markPendingAbsent(id, tx); // b and c become ABSENT
      const outcomesA = await repo.listOutcomesOfStudent(a, { page: 1, pageSize: 10 }, tx);
      expect(outcomesA.items.map((o) => [o.status, o.result?.total])).toEqual([['EXAMINED', 24.75]]);
      const outcomesB = await repo.listOutcomesOfStudent(b, { page: 1, pageSize: 10 }, tx);
      expect(outcomesB.items.map((o) => [o.status, o.result])).toEqual([['ABSENT', null]]);
      expect((await repo.listOutcomesOfStudent(randomUUID(), { page: 1, pageSize: 10 }, tx)).total).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
// Concurrency and recovery over the REAL database: real exam locks, real repositories, real services. Only Smart Guard, the groups, the teachers and the outbox are small
// stand-ins (they are not what is being proved). A "gate" holds a transaction right after it took the exam lock, so the ORDER of two requests is deterministic.
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pendingAfter = async (p: Promise<unknown>, ms = 400): Promise<boolean> => Promise.race([p.then(() => false, () => false), sleep(ms).then(() => true)]);

class GatedRepository extends SequelizeExamRepository {
  gate: ((mode: LockMode) => Promise<void>) | undefined;
  failNextResultInsert = false;
  async lockById(examId: string, mode: LockMode, tx: TransactionContext) {
    const exam = await super.lockById(examId, mode, tx);
    const g = this.gate;
    if (g) { this.gate = undefined; await g(mode); }
    return exam;
  }
  async insertResult(result: ExamResult, tx: TransactionContext): Promise<boolean> {
    if (this.failNextResultInsert) { this.failNextResultInsert = false; throw new Error('injected failure after the student was marked'); }
    return super.insertResult(result, tx);
  }
}

function createWorld() {
  const schoolId = randomUUID();
  const groupId = randomUUID();
  const students = Array.from({ length: 12 }, () => randomUUID());
  const teachers: string[] = [randomUUID(), randomUUID(), randomUUID()] as string[];
  const users: string[] = teachers.map(() => randomUUID() as string);
  const manager = randomUUID();
  const world = clock;
  const gated = new GatedRepository(sequelize);
  const state = { members: [...students], groupGate: undefined as Promise<void> | undefined, createdExams: [] as string[] };
  const outbox = { publishFrom: async (aggregate: { pullDomainEvents(): unknown[] }) => void aggregate.pullDomainEvents() };
  const build = (repository: SequelizeExamRepository) =>
    new ExamService({
      exams: repository,
      smartGuard: { checkProtectedAction: async () => undefined },
      teachers: { findById: async (id: string) => (teachers.includes(id) ? ({ id, schoolIds: [schoolId] } as never) : undefined), findByUserId: async (userId: string) => { const i = users.indexOf(userId); return i < 0 ? undefined : ({ id: teachers[i], schoolIds: [schoolId] } as never); } },
      groups: {
        listGroupsOfSchool: async () => ({ items: [{ id: groupId, name: 'مجموعة' }], total: 1, page: 1, pageSize: 100 }) as never,
        listStudentsOfGroup: async () => { const members = [...state.members]; await state.groupGate; return { items: members.map((s) => ({ studentId: s, fullName: 'طالب' })), total: members.length, page: 1, pageSize: 100 } as never; },
        findScopeById: async (id: string) => (id === groupId ? ({ id, schoolId, status: 'ACTIVE' } as never) : undefined),
      },
      parents: { findByUserId: async () => undefined, listActiveSchoolIds: async () => [] },
      unitOfWork: uow,
      outbox: outbox as never,
      clock: world,
    });
  const service = build(gated);
  const second = build(new SequelizeExamRepository(sequelize)); // another "process" (a second server instance)
  const create = async (over: { endAt?: Date | null; examiners?: string[] } = {}) => {
    world.set(new Date('2026-11-20T08:00:00.000Z'));
    const exam = await service.createExam(manager, { schoolId, startAt: START, endAt: over.endAt === undefined ? END : over.endAt, questionCount: 3, maxScore: 10, groupIds: [groupId], examinerTeacherIds: over.examiners ?? [teachers[0]!, teachers[1]!] });
    await service.scheduleExam(exam.id, manager);
    state.createdExams.push(exam.id);
    return exam.id;
  };
  const start = async (id: string) => { world.set(new Date(START.getTime() + 1000)); await service.advanceExam(id); };
  const submit = (id: string, student: string, who = 0, scores: number[] = [8, 9, 10], svc: ExamService = service) => svc.submitResult(id, users[who]!, { studentId: student, scores, gps: {} });
  const rows = async (table: string, id: string) => Number((await sequelize.query<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE exam_id = :id`, { replacements: { id }, type: QueryTypes.SELECT }))[0]!.n);
  const status = async (id: string) => (await sequelize.query<{ status: string }>('SELECT status FROM exams WHERE id = :id', { replacements: { id }, type: QueryTypes.SELECT }))[0]!.status;
  const studentStatus = async (id: string, student: string) => (await sequelize.query<{ status: string }>('SELECT status FROM exam_students WHERE exam_id = :id AND student_id = :s', { replacements: { id, s: student }, type: QueryTypes.SELECT }))[0]?.status;
  const cleanup = async () => {
    for (const id of state.createdExams) {
      await sequelize.query('DELETE FROM exam_result_scores WHERE result_id IN (SELECT id FROM exam_results WHERE exam_id = :id)', { replacements: { id } });
      for (const table of ['exam_results', 'exam_students', 'exam_examiners', 'exam_groups']) await sequelize.query(`DELETE FROM ${table} WHERE exam_id = :id`, { replacements: { id } });
      await sequelize.query('DELETE FROM exams WHERE id = :id', { replacements: { id } });
    }
  };
  return { world, gated, state, service, second, create, start, submit, rows, status, studentStatus, cleanup, students, teachers, users, manager, schoolId, groupId };
}

describe('result submission under concurrency (committed rows, cleaned up afterwards)', () => {
  it('two examiners (and then eight parallel requests) submitting the SAME student: exactly one wins, no duplicate, the student is EXAMINED once', async () => {
    const w = createWorld();
    try {
      const id = await w.create();
      await w.start(id);
      const settled = await Promise.allSettled([w.submit(id, w.students[0]!, 0, [1, 2, 3]), w.submit(id, w.students[0]!, 1, [9, 9, 9])]);
      expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(settled.filter((r) => r.status === 'rejected').map((r) => (r as PromiseRejectedResult).reason.code)).toEqual(['EXAM_RESULT_ALREADY_RECORDED']);
      const burst = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => w.submit(id, w.students[1]!, i % 2)));
      expect(burst.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(burst.filter((r) => r.status === 'rejected').every((r) => (r as PromiseRejectedResult).reason.code === 'EXAM_RESULT_ALREADY_RECORDED')).toBe(true);
      expect(await w.rows('exam_results', id)).toBe(2);
      expect(await w.studentStatus(id, w.students[0]!)).toBe('EXAMINED');
    } finally { await w.cleanup(); }
  });

  it('submissions for DIFFERENT students run in parallel (a shared exam lock): all succeed', async () => {
    const w = createWorld();
    try {
      const id = await w.create();
      await w.start(id);
      const settled = await Promise.allSettled(w.students.map((s, i) => w.submit(id, s, i % 2)));
      expect(settled.every((r) => r.status === 'fulfilled')).toBe(true);
      expect(await w.rows('exam_results', id)).toBe(12);
      expect(await w.rows('exam_result_scores', id).catch(() => 0)).toBe(0); // (scores are keyed by result, not exam)
    } finally { await w.cleanup(); }
  });

  it('is atomic on the database: a failure after the student was marked rolls the mark back, the student is PENDING again and no result exists', async () => {
    const w = createWorld();
    try {
      const id = await w.create();
      await w.start(id);
      w.gated.failNextResultInsert = true;
      await expect(w.submit(id, w.students[0]!)).rejects.toThrow('injected failure');
      expect(await w.studentStatus(id, w.students[0]!)).toBe('PENDING');
      expect(await w.rows('exam_results', id)).toBe(0);
      expect((await w.submit(id, w.students[0]!)).studentId).toBe(w.students[0]);
    } finally { await w.cleanup(); }
  });

  it('examiner removal racing with a submission, order 1: a submission holding the exam makes the removal WAIT; after it the removed examiner is refused and the recorded result stays', async () => {
    const w = createWorld();
    try {
      const id = await w.create();
      await w.start(id);
      let release!: () => void;
      w.gated.gate = () => new Promise<void>((resolve) => { release = resolve; });
      const submission = w.submit(id, w.students[0]!, 1);
      await sleep(200);
      const removal = w.service.removeExaminer(id, w.manager, w.teachers[1]!).then(() => 'removed', (e: { code: string }) => e.code);
      expect(await pendingAfter(removal)).toBe(true); // the removal waits for the submission that holds the exam
      release();
      await submission;
      expect(await removal).toBe('removed');
      await expect(w.submit(id, w.students[2]!, 1)).rejects.toMatchObject({ code: 'EXAM_NOT_EXAMINER' });
      expect(await w.rows('exam_results', id)).toBe(1);
    } finally { await w.cleanup(); }
  });

  it('examiner removal racing with a submission, order 2: a removal holding the exam makes the submission WAIT, and the submission is then refused (the permission is gone)', async () => {
    const w = createWorld();
    try {
      const id = await w.create();
      await w.start(id);
      let release!: () => void;
      w.gated.gate = () => new Promise<void>((resolve) => { release = resolve; });
      const removal = w.service.removeExaminer(id, w.manager, w.teachers[1]!);
      await sleep(200);
      const submission = w.submit(id, w.students[0]!, 1).then(() => 'recorded', (e: { code: string }) => e.code);
      expect(await pendingAfter(submission)).toBe(true);
      release();
      await removal;
      expect(await submission).toBe('EXAM_NOT_EXAMINER');
      expect(await w.rows('exam_results', id)).toBe(0);
      expect(await w.studentStatus(id, w.students[0]!)).toBe('PENDING');
    } finally { await w.cleanup(); }
  });

  it('ENDED releases the examiners under the lock: a submission racing with the end is either recorded before it or refused after it, never both', async () => {
    const w = createWorld();
    try {
      const id = await w.create({ endAt: null });
      await w.start(id);
      await w.service.completeExam(id, w.manager);
      const outcomes = await Promise.allSettled([w.service.endExam(id, w.manager), w.submit(id, w.students[0]!, 0)]);
      expect(outcomes[0]!.status).toBe('fulfilled');
      expect(outcomes[1]!.status).toBe('rejected'); // COMPLETED already refuses submissions; ENDED adds the loss of the permission
      expect(await w.rows('exam_results', id)).toBe(0);
    } finally { await w.cleanup(); }
  });
});

describe('lifecycle transitions under concurrency and recovery (committed rows, cleaned up afterwards)', () => {
  it('end-time change racing with the automatic completion, order 1: the completion holds the exam, the change WAITS and is then refused (COMPLETED cannot be extended)', async () => {
    const w = createWorld();
    try {
      const id = await w.create();
      await w.start(id);
      w.world.set(new Date(END.getTime() + 1000));
      let release!: () => void;
      w.gated.gate = () => new Promise<void>((resolve) => { release = resolve; });
      const completion = w.service.advanceExam(id);
      await sleep(200);
      const change = w.second.changeEndTime(id, w.manager, new Date(END.getTime() + 3_600_000)).then(() => 'changed', (e: { code: string }) => e.code);
      expect(await pendingAfter(change)).toBe(true);
      release();
      expect((await completion).completed).toBe(true);
      expect(await change).toMatch(/EXAM_LOCKED|EXAM_END_TIME_NOT_EDITABLE/);
      expect(await w.status(id)).toBe('COMPLETED');
    } finally { await w.cleanup(); }
  });

  it('end-time change racing with the automatic completion, order 2: the change holds the exam and moves the end into the future, so the completion that was due re-checks and does NOT complete', async () => {
    const w = createWorld();
    try {
      const id = await w.create();
      await w.start(id);
      w.world.set(new Date(END.getTime() + 1000));
      let release!: () => void;
      w.gated.gate = () => new Promise<void>((resolve) => { release = resolve; });
      const change = w.service.changeEndTime(id, w.manager, new Date(END.getTime() + 3_600_000));
      await sleep(200);
      const completion = w.second.advanceExam(id);
      expect(await pendingAfter(completion)).toBe(true);
      release();
      await change;
      expect((await completion).completed).toBe(false);
      expect(await w.status(id)).toBe('STARTED');
      expect(await w.studentStatus(id, w.students[0]!)).toBe('PENDING'); // nobody was marked absent
    } finally { await w.cleanup(); }
  });

  it('the freeze at STARTED racing with an edit: the start holds the exam, the edit WAITS and is then refused (locked), and the frozen list is the one read at the start', async () => {
    const w = createWorld();
    try {
      const id = await w.create();
      w.world.set(new Date(START.getTime() + 1000));
      let releaseGroups!: () => void;
      w.state.groupGate = new Promise<void>((resolve) => { releaseGroups = resolve; });
      const start = w.service.advanceExam(id); // takes the exam lock, then waits while reading the groups' students
      await sleep(300);
      const edit = w.second.updateExam(id, w.manager, { questionCount: 9 }).then(() => 'edited', (e: { code: string }) => e.code);
      expect(await pendingAfter(edit)).toBe(true);
      w.state.members.push(randomUUID()); // a student joins the group while the freeze is in progress: the list was already read
      releaseGroups();
      expect((await start).started).toBe(true);
      expect(await edit).toBe('EXAM_CONFIG_LOCKED');
      expect(await w.rows('exam_students', id)).toBe(12);
    } finally { await w.cleanup(); }
  });

  it('membership changes before the start are picked up at the freeze; changes after it never touch the frozen list', async () => {
    const w = createWorld();
    try {
      const id = await w.create();
      const joined = randomUUID();
      w.state.members.push(joined);
      w.state.members.shift(); // one leaves, one joins, before STARTED
      await w.start(id);
      expect(await w.studentStatus(id, joined)).toBe('PENDING');
      expect(await w.studentStatus(id, w.students[0]!)).toBeUndefined();
      const late = randomUUID();
      w.state.members.push(late);
      w.state.members.pop(); w.state.members.shift();
      await w.service.advanceExam(id);
      expect(await w.studentStatus(id, late)).toBeUndefined(); // joined after STARTED: not in the exam
      expect(await w.studentStatus(id, w.students[1]!)).toBe('PENDING'); // left the group after STARTED: still in the exam
      expect(await w.rows('exam_students', id)).toBe(12);
    } finally { await w.cleanup(); }
  });

  it('ENDED is one-way and happens once: five parallel end requests give exactly one success, and the examiners are released once', async () => {
    const w = createWorld();
    try {
      const id = await w.create({ endAt: null });
      await w.start(id);
      await w.service.completeExam(id, w.manager);
      const settled = await Promise.allSettled(Array.from({ length: 5 }, () => w.service.endExam(id, w.manager)));
      expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(settled.filter((r) => r.status === 'rejected').every((r) => (r as PromiseRejectedResult).reason.code === 'EXAM_INVALID_TRANSITION')).toBe(true);
      expect(await w.status(id)).toBe('ENDED');
      const released = await sequelize.query<{ n: number }>("SELECT COUNT(*) AS n FROM exam_examiners WHERE exam_id = :id AND released_at IS NOT NULL AND release_reason = 'EXAM_ENDED'", { replacements: { id }, type: QueryTypes.SELECT });
      expect(Number(released[0]!.n)).toBe(2);
      await expect(w.service.completeExam(id, w.manager)).rejects.toMatchObject({ code: 'EXAM_INVALID_TRANSITION' }); // never back
    } finally { await w.cleanup(); }
  });

  it('a restart or delayed job catches up: an exam whose start AND end passed while the server was down is started and completed in ONE pass, by two servers at once, exactly once', async () => {
    const w = createWorld();
    try {
      const id = await w.create();
      w.world.set(new Date('2026-12-09T00:00:00.000Z')); // the server was down
      const passes = await Promise.all([w.service.runCycle(), w.second.runCycle()]);
      expect(passes.map((p) => p.failed)).toEqual([0, 0]);
      expect(passes.reduce((n, p) => n + p.started, 0)).toBe(1);
      expect(passes.reduce((n, p) => n + p.completed, 0)).toBe(1);
      expect(await w.status(id)).toBe('COMPLETED');
      expect(await w.rows('exam_students', id)).toBe(12);
      const absent = await sequelize.query<{ n: number }>("SELECT COUNT(*) AS n FROM exam_students WHERE exam_id = :id AND status = 'ABSENT'", { replacements: { id }, type: QueryTypes.SELECT });
      expect(Number(absent[0]!.n)).toBe(12); // nobody could be examined; nobody got a score
      expect(await w.rows('exam_results', id)).toBe(0);
      expect(await w.service.runCycle()).toEqual({ started: 0, completed: 0, failed: 0 });
      expect(await w.status(id)).toBe('COMPLETED'); // never ENDED automatically
    } finally { await w.cleanup(); }
  });
});
