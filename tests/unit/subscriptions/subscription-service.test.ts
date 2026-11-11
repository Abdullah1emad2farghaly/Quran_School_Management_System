import { describe, expect, it } from 'vitest';
import { AppError } from '../../../src/modules/00-shared-kernel/public';
import { createSubscriptionsHarness } from '../../helpers/subscriptions-harness';

const codeOf = (p: Promise<unknown>) => p.then(() => 'NO_ERROR', (e: unknown) => (e instanceof AppError ? e.code : `NOT_APP_ERROR:${String(e)}`));

async function setup(studentCount = 3) {
  const t = await createSubscriptionsHarness();
  const school = await t.newSchool();
  const manager = await t.newSchoolManager(school.id);
  const students = [];
  for (let i = 0; i < studentCount; i += 1) students.push(await t.newStudent(school.id, manager.id));
  return { t, school, manager, students };
}

describe('monthly BULK creation', () => {
  it('creates one UNPAID subscription per ACTIVE student for the CURRENT Africa/Cairo month, and nothing else', async () => {
    const { t, school, manager, students } = await setup(3);
    const result = await t.subscriptions.createMonthlySubscriptions(school.id, manager.id);

    expect(result).toMatchObject({ schoolId: school.id, month: '2026-11', count: 3 });
    const page = await t.subscriptions.listSubscriptionsOfSchool({ schoolId: school.id, page: { page: 1, pageSize: 50 } });
    expect(page.total).toBe(3);
    expect(page.items.map((s) => s.studentId).sort()).toEqual(students.map((s) => s.id).sort());
    for (const s of page.items) expect(s).toMatchObject({ month: '2026-11', status: 'UNPAID', paidAt: null, waivedAt: null });
    // A subscription is Student + Month + Status: no amount or fee field exists anywhere.
    expect(Object.keys(page.items[0]!).join(',')).not.toMatch(/amount|fee|price|prorat|enroll/i);
  });

  it('takes the month from the server clock in Africa/Cairo (a UTC instant that is already the 1st in Cairo belongs to the new month)', async () => {
    const { t, school, manager } = await setup(1);
    t.setNow('2026-10-31T21:30:00Z'); // 23:30 on Oct 31 in Cairo (UTC+2)
    expect((await t.subscriptions.createMonthlySubscriptions(school.id, manager.id)).month).toBe('2026-10');
    t.setNow('2026-10-31T22:30:00Z'); // 00:30 on Nov 1 in Cairo
    expect((await t.subscriptions.createMonthlySubscriptions(school.id, manager.id)).month).toBe('2026-11');
  });

  it('includes ONLY active students: an INACTIVE or ARCHIVED student gets no subscription', async () => {
    const { t, school, manager, students } = await setup(3);
    await t.students.deactivateStudent(students[1]!.id, 'left for a while', manager.id);
    await t.students.archiveStudent(students[2]!.id, 'moved away', manager.id);
    const result = await t.subscriptions.createMonthlySubscriptions(school.id, manager.id);
    expect(result.count).toBe(1);
    const page = await t.subscriptions.listSubscriptionsOfSchool({ schoolId: school.id, page: { page: 1, pageSize: 50 } });
    expect(page.items.map((s) => s.studentId)).toEqual([students[0]!.id]);
  });

  it('does not use other schools\' students', async () => {
    const { t, school, manager } = await setup(2);
    const other = await t.newSchool('مدرسة أخرى');
    const otherManager = await t.newSchoolManager(other.id);
    await t.newStudent(other.id, otherManager.id);
    expect((await t.subscriptions.createMonthlySubscriptions(school.id, manager.id)).count).toBe(2);
  });

  it('refuses a second creation for the same school and month, informing the user, and creates NO duplicate', async () => {
    const { t, school, manager } = await setup(2);
    await t.subscriptions.createMonthlySubscriptions(school.id, manager.id);
    expect(await codeOf(t.subscriptions.createMonthlySubscriptions(school.id, manager.id))).toBe('SUBSCRIPTIONS_ALREADY_CREATED_FOR_MONTH');
    expect((await t.subscriptions.listSubscriptionsOfSchool({ schoolId: school.id, page: { page: 1, pageSize: 50 } })).total).toBe(2);
    expect(t.events('SubscriptionsCreated')).toHaveLength(1);
  });

  it('can be run again in the NEXT month', async () => {
    const { t, school, manager } = await setup(2);
    await t.subscriptions.createMonthlySubscriptions(school.id, manager.id);
    t.setNow('2026-12-01T09:00:00Z');
    expect((await t.subscriptions.createMonthlySubscriptions(school.id, manager.id)).month).toBe('2026-12');
    expect((await t.subscriptions.listSubscriptionsOfSchool({ schoolId: school.id, page: { page: 1, pageSize: 50 } })).total).toBe(4);
  });

  it('needs an ACTIVE school and at least one ACTIVE student, and creates nothing otherwise', async () => {
    const { t, school, manager } = await setup(0);
    expect(await codeOf(t.subscriptions.createMonthlySubscriptions(school.id, manager.id))).toBe('SUBSCRIPTION_NO_ACTIVE_STUDENTS');
    expect(await codeOf(t.subscriptions.createMonthlySubscriptions('00000000-0000-4000-8000-000000000000', manager.id))).toBe('SUBSCRIPTION_SCHOOL_NOT_ACTIVE');
    expect(t.subscriptionRepo.batchRows.size).toBe(0);
    expect(t.events()).toHaveLength(0);
  });

  it('is all-or-nothing: a failure while inserting leaves no batch, no subscription and no event', async () => {
    const { t, school, manager, students } = await setup(3);
    // Poison: the second student already has a subscription for the month (as if created by a concurrent writer), so the bulk insert must fail as a whole.
    const original = t.subscriptionRepo.insertMany.bind(t.subscriptionRepo);
    t.subscriptionRepo.insertMany = async (subs, tx) => {
      await original(subs.slice(0, 1), tx);
      throw new AppError('SUBSCRIPTION_ALREADY_EXISTS', 'CONFLICT');
    };
    expect(await codeOf(t.subscriptions.createMonthlySubscriptions(school.id, manager.id))).toBe('SUBSCRIPTION_ALREADY_EXISTS');
    expect(t.subscriptionRepo.rows.size).toBe(0);
    expect(t.subscriptionRepo.batchRows.size).toBe(0);
    expect(t.events()).toHaveLength(0);
    expect(students).toHaveLength(3);
  });

  it('publishes ONE SubscriptionsCreated event with identifiers only', async () => {
    const { t, school, manager } = await setup(2);
    const result = await t.subscriptions.createMonthlySubscriptions(school.id, manager.id);
    const [event] = t.events('SubscriptionsCreated');
    expect(event).toBeDefined();
    expect(JSON.parse(event!.payload)).toEqual({ batchId: result.batchId, schoolId: school.id, organizationId: t.org.id, month: '2026-11', count: 2, actorId: manager.id });
    expect(Object.keys(JSON.parse(event!.payload)).sort()).toEqual(['actorId', 'batchId', 'count', 'month', 'organizationId', 'schoolId']); // identifiers only: no student name, phone or amount
  });
});

describe('INDIVIDUAL creation (a student who joined after the bulk run)', () => {
  it('creates one UNPAID subscription for the current month without touching the others', async () => {
    const { t, school, manager } = await setup(2);
    await t.subscriptions.createMonthlySubscriptions(school.id, manager.id);
    const late = await t.newStudent(school.id, manager.id);

    const created = await t.subscriptions.createIndividualSubscription(school.id, late.id, manager.id);
    expect(created).toMatchObject({ studentId: late.id, month: '2026-11', status: 'UNPAID' });
    expect((await t.subscriptions.listSubscriptionsOfSchool({ schoolId: school.id, page: { page: 1, pageSize: 50 } })).total).toBe(3);
    expect(t.events('SubscriptionCreated')).toHaveLength(1);
    expect(t.events('SubscriptionsCreated')).toHaveLength(1);
  });

  it('is duplicate-protected: a student with a subscription for the month cannot get a second one', async () => {
    const { t, school, manager, students } = await setup(2);
    await t.subscriptions.createMonthlySubscriptions(school.id, manager.id);
    expect(await codeOf(t.subscriptions.createIndividualSubscription(school.id, students[0]!.id, manager.id))).toBe('SUBSCRIPTION_ALREADY_EXISTS');
    const late = await t.newStudent(school.id, manager.id);
    await t.subscriptions.createIndividualSubscription(school.id, late.id, manager.id);
    expect(await codeOf(t.subscriptions.createIndividualSubscription(school.id, late.id, manager.id))).toBe('SUBSCRIPTION_ALREADY_EXISTS');
    expect(t.subscriptionRepo.rows.size).toBe(3);
  });

  it('needs the bulk creation of the month first', async () => {
    const { t, school, manager, students } = await setup(1);
    expect(await codeOf(t.subscriptions.createIndividualSubscription(school.id, students[0]!.id, manager.id))).toBe('SUBSCRIPTIONS_NOT_CREATED_FOR_MONTH');
  });

  it('refuses a student of another school, an unknown student and a student that is not ACTIVE', async () => {
    const { t, school, manager } = await setup(1);
    await t.subscriptions.createMonthlySubscriptions(school.id, manager.id);
    const other = await t.newSchool('مدرسة أخرى');
    const otherManager = await t.newSchoolManager(other.id);
    const stranger = await t.newStudent(other.id, otherManager.id);
    expect(await codeOf(t.subscriptions.createIndividualSubscription(school.id, stranger.id, manager.id))).toBe('SUBSCRIPTION_STUDENT_NOT_IN_SCHOOL');
    expect(await codeOf(t.subscriptions.createIndividualSubscription(school.id, '00000000-0000-4000-8000-000000000000', manager.id))).toBe('SUBSCRIPTION_STUDENT_NOT_FOUND');
    const late = await t.newStudent(school.id, manager.id);
    await t.students.deactivateStudent(late.id, 'paused', manager.id);
    expect(await codeOf(t.subscriptions.createIndividualSubscription(school.id, late.id, manager.id))).toBe('SUBSCRIPTION_STUDENT_NOT_ACTIVE');
  });
});

describe('waiving', () => {
  it('moves UNPAID to WAIVED, records who and when, and publishes SubscriptionWaived', async () => {
    const { t, school, manager, students } = await setup(1);
    await t.subscriptions.createMonthlySubscriptions(school.id, manager.id);
    const [sub] = (await t.subscriptions.listSubscriptionsOfSchool({ schoolId: school.id, page: { page: 1, pageSize: 5 } })).items;
    const waived = await t.subscriptions.waiveSubscription(sub!.id, manager.id);
    expect(waived).toMatchObject({ status: 'WAIVED', studentId: students[0]!.id });
    expect(waived.waivedAt).toBeInstanceOf(Date);
    expect(t.subscriptionRepo.rows.get(sub!.id)!.waivedBy).toBe(manager.id);
    expect(t.events('SubscriptionWaived')).toHaveLength(1);
  });

  it('only an UNPAID subscription can be waived (PAID and WAIVED are final)', async () => {
    const { t, school, manager } = await setup(2);
    await t.subscriptions.createMonthlySubscriptions(school.id, manager.id);
    const [a, b] = (await t.subscriptions.listSubscriptionsOfSchool({ schoolId: school.id, page: { page: 1, pageSize: 5 } })).items;
    await t.subscriptions.waiveSubscription(a!.id, manager.id);
    expect(await codeOf(t.subscriptions.waiveSubscription(a!.id, manager.id))).toBe('SUBSCRIPTION_NOT_UNPAID');
    await t.subscriptions.markPaid(b!.id, manager.id);
    expect(await codeOf(t.subscriptions.waiveSubscription(b!.id, manager.id))).toBe('SUBSCRIPTION_NOT_UNPAID');
    expect(await codeOf(t.subscriptions.waiveSubscription('00000000-0000-4000-8000-000000000000', manager.id))).toBe('SUBSCRIPTION_NOT_FOUND');
  });
});

/** Three months of ONE student: September, October, November (2026). */
async function threeMonths() {
  const s = await setup(1);
  const { t, school, manager, students } = s;
  const ids: Record<string, string> = {};
  for (const [month, now] of [['2026-09', '2026-09-10T09:00:00Z'], ['2026-10', '2026-10-10T09:00:00Z'], ['2026-11', '2026-11-10T09:00:00Z']] as const) {
    t.setNow(now);
    await t.subscriptions.createMonthlySubscriptions(school.id, manager.id);
    ids[month] = (await t.subscriptions.listSubscriptionsOfSchool({ schoolId: school.id, month, page: { page: 1, pageSize: 5 } })).items[0]!.id;
  }
  return { ...s, ids, student: students[0]! };
}

describe('the OLDEST-UNPAID RULE (Master Specification §59) behind markPaid', () => {
  it('refuses to pay a newer month while ANY older month is still UNPAID', async () => {
    const { t, manager, ids } = await threeMonths();
    expect(await codeOf(t.subscriptions.markPaid(ids['2026-10']!, manager.id))).toBe('OLDER_UNPAID_SUBSCRIPTIONS_EXIST');
    expect(await codeOf(t.subscriptions.markPaid(ids['2026-11']!, manager.id))).toBe('OLDER_UNPAID_SUBSCRIPTIONS_EXIST');
    expect(t.events('SubscriptionPaid')).toHaveLength(0);
    expect(t.subscriptionRepo.rows.get(ids['2026-11']!)!.status).toBe('UNPAID');
  });

  it('allows the OLDEST unpaid month first, then the next, in order', async () => {
    const { t, manager, ids } = await threeMonths();
    expect((await t.subscriptions.markPaid(ids['2026-09']!, manager.id)).status).toBe('PAID');
    expect(await codeOf(t.subscriptions.markPaid(ids['2026-11']!, manager.id))).toBe('OLDER_UNPAID_SUBSCRIPTIONS_EXIST'); // October is still unpaid
    expect((await t.subscriptions.markPaid(ids['2026-10']!, manager.id)).status).toBe('PAID');
    expect((await t.subscriptions.markPaid(ids['2026-11']!, manager.id)).status).toBe('PAID');
    expect(t.events('SubscriptionPaid')).toHaveLength(3);
  });

  it('a WAIVED older month no longer blocks a newer month', async () => {
    const { t, manager, ids } = await threeMonths();
    await t.subscriptions.waiveSubscription(ids['2026-09']!, manager.id);
    await t.subscriptions.waiveSubscription(ids['2026-10']!, manager.id);
    expect((await t.subscriptions.markPaid(ids['2026-11']!, manager.id)).status).toBe('PAID');
  });

  it('a mix of PAID and WAIVED older months is enough', async () => {
    const { t, manager, ids } = await threeMonths();
    await t.subscriptions.markPaid(ids['2026-09']!, manager.id);
    await t.subscriptions.waiveSubscription(ids['2026-10']!, manager.id);
    expect((await t.subscriptions.markPaid(ids['2026-11']!, manager.id)).status).toBe('PAID');
  });

  it('a newer month never blocks an older one, and only the SAME student\'s months count', async () => {
    const { t, school, manager, ids } = await threeMonths();
    // another student with only the current month: not blocked by the first student's unpaid history
    const other = await t.newStudent(school.id, manager.id);
    await t.subscriptions.createIndividualSubscription(school.id, other.id, manager.id);
    const otherSub = (await t.subscriptions.listSubscriptionsOfSchool({ schoolId: school.id, studentId: other.id, page: { page: 1, pageSize: 5 } })).items[0]!;
    expect((await t.subscriptions.markPaid(otherSub.id, manager.id)).status).toBe('PAID');
    // the first student's oldest month can be paid even though newer ones exist
    expect((await t.subscriptions.markPaid(ids['2026-09']!, manager.id)).status).toBe('PAID');
  });

  it('a month the student never had a subscription for does not block (only existing older months count)', async () => {
    const { t, school, manager } = await setup(0);
    t.setNow('2026-09-10T09:00:00Z');
    await t.newStudent(school.id, manager.id); // joins in September...
    await t.subscriptions.createMonthlySubscriptions(school.id, manager.id);
    t.setNow('2026-10-10T09:00:00Z');
    await t.subscriptions.createMonthlySubscriptions(school.id, manager.id);
    const late = await t.newStudent(school.id, manager.id); // ...this one joins in October
    t.setNow('2026-11-10T09:00:00Z');
    await t.subscriptions.createMonthlySubscriptions(school.id, manager.id);
    const [novSub] = (await t.subscriptions.listSubscriptionsOfSchool({ schoolId: school.id, studentId: late.id, month: '2026-11', page: { page: 1, pageSize: 5 } })).items;
    expect((await t.subscriptions.markPaid(novSub!.id, manager.id)).status).toBe('PAID'); // no Sep/Oct rows for `late`: nothing older is unpaid
  });

  it('one successful payment per subscription: a second markPaid is refused and publishes nothing', async () => {
    const { t, manager, ids } = await threeMonths();
    await t.subscriptions.markPaid(ids['2026-09']!, manager.id);
    expect(await codeOf(t.subscriptions.markPaid(ids['2026-09']!, manager.id))).toBe('SUBSCRIPTION_ALREADY_PAID');
    expect(t.events('SubscriptionPaid')).toHaveLength(1);
  });

  it('a WAIVED subscription cannot be paid, and an unknown one is not found', async () => {
    const { t, manager, ids } = await threeMonths();
    await t.subscriptions.waiveSubscription(ids['2026-09']!, manager.id);
    expect(await codeOf(t.subscriptions.markPaid(ids['2026-09']!, manager.id))).toBe('SUBSCRIPTION_NOT_UNPAID');
    expect(await codeOf(t.subscriptions.markPaid('00000000-0000-4000-8000-000000000000', manager.id))).toBe('SUBSCRIPTION_NOT_FOUND');
  });

  it('publishes SubscriptionPaid with identifiers only (no name, no amount) and records who and when', async () => {
    const { t, school, manager, student, ids } = await threeMonths();
    await t.subscriptions.markPaid(ids['2026-09']!, manager.id);
    const [event] = t.events('SubscriptionPaid');
    expect(JSON.parse(event!.payload)).toEqual({ subscriptionId: ids['2026-09'], studentId: student.id, schoolId: school.id, organizationId: t.org.id, month: '2026-09', actorId: manager.id });
    const row = t.subscriptionRepo.rows.get(ids['2026-09']!)!;
    expect(row.paidBy).toBe(manager.id);
    expect(row.paidAt).toBeInstanceOf(Date);
  });

  it('joins the CALLER\'S transaction when one is given (Module 34 pays and marks in one unit of work), and rolls back with it', async () => {
    const { t, manager, ids } = await threeMonths();
    const failing = t.unitOfWork.run(async (tx) => {
      await t.subscriptions.markPaid(ids['2026-09']!, manager.id, tx);
      throw new Error('payment insert failed');
    });
    await expect(failing).rejects.toThrow('payment insert failed');
    expect(t.subscriptionRepo.rows.get(ids['2026-09']!)!.status).toBe('UNPAID');
    expect(t.events('SubscriptionPaid')).toHaveLength(0);
  });
});

describe('reads', () => {
  it('lists newest month first by default, filters by month, status and student, and shows the student name', async () => {
    const { t, school, manager, ids, student } = await threeMonths();
    await t.subscriptions.markPaid(ids['2026-09']!, manager.id);
    const all = await t.subscriptions.listSubscriptionsOfSchool({ schoolId: school.id, page: { page: 1, pageSize: 10 } });
    expect(all.items.map((s) => s.month)).toEqual(['2026-11', '2026-10', '2026-09']);
    expect(all.items[0]!.studentName).toBe(student.fullName);
    expect((await t.subscriptions.listSubscriptionsOfSchool({ schoolId: school.id, status: ['PAID'], page: { page: 1, pageSize: 10 } })).items.map((s) => s.month)).toEqual(['2026-09']);
    expect((await t.subscriptions.listSubscriptionsOfSchool({ schoolId: school.id, month: '2026-10', page: { page: 1, pageSize: 10 } })).total).toBe(1);
    expect(await codeOf(t.subscriptions.listSubscriptionsOfSchool({ schoolId: school.id, month: '2026-13', page: { page: 1, pageSize: 10 } }))).toBe('INVALID_SUBSCRIPTION_MONTH');
  });

  it('exposes the read-only lookups other modules use (scope, batch, unpaid of a month)', async () => {
    const { t, school, manager, ids } = await threeMonths();
    await t.subscriptions.markPaid(ids['2026-09']!, manager.id);
    expect(await t.subscriptions.findScopeById(ids['2026-10']!)).toMatchObject({ schoolId: school.id, organizationId: t.org.id });
    expect(await t.subscriptions.findById('00000000-0000-4000-8000-000000000000')).toBeUndefined();
    expect((await t.subscriptions.listUnpaidOfSchoolMonth(school.id, '2026-09')).length).toBe(0);
    expect((await t.subscriptions.listUnpaidOfSchoolMonth(school.id, '2026-10')).length).toBe(1);
  });
});
