import { describe, expect, it } from 'vitest';
import { AppError } from '../../../src/modules/00-shared-kernel/public';
import { Subscription } from '../../../src/modules/33-subscriptions/public';
import { createSubscriptionsHarness } from '../../helpers/subscriptions-harness';

const codeOf = (p: Promise<unknown>) => p.then(() => 'NO_ERROR', (e: unknown) => (e instanceof AppError ? e.code : `NOT_APP_ERROR:${String(e)}`));

/** One student with September, October and November 2026 subscriptions; the clock is left on 2026-11-10 (Cairo, current month = 2026-11). */
async function threeMonths() {
  const t = await createSubscriptionsHarness();
  const school = await t.newSchool();
  const manager = await t.newSchoolManager(school.id);
  const student = await t.newStudent(school.id, manager.id);
  const ids: Record<string, string> = {};
  for (const [month, now] of [['2026-09', '2026-09-10T09:00:00Z'], ['2026-10', '2026-10-10T09:00:00Z'], ['2026-11', '2026-11-10T09:00:00Z']] as const) {
    t.setNow(now);
    await t.subscriptions.createMonthlySubscriptions(school.id, manager.id);
    ids[month] = (await t.subscriptionRepo.findByStudentMonth(student.id, month))!.id;
  }
  const status = (month: string) => t.subscriptionRepo.rows.get(ids[month]!)!.status;
  return { t, school, manager, student, ids, status };
}
const payAll = async (w: Awaited<ReturnType<typeof threeMonths>>) => {
  for (const month of ['2026-09', '2026-10', '2026-11']) await w.t.subscriptions.markPaid(w.ids[month]!, w.manager.id);
};

describe('mark-paid (the existing markPaid contract) rejects every invalid transition', () => {
  it('UNPAID -> PAID succeeds once and publishes SubscriptionPaid exactly once', async () => {
    const { t, manager, ids } = await threeMonths();
    const paid = await t.subscriptions.markPaid(ids['2026-09']!, manager.id);
    expect(paid).toMatchObject({ status: 'PAID' });
    expect(t.events('SubscriptionPaid')).toHaveLength(1);
    expect(await codeOf(t.subscriptions.markPaid(ids['2026-09']!, manager.id))).toBe('SUBSCRIPTION_ALREADY_PAID');
    expect(t.events('SubscriptionPaid')).toHaveLength(1); // a rejected call publishes nothing
  });

  it('a WAIVED subscription cannot be marked PAID, and the Oldest-Unpaid Rule cannot be bypassed', async () => {
    const { t, manager, ids, status } = await threeMonths();
    await t.subscriptions.waiveSubscription(ids['2026-09']!, manager.id);
    expect(await codeOf(t.subscriptions.markPaid(ids['2026-09']!, manager.id))).toBe('SUBSCRIPTION_NOT_UNPAID');
    expect(await codeOf(t.subscriptions.markPaid(ids['2026-11']!, manager.id))).toBe('OLDER_UNPAID_SUBSCRIPTIONS_EXIST'); // October is still unpaid
    expect(status('2026-11')).toBe('UNPAID');
    expect(t.events('SubscriptionPaid')).toHaveLength(0);
  });
});

describe('mark-unpaid: PAID -> UNPAID only, only for the CURRENT Africa/Cairo month', () => {
  it('changes a PAID subscription of the current month back to UNPAID, clears the paid audit, and publishes SubscriptionMarkedUnpaid but never SubscriptionPaid', async () => {
    const w = await threeMonths();
    const { t, manager, ids } = w;
    await payAll(w);
    expect(t.events('SubscriptionPaid')).toHaveLength(3);

    const result = await t.subscriptions.markUnpaid(ids['2026-11']!, manager.id);
    expect(result).toMatchObject({ status: 'UNPAID', paidAt: null, waivedAt: null });
    const row = t.subscriptionRepo.rows.get(ids['2026-11']!)!;
    expect(row).toMatchObject({ status: 'UNPAID', paidAt: null, paidBy: null, waivedAt: null, waivedBy: null });
    expect(t.events('SubscriptionPaid')).toHaveLength(3); // no new SubscriptionPaid
    const [event] = t.events('SubscriptionMarkedUnpaid');
    expect(t.events('SubscriptionMarkedUnpaid')).toHaveLength(1);
    expect(JSON.parse(event!.payload)).toMatchObject({ subscriptionId: ids['2026-11'], month: '2026-11', actorId: manager.id });
    expect(event!.payload).not.toMatch(/amount|name|phone/i);
    expect(w.status('2026-10')).toBe('PAID'); // the older months are untouched
  });

  it('a subscription of ANY past month is rejected, whatever its status', async () => {
    const w = await threeMonths();
    const { t, manager, ids } = w;
    await t.subscriptions.markPaid(ids['2026-09']!, manager.id);
    await t.subscriptions.waiveSubscription(ids['2026-10']!, manager.id);
    // September is PAID, October WAIVED, and (below) an old UNPAID one: all are in the past (clock is in November)
    expect(await codeOf(t.subscriptions.markUnpaid(ids['2026-09']!, manager.id))).toBe('SUBSCRIPTION_MONTH_NOT_CURRENT');
    expect(await codeOf(t.subscriptions.markUnpaid(ids['2026-10']!, manager.id))).toBe('SUBSCRIPTION_MONTH_NOT_CURRENT');
    const past = Subscription.openInBatch({ studentId: w.student.id, schoolId: w.school.id, organizationId: t.org.id, month: '2026-08', createdBy: manager.id, batchId: ids['2026-09']!, clock: t.clock });
    await t.unitOfWork.run((tx) => t.subscriptionRepo.insert(past, tx));
    expect(await codeOf(t.subscriptions.markUnpaid(past.id, manager.id))).toBe('SUBSCRIPTION_MONTH_NOT_CURRENT'); // even an UNPAID one in the past
    expect(t.subscriptionRepo.rows.get(ids['2026-09']!)!.status).toBe('PAID');
    expect(t.subscriptionRepo.rows.get(ids['2026-10']!)!.status).toBe('WAIVED');
    expect(t.events('SubscriptionMarkedUnpaid')).toHaveLength(0);
  });

  it('a WAIVED subscription of the current month is rejected (WAIVED -> UNPAID)', async () => {
    const { t, manager, ids } = await threeMonths();
    await t.subscriptions.waiveSubscription(ids['2026-11']!, manager.id);
    expect(await codeOf(t.subscriptions.markUnpaid(ids['2026-11']!, manager.id))).toBe('SUBSCRIPTION_NOT_PAID');
    expect(t.subscriptionRepo.rows.get(ids['2026-11']!)!.status).toBe('WAIVED');
  });

  it('an already UNPAID subscription is rejected as an unnecessary transition', async () => {
    const { t, manager, ids } = await threeMonths();
    expect(await codeOf(t.subscriptions.markUnpaid(ids['2026-11']!, manager.id))).toBe('SUBSCRIPTION_ALREADY_UNPAID');
    expect(t.events('SubscriptionMarkedUnpaid')).toHaveLength(0);
  });

  it('an unknown subscription is not found', async () => {
    const { t, manager } = await threeMonths();
    expect(await codeOf(t.subscriptions.markUnpaid('00000000-0000-4000-8000-000000000000', manager.id))).toBe('SUBSCRIPTION_NOT_FOUND');
  });

  it('introduces no new status: a subscription is PAID, UNPAID or WAIVED before and after', async () => {
    const w = await threeMonths();
    await payAll(w);
    await w.t.subscriptions.markUnpaid(w.ids['2026-11']!, w.manager.id);
    await w.t.subscriptions.markPaid(w.ids['2026-11']!, w.manager.id);
    for (const row of w.t.subscriptionRepo.rows.values()) expect(['PAID', 'UNPAID', 'WAIVED']).toContain(row.status);
  });

  it('is transactional: when the caller\'s transaction fails the change and the event are rolled back', async () => {
    const w = await threeMonths();
    await payAll(w);
    const before = w.t.events('SubscriptionMarkedUnpaid').length;
    await expect(
      w.t.unitOfWork.run(async (tx) => {
        await w.t.subscriptions.markUnpaid(w.ids['2026-11']!, w.manager.id, tx);
        throw new Error('later step failed');
      }),
    ).rejects.toThrow('later step failed');
    expect(w.status('2026-11')).toBe('PAID');
    expect(w.t.events('SubscriptionMarkedUnpaid')).toHaveLength(before);
  });
});

describe('Cairo timezone around the month boundary (the server clock decides, inside the transaction)', () => {
  it('winter (UTC+2): allowed until 23:59 on the last day, refused from 00:00 on the 1st Cairo time', async () => {
    const t = await createSubscriptionsHarness();
    const school = await t.newSchool();
    const manager = await t.newSchoolManager(school.id);
    const student = await t.newStudent(school.id, manager.id);
    t.setNow('2026-10-20T09:00:00Z');
    await t.subscriptions.createMonthlySubscriptions(school.id, manager.id);
    const id = (await t.subscriptionRepo.findByStudentMonth(student.id, '2026-10'))!.id;
    await t.subscriptions.markPaid(id, manager.id);

    t.setNow('2026-10-31T21:59:59Z'); // 23:59:59 on 31 Oct in Cairo
    expect((await t.subscriptions.markUnpaid(id, manager.id)).status).toBe('UNPAID');
    await t.subscriptions.markPaid(id, manager.id);
    t.setNow('2026-10-31T22:00:00Z'); // 00:00:00 on 1 Nov in Cairo: October is now a PAST month
    expect(await codeOf(t.subscriptions.markUnpaid(id, manager.id))).toBe('SUBSCRIPTION_MONTH_NOT_CURRENT');
    expect(t.subscriptionRepo.rows.get(id)!.status).toBe('PAID');
  });

  it('summer (UTC+3): the boundary moves with the Egyptian offset', async () => {
    const t = await createSubscriptionsHarness();
    const school = await t.newSchool();
    const manager = await t.newSchoolManager(school.id);
    const student = await t.newStudent(school.id, manager.id);
    t.setNow('2026-06-20T09:00:00Z');
    await t.subscriptions.createMonthlySubscriptions(school.id, manager.id);
    const id = (await t.subscriptionRepo.findByStudentMonth(student.id, '2026-06'))!.id;
    await t.subscriptions.markPaid(id, manager.id);

    t.setNow('2026-06-30T20:59:59Z'); // 23:59:59 on 30 Jun in Cairo (UTC+3)
    expect((await t.subscriptions.markUnpaid(id, manager.id)).status).toBe('UNPAID');
    await t.subscriptions.markPaid(id, manager.id);
    t.setNow('2026-06-30T21:00:00Z'); // 00:00 on 1 Jul in Cairo
    expect(await codeOf(t.subscriptions.markUnpaid(id, manager.id))).toBe('SUBSCRIPTION_MONTH_NOT_CURRENT');
  });

  it('a UTC clock that is still "the 30th" is already the 1st in Cairo: the Cairo calendar wins, not UTC', async () => {
    const t = await createSubscriptionsHarness();
    const school = await t.newSchool();
    const manager = await t.newSchoolManager(school.id);
    const student = await t.newStudent(school.id, manager.id);
    t.setNow('2026-11-20T09:00:00Z');
    await t.subscriptions.createMonthlySubscriptions(school.id, manager.id);
    const id = (await t.subscriptionRepo.findByStudentMonth(student.id, '2026-11'))!.id;
    await t.subscriptions.markPaid(id, manager.id);
    t.setNow('2026-11-30T22:30:00Z'); // 30 Nov in UTC, 00:30 on 1 Dec in Cairo
    expect(await codeOf(t.subscriptions.markUnpaid(id, manager.id))).toBe('SUBSCRIPTION_MONTH_NOT_CURRENT');
  });
});

describe('the Oldest-Unpaid Rule (§59) is preserved by the PAID -> UNPAID transition', () => {
  it('after November is reverted, December cannot be paid until November is PAID or WAIVED again (the rule still protects the order)', async () => {
    const w = await threeMonths();
    const { t, manager, ids } = w;
    await payAll(w);
    await t.subscriptions.markUnpaid(ids['2026-11']!, manager.id);

    t.setNow('2026-12-10T09:00:00Z'); // the next month begins: November is now a past month
    await t.subscriptions.createMonthlySubscriptions(w.school.id, manager.id);
    const dec = (await t.subscriptionRepo.findByStudentMonth(w.student.id, '2026-12'))!.id;
    expect(await codeOf(t.subscriptions.markPaid(dec, manager.id))).toBe('OLDER_UNPAID_SUBSCRIPTIONS_EXIST');
    expect(await codeOf(t.subscriptions.markUnpaid(ids['2026-11']!, manager.id))).toBe('SUBSCRIPTION_MONTH_NOT_CURRENT'); // a past month is refused first, whatever its status
    await t.subscriptions.markPaid(ids['2026-11']!, manager.id); // pay the older month first
    expect((await t.subscriptions.markPaid(dec, manager.id)).status).toBe('PAID');
    // and now that December is PAID, November (a past month) can never be changed back
    expect(await codeOf(t.subscriptions.markUnpaid(ids['2026-11']!, manager.id))).toBe('SUBSCRIPTION_MONTH_NOT_CURRENT');
  });

  it('the changed month is the NEWEST a student can have, so no newer month can be left PAID behind an unpaid one', async () => {
    const w = await threeMonths();
    await payAll(w);
    await w.t.subscriptions.markUnpaid(w.ids['2026-11']!, w.manager.id);
    const months = [...w.t.subscriptionRepo.rows.values()].filter((r) => r.studentId === w.student.id).sort((a, b) => (a.month < b.month ? -1 : 1));
    // §59 invariant: a PAID month never has an older month that is neither PAID nor WAIVED
    for (const paid of months.filter((m) => m.status === 'PAID')) expect(months.filter((o) => o.month < paid.month).every((o) => o.status !== 'UNPAID')).toBe(true);
  });

  it('refuses (NEWER_PAID_SUBSCRIPTIONS_EXIST) instead of weakening §59 if a newer month were ever PAID', async () => {
    const w = await threeMonths();
    await payAll(w);
    // Artificial data that normal operation cannot produce (a December row while the clock is in November), to prove the guard is enforced and not merely assumed.
    const future = Subscription.openInBatch({ studentId: w.student.id, schoolId: w.school.id, organizationId: w.t.org.id, month: '2026-12', createdBy: w.manager.id, batchId: w.ids['2026-11']!, clock: w.t.clock });
    future.markPaid(w.manager.id, w.t.clock);
    await w.t.unitOfWork.run((tx) => w.t.subscriptionRepo.insert(future, tx));
    w.t.subscriptionRepo.rows.set(future.id, { ...w.t.subscriptionRepo.rows.get(future.id)!, status: 'PAID', paidAt: new Date(), paidBy: w.manager.id });
    expect(await codeOf(w.t.subscriptions.markUnpaid(w.ids['2026-11']!, w.manager.id))).toBe('NEWER_PAID_SUBSCRIPTIONS_EXIST');
    expect(w.status('2026-11')).toBe('PAID');
    expect(w.t.events('SubscriptionMarkedUnpaid')).toHaveLength(0);
  });

  it('a reverted subscription can be paid again through the same contract (Oldest-Unpaid still applies) and is a new SubscriptionPaid', async () => {
    const w = await threeMonths();
    await payAll(w);
    await w.t.subscriptions.markUnpaid(w.ids['2026-11']!, w.manager.id);
    expect((await w.t.subscriptions.markPaid(w.ids['2026-11']!, w.manager.id)).status).toBe('PAID');
    expect(w.t.events('SubscriptionPaid')).toHaveLength(4);
    expect(w.t.events('SubscriptionMarkedUnpaid')).toHaveLength(1);
  });
});
