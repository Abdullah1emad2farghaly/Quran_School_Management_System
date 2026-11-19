import { describe, expect, it } from 'vitest';
import { AppError, newUuid } from '../../../src/modules/00-shared-kernel/public';
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
  for (const month of ['2026-09', '2026-10', '2026-11']) await w.t.payViaWorkflow(w.ids[month]!, w.manager.id);
};
const NIL = '00000000-0000-4000-8000-000000000000';

describe('applyPaymentRecorded (UNPAID -> PAID, Module 34 workflow only) rejects every invalid transition', () => {
  it('UNPAID -> PAID succeeds once and publishes SubscriptionPaid exactly once', async () => {
    const { t, manager, ids, status } = await threeMonths();
    const paid = await t.payViaWorkflow(ids['2026-09']!, manager.id);
    expect(paid.status).toBe('PAID');
    expect(status('2026-09')).toBe('PAID');
    expect(await codeOf(t.payViaWorkflow(ids['2026-09']!, manager.id))).toBe('SUBSCRIPTION_ALREADY_PAID'); // no duplicate payment
    expect(t.events('SubscriptionPaid')).toHaveLength(1);
  });

  it('a WAIVED subscription cannot be paid, and the Oldest-Unpaid Rule cannot be bypassed', async () => {
    const { t, manager, ids } = await threeMonths();
    await t.subscriptions.waiveSubscription(ids['2026-09']!, manager.id);
    expect(await codeOf(t.payViaWorkflow(ids['2026-09']!, manager.id))).toBe('SUBSCRIPTION_NOT_UNPAID');
    expect(await codeOf(t.payViaWorkflow(ids['2026-11']!, manager.id))).toBe('OLDER_UNPAID_SUBSCRIPTIONS_EXIST'); // October is still unpaid
    expect(await codeOf(t.payViaWorkflow(NIL, manager.id))).toBe('SUBSCRIPTION_NOT_FOUND');
  });
});

describe('applyPaymentReversed (PAID -> UNPAID, Module 34 workflow only)', () => {
  it('returns a PAID subscription to UNPAID, clears the paid audit, publishes SubscriptionMarkedUnpaid and never SubscriptionPaid again', async () => {
    const { t, manager, ids, status } = await threeMonths();
    await t.payViaWorkflow(ids['2026-09']!, manager.id);
    const result = await t.reverseViaWorkflow(ids['2026-09']!, manager.id);
    expect(result.status).toBe('UNPAID');
    expect(status('2026-09')).toBe('UNPAID');
    const row = t.subscriptionRepo.rows.get(ids['2026-09']!)!;
    expect(row.paidAt).toBeNull();
    expect(row.paidBy).toBeNull();
    expect(t.events('SubscriptionMarkedUnpaid')).toHaveLength(1);
    expect(t.events('SubscriptionPaid')).toHaveLength(1);
  });

  it('is NOT limited to the current month (a reversal of a past month is a Module 34 decision)', async () => {
    const { t, manager, ids, status } = await threeMonths();
    await t.payViaWorkflow(ids['2026-09']!, manager.id);
    expect(status('2026-09')).toBe('PAID'); // September is a past month at 2026-11-10
    expect((await t.reverseViaWorkflow(ids['2026-09']!, manager.id)).status).toBe('UNPAID');
  });

  it('an already UNPAID subscription, a WAIVED one and an unknown one are rejected', async () => {
    const { t, manager, ids } = await threeMonths();
    expect(await codeOf(t.reverseViaWorkflow(ids['2026-11']!, manager.id))).toBe('SUBSCRIPTION_ALREADY_UNPAID');
    await t.subscriptions.waiveSubscription(ids['2026-09']!, manager.id);
    expect(await codeOf(t.reverseViaWorkflow(ids['2026-09']!, manager.id))).toBe('SUBSCRIPTION_NOT_PAID');
    expect(await codeOf(t.reverseViaWorkflow(NIL, manager.id))).toBe('SUBSCRIPTION_NOT_FOUND');
  });

  it('introduces no new status: a subscription is PAID, UNPAID or WAIVED before and after', async () => {
    const w = await threeMonths();
    await payAll(w);
    await w.t.reverseViaWorkflow(w.ids['2026-11']!, w.manager.id);
    await w.t.payViaWorkflow(w.ids['2026-11']!, w.manager.id);
    for (const row of w.t.subscriptionRepo.rows.values()) expect(['PAID', 'UNPAID', 'WAIVED']).toContain(row.status);
  });

  it('is transactional: when the caller\'s transaction fails the change and the event are rolled back', async () => {
    const w = await threeMonths();
    await payAll(w);
    const before = w.t.events('SubscriptionMarkedUnpaid').length;
    await expect(
      w.t.unitOfWork.run(async (tx) => {
        await w.t.paymentTransitions.applyPaymentReversed({ subscriptionId: w.ids['2026-11']!, paymentId: newUuid(), actorId: w.manager.id }, tx);
        throw new Error('later step failed');
      }),
    ).rejects.toThrow('later step failed');
    expect(w.status('2026-11')).toBe('PAID');
    expect(w.t.events('SubscriptionMarkedUnpaid')).toHaveLength(before);
  });
});

describe('the Oldest-Unpaid Rule (§59) is preserved by recording and by reversing', () => {
  it('after an older month is reversed, a newer month cannot be paid until the older one is PAID or WAIVED again', async () => {
    const { t, manager, ids } = await threeMonths();
    await t.payViaWorkflow(ids['2026-09']!, manager.id);
    await t.payViaWorkflow(ids['2026-10']!, manager.id);
    expect(await codeOf(t.reverseViaWorkflow(ids['2026-10']!, manager.id))).toBe('NO_ERROR'); // nothing newer is PAID
    expect(await codeOf(t.payViaWorkflow(ids['2026-11']!, manager.id))).toBe('OLDER_UNPAID_SUBSCRIPTIONS_EXIST');
    await t.payViaWorkflow(ids['2026-10']!, manager.id);
    expect((await t.payViaWorkflow(ids['2026-11']!, manager.id)).status).toBe('PAID');
  });

  it('an older month is never reversed behind a PAID newer month (NEWER_PAID_SUBSCRIPTIONS_EXIST)', async () => {
    const w = await threeMonths();
    await payAll(w);
    expect(await codeOf(w.t.reverseViaWorkflow(w.ids['2026-09']!, w.manager.id))).toBe('NEWER_PAID_SUBSCRIPTIONS_EXIST');
    expect(await codeOf(w.t.reverseViaWorkflow(w.ids['2026-10']!, w.manager.id))).toBe('NEWER_PAID_SUBSCRIPTIONS_EXIST');
    expect(w.status('2026-09')).toBe('PAID');
    expect(w.t.events('SubscriptionMarkedUnpaid')).toHaveLength(0);
    // newest first works, then the next one
    expect((await w.t.reverseViaWorkflow(w.ids['2026-11']!, w.manager.id)).status).toBe('UNPAID');
    expect((await w.t.reverseViaWorkflow(w.ids['2026-10']!, w.manager.id)).status).toBe('UNPAID');
  });

  it('a reversed subscription can be paid again (Oldest-Unpaid still applies) and is a new SubscriptionPaid', async () => {
    const w = await threeMonths();
    await payAll(w);
    await w.t.reverseViaWorkflow(w.ids['2026-11']!, w.manager.id);
    expect((await w.t.payViaWorkflow(w.ids['2026-11']!, w.manager.id)).status).toBe('PAID');
    expect(w.t.events('SubscriptionPaid')).toHaveLength(4);
    expect(w.t.events('SubscriptionMarkedUnpaid')).toHaveLength(1);
  });

  it('WAIVED stays a Module 33 operation and settles an older month for the rule', async () => {
    const { t, manager, ids } = await threeMonths();
    await t.subscriptions.waiveSubscription(ids['2026-09']!, manager.id);
    await t.subscriptions.waiveSubscription(ids['2026-10']!, manager.id);
    expect((await t.payViaWorkflow(ids['2026-11']!, manager.id)).status).toBe('PAID');
  });
});
