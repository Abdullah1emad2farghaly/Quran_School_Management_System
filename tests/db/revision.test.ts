/**
 * Real-database checks for Module 28 (Revision): the schema of `revision_assignments`, `revision_assignment_history`, `revision_records` and
 * `revision_correction_history` (one ACTIVE assignment per session + subject while any number of cancelled ones are kept, the CHECK constraints, no foreign keys to
 * other modules, NO uniqueness on records so overlapping ranges are valid), and the SQL repository (assignment + history written together, a correction writing the new range
 * AND its history entry together with the original kept, the fulfilment query, listing). NOT part of `npm test`.
 * Prerequisite: `npm run db:migrate`. Run: npm run test:db
 * Safe on any database: everything runs in ONE outer transaction that is ALWAYS rolled back, using random identifiers.
 */
import { randomUUID } from 'node:crypto';
import { QueryTypes } from 'sequelize';
import { afterAll, describe, expect, it } from 'vitest';
import { env } from '../../src/config/env';
import { FixedClock, type TransactionContext } from '../../src/modules/00-shared-kernel/public';
import { SequelizeUnitOfWork, createSequelize, sequelizeTransactionOf } from '../../src/modules/02-database/public';
import { RevisionAssignment, RevisionRecord, SequelizeRevisionRepository, type RevisionRange } from '../../src/modules/28-revision/public';

const sequelize = createSequelize(env.database);
const uow = new SequelizeUnitOfWork(sequelize);
const repo = new SequelizeRevisionRepository(sequelize);
const clock = new FixedClock(new Date('2026-11-02T16:05:00.000Z'));

class Rollback extends Error {}
afterAll(async () => {
  await sequelize.close();
});

const rangeOf = (firstAyah: number, lastAyah: number): RevisionRange => ({
  input: { form: 'START_UNIT_AMOUNT', unit: 'AYAHS', surah: 2, start: firstAyah, amount: lastAyah - firstAyah + 1, direction: 'FORWARD' },
  request: { start: { surah: 2, ayah: firstAyah }, unit: 'AYAHS', amount: lastAyah - firstAyah + 1, direction: 'FORWARD' },
  first: { surah: 2, ayah: firstAyah }, last: { surah: 2, ayah: lastAyah }, segments: [{ surah: 2, firstAyah, lastAyah }], ayahCount: lastAyah - firstAyah + 1,
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

const ASSIGN = `INSERT INTO revision_assignments (id, school_id, group_id, student_id, subject_key, defined_in_session_id, defined_by_teacher_id, defined_by_user_id, range_json, status, active_slot, created_at, updated_at)
                VALUES (:id, UUID(), UUID(), NULL, :subject, :sessionId, UUID(), UUID(), '{}', :status, :slot, NOW(3), NOW(3))`;
const assign = (over: Record<string, unknown> = {}) => ({ id: randomUUID(), subject: 'GROUP', sessionId: randomUUID(), status: 'ACTIVE', slot: 1, ...over });

const newAssignment = (over: { sessionId?: string; groupId?: string; studentId?: string | null; range?: RevisionRange } = {}) =>
  RevisionAssignment.define({
    schoolId: randomUUID(), groupId: over.groupId ?? randomUUID(), studentId: over.studentId ?? null, definedInSessionId: over.sessionId ?? randomUUID(), teacherId: randomUUID(), actorUserId: randomUUID(),
    range: over.range ?? rangeOf(1, 5), clock,
  });
const newRecord = (over: { sessionId?: string; studentId?: string; assignmentId?: string | null; range?: RevisionRange; matches?: boolean | null } = {}) =>
  RevisionRecord.record({
    sessionId: over.sessionId ?? randomUUID(), schoolId: randomUUID(), groupId: randomUUID(), studentId: over.studentId ?? randomUUID(), assignmentId: over.assignmentId ?? null, range: over.range ?? rangeOf(1, 5),
    matchesAssignment: over.matches ?? null, actorUserId: randomUUID(), clock,
  });

describe('revision schema (migration create-revision)', () => {
  it('has no foreign key to another module\'s table', async () => {
    await withFixture(async ({ q }) => {
      const fks = await q<{ n: number }>(
        `SELECT COUNT(*) AS n FROM information_schema.referential_constraints WHERE constraint_schema = DATABASE() AND table_name IN ('revision_assignments','revision_assignment_history','revision_records','revision_correction_history')`,
      );
      expect(Number(fks[0]!.n)).toBe(0);
    });
  });

  it('allows ONE active assignment per session + subject but keeps any number of cancelled ones', async () => {
    await withFixture(async ({ run, fails, q }) => {
      const sessionId = randomUUID();
      await run(ASSIGN, assign({ sessionId }));
      await fails(ASSIGN, assign({ sessionId })); // a second active one for the same session + shared subject
      await run(ASSIGN, assign({ sessionId, subject: randomUUID() })); // another subject (a student) is fine
      await run(ASSIGN, assign({ sessionId, status: 'CANCELLED', slot: null }));
      await run(ASSIGN, assign({ sessionId, status: 'CANCELLED', slot: null }));
      expect(Number((await q<{ n: number }>('SELECT COUNT(*) AS n FROM revision_assignments WHERE defined_in_session_id = :sessionId', { sessionId }))[0]!.n)).toBe(4);
    });
  });

  it('accepts only ACTIVE / CANCELLED with a matching active slot (CHECK constraints)', async () => {
    await withFixture(async ({ fails }) => {
      await fails(ASSIGN, assign({ status: 'DELETED', slot: null }));
      await fails(ASSIGN, assign({ status: 'ACTIVE', slot: null }));
      await fails(ASSIGN, assign({ status: 'CANCELLED', slot: 1 }));
    });
  });

  it('records have NO uniqueness: overlapping and repeated ranges for the same student and session are valid; a record must have an assignment exactly when it has an evaluation', async () => {
    const REC = `INSERT INTO revision_records (id, session_id, school_id, group_id, student_id, assignment_id, range_json, matches_assignment, session_scheduled_start, recorded_by, recorded_at, updated_by, updated_at)
                 VALUES (:id, :sessionId, UUID(), UUID(), :studentId, :assignmentId, '{}', :matches, NOW(3), UUID(), NOW(3), UUID(), NOW(3))`;
    await withFixture(async ({ run, fails, q }) => {
      const sessionId = randomUUID();
      const studentId = randomUUID();
      for (let i = 0; i < 3; i += 1) await run(REC, { id: randomUUID(), sessionId, studentId, assignmentId: null, matches: null });
      expect(Number((await q<{ n: number }>('SELECT COUNT(*) AS n FROM revision_records WHERE session_id = :sessionId', { sessionId }))[0]!.n)).toBe(3);
      await fails(REC, { id: randomUUID(), sessionId, studentId, assignmentId: randomUUID(), matches: null });
      await fails(REC, { id: randomUUID(), sessionId, studentId, assignmentId: null, matches: 1 });
      await fails(REC, { id: randomUUID(), sessionId, studentId, assignmentId: randomUUID(), matches: 2 });
    });
  });
});

describe('SequelizeRevisionRepository', () => {
  it('inserts an assignment with its DEFINED history entry, then a change writes the new range AND its history entry together', async () => {
    await withFixture(async ({ tx }) => {
      const sessionId = randomUUID();
      const { assignment, history } = newAssignment({ sessionId });
      expect(await repo.insertAssignment(assignment, history, tx)).toBe(true);
      const again = newAssignment({ sessionId });
      expect(await repo.insertAssignment(again.assignment, again.history, tx)).toBe(false); // the unique active slot
      const locked = (await repo.lockAssignment(assignment.snapshot.id, tx))!;
      const entry = locked.modify({ range: rangeOf(6, 10), actorUserId: randomUUID(), clock });
      await repo.applyAssignmentChange(locked, entry, tx);
      const cancel = (await repo.lockAssignment(assignment.snapshot.id, tx))!;
      await repo.applyAssignmentChange(cancel, cancel.cancel({ actorUserId: randomUUID(), clock }), tx);
      const stored = (await repo.findAssignment(assignment.snapshot.id, tx))!;
      expect(stored.snapshot).toMatchObject({ status: 'CANCELLED', range: rangeOf(6, 10) });
      const log = await repo.listAssignmentHistoryOfSession(sessionId, tx);
      expect(log.map((h) => h.action)).toEqual(['DEFINED', 'MODIFIED', 'CANCELLED']);
      expect(log[1]!.previousRange).toEqual(rangeOf(1, 5));
      expect(await repo.listActiveAssignmentsOfGroup(assignment.snapshot.groupId, tx)).toEqual([]); // cancelled: kept but no longer active
      const reused = newAssignment({ sessionId, groupId: assignment.snapshot.groupId });
      expect(await repo.insertAssignment(reused.assignment, reused.history, tx)).toBe(true); // the slot is free again
    });
  });

  it('inserts records, loads them back exactly, and a correction writes the new range AND appends its history entry, keeping the original', async () => {
    await withFixture(async ({ tx }) => {
      const start = new Date('2026-11-02T16:00:00.000Z');
      const sessionId = randomUUID();
      const studentId = randomUUID();
      const a = newRecord({ sessionId, studentId });
      const b = newRecord({ sessionId, studentId, range: rangeOf(3, 7) }); // overlapping
      await repo.insertRecords([a, b], start, tx);
      const loaded = (await repo.findRecord(a.snapshot.id, tx))!;
      expect(loaded.snapshot.range).toEqual(rangeOf(1, 5));
      expect(loaded.snapshot.recordedAt.toISOString()).toBe('2026-11-02T16:05:00.000Z');
      const locked = (await repo.lockRecord(a.snapshot.id, tx))!;
      const entry = locked.correct({ range: rangeOf(1, 3), matchesAssignment: null, reason: 'تصحيح', actorUserId: randomUUID(), clock })!;
      await repo.applyRecordCorrection(locked, entry, tx);
      expect((await repo.findRecord(a.snapshot.id, tx))!.snapshot.range).toEqual(rangeOf(1, 3));
      expect((await repo.findRecord(b.snapshot.id, tx))!.snapshot.range).toEqual(rangeOf(3, 7)); // the other record is untouched
      const log = await repo.listCorrectionsOfSession(sessionId, tx);
      expect(log).toHaveLength(1);
      expect(log[0]!.previousRange).toEqual(rangeOf(1, 5)); // the original is kept
      expect(log[0]!.reason).toBe('تصحيح');
      expect((await repo.listRecordsBySession(sessionId, tx)).map((r) => r.snapshot.id).sort()).toEqual([a.snapshot.id, b.snapshot.id].sort());
    });
  });

  it('answers "fulfilled before" only from fulfilling records of EARLIER sessions, and lists a student\'s records newest session first with a total', async () => {
    await withFixture(async ({ tx }) => {
      const assignmentId = randomUUID();
      const studentId = randomUUID();
      const early = new Date('2026-11-02T16:00:00.000Z');
      const late = new Date('2026-11-09T16:00:00.000Z');
      await repo.insertRecords([newRecord({ studentId, assignmentId, matches: true })], early, tx);
      await repo.insertRecords([newRecord({ studentId, assignmentId: randomUUID(), matches: false })], late, tx);
      expect([...(await repo.fulfilledBefore([assignmentId], late, tx))]).toEqual([assignmentId]);
      expect([...(await repo.fulfilledBefore([assignmentId], early, tx))]).toEqual([]); // not before its own session
      const page = await repo.listRecordsByStudent(studentId, 'desc', { page: 1, pageSize: 1 }, tx);
      expect(page.total).toBe(2);
      expect(page.items[0]!.snapshot.matchesAssignment).toBe(false); // the later session first
    });
  });
});
