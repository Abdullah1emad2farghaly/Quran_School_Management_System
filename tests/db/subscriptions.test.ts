/**
 * Real-database checks for Module 33 (Subscriptions): the schema (unique Student+Month, unique school+month batch, status / audit / month CHECKs, the batch key, the
 * Collector link history index and its NULL-safe CHECK, the reminder-kind CHECK that Module 32 shares), the SQL repositories, the real SubscriptionService on them (bulk creation, the
 * Oldest-Unpaid Rule, atomic rollback) and CONCURRENCY with real parallel connections. NOT part of `npm test`.
 * Prerequisite: `npm run db:migrate`. Run: npm run test:db
 * Part 1 runs inside ONE outer transaction that is ALWAYS rolled back. Part 2 needs real commits for concurrency, so it uses random ids that belong to no other table (Module 33 has no
 * foreign keys to other modules) and deletes everything it created in `afterAll`.
 */
import { randomUUID } from 'node:crypto';
import { QueryTypes } from 'sequelize';
import { afterAll, describe, expect, it } from 'vitest';
import { env } from '../../src/config/env';
import { AppError, type TransactionContext, type UnitOfWork } from '../../src/modules/00-shared-kernel/public';
import { SequelizeUnitOfWork, createSequelize, sequelizeTransactionOf } from '../../src/modules/02-database/public';
import type { OutboxService } from '../../src/modules/06-domain-events-outbox/public';
import {
  CollectorSchoolLink,
  SequelizeCollectorLinkRepository,
  SequelizeSubscriptionRepository,
  Subscription,
  SubscriptionBatch,
  SubscriptionService,
  type StudentRoster,
} from '../../src/modules/33-subscriptions/public';

const sequelize = createSequelize(env.database);
const uow = new SequelizeUnitOfWork(sequelize);
const noopOutbox = { publishFrom: async () => undefined } as unknown as OutboxService;
const codeOf = (p: Promise<unknown>) => p.then(() => 'NO_ERROR', (e: unknown) => (e instanceof AppError ? e.code : `OTHER:${(e as Error).message}`));
class Rollback extends Error {}
const swallowRollback = (error: unknown) => {
  if (!(error instanceof Rollback)) throw error;
};

const subRepo = new SequelizeSubscriptionRepository(sequelize);
const linkRepo = new SequelizeCollectorLinkRepository(sequelize);
const clock = (iso: string) => ({ now: () => new Date(iso) });

interface World {
  schoolId: string;
  organizationId: string;
  studentIds: string[];
  roster: StudentRoster;
  service: (now: string, unitOfWork?: UnitOfWork) => SubscriptionService;
}
const created = { schools: new Set<string>(), students: new Set<string>() };
function world(studentCount: number): World {
  const schoolId = randomUUID();
  const organizationId = randomUUID();
  const studentIds: string[] = Array.from({ length: studentCount }, () => randomUUID());
  created.schools.add(schoolId);
  studentIds.forEach((s) => created.students.add(s));
  const roster: StudentRoster = {
    find: async (id) => ((studentIds as string[]).includes(id) ? { id, fullName: `Student ${id.slice(0, 4)}`, schoolId, organizationId, status: 'ACTIVE' } : undefined),
    listActiveStudentIds: async () => [...studentIds],
  };
  const schools = { findById: async (id: string) => (id === schoolId ? { id, organizationId, status: 'ACTIVE' } : undefined) } as never;
  const service = (now: string, unitOfWork: UnitOfWork = uow) => new SubscriptionService({ subscriptions: subRepo, roster, schools, unitOfWork, outbox: noopOutbox, clock: clock(now) });
  return { schoolId, organizationId, studentIds, roster, service };
}

async function inRolledBackTransaction(work: (tx: TransactionContext, q: <T extends object>(sql: string, r?: Record<string, unknown>) => Promise<T[]>, fails: (sql: string, r?: Record<string, unknown>) => Promise<void>, savepointUow: UnitOfWork) => Promise<void>): Promise<void> {
  try {
    await uow.run(async (tx) => {
      const transaction = sequelizeTransactionOf(tx) ?? null;
      const q = <T extends object>(sql: string, replacements: Record<string, unknown> = {}) => sequelize.query<T>(sql, { replacements, type: QueryTypes.SELECT, transaction });
      const run = async (sql: string, replacements: Record<string, unknown> = {}) => {
        await sequelize.query(sql, { replacements, transaction });
      };
      let sp = 0;
      const fails = async (sql: string, replacements: Record<string, unknown> = {}) => {
        const name = `sp_${++sp}`;
        await run(`SAVEPOINT ${name}`);
        await expect(run(sql, replacements)).rejects.toThrow();
        await run(`ROLLBACK TO SAVEPOINT ${name}`);
      };
      let operation = 0;
      const savepointUow: UnitOfWork = {
        run: async (inner) => {
          const name = `op_${++operation}`;
          await run(`SAVEPOINT ${name}`);
          try {
            const result = await inner(tx);
            await run(`RELEASE SAVEPOINT ${name}`);
            return result;
          } catch (error) {
            await run(`ROLLBACK TO SAVEPOINT ${name}`);
            throw error;
          }
        },
      };
      await work(tx, q, fails, savepointUow);
      throw new Rollback();
    });
  } catch (error) {
    swallowRollback(error);
  }
}

const insertBatch = (school: string, month: string, id = randomUUID()) =>
  [`INSERT INTO subscription_batches (id, school_id, organization_id, month, record_count, created_by, created_at, updated_at) VALUES (:id, :school, :org, :month, 1, :by, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`, { id, school, org: randomUUID(), month, by: randomUUID() }] as const;
const insertSub = (student: string, school: string, month: string, over: Record<string, unknown> = {}) =>
  [
    `INSERT INTO subscriptions (id, student_id, school_id, organization_id, month, status, batch_id, created_by, paid_at, paid_by, waived_at, waived_by, version, created_at, updated_at)
     VALUES (:id, :student, :school, :org, :month, :status, :batch, :by, :paidAt, :paidBy, :waivedAt, :waivedBy, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    { id: randomUUID(), student, school, org: randomUUID(), month, status: 'UNPAID', batch: null, by: randomUUID(), paidAt: null, paidBy: null, waivedAt: null, waivedBy: null, ...over },
  ] as const;

describe('Module 33 schema (real MariaDB)', () => {
  it('forbids a second subscription for the same Student + Month, but allows another month or another student', async () => {
    await inRolledBackTransaction(async (tx, q, fails) => {
      const run = (sql: string, r: Record<string, unknown>) => sequelize.query(sql, { replacements: r, transaction: sequelizeTransactionOf(tx) ?? null });
      const school = randomUUID();
      const student = randomUUID();
      await run(...insertSub(student, school, '2026-11'));
      await fails(...insertSub(student, school, '2026-11'));
      await run(...insertSub(student, school, '2026-12'));
      await run(...insertSub(randomUUID(), school, '2026-11'));
      expect((await q<{ n: number }>('SELECT COUNT(*) AS n FROM subscriptions WHERE school_id = :school', { school }))[0]!.n).toBe(3);
    });
  });

  it('forbids a second bulk batch for the same school and month', async () => {
    await inRolledBackTransaction(async (tx, _q, fails) => {
      const run = (sql: string, r: Record<string, unknown>) => sequelize.query(sql, { replacements: r, transaction: sequelizeTransactionOf(tx) ?? null });
      const school = randomUUID();
      await run(...insertBatch(school, '2026-11'));
      await fails(...insertBatch(school, '2026-11'));
      await run(...insertBatch(school, '2026-12'));
      await run(...insertBatch(randomUUID(), '2026-11'));
    });
  });

  it('enforces the status, month-format and paid/waived audit CHECKs', async () => {
    await inRolledBackTransaction(async (tx, _q, fails) => {
      const run = (sql: string, r: Record<string, unknown>) => sequelize.query(sql, { replacements: r, transaction: sequelizeTransactionOf(tx) ?? null });
      const school = randomUUID();
      const now = new Date();
      await fails(...insertSub(randomUUID(), school, '2026-11', { status: 'REFUNDED' }));
      await fails(...insertSub(randomUUID(), school, '2026-13'));
      await fails(...insertSub(randomUUID(), school, '26-11'));
      await fails(...insertSub(randomUUID(), school, '2026-11', { status: 'PAID' })); // PAID needs paid_at and paid_by
      await fails(...insertSub(randomUUID(), school, '2026-11', { status: 'UNPAID', paidAt: now, paidBy: randomUUID() }));
      await fails(...insertSub(randomUUID(), school, '2026-11', { status: 'PAID', paidAt: now, paidBy: randomUUID(), waivedAt: now, waivedBy: randomUUID() }));
      await run(...insertSub(randomUUID(), school, '2026-11', { status: 'PAID', paidAt: now, paidBy: randomUUID() }));
      await run(...insertSub(randomUUID(), school, '2026-11', { status: 'WAIVED', waivedAt: now, waivedBy: randomUUID() }));
    });
  });

  it('restricts deleting a batch that has subscriptions (the only foreign key of the module)', async () => {
    await inRolledBackTransaction(async (tx, _q, fails) => {
      const run = (sql: string, r: Record<string, unknown>) => sequelize.query(sql, { replacements: r, transaction: sequelizeTransactionOf(tx) ?? null });
      const school = randomUUID();
      const batch = randomUUID();
      await run(...insertBatch(school, '2026-11', batch));
      await run(...insertSub(randomUUID(), school, '2026-11', { batch }));
      await fails('DELETE FROM subscription_batches WHERE id = :batch', { batch });
      await fails(...insertSub(randomUUID(), school, '2026-11', { batch: randomUUID() })); // unknown batch
    });
  });

  it('allows ONE active Collector link per account and school, any number of ended ones, and keeps the active/ended CHECK', async () => {
    await inRolledBackTransaction(async (tx, _q, fails) => {
      const run = (sql: string, r: Record<string, unknown>) => sequelize.query(sql, { replacements: r, transaction: sequelizeTransactionOf(tx) ?? null });
      const user = randomUUID();
      const school = randomUUID();
      const link = (active: number | null, over: Record<string, unknown> = {}) =>
        [
          `INSERT INTO collector_school_links (id, user_id, organization_id, school_id, linked_at, linked_by, unlinked_at, unlinked_by, active, version, created_at, updated_at)
           VALUES (:id, :user, :org, :school, UTC_TIMESTAMP(3), :by, :unlinkedAt, :unlinkedBy, :active, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
          { id: randomUUID(), user, org: randomUUID(), school, by: randomUUID(), unlinkedAt: active === null ? new Date() : null, unlinkedBy: active === null ? randomUUID() : null, active, ...over },
        ] as const;
      await run(...link(1));
      await fails(...link(1)); // a second ACTIVE link for the same account and school
      await run(...link(null)); // ended links are history: any number
      await run(...link(null));
      await run(...link(1, { school: randomUUID() })); // another school is fine
      await fails(...link(1, { school: randomUUID(), unlinkedAt: new Date(), unlinkedBy: randomUUID() })); // active but with an end
      await fails(...link(null, { unlinkedAt: null, unlinkedBy: null })); // ended without an end
    });
  });

  it('the shared reminder table accepts the two subscription kinds and still rejects unknown ones', async () => {
    await inRolledBackTransaction(async (tx, _q, fails) => {
      const run = (sql: string, r: Record<string, unknown>) => sequelize.query(sql, { replacements: r, transaction: sequelizeTransactionOf(tx) ?? null });
      const row = (kind: string) => [`INSERT INTO notification_reminders (id, kind, subject_id, due_at, state, attempts, created_at, updated_at) VALUES (:id, :kind, :subject, UTC_TIMESTAMP(3), 'PENDING', 0, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`, { id: randomUUID(), kind, subject: randomUUID() }] as const;
      await run(...row('SUBSCRIPTION_UNPAID_3D'));
      await run(...row('SUBSCRIPTION_UNPAID_MONTH_END'));
      await run(...row('EXAM_24H'));
      await fails(...row('SUBSCRIPTION_UNPAID_1D'));
    });
  });
});

describe('Module 33 SQL repositories and the real service (inside a rolled-back transaction)', () => {
  it('bulk-creates one UNPAID subscription per student in chunks, records the batch, and refuses a second run', async () => {
    await inRolledBackTransaction(async (tx, q, _fails, savepointUow) => {
      const w = world(450); // more than one insert chunk
      const service = w.service('2026-11-10T09:00:00Z', savepointUow);
      const result = await service.createMonthlySubscriptions(w.schoolId, randomUUID(), tx);
      expect(result).toMatchObject({ month: '2026-11', count: 450 });
      expect((await q<{ n: number }>("SELECT COUNT(*) AS n FROM subscriptions WHERE school_id = :s AND status = 'UNPAID' AND month = '2026-11' AND batch_id = :b", { s: w.schoolId, b: result.batchId }))[0]!.n).toBe(450);
      expect(await codeOf(service.createMonthlySubscriptions(w.schoolId, randomUUID(), tx))).toBe('SUBSCRIPTIONS_ALREADY_CREATED_FOR_MONTH');
      expect((await q<{ n: number }>('SELECT COUNT(*) AS n FROM subscriptions WHERE school_id = :s', { s: w.schoolId }))[0]!.n).toBe(450);
    });
  });

  it('creates an individual subscription for a late student after the bulk run and refuses a duplicate', async () => {
    await inRolledBackTransaction(async (tx, q, _f, savepointUow) => {
      const w = world(2);
      const service = w.service('2026-11-10T09:00:00Z', savepointUow);
      expect(await codeOf(service.createIndividualSubscription(w.schoolId, w.studentIds[0]!, randomUUID(), tx))).toBe('SUBSCRIPTIONS_NOT_CREATED_FOR_MONTH');
      await service.createMonthlySubscriptions(w.schoolId, randomUUID(), tx);
      expect(await codeOf(service.createIndividualSubscription(w.schoolId, w.studentIds[0]!, randomUUID(), tx))).toBe('SUBSCRIPTION_ALREADY_EXISTS');
      const late = randomUUID();
      w.studentIds.push(late);
      const sub = await service.createIndividualSubscription(w.schoolId, late, randomUUID(), tx);
      expect(sub).toMatchObject({ studentId: late, status: 'UNPAID', month: '2026-11' });
      expect((await q<{ n: number }>("SELECT COUNT(*) AS n FROM subscriptions WHERE school_id = :s AND batch_id IS NULL", { s: w.schoolId }))[0]!.n).toBe(1);
    });
  });

  it('applies the Oldest-Unpaid Rule in SQL across paid, waived and unpaid months, and writes the audit columns', async () => {
    await inRolledBackTransaction(async (tx, q, _f, savepointUow) => {
      const w = world(1);
      const actor = randomUUID();
      const ids: string[] = [];
      for (const now of ['2026-09-10T09:00:00Z', '2026-10-10T09:00:00Z', '2026-11-10T09:00:00Z']) {
        const service = w.service(now, savepointUow);
        await service.createMonthlySubscriptions(w.schoolId, actor, tx);
        ids.push((await subRepo.findByStudentMonth(w.studentIds[0]!, now.slice(0, 7), tx))!.id);
      }
      const service = w.service('2026-11-12T09:00:00Z', savepointUow);
      expect(await codeOf(service.markPaid(ids[2]!, actor, tx))).toBe('OLDER_UNPAID_SUBSCRIPTIONS_EXIST');
      expect(await codeOf(service.markPaid(ids[1]!, actor, tx))).toBe('OLDER_UNPAID_SUBSCRIPTIONS_EXIST');
      expect((await service.markPaid(ids[0]!, actor, tx)).status).toBe('PAID');
      expect(await codeOf(service.markPaid(ids[0]!, actor, tx))).toBe('SUBSCRIPTION_ALREADY_PAID');
      expect((await service.waiveSubscription(ids[1]!, actor, tx)).status).toBe('WAIVED');
      expect(await codeOf(service.markPaid(ids[1]!, actor, tx))).toBe('SUBSCRIPTION_NOT_UNPAID');
      expect((await service.markPaid(ids[2]!, actor, tx)).status).toBe('PAID');
      const rows = await q<{ status: string; paid_by: string | null; waived_by: string | null }>('SELECT status, paid_by, waived_by FROM subscriptions WHERE student_id = :s ORDER BY month', { s: w.studentIds[0] });
      expect(rows.map((r) => r.status)).toEqual(['PAID', 'WAIVED', 'PAID']);
      expect(rows[0]!.paid_by).toBe(actor);
      expect(rows[1]!.waived_by).toBe(actor);
    });
  });

  it('is atomic: a failing bulk insert leaves no batch and no subscription', async () => {
    await inRolledBackTransaction(async (tx, q, _f, savepointUow) => {
      const w = world(3);
      w.studentIds.push(w.studentIds[0]!); // the roster lists one student twice: the unique (student, month) index fails the insert
      const service = w.service('2026-11-10T09:00:00Z', savepointUow);
      expect(await codeOf(service.createMonthlySubscriptions(w.schoolId, randomUUID()))).toBe('SUBSCRIPTION_ALREADY_EXISTS'); // no `tx`: the service opens its own unit of work (a savepoint here)
      expect(tx).toBeDefined();
      expect((await q<{ n: number }>('SELECT COUNT(*) AS n FROM subscription_batches WHERE school_id = :s', { s: w.schoolId }))[0]!.n).toBe(0);
      expect((await q<{ n: number }>('SELECT COUNT(*) AS n FROM subscriptions WHERE school_id = :s', { s: w.schoolId }))[0]!.n).toBe(0);
    });
  });

  it('repository: optimistic lock, listing filters and order, unpaid-of-month, batch reads', async () => {
    await inRolledBackTransaction(async (tx, _q, _f, savepointUow) => {
      const w = world(3);
      const actor = randomUUID();
      const service = w.service('2026-11-10T09:00:00Z', savepointUow);
      const bulk = await service.createMonthlySubscriptions(w.schoolId, actor, tx);
      const list = await subRepo.listByBatch(bulk.batchId, tx);
      expect(list).toHaveLength(3);
      // a stale update is a concurrent modification
      const fresh = (await subRepo.findById(list[0]!.id, tx))!;
      const stale = (await subRepo.findById(list[0]!.id, tx))!;
      fresh.waive(actor, clock('2026-11-11T09:00:00Z'));
      await subRepo.update(fresh, tx);
      stale.waive(actor, clock('2026-11-11T09:00:00Z'));
      expect(await codeOf(subRepo.update(stale, tx))).toBe('SUBSCRIPTION_CONCURRENT_MODIFICATION');
      expect((await subRepo.listUnpaidOfSchoolMonth(w.schoolId, '2026-11', tx)).map((s) => s.id).sort()).toEqual(list.slice(1).map((s) => s.id).sort());
      const page = await subRepo.list({ schoolId: w.schoolId, status: ['WAIVED'], direction: 'desc', page: { page: 1, pageSize: 10 } }, tx);
      expect(page.total).toBe(1);
      expect((await subRepo.findBatchBySchoolMonth(w.schoolId, '2026-11', tx))?.snapshot.count).toBe(3);
      expect((await subRepo.findBatchById(bulk.batchId, tx))?.snapshot.schoolId).toBe(w.schoolId);
      expect(await subRepo.findBatchBySchoolMonth(w.schoolId, '2026-12', tx)).toBeUndefined();
    });
  });

  it('Collector links: insert, one active per school, end keeps history, lookups, organization of an account', async () => {
    await inRolledBackTransaction(async (tx) => {
      const user = randomUUID();
      const org = randomUUID();
      const school = randomUUID();
      const school2 = randomUUID();
      const actor = randomUUID();
      const c = clock('2026-11-10T09:00:00Z');
      const link = CollectorSchoolLink.link({ userId: user, organizationId: org, schoolId: school, linkedBy: actor, clock: c });
      await linkRepo.insert(link, tx);
      expect(await codeOf(linkRepo.insert(CollectorSchoolLink.link({ userId: user, organizationId: org, schoolId: school, linkedBy: actor, clock: c }), tx))).toBe('COLLECTOR_ALREADY_LINKED_TO_SCHOOL');
      await linkRepo.insert(CollectorSchoolLink.link({ userId: user, organizationId: org, schoolId: school2, linkedBy: actor, clock: c }), tx);
      expect((await linkRepo.listActiveByUser(user, tx)).map((l) => l.snapshot.schoolId).sort()).toEqual([school, school2].sort());
      expect((await linkRepo.listActiveBySchool(school, tx)).map((l) => l.snapshot.userId)).toEqual([user]);
      expect(await linkRepo.findOrganizationOfUser(user, tx)).toBe(org);

      const locked = (await linkRepo.lockActive(user, school, tx))!;
      locked.unlink(actor, clock('2026-11-11T09:00:00Z'));
      await linkRepo.update(locked, tx);
      expect(await linkRepo.findActive(user, school, tx)).toBeUndefined();
      expect(await linkRepo.findActive(user, school2, tx)).toBeDefined();
      expect(await linkRepo.listHistoryByUser(user, tx)).toHaveLength(2);
      expect(await linkRepo.findOrganizationOfUser(user, tx)).toBe(org); // history still pins the organization
      // after the end a NEW active link to the same school is allowed (a second history row)
      await linkRepo.insert(CollectorSchoolLink.link({ userId: user, organizationId: org, schoolId: school, linkedBy: actor, clock: c }), tx);
      expect(await linkRepo.listHistoryByUser(user, tx)).toHaveLength(3);
      // a stale unlink is a concurrent modification
      const stale = CollectorSchoolLink.rehydrate({ ...locked.snapshot, unlinkedAt: null, unlinkedBy: null });
      stale.unlink(actor, c);
      expect(await codeOf(linkRepo.update(stale, tx))).toBe('COLLECTOR_CONCURRENT_MODIFICATION');
    });
  });

  it('entities round-trip through SQL without losing data', async () => {
    await inRolledBackTransaction(async (tx) => {
      const school = randomUUID();
      const batch = SubscriptionBatch.record({ schoolId: school, organizationId: randomUUID(), month: '2026-11', count: 1, createdBy: randomUUID(), clock: clock('2026-11-10T09:00:00Z') });
      await subRepo.insertBatch(batch, tx);
      const sub = Subscription.openInBatch({ studentId: randomUUID(), schoolId: school, organizationId: batch.snapshot.organizationId, month: '2026-11', createdBy: randomUUID(), batchId: batch.id, clock: clock('2026-11-10T09:00:00Z') });
      await subRepo.insert(sub, tx);
      const read = (await subRepo.findById(sub.id, tx))!;
      expect(read.snapshot).toMatchObject({ studentId: sub.snapshot.studentId, schoolId: school, month: '2026-11', status: 'UNPAID', batchId: batch.id, version: 1 });
      expect(read.snapshot.createdAt.toISOString()).toBe('2026-11-10T09:00:00.000Z');
    });
  });
});

describe('Module 33 concurrency (real parallel connections; committed data is deleted afterwards)', () => {
  afterAll(async () => {
    const schools = [...created.schools];
    const students = [...created.students];
    if (schools.length > 0) {
      await sequelize.query('DELETE FROM subscriptions WHERE school_id IN (:schools)', { replacements: { schools } });
      await sequelize.query('DELETE FROM subscription_batches WHERE school_id IN (:schools)', { replacements: { schools } });
    }
    if (students.length > 0) await sequelize.query('DELETE FROM subscriptions WHERE student_id IN (:students)', { replacements: { students } });
    await sequelize.close();
  });

  it('two simultaneous bulk creations for the same school and month: exactly one wins, the other is told it already exists, and nothing is duplicated', async () => {
    for (let round = 0; round < 5; round += 1) {
      const w = world(30);
      const results = await Promise.all([1, 2, 3].map(() => codeOf(w.service('2026-11-10T09:00:00Z').createMonthlySubscriptions(w.schoolId, randomUUID()))));
      expect(results.filter((r) => r === 'NO_ERROR')).toHaveLength(1);
      expect(results.filter((r) => r === 'SUBSCRIPTIONS_ALREADY_CREATED_FOR_MONTH')).toHaveLength(2);
      const [{ n }] = (await sequelize.query<{ n: number }>('SELECT COUNT(*) AS n FROM subscriptions WHERE school_id = :s', { replacements: { s: w.schoolId }, type: QueryTypes.SELECT })) as [{ n: number }];
      expect(Number(n)).toBe(30);
    }
  });

  it('a bulk run racing with individual creations never duplicates a Student + Month', async () => {
    const w = world(10);
    const late = randomUUID();
    created.students.add(late);
    await w.service('2026-11-10T09:00:00Z').createMonthlySubscriptions(w.schoolId, randomUUID());
    w.studentIds.push(late);
    const outcomes = await Promise.all([1, 2, 3, 4].map(() => codeOf(w.service('2026-11-10T09:00:00Z').createIndividualSubscription(w.schoolId, late, randomUUID()))));
    expect(outcomes.filter((o) => o === 'NO_ERROR')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'SUBSCRIPTION_ALREADY_EXISTS')).toHaveLength(3);
  });

  it('with the real unit of work a failing bulk insert leaves NO batch behind, so the run can be retried', async () => {
    const w = world(3);
    const duplicated = [...w.studentIds, w.studentIds[0]!];
    const failing = { ...w.roster, listActiveStudentIds: async () => duplicated };
    const schools = { findById: async (id: string) => ({ id, organizationId: w.organizationId, status: 'ACTIVE' }) } as never;
    const broken = new SubscriptionService({ subscriptions: subRepo, roster: failing, schools, unitOfWork: uow, outbox: noopOutbox, clock: clock('2026-11-10T09:00:00Z') });
    expect(await codeOf(broken.createMonthlySubscriptions(w.schoolId, randomUUID()))).toBe('SUBSCRIPTION_ALREADY_EXISTS');
    expect(await subRepo.findBatchBySchoolMonth(w.schoolId, '2026-11')).toBeUndefined();
    expect(Number((await sequelize.query<{ n: number }>('SELECT COUNT(*) AS n FROM subscriptions WHERE school_id = :s', { replacements: { s: w.schoolId }, type: QueryTypes.SELECT }))[0]!.n)).toBe(0);
    expect((await w.service('2026-11-10T09:00:00Z').createMonthlySubscriptions(w.schoolId, randomUUID())).count).toBe(3);
  });

  it('the same subscription paid by two payments at once: exactly one succeeds (one payment per subscription)', async () => {
    const w = world(1);
    const service = w.service('2026-11-10T09:00:00Z');
    await service.createMonthlySubscriptions(w.schoolId, randomUUID());
    const sub = (await subRepo.findByStudentMonth(w.studentIds[0]!, '2026-11'))!;
    const outcomes = await Promise.all([1, 2, 3].map(() => codeOf(service.markPaid(sub.id, randomUUID()))));
    expect(outcomes.filter((o) => o === 'NO_ERROR')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'SUBSCRIPTION_ALREADY_PAID')).toHaveLength(2);
  });

  it('paying and waiving the same subscription at once: exactly one wins', async () => {
    const w = world(1);
    const service = w.service('2026-11-10T09:00:00Z');
    await service.createMonthlySubscriptions(w.schoolId, randomUUID());
    const sub = (await subRepo.findByStudentMonth(w.studentIds[0]!, '2026-11'))!;
    const outcomes = await Promise.all([codeOf(service.markPaid(sub.id, randomUUID())), codeOf(service.waiveSubscription(sub.id, randomUUID()))]);
    expect(outcomes.filter((o) => o === 'NO_ERROR')).toHaveLength(1);
    expect(['SUBSCRIPTION_ALREADY_PAID', 'SUBSCRIPTION_NOT_UNPAID']).toContain(outcomes.find((o) => o !== 'NO_ERROR'));
  });

  it('OLDEST-UNPAID under concurrency: paying October and September at the same time never leaves October PAID while September is UNPAID', async () => {
    for (let round = 0; round < 12; round += 1) {
      const w = world(1);
      const student = w.studentIds[0]!;
      for (const now of ['2026-09-10T09:00:00Z', '2026-10-10T09:00:00Z']) await w.service(now).createMonthlySubscriptions(w.schoolId, randomUUID());
      const sep = (await subRepo.findByStudentMonth(student, '2026-09'))!;
      const oct = (await subRepo.findByStudentMonth(student, '2026-10'))!;
      const service = w.service('2026-10-12T09:00:00Z');
      const [octResult, sepResult] = await Promise.all([codeOf(service.markPaid(oct.id, randomUUID())), codeOf(service.markPaid(sep.id, randomUUID()))]);
      expect(sepResult).toBe('NO_ERROR');
      expect(['NO_ERROR', 'OLDER_UNPAID_SUBSCRIPTIONS_EXIST']).toContain(octResult);
      const rows = await sequelize.query<{ month: string; status: string }>('SELECT month, status FROM subscriptions WHERE student_id = :s ORDER BY month', { replacements: { s: student }, type: QueryTypes.SELECT });
      expect(rows.find((r) => r.month === '2026-09')!.status).toBe('PAID');
      // the invariant: a PAID October implies September is settled
      const octStatus = rows.find((r) => r.month === '2026-10')!.status;
      expect(octStatus === 'PAID' ? octResult === 'NO_ERROR' : octResult === 'OLDER_UNPAID_SUBSCRIPTIONS_EXIST').toBe(true);
    }
  });

  it('OLDEST-UNPAID under concurrency: waiving September while October is being paid is serialized, never inconsistent', async () => {
    for (let round = 0; round < 8; round += 1) {
      const w = world(1);
      const student = w.studentIds[0]!;
      for (const now of ['2026-09-10T09:00:00Z', '2026-10-10T09:00:00Z']) await w.service(now).createMonthlySubscriptions(w.schoolId, randomUUID());
      const sep = (await subRepo.findByStudentMonth(student, '2026-09'))!;
      const oct = (await subRepo.findByStudentMonth(student, '2026-10'))!;
      const service = w.service('2026-10-12T09:00:00Z');
      const [octResult, waiveResult] = await Promise.all([codeOf(service.markPaid(oct.id, randomUUID())), codeOf(service.waiveSubscription(sep.id, randomUUID()))]);
      expect(waiveResult).toBe('NO_ERROR');
      const rows = await sequelize.query<{ month: string; status: string }>('SELECT month, status FROM subscriptions WHERE student_id = :s ORDER BY month', { replacements: { s: student }, type: QueryTypes.SELECT });
      expect(rows.find((r) => r.month === '2026-09')!.status).toBe('WAIVED');
      const octStatus = rows.find((r) => r.month === '2026-10')!.status;
      expect(octStatus === 'PAID' ? octResult === 'NO_ERROR' : octResult === 'OLDER_UNPAID_SUBSCRIPTIONS_EXIST').toBe(true);
    }
  });
});
