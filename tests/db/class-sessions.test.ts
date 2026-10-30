/**
 * Real-database checks for Module 24 (Class Sessions): the schema of `class_sessions` (one session per slot occurrence, the CHECK constraints that keep status,
 * transition times and cancellation consistent, no foreign keys to other modules), the SQL repository (insert-if-absent, row locks, due transitions, filters and
 * paging, the "no delete" guarantee) and the concurrency guarantee (two generators racing for the same occurrence create ONE session). NOT part of `npm test`.
 * Prerequisite: `npm run db:migrate`. Run: npm run test:db
 * Safe on any database: the schema and repository tests run in ONE outer transaction that is ALWAYS rolled back; the concurrency test must COMMIT (other connections
 * have to see the rows), using random identifiers, and removes exactly those rows afterwards (also when it fails). Nothing else is read or changed.
 */
import { randomUUID } from 'node:crypto';
import { QueryTypes } from 'sequelize';
import { afterAll, describe, expect, it } from 'vitest';
import { env } from '../../src/config/env';
import { FixedClock, type TransactionContext } from '../../src/modules/00-shared-kernel/public';
import { SequelizeUnitOfWork, createSequelize, sequelizeTransactionOf } from '../../src/modules/02-database/public';
import { ClassSession, SequelizeClassSessionRepository } from '../../src/modules/24-sessions/public';

const sequelize = createSequelize(env.database);
const uow = new SequelizeUnitOfWork(sequelize);
const repo = new SequelizeClassSessionRepository(sequelize);
const clock = new FixedClock(new Date('2026-11-02T15:45:00.000Z'));

class Rollback extends Error {}
afterAll(async () => {
  await sequelize.close();
});

const newSession = (over: Partial<Parameters<typeof ClassSession.open>[0]> = {}) =>
  ClassSession.open({
    schoolId: randomUUID(), groupId: randomUUID(), teacherId: randomUUID(), slotId: randomUUID(), occurrenceDate: '2026-11-02',
    scheduledStart: new Date('2026-11-02T16:00:00.000Z'), scheduledEnd: new Date('2026-11-02T17:00:00.000Z'), clock, ...over,
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

const INSERT = `INSERT INTO class_sessions (id, school_id, group_id, teacher_id, slot_id, occurrence_date, scheduled_start, scheduled_end, status, created_at, started_at, completed_at, cancelled_at, cancelled_by, cancel_source, cancel_reason, slot_retire_reason)
                VALUES (:id, UUID(), UUID(), UUID(), :slotId, :date, :start, :end, :status, NOW(3), :startedAt, :completedAt, :cancelledAt, :cancelledBy, :source, :reason, :retire)`;
const row = (over: Record<string, unknown> = {}) => ({ id: randomUUID(), slotId: randomUUID(), date: '2026-11-02', start: new Date('2026-11-02T16:00:00Z'), end: new Date('2026-11-02T17:00:00Z'), status: 'OPEN', startedAt: null, completedAt: null, cancelledAt: null, cancelledBy: null, source: null, reason: null, retire: null, ...over });

describe('class_sessions schema (migration create-class-sessions)', () => {
  it('has no foreign key to another module\'s table', async () => {
    await withFixture(async ({ q }) => {
      expect(await q("SELECT CONSTRAINT_NAME AS n FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_TYPE = 'FOREIGN KEY' AND TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'class_sessions'")).toEqual([]);
    });
  });

  it('allows ONE session per slot occurrence (slot + date), and the same slot on another date', async () => {
    await withFixture(async ({ run, fails }) => {
      const slotId = randomUUID();
      await run(INSERT, row({ slotId }));
      await fails(INSERT, row({ slotId })); // the same occurrence again
      await run(INSERT, row({ slotId, date: '2026-11-09' }));
      await run(INSERT, row({ date: '2026-11-02' })); // another slot, same date
    });
  });

  it('keeps status, transition times and times consistent (CHECK constraints)', async () => {
    await withFixture(async ({ run, fails }) => {
      await fails(INSERT, row({ status: 'WHATEVER' }));
      await fails(INSERT, row({ start: new Date('2026-11-02T17:00:00Z'), end: new Date('2026-11-02T16:00:00Z') })); // start after end
      await fails(INSERT, row({ status: 'OPEN', startedAt: new Date() })); // OPEN cannot have started
      await fails(INSERT, row({ status: 'IN_PROGRESS' })); // IN_PROGRESS needs startedAt
      await fails(INSERT, row({ status: 'COMPLETED', startedAt: new Date() })); // COMPLETED needs completedAt
      await run(INSERT, row({ status: 'IN_PROGRESS', startedAt: new Date() }));
      await run(INSERT, row({ status: 'COMPLETED', startedAt: new Date(), completedAt: new Date() }));
    });
  });

  it('a CANCELLED row always says who or what cancelled it; a Teacher cancellation always has a non-empty reason', async () => {
    await withFixture(async ({ run, fails }) => {
      const t = new Date();
      await fails(INSERT, row({ status: 'CANCELLED' })); // nothing recorded
      await fails(INSERT, row({ status: 'CANCELLED', cancelledAt: t, source: 'TEACHER', cancelledBy: randomUUID(), reason: null }));
      await fails(INSERT, row({ status: 'CANCELLED', cancelledAt: t, source: 'TEACHER', cancelledBy: randomUUID(), reason: '   ' }));
      await fails(INSERT, row({ status: 'CANCELLED', cancelledAt: t, source: 'TEACHER', cancelledBy: null, reason: 'سبب' }));
      await fails(INSERT, row({ status: 'CANCELLED', cancelledAt: t, source: 'SCHEDULE_SLOT_RETIRED', cancelledBy: null, reason: null, retire: null }));
      await fails(INSERT, row({ status: 'CANCELLED', cancelledAt: t, source: 'SCHEDULE_SLOT_RETIRED', cancelledBy: null, reason: null, retire: 'OTHER' }));
      await fails(INSERT, row({ status: 'CANCELLED', cancelledAt: t, source: 'OTHER', cancelledBy: null, reason: null, retire: 'REMOVED' }));
      await fails(INSERT, row({ status: 'CANCELLED', cancelledAt: t, source: null, cancelledBy: randomUUID(), reason: 'سبب' })); // no source recorded (a NULL must not pass a CHECK)
      await fails(INSERT, row({ status: 'CANCELLED', cancelledAt: t, source: 'TEACHER', cancelledBy: randomUUID(), reason: 'سبب', retire: 'REMOVED' })); // a Teacher cancellation has no slot reason
      await fails(INSERT, row({ status: 'CANCELLED', cancelledAt: t, source: 'SCHEDULE_SLOT_RETIRED', cancelledBy: randomUUID(), reason: null, retire: 'REMOVED' })); // the system has no actor
      await fails(INSERT, row({ status: 'OPEN', cancelledAt: t })); // not cancelled but has cancellation data
      await run(INSERT, row({ status: 'CANCELLED', cancelledAt: t, source: 'TEACHER', cancelledBy: randomUUID(), reason: 'مريض' }));
      await run(INSERT, row({ status: 'CANCELLED', cancelledAt: t, source: 'SCHEDULE_SLOT_RETIRED', cancelledBy: null, reason: null, retire: 'REPLACED' }));
    });
  });
});

describe('SequelizeClassSessionRepository', () => {
  it('inserts a session once per occurrence and loads it back exactly (UTC instants, business date, nullable columns)', async () => {
    await withFixture(async ({ tx }) => {
      const s = newSession();
      expect(await repo.insertIfAbsent(s, tx)).toBe(true);
      expect(await repo.insertIfAbsent(newSession({ slotId: s.snapshot.slotId }), tx)).toBe(false); // same slot + date
      const back = (await repo.findById(s.id, tx))!.snapshot;
      expect(back).toMatchObject({ id: s.id, status: 'OPEN', occurrenceDate: '2026-11-02', slotId: s.snapshot.slotId, startedAt: null, cancelSource: null, cancelReason: null });
      expect(back.scheduledStart).toEqual(new Date('2026-11-02T16:00:00.000Z'));
      expect(back.scheduledEnd).toEqual(new Date('2026-11-02T17:00:00.000Z'));
      expect(await repo.findById(randomUUID(), tx)).toBeUndefined();
    });
  });

  it('saves transitions and a cancellation, and changes nothing else', async () => {
    await withFixture(async ({ tx, q }) => {
      const s = newSession();
      await repo.insertIfAbsent(s, tx);
      const loaded = (await repo.lockById(s.id, tx))!;
      clock.set(new Date('2026-11-02T16:20:00.000Z'));
      loaded.advance(clock);
      loaded.cancelByTeacher({ teacherId: s.snapshot.teacherId, actorUserId: randomUUID(), reason: 'طارئ', clock });
      await repo.save(loaded, tx);
      const back = (await repo.findById(s.id, tx))!.snapshot;
      expect(back).toMatchObject({ status: 'CANCELLED', cancelSource: 'TEACHER', cancelReason: 'طارئ', slotRetireReason: null });
      expect(back.startedAt).toEqual(new Date('2026-11-02T16:20:00.000Z'));
      expect(back).toMatchObject({ schoolId: s.snapshot.schoolId, groupId: s.snapshot.groupId, teacherId: s.snapshot.teacherId, slotId: s.snapshot.slotId });
      expect((await q<{ n: number }>('SELECT COUNT(*) AS n FROM class_sessions WHERE id = :id', { id: s.id }))[0]!.n).toBe(1);
      clock.set(new Date('2026-11-02T15:45:00.000Z'));
    });
  });

  it('finds the sessions whose automatic transition is due, the OPEN slots, and locks the OPEN sessions of a slot', async () => {
    await withFixture(async ({ tx }) => {
      const open = newSession();
      const later = newSession({ slotId: randomUUID(), scheduledStart: new Date('2026-11-02T18:00:00.000Z'), scheduledEnd: new Date('2026-11-02T19:00:00.000Z') });
      await repo.insertIfAbsent(open, tx);
      await repo.insertIfAbsent(later, tx);
      const running = newSession({ slotId: randomUUID() });
      await repo.insertIfAbsent(running, tx);
      const r = (await repo.lockById(running.id, tx))!;
      clock.set(new Date('2026-11-02T16:00:00.000Z'));
      r.advance(clock);
      await repo.save(r, tx);
      const due = await repo.listDueIds(new Date('2026-11-02T16:00:00.000Z'), 100, tx);
      expect(due).toContain(open.id); // OPEN and its start has come
      expect(due).not.toContain(later.id); // not yet
      expect(due).not.toContain(running.id); // IN_PROGRESS until its end
      expect(await repo.listDueIds(new Date('2026-11-02T17:00:00.000Z'), 100, tx)).toContain(running.id);
      expect(await repo.listOpenSlotIds(tx)).toEqual(expect.arrayContaining([open.snapshot.slotId, later.snapshot.slotId]));
      expect(await repo.listOpenSlotIds(tx)).not.toContain(running.snapshot.slotId);
      expect((await repo.lockOpenBySlot(open.snapshot.slotId, tx)).map((x) => x.id)).toEqual([open.id]);
      expect(await repo.lockOpenBySlot(running.snapshot.slotId, tx)).toEqual([]);
      clock.set(new Date('2026-11-02T15:45:00.000Z'));
    });
  });

  it('lists a group\'s and a Teacher\'s sessions: filter by status, newest first by default, paging with a total', async () => {
    await withFixture(async ({ tx }) => {
      const groupId = randomUUID();
      const teacherId = randomUUID();
      const days = ['2026-11-02', '2026-11-09', '2026-11-16'];
      const slotId = randomUUID();
      for (const [i, d] of days.entries()) {
        await repo.insertIfAbsent(newSession({ groupId, teacherId, slotId, occurrenceDate: d, scheduledStart: new Date(`${d}T16:00:00.000Z`), scheduledEnd: new Date(`${d}T17:00:00.000Z`) }), tx);
        expect(i).toBeGreaterThanOrEqual(0);
      }
      const all = await repo.listByGroup(groupId, { direction: 'desc' }, { page: 1, pageSize: 10 }, tx);
      expect(all.total).toBe(3);
      expect(all.items.map((s) => s.snapshot.occurrenceDate)).toEqual([...days].reverse());
      expect((await repo.listByGroup(groupId, { direction: 'asc' }, { page: 1, pageSize: 2 }, tx)).items.map((s) => s.snapshot.occurrenceDate)).toEqual(days.slice(0, 2));
      expect((await repo.listByGroup(groupId, { direction: 'asc' }, { page: 2, pageSize: 2 }, tx)).items.map((s) => s.snapshot.occurrenceDate)).toEqual([days[2]]);
      expect((await repo.listByGroup(groupId, { status: ['COMPLETED'], direction: 'desc' }, { page: 1, pageSize: 10 }, tx)).total).toBe(0);
      expect((await repo.listByTeacher(teacherId, { status: ['OPEN', 'IN_PROGRESS'], direction: 'desc' }, { page: 1, pageSize: 10 }, tx)).total).toBe(3);
      expect((await repo.listByTeacher(randomUUID(), { direction: 'desc' }, { page: 1, pageSize: 10 }, tx)).total).toBe(0);
    });
  });
});

describe('concurrency (committed rows, cleaned up afterwards)', () => {
  it('two generators racing for the SAME occurrence create exactly one session', async () => {
    const slotId = randomUUID();
    try {
      const attempts = await Promise.all(Array.from({ length: 6 }, () => uow.run((tx) => repo.insertIfAbsent(newSession({ slotId }), tx))));
      expect(attempts.filter(Boolean)).toHaveLength(1);
      const rows = await sequelize.query<{ n: number }>('SELECT COUNT(*) AS n FROM class_sessions WHERE slot_id = :slotId', { replacements: { slotId }, type: QueryTypes.SELECT });
      expect(Number(rows[0]!.n)).toBe(1);
    } finally {
      // Test cleanup of exactly the rows this test committed (random slot id). The application itself never deletes a session.
      await sequelize.query('DELETE FROM class_sessions WHERE slot_id = :slotId', { replacements: { slotId } });
    }
    const left = await sequelize.query<{ n: number }>('SELECT COUNT(*) AS n FROM class_sessions WHERE slot_id = :slotId', { replacements: { slotId }, type: QueryTypes.SELECT });
    expect(Number(left[0]!.n)).toBe(0);
  });
});
