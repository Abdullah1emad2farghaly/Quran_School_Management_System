import { describe, expect, it } from 'vitest';
import { AppError } from '../../../src/modules/00-shared-kernel/public';
import { Payment } from '../../../src/modules/34-payments-collection/public';
import { createPaymentsHarness } from '../../helpers/payments-harness';

const codeOf = (p: Promise<unknown>) => p.then(() => 'NO_ERROR', (e: unknown) => (e instanceof AppError ? e.code : `NOT_APP_ERROR:${String(e)}`));
const NOV = '2026-11-10T09:00:00Z';
const OCT = '2026-10-10T09:00:00Z';

/** A school whose student has an OCTOBER and a NOVEMBER subscription (both UNPAID), created in their own months. */
async function twoMonths() {
  const t = await createPaymentsHarness();
  const school = await t.newSchool();
  const manager = await t.newSchoolManager(school.id);
  const student = await t.newStudent(school.id, manager.id);
  t.setNow(OCT);
  await t.subscriptions.createMonthlySubscriptions(school.id, manager.id);
  t.setNow(NOV);
  await t.subscriptions.createMonthlySubscriptions(school.id, manager.id);
  const oct = (await t.subscriptionRepo.findByStudentMonth(student.id, '2026-10'))!.snapshot;
  const nov = (await t.subscriptionRepo.findByStudentMonth(student.id, '2026-11'))!.snapshot;
  return { t, school, manager, student, oct, nov };
}
const statusOf = async (t: Awaited<ReturnType<typeof createPaymentsHarness>>, id: string) => (await t.subscriptionRepo.findById(id))!.status;

describe('recording a cash payment', () => {
  it('stores a SUCCESSFUL CASH payment of Student + School + Subscription, makes the subscription PAID, and publishes both events', async () => {
    const t = await createPaymentsHarness();
    const { school, manager, students, subs } = await t.newSchoolWithSubscriptions();
    const payment = await t.payments.recordPayment(subs[0]!.id, manager.id);
    expect(payment).toMatchObject({ subscriptionId: subs[0]!.id, studentId: students[0]!.id, schoolId: school.id, organizationId: t.org.id, month: '2026-11', method: 'CASH', status: 'SUCCESSFUL', recordedBy: manager.id, reversedBy: null, reversedAt: null, reversalReason: null });
    expect(await statusOf(t, subs[0]!.id)).toBe('PAID');
    expect(t.paymentEvents('PaymentRecorded')).toHaveLength(1);
    expect(t.events('SubscriptionPaid')).toHaveLength(1); // state event only: the Parent notification is triggered by PaymentRecorded
    expect(JSON.parse(t.paymentEvents('PaymentRecorded')[0]!.payload as unknown as string)).toMatchObject({ paymentId: payment.id, method: 'CASH', month: '2026-11', actorId: manager.id });
  });

  it('has no amount anywhere (the amount is determined outside the system)', async () => {
    const t = await createPaymentsHarness();
    const { manager, subs } = await t.newSchoolWithSubscriptions();
    const payment = await t.payments.recordPayment(subs[0]!.id, manager.id);
    expect(Object.keys(payment).some((k) => /amount|price|fee/i.test(k))).toBe(false);
    expect(Object.keys(t.paymentRepo.rows.get(payment.id)!).some((k) => /amount|price|fee/i.test(k))).toBe(false);
  });

  it('accepts CASH and refuses any other method, changing nothing', async () => {
    const t = await createPaymentsHarness();
    const { manager, subs } = await t.newSchoolWithSubscriptions(2);
    expect(await codeOf(t.payments.recordPayment(subs[0]!.id, manager.id, 'CARD'))).toBe('PAYMENT_METHOD_NOT_ALLOWED');
    expect(await codeOf(t.payments.recordPayment(subs[0]!.id, manager.id, 5))).toBe('PAYMENT_METHOD_NOT_ALLOWED');
    expect(t.paymentRepo.rows.size).toBe(0);
    expect(await statusOf(t, subs[0]!.id)).toBe('UNPAID');
    expect(await codeOf(t.payments.recordPayment(subs[0]!.id, manager.id, 'CASH'))).toBe('NO_ERROR');
  });

  it('allows ONE successful payment per subscription: the second is refused and nothing is added', async () => {
    const t = await createPaymentsHarness();
    const { manager, subs } = await t.newSchoolWithSubscriptions();
    await t.payments.recordPayment(subs[0]!.id, manager.id);
    expect(await codeOf(t.payments.recordPayment(subs[0]!.id, manager.id))).toBe('SUBSCRIPTION_ALREADY_PAID');
    expect(t.paymentRepo.rows.size).toBe(1);
    expect(t.paymentEvents('PaymentRecorded')).toHaveLength(1);
  });

  it('applies the Oldest-Unpaid Rule (§59) and, when refused, leaves neither a payment nor a status change behind', async () => {
    const { t, manager, oct, nov } = await twoMonths();
    expect(await codeOf(t.payments.recordPayment(nov.id, manager.id))).toBe('OLDER_UNPAID_SUBSCRIPTIONS_EXIST');
    expect(t.paymentRepo.rows.size).toBe(0);
    expect(await statusOf(t, nov.id)).toBe('UNPAID');
    expect(t.paymentEvents()).toHaveLength(0);
    await t.payments.recordPayment(oct.id, manager.id);
    await t.payments.recordPayment(nov.id, manager.id); // the older month is PAID now
    expect(t.paymentRepo.rows.size).toBe(2);
  });

  it('lets a WAIVED older month stand for PAID (§59) and refuses to pay a WAIVED subscription', async () => {
    const { t, manager, oct, nov } = await twoMonths();
    await t.subscriptions.waiveSubscription(oct.id, manager.id);
    expect(await codeOf(t.payments.recordPayment(oct.id, manager.id))).toBe('SUBSCRIPTION_NOT_UNPAID');
    expect(await codeOf(t.payments.recordPayment(nov.id, manager.id))).toBe('NO_ERROR');
  });

  it('an unknown subscription is SUBSCRIPTION_NOT_FOUND', async () => {
    const t = await createPaymentsHarness();
    const { manager } = await t.newSchoolWithSubscriptions();
    expect(await codeOf(t.payments.recordPayment('00000000-0000-4000-8000-000000000000', manager.id))).toBe('SUBSCRIPTION_NOT_FOUND');
  });

  it('rolls the payment back when a later step of the same transaction fails (payment and status are ONE unit)', async () => {
    const t = await createPaymentsHarness();
    const { manager, subs } = await t.newSchoolWithSubscriptions();
    await expect(
      t.unitOfWork.run(async (tx) => {
        await t.payments.recordPayment(subs[0]!.id, manager.id, undefined, tx);
        throw new Error('later step failed');
      }),
    ).rejects.toThrow('later step failed');
    expect(t.paymentRepo.rows.size).toBe(0);
    expect(await statusOf(t, subs[0]!.id)).toBe('UNPAID');
  });
});

describe('reversing a payment', () => {
  it('needs a reason: empty, blank, missing or non-text is refused, and a refused reversal changes nothing', async () => {
    const t = await createPaymentsHarness();
    const { manager, subs } = await t.newSchoolWithSubscriptions();
    const payment = await t.payments.recordPayment(subs[0]!.id, manager.id);
    for (const bad of ['', '   ', undefined, null, 7]) expect(await codeOf(t.payments.reversePayment(payment.id, bad, manager.id))).toBe('PAYMENT_REVERSAL_REASON_REQUIRED');
    expect(await codeOf(t.payments.reversePayment(payment.id, 'x'.repeat(501), manager.id))).toBe('PAYMENT_REVERSAL_REASON_TOO_LONG');
    expect(await codeOf(t.payments.reversePayment(payment.id, 'x'.repeat(500), manager.id))).toBe('NO_ERROR'); // exactly 500 is allowed
  });

  it('keeps the payment (never deleted) with reason, actor and time, returns the subscription to UNPAID and publishes the audited events', async () => {
    const t = await createPaymentsHarness();
    const { manager, subs } = await t.newSchoolWithSubscriptions();
    const payment = await t.payments.recordPayment(subs[0]!.id, manager.id);
    t.setNow('2026-11-12T10:00:00Z');
    const reversed = await t.payments.reversePayment(payment.id, '  تم تسجيل الدفعة بالخطأ  ', manager.id);
    expect(reversed).toMatchObject({ id: payment.id, status: 'REVERSED', reversedBy: manager.id, reversalReason: 'تم تسجيل الدفعة بالخطأ' });
    expect(reversed.reversedAt?.toISOString()).toBe('2026-11-12T10:00:00.000Z');
    expect(t.paymentRepo.rows.get(payment.id)?.status).toBe('REVERSED'); // the row is still there
    expect(await statusOf(t, subs[0]!.id)).toBe('UNPAID');
    const event = t.paymentEvents('PaymentReversed')[0]!;
    expect(JSON.parse(event.payload as unknown as string)).toMatchObject({ paymentId: payment.id, previousStatus: 'SUCCESSFUL', status: 'REVERSED', reason: 'تم تسجيل الدفعة بالخطأ', actorId: manager.id });
    expect(t.events('SubscriptionMarkedUnpaid')).toHaveLength(1);
    expect(t.events('SubscriptionPaid')).toHaveLength(1); // never published again by a reversal
  });

  it('happens once: a second reversal is refused and the first reason is never overwritten', async () => {
    const t = await createPaymentsHarness();
    const { manager, subs } = await t.newSchoolWithSubscriptions();
    const payment = await t.payments.recordPayment(subs[0]!.id, manager.id);
    await t.payments.reversePayment(payment.id, 'first reason', manager.id);
    expect(await codeOf(t.payments.reversePayment(payment.id, 'second reason', manager.id))).toBe('PAYMENT_ALREADY_REVERSED');
    expect((await t.payments.getPayment(payment.id)).reversalReason).toBe('first reason');
    expect(t.paymentEvents('PaymentReversed')).toHaveLength(1);
  });

  it('an unknown payment is PAYMENT_NOT_FOUND', async () => {
    const t = await createPaymentsHarness();
    const { manager } = await t.newSchoolWithSubscriptions();
    expect(await codeOf(t.payments.reversePayment('00000000-0000-4000-8000-000000000000', 'reason', manager.id))).toBe('PAYMENT_NOT_FOUND');
  });

  it('allows a NEW successful payment of the same subscription afterwards, keeping the reversed one as history', async () => {
    const t = await createPaymentsHarness();
    const { manager, subs } = await t.newSchoolWithSubscriptions();
    const first = await t.payments.recordPayment(subs[0]!.id, manager.id);
    await t.payments.reversePayment(first.id, 'mistake', manager.id);
    const second = await t.payments.recordPayment(subs[0]!.id, manager.id);
    expect(second.id).not.toBe(first.id);
    expect([...t.paymentRepo.rows.values()].map((r) => r.status).sort()).toEqual(['REVERSED', 'SUCCESSFUL']);
    expect(await statusOf(t, subs[0]!.id)).toBe('PAID');
  });

  it('keeps the Oldest-Unpaid Rule: an older month cannot be reversed while a NEWER month is PAID (payment and status untouched), but can once the newer one is reversed first', async () => {
    const { t, manager, oct, nov } = await twoMonths();
    const pOct = await t.payments.recordPayment(oct.id, manager.id);
    const pNov = await t.payments.recordPayment(nov.id, manager.id);
    expect(await codeOf(t.payments.reversePayment(pOct.id, 'reason', manager.id))).toBe('NEWER_PAID_SUBSCRIPTIONS_EXIST');
    expect((await t.payments.getPayment(pOct.id)).status).toBe('SUCCESSFUL');
    expect(await statusOf(t, oct.id)).toBe('PAID');
    expect(t.paymentEvents('PaymentReversed')).toHaveLength(0);
    await t.payments.reversePayment(pNov.id, 'reason', manager.id);
    // a PAST month can be reversed (a reversal is not limited to the current month)
    expect(await codeOf(t.payments.reversePayment(pOct.id, 'reason', manager.id))).toBe('NO_ERROR');
    expect(await statusOf(t, oct.id)).toBe('UNPAID');
  });

  it('closes a stale SUCCESSFUL payment whose subscription is already UNPAID (legacy data from the removed Module 33 correction), then lets the subscription be paid again', async () => {
    const t = await createPaymentsHarness();
    const { manager, subs } = await t.newSchoolWithSubscriptions();
    const payment = await t.payments.recordPayment(subs[0]!.id, manager.id);
    await t.reverseViaWorkflow(subs[0]!.id, manager.id); // simulates legacy data: the status went back to UNPAID without closing the payment row
    expect(await codeOf(t.payments.recordPayment(subs[0]!.id, manager.id))).toBe('PAYMENT_ALREADY_RECORDED'); // the stale row still blocks (and nothing is left behind)
    expect(await statusOf(t, subs[0]!.id)).toBe('UNPAID');
    expect(await codeOf(t.payments.reversePayment(payment.id, 'status corrected by hand', manager.id))).toBe('NO_ERROR');
    expect(await codeOf(t.payments.recordPayment(subs[0]!.id, manager.id))).toBe('NO_ERROR');
  });

  it('refuses a reversal of a WAIVED subscription\'s payment path (SUBSCRIPTION_NOT_PAID) and rolls the reversal back', async () => {
    const t = await createPaymentsHarness();
    const { manager, subs } = await t.newSchoolWithSubscriptions();
    const payment = await t.payments.recordPayment(subs[0]!.id, manager.id);
    const row = t.paymentRepo.rows.get(payment.id)!;
    // Force the (impossible through the API) state: payment SUCCESSFUL while the subscription is WAIVED.
    const sub = t.subscriptionRepo.rows.get(subs[0]!.id)!;
    t.subscriptionRepo.rows.set(sub.id, { ...sub, status: 'WAIVED', paidAt: null, paidBy: null, waivedAt: new Date(), waivedBy: manager.id });
    expect(await codeOf(t.payments.reversePayment(row.id, 'reason', manager.id))).toBe('SUBSCRIPTION_NOT_PAID');
    expect(t.paymentRepo.rows.get(row.id)?.status).toBe('SUCCESSFUL');
  });
});

describe('listing and reading payments', () => {
  it('lists a school\'s payments newest first with month, status, student and subscription filters, paginated', async () => {
    const t = await createPaymentsHarness();
    const { school, manager, students, subs } = await t.newSchoolWithSubscriptions(3);
    t.setNow('2026-11-10T09:00:00Z');
    const p1 = await t.payments.recordPayment(subs[0]!.id, manager.id);
    t.setNow('2026-11-11T09:00:00Z');
    const p2 = await t.payments.recordPayment(subs[1]!.id, manager.id);
    t.setNow('2026-11-12T09:00:00Z');
    await t.payments.recordPayment(subs[2]!.id, manager.id);
    await t.payments.reversePayment(p1.id, 'mistake', manager.id);
    const page = { page: 1, pageSize: 2 };
    const all = await t.payments.listPaymentsOfSchool({ schoolId: school.id, page });
    expect(all.items).toHaveLength(2);
    expect(all.total).toBe(3);
    expect(all.items[0]!.recordedAt.getTime()).toBeGreaterThan(all.items[1]!.recordedAt.getTime());
    expect((await t.payments.listPaymentsOfSchool({ schoolId: school.id, status: ['REVERSED'], page })).items.map((p) => p.id)).toEqual([p1.id]);
    expect((await t.payments.listPaymentsOfSchool({ schoolId: school.id, studentId: students[1]!.id, page })).items.map((p) => p.id)).toEqual([p2.id]);
    expect((await t.payments.listPaymentsOfSchool({ schoolId: school.id, subscriptionId: subs[1]!.id, page })).items.map((p) => p.id)).toEqual([p2.id]);
    expect((await t.payments.listPaymentsOfSchool({ schoolId: school.id, month: '2026-10', page })).items).toHaveLength(0);
    expect(await codeOf(t.payments.listPaymentsOfSchool({ schoolId: school.id, month: '2026-13', page }))).toBe('INVALID_PAYMENT_MONTH');
  });

  it('never lists another school\'s payments', async () => {
    const t = await createPaymentsHarness();
    const a = await t.newSchoolWithSubscriptions();
    await t.payments.recordPayment(a.subs[0]!.id, a.manager.id);
    const other = await t.newSchool('مدرسة أخرى');
    expect((await t.payments.listPaymentsOfSchool({ schoolId: other.id, page: { page: 1, pageSize: 20 } })).items).toHaveLength(0);
  });

  it('exposes the payment\'s school for authorization and nothing for an unknown id', async () => {
    const t = await createPaymentsHarness();
    const { school, manager, subs } = await t.newSchoolWithSubscriptions();
    const payment = await t.payments.recordPayment(subs[0]!.id, manager.id);
    expect(await t.payments.findScopeById(payment.id)).toEqual({ id: payment.id, schoolId: school.id, organizationId: t.org.id });
    expect(await t.payments.findScopeById('00000000-0000-4000-8000-000000000000')).toBeUndefined();
  });
});

describe('the Payment entity', () => {
  it('only ever has the CASH method and cannot be reversed twice or without a reason', () => {
    const clock = { now: () => new Date('2026-11-10T09:00:00Z') };
    const p = Payment.record({ subscriptionId: 's', studentId: 'st', schoolId: 'sc', organizationId: 'o', month: '2026-11', recordedBy: 'u', clock });
    expect(p.snapshot.method).toBe('CASH');
    expect(() => p.reverse('u', '', clock)).toThrow(AppError);
    p.reverse('u', 'because', clock);
    expect(() => p.reverse('u', 'again', clock)).toThrow(AppError);
    expect(p.snapshot.reversalReason).toBe('because');
  });
});
