/**
 * Real-database checks for Module 34 (Payments & Collection): the schema (CASH-only, status / reversal / month CHECKs, the "one SUCCESSFUL payment per subscription" unique index
 * that still allows reversed history), the SQL repository, the real PaymentService on the real SubscriptionService (record, Oldest-Unpaid Rule, reversal, atomic rollback) and
 * CONCURRENCY with real parallel connections. NOT part of `npm test`.
 * Prerequisite: `npm run db:migrate`. Run: npm run test:db
 * It needs real commits (concurrency), so it uses random ids that belong to no other table (Modules 33 and 34 have no foreign keys to other modules' tables) and deletes
 * everything it created in `afterAll` (the application itself never deletes a payment; this cleanup is test housekeeping only).
 */
import { randomUUID } from 'node:crypto';
import { QueryTypes } from 'sequelize';
import { afterAll, describe, expect, it } from 'vitest';
import { env } from '../../src/config/env';
import { AppError, type UnitOfWork } from '../../src/modules/00-shared-kernel/public';
import { SequelizeUnitOfWork, createSequelize } from '../../src/modules/02-database/public';
import type { OutboxService } from '../../src/modules/06-domain-events-outbox/public';
import { SequelizeSubscriptionRepository, SubscriptionPaymentTransitions, SubscriptionService, type StudentRoster } from '../../src/modules/33-subscriptions/public';
import { Payment, PaymentService, SequelizePaymentRepository } from '../../src/modules/34-payments-collection/public';

const sequelize = createSequelize(env.database);
const uow = new SequelizeUnitOfWork(sequelize);
const noopOutbox = { publishFrom: async () => undefined } as unknown as OutboxService;
const codeOf = (p: Promise<unknown>) => p.then(() => 'NO_ERROR', (e: unknown) => (e instanceof AppError ? e.code : `OTHER:${(e as Error).message}`));
const subRepo = new SequelizeSubscriptionRepository(sequelize);
const payRepo = new SequelizePaymentRepository(sequelize);
const clock = (iso: string) => ({ now: () => new Date(iso) });
const created = { schools: new Set<string>() };
const manager = randomUUID();

interface World {
  schoolId: string;
  organizationId: string;
  studentIds: string[];
  subs: (now: string, unitOfWork?: UnitOfWork) => SubscriptionService;
  pay: (now: string, unitOfWork?: UnitOfWork) => PaymentService;
  subscriptionOf: (studentId: string, month: string) => Promise<string>;
}
function world(studentCount: number): World {
  const schoolId = randomUUID();
  const organizationId = randomUUID();
  const studentIds: string[] = Array.from({ length: studentCount }, () => randomUUID());
  created.schools.add(schoolId);
  const roster: StudentRoster = {
    find: async (id) => (studentIds.includes(id) ? { id, fullName: `Student ${id.slice(0, 4)}`, schoolId, organizationId, status: 'ACTIVE' } : undefined),
    listActiveStudentIds: async () => [...studentIds],
  };
  const schools = { findById: async (id: string) => (id === schoolId ? { id, organizationId, status: 'ACTIVE' } : undefined) } as never;
  const subs = (now: string, unitOfWork: UnitOfWork = uow) => new SubscriptionService({ subscriptions: subRepo, roster, schools, unitOfWork, outbox: noopOutbox, clock: clock(now) });
  const pay = (now: string, unitOfWork: UnitOfWork = uow) => new PaymentService({ payments: payRepo, subscriptions: new SubscriptionPaymentTransitions({ subscriptions: subRepo, outbox: noopOutbox, clock: clock(now) }), unitOfWork, outbox: noopOutbox, clock: clock(now) });
  const subscriptionOf = async (studentId: string, month: string) => (await subRepo.findByStudentMonth(studentId, month))!.id;
  return { schoolId, organizationId, studentIds, subs, pay, subscriptionOf };
}
const OCT = '2026-10-10T09:00:00Z';
const NOV = '2026-11-10T09:00:00Z';
const statusOf = async (id: string) => (await subRepo.findById(id))!.status;
const rowsOf = (subscriptionId: string) => sequelize.query<{ status: string; active: number | null }>('SELECT status, active FROM payments WHERE subscription_id = :id ORDER BY recorded_at, id', { replacements: { id: subscriptionId }, type: QueryTypes.SELECT });

afterAll(async () => {
  const ids = [...created.schools];
  if (ids.length > 0) {
    await sequelize.query('DELETE FROM payments WHERE school_id IN (:ids)', { replacements: { ids } });
    await sequelize.query('DELETE FROM subscriptions WHERE school_id IN (:ids)', { replacements: { ids } });
    await sequelize.query('DELETE FROM subscription_batches WHERE school_id IN (:ids)', { replacements: { ids } });
  }
  await sequelize.close();
});

describe('payments schema', () => {
  const insert = (over: Record<string, unknown> = {}) => {
    const v = { id: randomUUID(), subscription_id: randomUUID(), student_id: randomUUID(), school_id: randomUUID(), organization_id: randomUUID(), month: '2026-11', method: 'CASH', status: 'SUCCESSFUL', active: 1, recorded_by: randomUUID(), reversed_by: null, reversed_at: null, reversal_reason: null, ...over };
    created.schools.add(v.school_id as string);
    return sequelize.query(
      `INSERT INTO payments (id, subscription_id, student_id, school_id, organization_id, month, method, status, active, recorded_by, recorded_at, reversed_by, reversed_at, reversal_reason, version, created_at, updated_at)
       VALUES (:id, :subscription_id, :student_id, :school_id, :organization_id, :month, :method, :status, :active, :recorded_by, NOW(3), :reversed_by, :reversed_at, :reversal_reason, 1, NOW(3), NOW(3))`,
      { replacements: v },
    );
  };
  const reversed = { status: 'REVERSED', active: null, reversed_by: randomUUID(), reversed_at: new Date(), reversal_reason: 'reason' };

  it('accepts a valid SUCCESSFUL and a valid REVERSED row', async () => {
    await insert();
    await insert(reversed);
  });
  it('is CASH ONLY', async () => {
    await expect(insert({ method: 'CARD' })).rejects.toThrow();
    await expect(insert({ method: 'cash ' })).rejects.toThrow();
    await expect(insert({ method: 'Cash' })).rejects.toThrow();
    await expect(insert({ status: 'successful' })).rejects.toThrow();
  });
  it('refuses an unknown status and a malformed month', async () => {
    await expect(insert({ status: 'PENDING' })).rejects.toThrow();
    await expect(insert({ month: '2026-13' })).rejects.toThrow();
    await expect(insert({ month: '26-11' })).rejects.toThrow();
  });
  it('keeps the reversal columns consistent with the status (a reversal needs reason, actor and time)', async () => {
    await expect(insert({ reversed_by: randomUUID() })).rejects.toThrow(); // SUCCESSFUL with reversal data
    await expect(insert({ ...reversed, reversal_reason: null })).rejects.toThrow();
    await expect(insert({ ...reversed, reversal_reason: '   ' })).rejects.toThrow();
    await expect(insert({ ...reversed, reversed_by: null })).rejects.toThrow();
    await expect(insert({ ...reversed, reversed_at: null })).rejects.toThrow();
    await expect(insert({ ...reversed, active: 1 })).rejects.toThrow();
    await expect(insert({ active: null })).rejects.toThrow(); // SUCCESSFUL must be active
  });
  it('allows ONE successful payment per subscription and any number of reversed ones', async () => {
    const subscription_id = randomUUID();
    await insert({ subscription_id });
    await expect(insert({ subscription_id })).rejects.toMatchObject({ name: 'SequelizeUniqueConstraintError' });
    await insert({ subscription_id, ...reversed });
    await insert({ subscription_id, ...reversed });
    expect(await rowsOf(subscription_id)).toHaveLength(3);
  });
  it('has no amount column', async () => {
    const cols = await sequelize.query<{ COLUMN_NAME: string }>("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payments'", { type: QueryTypes.SELECT });
    expect(cols.map((c) => c.COLUMN_NAME).filter((c) => /amount|price|fee|total/i.test(c))).toEqual([]);
  });
});

describe('the SQL repository', () => {
  it('inserts, reads, updates with the optimistic lock, and maps a second successful payment to PAYMENT_ALREADY_RECORDED', async () => {
    const w = world(1);
    const base = { subscriptionId: randomUUID(), studentId: randomUUID(), schoolId: w.schoolId, organizationId: w.organizationId, month: '2026-11', recordedBy: manager, clock: clock(NOV) };
    const a = Payment.record(base);
    await uow.run((tx) => payRepo.insert(a, tx));
    expect(await codeOf(uow.run((tx) => payRepo.insert(Payment.record(base), tx)))).toBe('PAYMENT_ALREADY_RECORDED');
    const loaded = (await payRepo.findById(a.id))!;
    expect(loaded.snapshot).toMatchObject({ status: 'SUCCESSFUL', method: 'CASH', month: '2026-11', version: 1 });
    const stale = (await payRepo.findById(a.id))!;
    loaded.reverse(manager, 'reason', clock(NOV));
    await uow.run((tx) => payRepo.update(loaded, tx));
    stale.reverse(manager, 'other', clock(NOV));
    expect(await codeOf(uow.run((tx) => payRepo.update(stale, tx)))).toBe('PAYMENT_CONCURRENT_MODIFICATION');
    expect((await payRepo.findById(a.id))!.snapshot).toMatchObject({ status: 'REVERSED', reversalReason: 'reason', reversedBy: manager, version: 2 });
    // after the reversal the same subscription may get a new SUCCESSFUL payment
    await uow.run((tx) => payRepo.insert(Payment.record(base), tx));
    const page = await payRepo.list({ schoolId: w.schoolId, direction: 'desc', page: { page: 1, pageSize: 10 } });
    expect(page.total).toBe(2);
    expect((await payRepo.list({ schoolId: w.schoolId, status: ['REVERSED'], direction: 'desc', page: { page: 1, pageSize: 10 } })).total).toBe(1);
  });
});

describe('the real PaymentService on real SQL', () => {
  it('records, enforces the Oldest-Unpaid Rule, reverses (keeping the row) and allows a new payment afterwards', async () => {
    const w = world(1);
    await w.subs(OCT).createMonthlySubscriptions(w.schoolId, manager);
    await w.subs(NOV).createMonthlySubscriptions(w.schoolId, manager);
    const oct = await w.subscriptionOf(w.studentIds[0]!, '2026-10');
    const nov = await w.subscriptionOf(w.studentIds[0]!, '2026-11');
    expect(await codeOf(w.pay(NOV).recordPayment(nov, manager))).toBe('OLDER_UNPAID_SUBSCRIPTIONS_EXIST');
    expect(await rowsOf(nov)).toHaveLength(0);
    expect(await statusOf(nov)).toBe('UNPAID');
    const pOct = await w.pay(NOV).recordPayment(oct, manager);
    const pNov = await w.pay(NOV).recordPayment(nov, manager);
    expect(await codeOf(w.pay(NOV).recordPayment(nov, manager))).toBe('SUBSCRIPTION_ALREADY_PAID');
    expect(await codeOf(w.pay(NOV).reversePayment(pOct.id, 'reason', manager))).toBe('NEWER_PAID_SUBSCRIPTIONS_EXIST');
    expect(await statusOf(oct)).toBe('PAID');
    expect(await rowsOf(oct)).toEqual([{ status: 'SUCCESSFUL', active: 1 }]);
    await w.pay(NOV).reversePayment(pNov.id, 'mistake', manager);
    await w.pay(NOV).reversePayment(pOct.id, 'mistake', manager); // a PAST month may be reversed
    expect(await statusOf(oct)).toBe('UNPAID');
    expect(await rowsOf(oct)).toEqual([{ status: 'REVERSED', active: null }]); // kept, never deleted
    await w.pay('2026-11-12T09:00:00Z').recordPayment(oct, manager); // a later instant, so the history order is deterministic
    expect((await rowsOf(oct)).map((r) => r.status)).toEqual(['REVERSED', 'SUCCESSFUL']);
  });

  it('rolls back the payment AND the status together when the transaction fails', async () => {
    const w = world(1);
    await w.subs(NOV).createMonthlySubscriptions(w.schoolId, manager);
    const sub = await w.subscriptionOf(w.studentIds[0]!, '2026-11');
    await expect(
      uow.run(async (tx) => {
        await w.pay(NOV).recordPayment(sub, manager, undefined, tx);
        throw new Error('later step failed');
      }),
    ).rejects.toThrow('later step failed');
    expect(await rowsOf(sub)).toHaveLength(0);
    expect(await statusOf(sub)).toBe('UNPAID');
  });
});

describe('concurrency (real parallel connections)', () => {
  it('two simultaneous payments of the same subscription: exactly one wins, one row, one PAID', async () => {
    const w = world(1);
    await w.subs(NOV).createMonthlySubscriptions(w.schoolId, manager);
    const sub = await w.subscriptionOf(w.studentIds[0]!, '2026-11');
    const results = await Promise.all(Array.from({ length: 4 }, () => codeOf(w.pay(NOV).recordPayment(sub, manager))));
    expect(results.filter((r) => r === 'NO_ERROR')).toHaveLength(1);
    expect(results.filter((r) => r !== 'NO_ERROR').every((r) => ['SUBSCRIPTION_ALREADY_PAID', 'PAYMENT_ALREADY_RECORDED', 'SUBSCRIPTION_CONCURRENT_MODIFICATION'].includes(r))).toBe(true);
    expect(await rowsOf(sub)).toEqual([{ status: 'SUCCESSFUL', active: 1 }]);
    expect(await statusOf(sub)).toBe('PAID');
  });

  it('two simultaneous reversals of the same payment: exactly one wins, the reason is never overwritten', async () => {
    const w = world(1);
    await w.subs(NOV).createMonthlySubscriptions(w.schoolId, manager);
    const sub = await w.subscriptionOf(w.studentIds[0]!, '2026-11');
    const payment = await w.pay(NOV).recordPayment(sub, manager);
    const results = await Promise.all(['one', 'two', 'three'].map((r) => codeOf(w.pay(NOV).reversePayment(payment.id, r, manager))));
    expect(results.filter((r) => r === 'NO_ERROR')).toHaveLength(1);
    expect(await statusOf(sub)).toBe('UNPAID');
    expect((await rowsOf(sub)).map((r) => r.status)).toEqual(['REVERSED']);
  });

  it('paying the newer month and the older month at the same time never leaves the newer one PAID behind an unpaid older one', async () => {
    const w = world(1);
    await w.subs(OCT).createMonthlySubscriptions(w.schoolId, manager);
    await w.subs(NOV).createMonthlySubscriptions(w.schoolId, manager);
    const oct = await w.subscriptionOf(w.studentIds[0]!, '2026-10');
    const nov = await w.subscriptionOf(w.studentIds[0]!, '2026-11');
    await Promise.all([codeOf(w.pay(NOV).recordPayment(nov, manager)), codeOf(w.pay(NOV).recordPayment(oct, manager))]);
    const octStatus = await statusOf(oct);
    const novStatus = await statusOf(nov);
    expect(novStatus === 'PAID' ? octStatus === 'PAID' : true).toBe(true); // §59 holds whichever order the two transactions took
  });
});
