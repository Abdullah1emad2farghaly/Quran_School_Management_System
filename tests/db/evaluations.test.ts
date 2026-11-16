/**
 * Real-database checks for Module 29 (Evaluations): the schema of `evaluations` and `evaluation_scores` (one evaluation per session + student, the CHECK constraints, the
 * NULL-safe assignment association, the note rules, no foreign key to another module, no history table), the SQL repository, and the CONCURRENCY guarantee of the approved
 * cross-module rule: a student marked ABSENT cannot be evaluated and an evaluated student cannot be marked ABSENT, also when both requests arrive at the same time.
 * NOT part of `npm test`. Prerequisite: `npm run db:migrate`. Run: npm run test:db
 * Safe on any database: the schema and repository tests run in ONE outer transaction that is ALWAYS rolled back; the concurrency tests must COMMIT (other connections have to
 * see the rows), using random identifiers, and remove exactly those rows afterwards (also when they fail). Nothing else is read or changed.
 */
import { randomUUID } from 'node:crypto';
import { QueryTypes } from 'sequelize';
import { afterAll, describe, expect, it } from 'vitest';
import { env } from '../../src/config/env';
import { FixedClock, type TransactionContext } from '../../src/modules/00-shared-kernel/public';
import { SequelizeUnitOfWork, createSequelize, sequelizeTransactionOf } from '../../src/modules/02-database/public';
import { ClassSessionService, SequelizeClassSessionRepository } from '../../src/modules/24-sessions/public';
import { AttendanceService, SequelizeAttendanceRepository } from '../../src/modules/26-attendance/public';
import { Evaluation, EvaluationService, SequelizeEvaluationRepository } from '../../src/modules/29-evaluations/public';

const sequelize = createSequelize(env.database);
const uow = new SequelizeUnitOfWork(sequelize);
const repo = new SequelizeEvaluationRepository(sequelize);
const clock = new FixedClock(new Date('2026-11-02T16:30:00.000Z'));

class Rollback extends Error {}
afterAll(async () => {
  await sequelize.close();
});

const score = (category: 'MEMORIZATION' | 'REVISION' | 'PERFORMANCE' | 'TAJWEED', value: number, mem: string | null, rev: string | null) => ({ category, score: value, memorizationAssignmentId: mem, revisionAssignmentId: rev });
const newEvaluation = (over: Partial<Parameters<typeof Evaluation.create>[0]> = {}) => {
  const mem = randomUUID();
  return Evaluation.create({
    sessionId: randomUUID(), schoolId: randomUUID(), groupId: randomUUID(), studentId: randomUUID(), occurrenceDate: '2026-11-02', scheduledStart: new Date('2026-11-02T16:00:00.000Z'), note: 'ممتاز',
    scores: [score('MEMORIZATION', 8.5, mem, null), score('PERFORMANCE', 9, mem, null), score('TAJWEED', 7.75, mem, null)], actorUserId: randomUUID(), clock, ...over,
  });
};

interface Fixture {
  tx: TransactionContext;
  q: <T extends object>(sql: string, replacements?: Record<string, unknown>) => Promise<T[]>;
  run: (sql: string, replacements?: Record<string, unknown>) => Promise<void>;
  /** The statement must fail (constraint); the transaction stays usable (savepoint). */
  fails: (sql: string, replacements?: Record<string, unknown>) => Promise<void>;
}

async function withFixture(work: (f: Fixture) => Promise<void>): Promise<void> {
  try {
    await uow.run(async (tx) => {
      const transaction = sequelizeTransactionOf(tx) ?? null;
      const q: Fixture['q'] = (sql, replacements = {}) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction });
      const run: Fixture['run'] = async (sql, replacements = {}) => {
        await sequelize.query(sql, { replacements, transaction });
      };
      let sp = 0;
      const fails: Fixture['fails'] = async (sql, replacements = {}) => {
        const name = `sp_${++sp}`;
        await run(`SAVEPOINT ${name}`);
        await expect(run(sql, replacements)).rejects.toThrow();
        await run(`ROLLBACK TO SAVEPOINT ${name}`);
      };
      // The checks below prove that the DATABASE refuses an over-length note. That needs a STRICT sql_mode: a non-strict server (for example the XAMPP defaults) silently truncates an
      // over-long value to the column size instead of raising an error. The test therefore pins strict mode for its own session and restores the previous mode afterwards, so it gives the
      // same answer on any server configuration. (The application validates the length itself before it ever reaches the database.)
      const [{ mode }] = await q<{ mode: string }>('SELECT @@SESSION.sql_mode AS mode');
      await run("SET SESSION sql_mode = CONCAT_WS(',', @@SESSION.sql_mode, 'STRICT_TRANS_TABLES')");
      try {
        await work({ tx, q, run, fails });
      } finally {
        await run('SET SESSION sql_mode = :mode', { mode }).catch(() => undefined);
      }
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

const EV = `INSERT INTO evaluations (id, session_id, school_id, group_id, student_id, occurrence_date, scheduled_start, note, recorded_by, recorded_at, updated_by, updated_at)
            VALUES (:id, :sessionId, UUID(), UUID(), :studentId, '2026-11-02', NOW(3), :note, UUID(), NOW(3), UUID(), NOW(3))`;
const ev = (over: Record<string, unknown> = {}) => ({ id: randomUUID(), sessionId: randomUUID(), studentId: randomUUID(), note: null, ...over });
const SC = 'INSERT INTO evaluation_scores (evaluation_id, category, score, memorization_assignment_id, revision_assignment_id) VALUES (:evaluationId, :category, :score, :mem, :rev)';
const sc = (evaluationId: string, over: Record<string, unknown> = {}) => ({ evaluationId, category: 'MEMORIZATION', score: 8, mem: randomUUID(), rev: null, ...over });

describe('evaluations schema (migration create-evaluations)', () => {
  it('has no foreign key to another module\'s table, and no history/audit table exists', async () => {
    await withFixture(async ({ q }) => {
      const fks = await q<{ t: string; r: string }>("SELECT TABLE_NAME AS t, REFERENCED_TABLE_NAME AS r FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('evaluations', 'evaluation_scores') AND REFERENCED_TABLE_NAME IS NOT NULL");
      expect(fks).toEqual([{ t: 'evaluation_scores', r: 'evaluations' }]); // only the module's own parent table
      const tables = await q<{ n: string }>("SELECT TABLE_NAME AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'evaluation%'");
      expect(tables.map((t) => t.n).sort()).toEqual(['evaluation_scores', 'evaluations']);
    });
  });

  it('allows ONE evaluation per session + student; another student, or the same student in another session, is fine', async () => {
    await withFixture(async ({ run, fails }) => {
      const e = ev();
      await run(EV, e);
      await fails(EV, ev({ sessionId: e.sessionId, studentId: e.studentId }));
      await run(EV, ev({ sessionId: e.sessionId }));
      await run(EV, ev({ studentId: e.studentId }));
    });
  });

  it('the note is optional, never blank and at most 200 characters (a NULL passes ONLY because the note is optional)', async () => {
    await withFixture(async ({ run, fails }) => {
      await run(EV, ev({ note: null }));
      await run(EV, ev({ note: 'ب'.repeat(200) }));
      await fails(EV, ev({ note: '' }));
      await fails(EV, ev({ note: '   ' }));
      await fails(EV, ev({ note: 'ب'.repeat(201) }));
    });
  });

  it('a score is from 0.00 to 10.00, two decimals, one per category per evaluation, in the four categories only', async () => {
    await withFixture(async ({ run, fails, q }) => {
      const e = ev();
      await run(EV, e);
      await run(SC, sc(e.id, { category: 'MEMORIZATION', score: 0 }));
      await run(SC, sc(e.id, { category: 'PERFORMANCE', score: 10 }));
      await fails(SC, sc(e.id, { category: 'TAJWEED', score: -0.01 }));
      await fails(SC, sc(e.id, { category: 'TAJWEED', score: 10.01 }));
      await fails(SC, sc(e.id, { category: 'MEMORIZATION', score: 5 })); // the same category twice
      await fails(SC, sc(e.id, { category: 'SPEED', score: 5 }));
      await run(SC, sc(e.id, { category: 'TAJWEED', score: 7.75 }));
      expect((await q<{ score: string }>("SELECT score FROM evaluation_scores WHERE evaluation_id = :id AND category = 'TAJWEED'", { id: e.id }))[0]!.score).toBe('7.75');
    });
  });

  it('the assignment association cannot pass by accident on a NULL: Memorization needs its memorization assignment (and no revision one), Revision the reverse, Performance and Tajweed at least one', async () => {
    await withFixture(async ({ run, fails }) => {
      const e = ev();
      await run(EV, e);
      const M = randomUUID();
      const R = randomUUID();
      await fails(SC, sc(e.id, { category: 'MEMORIZATION', mem: null, rev: null }));
      await fails(SC, sc(e.id, { category: 'MEMORIZATION', mem: null, rev: R }));
      await fails(SC, sc(e.id, { category: 'MEMORIZATION', mem: M, rev: R }));
      await fails(SC, sc(e.id, { category: 'REVISION', mem: null, rev: null }));
      await fails(SC, sc(e.id, { category: 'REVISION', mem: M, rev: null }));
      await fails(SC, sc(e.id, { category: 'PERFORMANCE', mem: null, rev: null }));
      await fails(SC, sc(e.id, { category: 'TAJWEED', mem: null, rev: null }));
      await run(SC, sc(e.id, { category: 'MEMORIZATION', mem: M, rev: null }));
      await run(SC, sc(e.id, { category: 'REVISION', mem: null, rev: R }));
      await run(SC, sc(e.id, { category: 'PERFORMANCE', mem: M, rev: R }));
      await run(SC, sc(e.id, { category: 'TAJWEED', mem: null, rev: R }));
    });
  });

  it('a score cannot exist without its evaluation, and an evaluation with scores cannot be deleted (never deleted)', async () => {
    await withFixture(async ({ run, fails }) => {
      await fails(SC, sc(randomUUID()));
      const e = ev();
      await run(EV, e);
      await run(SC, sc(e.id));
      await fails('DELETE FROM evaluations WHERE id = :id', { id: e.id });
    });
  });
});

describe('SequelizeEvaluationRepository', () => {
  it('inserts an evaluation with its scores once (a second insert for the same session + student answers false), and reads it back with numeric scores in the category order', async () => {
    await withFixture(async ({ tx }) => {
      const e = newEvaluation();
      expect(await repo.insertIfAbsent(e, tx)).toBe(true);
      const again = newEvaluation({ sessionId: e.snapshot.sessionId, studentId: e.snapshot.studentId });
      expect(await repo.insertIfAbsent(again, tx)).toBe(false);
      const [read] = await repo.listBySession(e.snapshot.sessionId, tx);
      expect(read!.snapshot).toMatchObject({ id: e.snapshot.id, studentId: e.snapshot.studentId, occurrenceDate: '2026-11-02', note: 'ممتاز' });
      expect(read!.snapshot.scores.map((s) => [s.category, s.score])).toEqual([['MEMORIZATION', 8.5], ['PERFORMANCE', 9], ['TAJWEED', 7.75]]);
      expect(typeof read!.snapshot.scores[0]!.score).toBe('number');
    });
  });

  it('saveScores overwrites the scores and who/when and NEVER touches the note; no previous value remains anywhere', async () => {
    await withFixture(async ({ tx, q }) => {
      const e = newEvaluation();
      await repo.insertIfAbsent(e, tx);
      const [locked] = await repo.lockBySessionAndStudents(e.snapshot.sessionId, [e.snapshot.studentId], tx);
      const changed = locked!.changeScores({ scores: [{ category: 'TAJWEED', score: 4 }, { category: 'MEMORIZATION', score: 9.25 }], actorUserId: randomUUID(), clock });
      expect(changed.sort()).toEqual(['MEMORIZATION', 'TAJWEED']);
      await repo.saveScores(locked!, tx);
      const [after] = await repo.listBySession(e.snapshot.sessionId, tx);
      expect(after!.snapshot.scores.map((s) => s.score)).toEqual([9.25, 9, 4]);
      expect(after!.snapshot.note).toBe('ممتاز');
      expect(await q('SELECT 1 AS x FROM evaluation_scores WHERE evaluation_id = :id AND score IN (8.5, 7.75)', { id: e.snapshot.id })).toEqual([]);
      expect((await q<{ n: number }>('SELECT COUNT(*) AS n FROM evaluation_scores WHERE evaluation_id = :id', { id: e.snapshot.id }))[0]!.n).toBe(3);
    });
  });

  it('locks and finds only the evaluations of the given students in the session', async () => {
    await withFixture(async ({ tx }) => {
      const a = newEvaluation();
      const b = newEvaluation({ sessionId: a.snapshot.sessionId });
      await repo.insertIfAbsent(a, tx);
      await repo.insertIfAbsent(b, tx);
      expect((await repo.lockBySessionAndStudents(a.snapshot.sessionId, [a.snapshot.studentId, randomUUID()], tx)).map((e) => e.snapshot.studentId)).toEqual([a.snapshot.studentId]);
      expect((await repo.lockEvaluatedStudentIds(a.snapshot.sessionId, [a.snapshot.studentId, b.snapshot.studentId, randomUUID()], tx)).sort()).toEqual([a.snapshot.studentId, b.snapshot.studentId].sort());
      expect(await repo.lockEvaluatedStudentIds(a.snapshot.sessionId, [], tx)).toEqual([]);
    });
  });

  it('lists a student\'s evaluations by the session start, newest first by default, paged', async () => {
    await withFixture(async ({ tx }) => {
      const studentId = randomUUID();
      const days = ['2026-11-02', '2026-11-09', '2026-11-16'];
      for (const d of days) await repo.insertIfAbsent(newEvaluation({ studentId, occurrenceDate: d, scheduledStart: new Date(`${d}T16:00:00.000Z`) }), tx);
      const all = await repo.listByStudent(studentId, 'desc', { page: 1, pageSize: 10 }, tx);
      expect(all.total).toBe(3);
      expect(all.items.map((e) => e.snapshot.occurrenceDate)).toEqual([...days].reverse());
      expect((await repo.listByStudent(studentId, 'asc', { page: 2, pageSize: 2 }, tx)).items.map((e) => e.snapshot.occurrenceDate)).toEqual([days[2]]);
      expect((await repo.listByStudent(randomUUID(), 'desc', { page: 1, pageSize: 10 }, tx)).total).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The cross-module concurrency guarantee, over the REAL database: real session row lock, real attendance and evaluation repositories, real services. Only Smart Guard, the
// roster, the assignments and the outbox are small stand-ins (they are not what is being proved).
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pendingAfter = async (p: Promise<unknown>, ms = 400): Promise<boolean> => Promise.race([p.then(() => false, () => false), sleep(ms).then(() => true)]);

function createWorld() {
  const teacherId = randomUUID();
  const teacherUserId = randomUUID();
  const managerUserId = randomUUID();
  const schoolId = randomUUID();
  const groupId = randomUUID();
  const sessionId = randomUUID();
  const memId = randomUUID();
  const gates = { evaluationAfterLock: undefined as Promise<void> | undefined, attendanceAfterLock: undefined as Promise<void> | undefined };
  const sessionService = new ClassSessionService({ sessions: new SequelizeClassSessionRepository(sequelize), schedule: {} as never, teachers: {} as never, unitOfWork: uow, outbox: {} as never, clock });
  const sessionsFor = (gate: () => Promise<void> | undefined) => ({
    getSession: (id: string, tx?: TransactionContext) => sessionService.getSession(id, tx),
    findGroupIdOf: (id: string) => sessionService.findGroupIdOf(id),
    lockSession: async (id: string, tx: TransactionContext) => { const locked = await sessionService.lockSession(id, tx); await gate(); return locked; },
  });
  const outbox = { publishFrom: async (aggregate: { pullDomainEvents(): unknown[] }) => void aggregate.pullDomainEvents() };
  const smartGuard = { check: async (input: { teacherId: string; sessionId: string }) => ({ sessionId: input.sessionId, schoolId, groupId, teacherId: input.teacherId }) };
  const teachers = { findByUserId: async (userId: string) => (userId === teacherUserId ? { id: teacherId } : undefined) as never };
  const groups = { listAssignmentHistoryOfStudent: async () => [{ groupId, unassignedAt: null }] as never, listStudentsOfGroup: async () => ({ items: [], total: 0 }) as never };
  const schools = { isSchoolManager: async (userId: string) => userId === managerUserId };
  const evaluationRepo = repo;
  const holder: { evaluations?: EvaluationService } = {};
  const attendance = new AttendanceService({
    attendance: new SequelizeAttendanceRepository(sequelize), sessions: sessionsFor(() => gates.attendanceAfterLock), smartGuard, teachers, groups, schools, unitOfWork: uow, outbox: outbox as never, clock,
    evaluationGuard: { findEvaluatedStudents: (s, ids, tx) => holder.evaluations!.findEvaluatedStudents(s, ids, tx) },
  });
  const evaluations = new EvaluationService({
    evaluations: evaluationRepo, sessions: sessionsFor(() => gates.evaluationAfterLock), smartGuard, teachers, groups, schools, attendance,
    memorization: { getScheduledMemorization: async () => ({ assignments: [{ id: memId, studentId: null }] }) as never }, revision: { getScheduledRevision: async () => ({ assignments: [] }) as never }, unitOfWork: uow, outbox: outbox as never, clock,
  });
  holder.evaluations = evaluations;
  const GPS = { latitude: 30.0444, longitude: 31.2357, accuracyMeters: 8 };
  const MEM3 = [{ category: 'MEMORIZATION', score: 8 }, { category: 'PERFORMANCE', score: 9 }, { category: 'TAJWEED', score: 7 }];
  const create = async () => {
    await sequelize.query(
      `INSERT INTO class_sessions (id, school_id, group_id, teacher_id, slot_id, occurrence_date, scheduled_start, scheduled_end, status, created_at, started_at)
       VALUES (:sessionId, :schoolId, :groupId, :teacherId, UUID(), '2026-11-02', '2026-11-02 16:00:00.000', '2026-11-02 17:00:00.000', 'IN_PROGRESS', NOW(3), '2026-11-02 16:00:00.000')`,
      { replacements: { sessionId, schoolId, groupId, teacherId } },
    );
  };
  const cleanup = async () => {
    await sequelize.query('DELETE FROM evaluation_scores WHERE evaluation_id IN (SELECT id FROM evaluations WHERE session_id = :sessionId)', { replacements: { sessionId } });
    await sequelize.query('DELETE FROM evaluations WHERE session_id = :sessionId', { replacements: { sessionId } });
    await sequelize.query('DELETE FROM attendance_correction_history WHERE session_id = :sessionId', { replacements: { sessionId } });
    await sequelize.query('DELETE FROM attendance_records WHERE session_id = :sessionId', { replacements: { sessionId } });
    await sequelize.query('DELETE FROM class_sessions WHERE id = :sessionId', { replacements: { sessionId } });
  };
  const evaluate = (studentId: string) => evaluations.recordEvaluations(sessionId, teacherUserId, { gps: GPS, records: [{ studentId, scores: MEM3 }] });
  const markAbsent = (studentId: string) => attendance.setStudentAttendanceByManager(sessionId, studentId, managerUserId, { status: 'ABSENT', reason: 'غياب' });
  const markPresent = (studentId: string) => attendance.setStudentAttendanceByManager(sessionId, studentId, managerUserId, { status: 'PRESENT' });
  const state = async (studentId: string) => {
    const e = await sequelize.query<{ n: number }>('SELECT COUNT(*) AS n FROM evaluations WHERE session_id = :sessionId AND student_id = :studentId', { replacements: { sessionId, studentId }, type: QueryTypes.SELECT });
    const a = await sequelize.query<{ status: string }>('SELECT status FROM attendance_records WHERE session_id = :sessionId AND subject_id = :studentId', { replacements: { sessionId, studentId }, type: QueryTypes.SELECT });
    return { evaluated: Number(e[0]!.n) === 1, attendance: a[0]?.status ?? 'UNMARKED' };
  };
  return { gates, create, cleanup, evaluate, markAbsent, markPresent, state, sessionId };
}

describe('attendance / evaluation mutual exclusion under concurrency (committed rows, cleaned up afterwards)', () => {
  it('deterministic order 1: an evaluation holding the session lock makes a concurrent ABSENT marking WAIT, and then refuses it', async () => {
    const w = createWorld();
    const student = randomUUID();
    try {
      await w.create();
      let release!: () => void;
      w.gates.evaluationAfterLock = new Promise<void>((resolve) => { release = resolve; });
      const evaluation = w.evaluate(student); // takes the session row lock, then waits at the gate
      await sleep(150);
      const absent = w.markAbsent(student).then(() => 'marked', (e: { code: string }) => e.code);
      expect(await pendingAfter(absent)).toBe(true); // the ABSENT marking is blocked on the session lock, it did not slip in
      release();
      expect((await evaluation).results[0]!.outcome).toBe('RECORDED');
      expect(await absent).toBe('ATTENDANCE_STUDENT_ALREADY_EVALUATED');
      expect(await w.state(student)).toEqual({ evaluated: true, attendance: 'UNMARKED' }); // unmarked stays unmarked: never turned into ABSENT
    } finally {
      await w.cleanup();
    }
  });

  it('deterministic order 2: an ABSENT marking holding the session lock makes a concurrent evaluation WAIT, and then refuses it', async () => {
    const w = createWorld();
    const student = randomUUID();
    try {
      await w.create();
      let release!: () => void;
      w.gates.attendanceAfterLock = new Promise<void>((resolve) => { release = resolve; });
      const absent = w.markAbsent(student);
      await sleep(150);
      const evaluation = w.evaluate(student).then(() => 'recorded', (e: { code: string }) => e.code);
      expect(await pendingAfter(evaluation)).toBe(true);
      release();
      await absent;
      expect(await evaluation).toBe('EVALUATION_STUDENT_ABSENT');
      expect(await w.state(student)).toEqual({ evaluated: false, attendance: 'ABSENT' });
    } finally {
      await w.cleanup();
    }
  });

  it('racing 25 evaluation / ABSENT pairs (unmarked and already-PRESENT students): in EVERY pair exactly one wins, and never both', async () => {
    const w = createWorld();
    const outcomes = { evaluationWon: 0, absentWon: 0 };
    try {
      await w.create();
      for (let i = 0; i < 25; i += 1) {
        const student = randomUUID();
        if (i % 2 === 1) await w.markPresent(student); // ABSENT then needs the PRESENT -> ABSENT correction path
        const [evaluation, absent] = await Promise.allSettled([w.evaluate(student), w.markAbsent(student)]);
        const s = await w.state(student);
        expect(s.evaluated && s.attendance === 'ABSENT', `pair ${i}: evaluated AND ABSENT`).toBe(false);
        if (evaluation.status === 'fulfilled') {
          expect(absent.status).toBe('rejected');
          expect(s.evaluated).toBe(true);
          outcomes.evaluationWon += 1;
        } else {
          expect(absent.status).toBe('fulfilled');
          expect(s).toEqual({ evaluated: false, attendance: 'ABSENT' });
          outcomes.absentWon += 1;
        }
      }
      expect(outcomes.evaluationWon + outcomes.absentWon).toBe(25);
    } finally {
      await w.cleanup();
    }
  });

  it('racing first creations of the same student\'s evaluation create exactly one evaluation', async () => {
    const w = createWorld();
    const student = randomUUID();
    try {
      await w.create();
      const settled = await Promise.allSettled(Array.from({ length: 6 }, () => w.evaluate(student)));
      expect(settled.filter((r) => r.status === 'fulfilled' && r.value.results[0]!.outcome === 'RECORDED')).toHaveLength(1);
      const rows = await sequelize.query<{ n: number }>('SELECT COUNT(*) AS n FROM evaluations WHERE session_id = :sessionId', { replacements: { sessionId: w.sessionId }, type: QueryTypes.SELECT });
      expect(Number(rows[0]!.n)).toBe(1);
      const scores = await sequelize.query<{ n: number }>('SELECT COUNT(*) AS n FROM evaluation_scores WHERE evaluation_id IN (SELECT id FROM evaluations WHERE session_id = :sessionId)', { replacements: { sessionId: w.sessionId }, type: QueryTypes.SELECT });
      expect(Number(scores[0]!.n)).toBe(3);
    } finally {
      await w.cleanup();
    }
  });
});
