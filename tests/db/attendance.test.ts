/**
 * Real-database checks for Module 26 (Attendance): the schema of `attendance_records` and `attendance_correction_history` (one record per session + subject, the CHECK
 * constraints, no foreign keys to other modules), the SQL repository (insert-if-absent, row locks, a correction writing the new status AND its history entry together,
 * listing, paging) and the concurrency guarantee (racing first markings of the same subject create ONE record). NOT part of `npm test`.
 * Prerequisite: `npm run db:migrate`. Run: npm run test:db
 * Safe on any database: the schema and repository tests run in ONE outer transaction that is ALWAYS rolled back; the concurrency test must COMMIT (other connections have
 * to see the rows), using random identifiers, and removes exactly those rows afterwards (also when it fails). Nothing else is read or changed.
 */
import { randomUUID } from 'node:crypto';
import { QueryTypes } from 'sequelize';
import { afterAll, describe, expect, it } from 'vitest';
import { env } from '../../src/config/env';
import { FixedClock, type TransactionContext } from '../../src/modules/00-shared-kernel/public';
import { SequelizeUnitOfWork, createSequelize, sequelizeTransactionOf } from '../../src/modules/02-database/public';
import { AttendanceRecord, SequelizeAttendanceRepository } from '../../src/modules/26-attendance/public';

const sequelize = createSequelize(env.database);
const uow = new SequelizeUnitOfWork(sequelize);
const repo = new SequelizeAttendanceRepository(sequelize);
const clock = new FixedClock(new Date('2026-11-02T16:05:00.000Z'));

class Rollback extends Error {}
afterAll(async () => {
  await sequelize.close();
});

const newRecord = (over: Partial<Parameters<typeof AttendanceRecord.record>[0]> = {}) =>
  AttendanceRecord.record({
    sessionId: randomUUID(), schoolId: randomUUID(), groupId: randomUUID(), subjectType: 'STUDENT', subjectId: randomUUID(), status: 'PRESENT', occurrenceDate: '2026-11-02',
    scheduledStart: new Date('2026-11-02T16:00:00.000Z'), actorUserId: randomUUID(), actorRole: 'TEACHER', clock, ...over,
  });

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
      await work({ tx, q, run, fails });
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}

const REC = `INSERT INTO attendance_records (id, session_id, school_id, group_id, subject_type, subject_id, status, occurrence_date, scheduled_start, recorded_by, recorded_by_role, recorded_at, updated_by, updated_by_role, updated_at)
             VALUES (:id, :sessionId, UUID(), UUID(), :type, :subjectId, :status, '2026-11-02', NOW(3), UUID(), :role, NOW(3), UUID(), :role, NOW(3))`;
const rec = (over: Record<string, unknown> = {}) => ({ id: randomUUID(), sessionId: randomUUID(), type: 'STUDENT', subjectId: randomUUID(), status: 'PRESENT', role: 'TEACHER', ...over });
const HIST = `INSERT INTO attendance_correction_history (id, record_id, session_id, subject_type, subject_id, previous_status, new_status, reason, changed_by, changed_by_role, changed_at)
              VALUES (:id, UUID(), UUID(), :type, UUID(), :prev, :next, :reason, UUID(), :role, NOW(3))`;
const hist = (over: Record<string, unknown> = {}) => ({ id: randomUUID(), type: 'STUDENT', prev: 'PRESENT', next: 'ABSENT', reason: 'سبب', role: 'TEACHER', ...over });

describe('attendance schema (migration create-attendance)', () => {
  it('has no foreign key to another module\'s table', async () => {
    await withFixture(async ({ q }) => {
      expect(await q("SELECT CONSTRAINT_NAME AS n FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_TYPE = 'FOREIGN KEY' AND TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('attendance_records', 'attendance_correction_history')")).toEqual([]);
    });
  });

  it('allows ONE record per session + subject: a student and the Teacher of the same session each get one; the same subject twice is refused', async () => {
    await withFixture(async ({ run, fails }) => {
      const sessionId = randomUUID();
      const subjectId = randomUUID();
      await run(REC, rec({ sessionId, subjectId }));
      await fails(REC, rec({ sessionId, subjectId })); // Session + Student again
      await run(REC, rec({ sessionId, subjectId, type: 'TEACHER' })); // Session + Teacher: a different subject type
      await run(REC, rec({ subjectId })); // the same subject in another session
    });
  });

  it('accepts only PRESENT / ABSENT, STUDENT / TEACHER and the two actor roles (CHECK constraints)', async () => {
    await withFixture(async ({ run, fails }) => {
      await fails(REC, rec({ status: 'LATE' }));
      await fails(REC, rec({ type: 'PARENT' }));
      await fails(REC, rec({ role: 'MAIN_ADMIN' }));
      await run(REC, rec({ status: 'ABSENT', role: 'SCHOOL_MANAGER' }));
      await run(REC, rec({ status: 'ABSENT', type: 'TEACHER', role: 'SYSTEM' })); // the automatic Teacher-absence rule (needs migration attendance-allow-system-actor)
    });
  });

  it('a history row must be a real change with a non-blank reason, a valid role and a valid subject type', async () => {
    await withFixture(async ({ run, fails, q }) => {
      await fails(HIST, hist({ next: 'PRESENT' })); // previous = new: not a change
      await fails(HIST, hist({ reason: '   ' }));
      await fails(HIST, hist({ prev: 'LATE' }));
      await fails(HIST, hist({ role: 'PARENT' }));
      await fails(HIST, hist({ type: 'PARENT' }));
      await run(HIST, hist());
      await run(HIST, hist({ prev: 'ABSENT', next: 'PRESENT', role: 'SCHOOL_MANAGER', type: 'TEACHER' }));
      await run(HIST, hist({ prev: 'PRESENT', next: 'ABSENT', role: 'SYSTEM', type: 'TEACHER', reason: 'SESSION_CANCELLED_BY_TEACHER' })); // needs migration attendance-allow-system-actor
      expect((await q<{ n: number }>("SELECT COUNT(*) AS n FROM attendance_correction_history WHERE reason = 'سبب'"))[0]!.n).toBeGreaterThanOrEqual(1);
    });
  });
});

describe('SequelizeAttendanceRepository', () => {
  it('inserts a record once per (session, subject) and loads it back exactly (UTC instants, business date)', async () => {
    await withFixture(async ({ tx }) => {
      const r = newRecord();
      expect(await repo.insertIfAbsent(r, tx)).toBe(true);
      expect(await repo.insertIfAbsent(newRecord({ sessionId: r.snapshot.sessionId, subjectId: r.snapshot.subjectId }), tx)).toBe(false);
      const [back] = await repo.lockSubjects(r.snapshot.sessionId, 'STUDENT', [r.snapshot.subjectId], tx);
      expect(back!.snapshot).toMatchObject({ id: r.id, status: 'PRESENT', subjectType: 'STUDENT', occurrenceDate: '2026-11-02', recordedByRole: 'TEACHER' });
      expect(back!.snapshot.scheduledStart).toEqual(new Date('2026-11-02T16:00:00.000Z'));
      expect(await repo.lockSubjects(r.snapshot.sessionId, 'TEACHER', [r.snapshot.subjectId], tx)).toEqual([]);
      expect(await repo.lockSubjects(r.snapshot.sessionId, 'STUDENT', [], tx)).toEqual([]);
    });
  });

  it('a correction writes the new status AND appends its history entry together; the previous value stays in the history', async () => {
    await withFixture(async ({ tx }) => {
      const r = newRecord();
      await repo.insertIfAbsent(r, tx);
      const [locked] = await repo.lockSubjects(r.snapshot.sessionId, 'STUDENT', [r.snapshot.subjectId], tx);
      clock.set(new Date('2026-11-02T16:40:00.000Z'));
      const actor = randomUUID();
      const correction = locked!.correct({ status: 'ABSENT', reason: 'سُجّل خطأً', actorUserId: actor, actorRole: 'SCHOOL_MANAGER', clock })!;
      await repo.applyCorrection(locked!, correction, tx);
      const [after] = await repo.lockSubjects(r.snapshot.sessionId, 'STUDENT', [r.snapshot.subjectId], tx);
      expect(after!.snapshot).toMatchObject({ status: 'ABSENT', updatedBy: actor, updatedByRole: 'SCHOOL_MANAGER', recordedByRole: 'TEACHER', recordedBy: r.snapshot.recordedBy });
      const history = await repo.listCorrectionsOfSession(r.snapshot.sessionId, tx);
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ previousStatus: 'PRESENT', newStatus: 'ABSENT', reason: 'سُجّل خطأً', changedBy: actor, changedByRole: 'SCHOOL_MANAGER', recordId: r.id });
      expect(history[0]!.changedAt).toEqual(new Date('2026-11-02T16:40:00.000Z'));
      // a second correction appends: the first entry is untouched, oldest first
      clock.set(new Date('2026-11-02T16:50:00.000Z'));
      const second = after!.correct({ status: 'PRESENT', reason: 'الثاني', actorUserId: actor, actorRole: 'SCHOOL_MANAGER', clock })!;
      await repo.applyCorrection(after!, second, tx);
      const both = await repo.listCorrectionsOfSession(r.snapshot.sessionId, tx);
      expect(both.map((c) => `${c.previousStatus}>${c.newStatus}`)).toEqual(['PRESENT>ABSENT', 'ABSENT>PRESENT']);
      expect(both[0]).toEqual(history[0]);
      clock.set(new Date('2026-11-02T16:05:00.000Z'));
    });
  });

  it('lists a session\'s records and a student\'s records (newest session first by default, paged with a total)', async () => {
    await withFixture(async ({ tx }) => {
      const studentId = randomUUID();
      const sessionId = randomUUID();
      const days = ['2026-11-02', '2026-11-09', '2026-11-16'];
      for (const d of days) await repo.insertIfAbsent(newRecord({ subjectId: studentId, sessionId: d === days[0] ? sessionId : randomUUID(), occurrenceDate: d, scheduledStart: new Date(`${d}T16:00:00.000Z`) }), tx);
      await repo.insertIfAbsent(newRecord({ sessionId, subjectType: 'TEACHER' }), tx);
      expect((await repo.listBySession(sessionId, tx)).map((r) => r.snapshot.subjectType).sort()).toEqual(['STUDENT', 'TEACHER']);
      const all = await repo.listByStudent(studentId, 'desc', { page: 1, pageSize: 10 }, tx);
      expect(all.total).toBe(3);
      expect(all.items.map((r) => r.snapshot.occurrenceDate)).toEqual([...days].reverse());
      expect((await repo.listByStudent(studentId, 'asc', { page: 2, pageSize: 2 }, tx)).items.map((r) => r.snapshot.occurrenceDate)).toEqual([days[2]]);
      expect((await repo.listByStudent(randomUUID(), 'desc', { page: 1, pageSize: 10 }, tx)).total).toBe(0);
    });
  });
});

describe('concurrency (committed rows, cleaned up afterwards)', () => {
  it('racing first markings of the SAME subject create exactly one record', async () => {
    const sessionId = randomUUID();
    const subjectId = randomUUID();
    try {
      const attempts = await Promise.all(Array.from({ length: 6 }, () => uow.run((tx) => repo.insertIfAbsent(newRecord({ sessionId, subjectId }), tx))));
      expect(attempts.filter(Boolean)).toHaveLength(1);
      const rows = await sequelize.query<{ n: number }>('SELECT COUNT(*) AS n FROM attendance_records WHERE session_id = :sessionId', { replacements: { sessionId }, type: QueryTypes.SELECT });
      expect(Number(rows[0]!.n)).toBe(1);
    } finally {
      // Test cleanup of exactly the rows this test committed (random ids). The application itself never deletes attendance.
      await sequelize.query('DELETE FROM attendance_records WHERE session_id = :sessionId', { replacements: { sessionId } });
    }
    const left = await sequelize.query<{ n: number }>('SELECT COUNT(*) AS n FROM attendance_records WHERE session_id = :sessionId', { replacements: { sessionId }, type: QueryTypes.SELECT });
    expect(Number(left[0]!.n)).toBe(0);
  });

  it('racing corrections of the same record are serialized by the row lock: the history keeps one entry per real change', async () => {
    const r = newRecord();
    const sessionId = r.snapshot.sessionId;
    try {
      await uow.run((tx) => repo.insertIfAbsent(r, tx));
      const actor = randomUUID();
      // Four requests each try to set ABSENT with a reason: only the first changes anything; the others find ABSENT already and change nothing.
      await Promise.all(
        Array.from({ length: 4 }, () =>
          uow.run(async (tx) => {
            const [locked] = await repo.lockSubjects(sessionId, 'STUDENT', [r.snapshot.subjectId], tx);
            const correction = locked!.correct({ status: 'ABSENT', reason: 'سباق', actorUserId: actor, actorRole: 'SCHOOL_MANAGER', clock });
            if (correction) await repo.applyCorrection(locked!, correction, tx);
          }),
        ),
      );
      expect(await repo.listCorrectionsOfSession(sessionId)).toHaveLength(1);
      expect((await repo.listBySession(sessionId))[0]!.snapshot.status).toBe('ABSENT');
    } finally {
      await sequelize.query('DELETE FROM attendance_correction_history WHERE session_id = :sessionId', { replacements: { sessionId } });
      await sequelize.query('DELETE FROM attendance_records WHERE session_id = :sessionId', { replacements: { sessionId } });
    }
    expect(await repo.listCorrectionsOfSession(sessionId)).toHaveLength(0);
  });
});
