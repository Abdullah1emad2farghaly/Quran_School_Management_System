import { beforeEach, describe, expect, it } from 'vitest';
import { REMINDER_KINDS } from '../../../src/modules/32-notification-rules/public';
import { SubscriptionEventTypes } from '../../../src/modules/33-subscriptions/public';
import { createRulesHarness, ids, type RulesHarness } from '../../helpers/notification-rules-harness';

const COLLECTOR_1 = 'c0000000-0000-4000-8000-000000000001';
const COLLECTOR_2 = 'c0000000-0000-4000-8000-000000000002';
const BATCH = 'b0000000-0000-4000-8000-000000000001';
const MONTH = '2026-11';
const subId = (n: number) => `a0000000-0000-4000-8000-00000000000${n}`;
const CREATED_AT = new Date('2026-11-10T09:00:00Z');
const DAY3_DUE = new Date('2026-11-12T22:00:00Z'); // 2026-11-13 00:00 Cairo
const MONTH_END_DUE = new Date('2026-11-25T22:00:00Z'); // 2026-11-26 00:00 Cairo

let w: RulesHarness;
const jumpTo = (instant: Date) => w.h.advance(instant.getTime() - w.h.clock.now().getTime());
const setStatus = (id: string, status: string) => w.subscriptions.subscriptions.set(id, { ...w.subscriptions.subscriptions.get(id)!, status });
const batchEvent = () => ({ batchId: BATCH, schoolId: ids.school, organizationId: ids.org, month: MONTH, count: 3, actorId: ids.manager1 });
const paidEvent = (n: number, studentId: string) => ({ subscriptionId: subId(n), studentId, schoolId: ids.school, organizationId: ids.org, month: MONTH, actorId: ids.manager1 });
const kinds = (n: number) => [REMINDER_KINDS.SUBSCRIPTION_UNPAID_3D, subId(n)] as const;

beforeEach(async () => {
  w = createRulesHarness();
  jumpTo(CREATED_AT);
  // Three UNPAID subscriptions of the current month: A and A2 share parent A, B has parent B.
  const rows: Array<[number, string]> = [[1, ids.studentA], [2, ids.studentA2], [3, ids.studentB]];
  for (const [n, studentId] of rows) w.subscriptions.subscriptions.set(subId(n), { id: subId(n), studentId, schoolId: ids.school, month: MONTH, status: 'UNPAID', createdAt: CREATED_AT });
  w.subscriptions.batches.set(BATCH, { id: BATCH, schoolId: ids.school, month: MONTH });
  w.subscriptions.batchMembers.set(BATCH, [subId(1), subId(2), subId(3)]);
  w.subscriptions.collectors.set(ids.school, [COLLECTOR_1, COLLECTOR_2]);
  w.subscriptions.managers.set(ids.school, [ids.manager1]);
});

describe('A. monthly bulk creation (SubscriptionsCreated)', () => {
  it('tells every CURRENT Subscription Collector of the school, and nobody else', async () => {
    await w.deliver(SubscriptionEventTypes.SUBSCRIPTIONS_CREATED, batchEvent());
    for (const c of [COLLECTOR_1, COLLECTOR_2]) {
      const [n] = w.notificationsOf(c);
      expect(n?.body).toContain(MONTH);
      expect(n?.body).toContain('3');
    }
    for (const other of [ids.parentA, ids.parentB, ids.manager1, ids.teacherUser1]) expect(w.notificationsOf(other)).toHaveLength(0);
  });

  it('a redelivered event creates nothing twice', async () => {
    const event = await w.deliver(SubscriptionEventTypes.SUBSCRIPTIONS_CREATED, batchEvent());
    await w.redeliver(event);
    expect(w.notificationsOf(COLLECTOR_1)).toHaveLength(1);
    expect(w.notificationsOf(COLLECTOR_2)).toHaveLength(1);
  });

  it('with no Collector assigned nothing is sent, but the reminders are still scheduled', async () => {
    w.subscriptions.collectors.set(ids.school, []);
    await w.deliver(SubscriptionEventTypes.SUBSCRIPTIONS_CREATED, batchEvent());
    expect(w.allNotifications()).toHaveLength(0);
    expect(await w.state.findReminder(REMINDER_KINDS.SUBSCRIPTION_UNPAID_MONTH_END, BATCH)).toBeDefined();
  });

  it('schedules one 3-day reminder per subscription (creation date + 3 calendar days, 00:00 Cairo) and ONE end-of-month reminder per batch', async () => {
    await w.deliver(SubscriptionEventTypes.SUBSCRIPTIONS_CREATED, batchEvent());
    for (const n of [1, 2, 3]) expect((await w.state.findReminder(...kinds(n)))?.dueAt.toISOString()).toBe(DAY3_DUE.toISOString());
    const monthEnd = await w.state.findReminder(REMINDER_KINDS.SUBSCRIPTION_UNPAID_MONTH_END, BATCH);
    expect(monthEnd?.dueAt.toISOString()).toBe(MONTH_END_DUE.toISOString());
    expect(w.state.reminders.size).toBe(4);
  });

  it('redelivery does not duplicate or revive reminders', async () => {
    const event = await w.deliver(SubscriptionEventTypes.SUBSCRIPTIONS_CREATED, batchEvent());
    jumpTo(DAY3_DUE);
    await w.processor.processDue();
    await w.redeliver(event);
    expect(w.state.reminders.size).toBe(4);
    expect((await w.state.findReminder(...kinds(1)))?.state).toBe('SENT');
  });

  it('an individual SubscriptionCreated schedules only its own 3-day reminder', async () => {
    await w.deliver(SubscriptionEventTypes.SUBSCRIPTION_CREATED, paidEvent(1, ids.studentA));
    expect((await w.state.findReminder(...kinds(1)))?.dueAt.toISOString()).toBe(DAY3_DUE.toISOString());
    expect(w.state.reminders.size).toBe(1);
    expect(w.allNotifications()).toHaveLength(0); // no Collector notification for an individual creation
  });
});

describe('B. payment recorded (SubscriptionPaid): the Parent only', () => {
  it('tells the student\'s Parent about that child only; no Collector, no School Manager, no other Parent', async () => {
    await w.deliver(SubscriptionEventTypes.SUBSCRIPTION_PAID, paidEvent(1, ids.studentA));
    const [n] = w.notificationsOf(ids.parentA);
    expect(w.notificationsOf(ids.parentA)).toHaveLength(1);
    expect(n?.body).toContain('Ali Ahmed');
    expect(n?.body).toContain(MONTH);
    expect(n?.body).not.toContain('Amal');
    for (const other of [ids.parentB, COLLECTOR_1, COLLECTOR_2, ids.manager1]) expect(w.notificationsOf(other)).toHaveLength(0);
  });

  it('is sent once even when the event is redelivered, and cancels the pending 3-day reminder', async () => {
    await w.deliver(SubscriptionEventTypes.SUBSCRIPTIONS_CREATED, batchEvent());
    const event = await w.deliver(SubscriptionEventTypes.SUBSCRIPTION_PAID, paidEvent(1, ids.studentA));
    await w.redeliver(event);
    expect(w.notificationsOf(ids.parentA)).toHaveLength(1);
    expect((await w.state.findReminder(...kinds(1)))?.state).toBe('SUPPRESSED');
    expect((await w.state.findReminder(...kinds(2)))?.state).toBe('PENDING');
  });

  it('a student without a Parent account is skipped quietly', async () => {
    w.students.map.set(ids.studentA, { ...w.students.map.get(ids.studentA)!, parentUserIds: [] });
    await w.deliver(SubscriptionEventTypes.SUBSCRIPTION_PAID, paidEvent(1, ids.studentA));
    expect(w.allNotifications()).toHaveLength(0);
  });

  it('a waived subscription cancels its pending 3-day reminder and notifies nobody', async () => {
    await w.deliver(SubscriptionEventTypes.SUBSCRIPTIONS_CREATED, batchEvent());
    await w.deliver(SubscriptionEventTypes.SUBSCRIPTION_WAIVED, paidEvent(2, ids.studentA2));
    expect((await w.state.findReminder(...kinds(2)))?.state).toBe('SUPPRESSED');
    expect(w.notificationsOf(ids.parentA)).toHaveLength(0);
  });
});

describe('B2. PAID -> UNPAID (SubscriptionMarkedUnpaid) and a second payment: existing behavior is preserved', () => {
  it('SubscriptionMarkedUnpaid notifies nobody and changes no reminder', async () => {
    await w.deliver(SubscriptionEventTypes.SUBSCRIPTIONS_CREATED, batchEvent());
    const reminders = JSON.stringify([...w.state.reminders]);
    w.h.repository.notifications.clear();
    await w.deliver(SubscriptionEventTypes.SUBSCRIPTION_MARKED_UNPAID, paidEvent(1, ids.studentA));
    expect(w.allNotifications()).toHaveLength(0);
    expect(JSON.stringify([...w.state.reminders])).toBe(reminders);
  });

  it('pay, change back, pay again: the Parent (only) is told ONCE per subscription (the once-only key is per subscription), nobody else', async () => {
    await w.deliver(SubscriptionEventTypes.SUBSCRIPTION_PAID, paidEvent(1, ids.studentA));
    await w.deliver(SubscriptionEventTypes.SUBSCRIPTION_MARKED_UNPAID, paidEvent(1, ids.studentA));
    await w.deliver(SubscriptionEventTypes.SUBSCRIPTION_PAID, paidEvent(1, ids.studentA));
    expect(w.notificationsOf(ids.parentA)).toHaveLength(1);
    for (const other of [ids.parentB, COLLECTOR_1, COLLECTOR_2, ids.manager1]) expect(w.notificationsOf(other)).toHaveLength(0);
  });

  it('the month-end reminder reads the CURRENT status: a subscription changed back to UNPAID is included again', async () => {
    await w.deliver(SubscriptionEventTypes.SUBSCRIPTIONS_CREATED, batchEvent());
    jumpTo(DAY3_DUE);
    await w.processor.processDue();
    w.h.repository.notifications.clear();
    setStatus(subId(1), 'PAID');
    setStatus(subId(1), 'UNPAID'); // paid, then changed back
    jumpTo(MONTH_END_DUE);
    await w.processor.processDue();
    expect(w.notificationsOf(ids.manager1)[0]?.body).toContain('Ali Ahmed');
  });
});

describe('C. first unpaid reminder: 3 calendar days after creation, the Parent only', () => {
  beforeEach(async () => {
    await w.deliver(SubscriptionEventTypes.SUBSCRIPTIONS_CREATED, batchEvent());
    w.h.repository.notifications.clear(); // forget the Collector notification of the bulk creation
  });

  it('is already due 72 elapsed hours later (the rule is the calendar day, not the hour count)', async () => {
    jumpTo(new Date(CREATED_AT.getTime() + 72 * 3600 * 1000)); // 2026-11-13 09:00Z = 11:00 Cairo: already due
    expect((await w.processor.processDue()).sent).toBeGreaterThan(0);
    w.h.repository.notifications.clear();
  });

  it('is not due one minute before the calendar day starts', async () => {
    jumpTo(new Date(DAY3_DUE.getTime() - 60_000));
    const result = await w.processor.processDue();
    expect(result.sent).toBe(0);
    expect(w.allNotifications()).toHaveLength(0);
  });

  it('is sent at the calendar-day boundary to the Parent of each still-UNPAID subscription (own child only), and to nobody else', async () => {
    jumpTo(DAY3_DUE);
    const result = await w.processor.processDue();
    expect(result.sent).toBe(3);
    const a = w.notificationsOf(ids.parentA);
    expect(a).toHaveLength(2); // two children, one reminder each
    expect(a.map((n) => n.body).join(' ')).toContain('Ali Ahmed');
    expect(a.map((n) => n.body).join(' ')).toContain('Amal Ahmed');
    expect(w.notificationsOf(ids.parentB)[0]?.body).toContain('Bilal Badr');
    expect(w.notificationsOf(ids.parentB)[0]?.body).not.toContain('Ali');
    for (const other of [COLLECTOR_1, COLLECTOR_2, ids.manager1]) expect(w.notificationsOf(other)).toHaveLength(0);
  });

  it('checks the CURRENT status first: PAID and WAIVED subscriptions are not reminded (even if no event arrived)', async () => {
    setStatus(subId(1), 'PAID');
    setStatus(subId(2), 'WAIVED');
    jumpTo(DAY3_DUE);
    const result = await w.processor.processDue();
    expect(result.sent).toBe(1);
    expect(result.suppressed).toBeGreaterThanOrEqual(2);
    expect(w.notificationsOf(ids.parentA)).toHaveLength(0);
    expect(w.notificationsOf(ids.parentB)).toHaveLength(1);
    expect((await w.state.findReminder(...kinds(1)))?.state).toBe('SUPPRESSED');
    expect((await w.state.findReminder(...kinds(2)))?.state).toBe('SUPPRESSED');
  });

  it('is never sent twice for the same subscription (later passes and a re-run change nothing)', async () => {
    jumpTo(DAY3_DUE);
    await w.processor.processDue();
    const first = w.allNotifications().length;
    jumpTo(new Date(DAY3_DUE.getTime() + 3600_000));
    await w.processor.processDue();
    await w.processor.processDue();
    expect(w.allNotifications()).toHaveLength(first);
  });

  it('a late scheduler (restart/outage) sends it at once while the subscription is still UNPAID, and suppresses it once paid', async () => {
    jumpTo(new Date('2026-11-20T08:00:00Z'));
    setStatus(subId(3), 'PAID');
    const result = await w.processor.processDue();
    expect(w.notificationsOf(ids.parentA)).toHaveLength(2);
    expect(w.notificationsOf(ids.parentB)).toHaveLength(0);
    expect(result.suppressed).toBeGreaterThanOrEqual(1);
  });
});

describe('D. end-of-month reminder: once per school and month, at the start of the final five days', () => {
  beforeEach(async () => {
    await w.deliver(SubscriptionEventTypes.SUBSCRIPTIONS_CREATED, batchEvent());
    // consume the 3-day reminders so only the month-end one is left
    jumpTo(DAY3_DUE);
    await w.processor.processDue();
    w.h.repository.notifications.clear();
  });

  it('is not sent before the 26th (30-day month) starts in Cairo, and is due exactly then', async () => {
    jumpTo(new Date(MONTH_END_DUE.getTime() - 60_000));
    expect((await w.processor.processDue()).sent).toBe(0);
    expect(w.allNotifications()).toHaveLength(0);
    jumpTo(MONTH_END_DUE);
    expect((await w.processor.processDue()).sent).toBe(1);
  });

  it('tells each Parent about their OWN child, and the Collectors and the School Manager which students remain unpaid', async () => {
    setStatus(subId(2), 'PAID');
    jumpTo(MONTH_END_DUE);
    await w.processor.processDue();

    const a = w.notificationsOf(ids.parentA);
    expect(a).toHaveLength(1);
    expect(a[0]?.body).toContain('Ali Ahmed');
    expect(a[0]?.body).not.toContain('Amal');
    expect(w.notificationsOf(ids.parentB)[0]?.body).toContain('Bilal Badr');
    for (const staff of [COLLECTOR_1, COLLECTOR_2, ids.manager1]) {
      const n = w.notificationsOf(staff);
      expect(n, staff).toHaveLength(1);
      expect(n[0]?.body).toContain('Ali Ahmed');
      expect(n[0]?.body).toContain('Bilal Badr');
      expect(n[0]?.body).not.toContain('Amal Ahmed'); // PAID is excluded
      expect(n[0]?.body).toContain('2 students');
    }
    expect(w.notificationsOf(ids.manager2)).toHaveLength(0);
    expect(w.notificationsOf(ids.teacherUser1)).toHaveLength(0);
  });

  it('excludes PAID and WAIVED subscriptions, and sends NOTHING when no student remains unpaid', async () => {
    for (const n of [1, 2, 3]) setStatus(subId(n), n === 2 ? 'WAIVED' : 'PAID');
    jumpTo(MONTH_END_DUE);
    const result = await w.processor.processDue();
    expect(result.sent).toBe(0);
    expect(w.allNotifications()).toHaveLength(0);
    expect((await w.state.findReminder(REMINDER_KINDS.SUBSCRIPTION_UNPAID_MONTH_END, BATCH))?.state).toBe('SUPPRESSED');
  });

  it('is sent only ONCE per school and month (repeated passes and a redelivered bulk event add nothing)', async () => {
    jumpTo(MONTH_END_DUE);
    await w.processor.processDue();
    const count = w.allNotifications().length;
    expect(count).toBe(2 /* parents A: 2 children */ + 1 /* parent B */ + 3 /* collectors + manager */);
    jumpTo(new Date(MONTH_END_DUE.getTime() + 24 * 3600_000));
    await w.processor.processDue();
    expect(w.allNotifications()).toHaveLength(count);
  });

  it('respects the CURRENT assignments: an unassigned Collector is not told, a newly assigned one is', async () => {
    w.subscriptions.collectors.set(ids.school, [COLLECTOR_2, 'c0000000-0000-4000-8000-000000000003']);
    jumpTo(MONTH_END_DUE);
    await w.processor.processDue();
    expect(w.notificationsOf(COLLECTOR_1)).toHaveLength(0);
    expect(w.notificationsOf(COLLECTOR_2)).toHaveLength(1);
    expect(w.notificationsOf('c0000000-0000-4000-8000-000000000003')).toHaveLength(1);
  });

  it('only subscriptions of THIS school and month are included', async () => {
    const other = 'a0000000-0000-4000-8000-000000000009';
    w.subscriptions.subscriptions.set(other, { id: other, studentId: ids.studentB, schoolId: 'f0000000-0000-4000-8000-00000000000f', month: MONTH, status: 'UNPAID', createdAt: CREATED_AT });
    const older = 'a0000000-0000-4000-8000-000000000008';
    w.subscriptions.subscriptions.set(older, { id: older, studentId: ids.studentB, schoolId: ids.school, month: '2026-10', status: 'UNPAID', createdAt: CREATED_AT });
    jumpTo(MONTH_END_DUE);
    await w.processor.processDue();
    expect(w.notificationsOf(ids.manager1)[0]?.body).toContain('3 students');
    expect(w.notificationsOf(ids.parentB)).toHaveLength(1);
  });

  it('a long list shows the first names and how many more (the text stays within limits)', async () => {
    for (let i = 10; i < 40; i += 1) {
      const sid = `d0000000-0000-4000-8000-0000000000${i}`;
      w.students.map.set(sid, { id: sid, fullName: `Student Number${i}`, schoolId: ids.school, parentUserIds: [] });
      w.subscriptions.subscriptions.set(`e0000000-0000-4000-8000-0000000000${i}`, { id: `e0000000-0000-4000-8000-0000000000${i}`, studentId: sid, schoolId: ids.school, month: MONTH, status: 'UNPAID', createdAt: CREATED_AT });
    }
    jumpTo(MONTH_END_DUE);
    await w.processor.processDue();
    const body = w.notificationsOf(ids.manager1)[0]?.body ?? '';
    expect(body).toContain('33 students');
    expect(body).toContain('(+13)');
    expect(body.length).toBeLessThan(1500);
  });

  it('when the month is already over the window has passed: suppressed, nothing sent', async () => {
    jumpTo(new Date('2026-12-02T08:00:00Z'));
    const result = await w.processor.processDue();
    expect(result.sent).toBe(0);
    expect(w.allNotifications()).toHaveLength(0);
    expect((await w.state.findReminder(REMINDER_KINDS.SUBSCRIPTION_UNPAID_MONTH_END, BATCH))?.state).toBe('SUPPRESSED');
  });

  it('a bulk creation made INSIDE the window is sent at the next pass (the beginning of the window already passed)', async () => {
    const w2 = createRulesHarness();
    const lateBatch = 'b0000000-0000-4000-8000-0000000000aa';
    w2.h.advance(new Date('2026-11-28T09:00:00Z').getTime() - w2.h.clock.now().getTime());
    w2.subscriptions.subscriptions.set(subId(1), { id: subId(1), studentId: ids.studentA, schoolId: ids.school, month: MONTH, status: 'UNPAID', createdAt: w2.h.clock.now() });
    w2.subscriptions.batches.set(lateBatch, { id: lateBatch, schoolId: ids.school, month: MONTH });
    w2.subscriptions.batchMembers.set(lateBatch, [subId(1)]);
    w2.subscriptions.managers.set(ids.school, [ids.manager1]);
    await w2.deliver(SubscriptionEventTypes.SUBSCRIPTIONS_CREATED, { ...batchEvent(), batchId: lateBatch, count: 1 });
    const result = await w2.processor.processDue();
    expect(result.sent).toBe(1);
    expect(w2.notificationsOf(ids.manager1)).toHaveLength(1);
  });
});
