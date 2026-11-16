import { describe, expect, it } from 'vitest';
import { AppError } from '../../../src/modules/00-shared-kernel/public';
import { createSubscriptionsHarness } from '../../helpers/subscriptions-harness';

const codeOf = (p: Promise<unknown>) => p.then(() => 'NO_ERROR', (e: unknown) => (e instanceof AppError ? e.code : `NOT_APP_ERROR:${String(e)}`));
const page = (n = 1, size = 100) => ({ page: n, pageSize: size });

/** A school with a manager, three groups (G1: 3 students, G2: 2 students, G3: empty) and the bulk creation of the current month (Nov 2026) NOT yet done. */
async function setup() {
  const t = await createSubscriptionsHarness();
  const school = await t.newSchool();
  const manager = await t.newSchoolManager(school.id);
  const g1 = await t.newGroup(school.id, manager.id, 'حلقة الفجر');
  const g2 = await t.newGroup(school.id, manager.id, 'حلقة الضحى');
  const g3 = await t.newGroup(school.id, manager.id, 'حلقة العصر');
  const s1 = [await t.newStudentInGroup(school.id, manager.id, g1.id), await t.newStudentInGroup(school.id, manager.id, g1.id), await t.newStudentInGroup(school.id, manager.id, g1.id)];
  const s2 = [await t.newStudentInGroup(school.id, manager.id, g2.id), await t.newStudentInGroup(school.id, manager.id, g2.id)];
  const sub = async (studentId: string, month = '2026-11') => (await t.subscriptionRepo.findByStudentMonth(studentId, month))!.id;
  const summaries = async (month?: string, schoolId = school.id) => (await t.groupSummaries.listGroupSummaries(schoolId, { ...(month ? { month } : {}), page: page() })).items;
  const summaryOf = async (groupId: string, month?: string) => (await summaries(month)).find((g) => g.groupId === groupId)!;
  return { t, school, manager, g1, g2, g3, s1, s2, sub, summaries, summaryOf };
}

describe('group summary: the school\'s existing groups with paid / unpaid / total for a month', () => {
  it('returns exactly the ACTIVE groups of the school (id and name), including an empty group, and no other school\'s groups', async () => {
    const { t, school, manager, g1, g2, g3, summaries } = await setup();
    const archived = await t.newGroup(school.id, manager.id, 'حلقة مؤرشفة');
    await t.groups.archiveGroup(archived.id, null, manager.id);
    const other = await t.newSchool('مدرسة أخرى');
    const otherManager = await t.newSchoolManager(other.id);
    await t.newGroup(other.id, otherManager.id, 'حلقة غريبة');

    const result = await summaries();
    expect(result.map((g) => g.groupId).sort()).toEqual([g1.id, g2.id, g3.id].sort());
    expect(result.map((g) => g.groupName).sort()).toEqual(['حلقة الفجر', 'حلقة الضحى', 'حلقة العصر'].sort());
    expect(result.find((g) => g.groupId === g3.id)).toMatchObject({ totalStudents: 0, paidStudents: 0, unpaidStudents: 0, withoutSubscription: 0 });
  });

  it('counts PAID and UNPAID students from the real subscription records of the month; WAIVED are in the total only', async () => {
    const { t, school, manager, g1, g2, s1, s2, sub, summaryOf } = await setup();
    await t.subscriptions.createMonthlySubscriptions(school.id, manager.id);
    await t.subscriptions.markPaid(await sub(s1[0]!.id), manager.id);
    await t.subscriptions.waiveSubscription(await sub(s1[1]!.id), manager.id);

    expect(await summaryOf(g1.id)).toMatchObject({ month: '2026-11', subscriptionsCreated: true, paidStudents: 1, unpaidStudents: 1, waivedStudents: 1, withoutSubscription: 0, totalStudents: 3 });
    expect(await summaryOf(g2.id)).toMatchObject({ paidStudents: 0, unpaidStudents: 2, waivedStudents: 0, withoutSubscription: 0, totalStudents: 2 });
    for (const g of [await summaryOf(g1.id), await summaryOf(g2.id)]) expect(g.paidStudents + g.unpaidStudents + g.waivedStudents + g.withoutSubscription).toBe(g.totalStudents);
    expect(s2).toHaveLength(2);
  });

  it('a WAIVED student is never in paid or unpaid, even when every student is waived', async () => {
    const { t, school, manager, g2, s2, sub, summaryOf } = await setup();
    await t.subscriptions.createMonthlySubscriptions(school.id, manager.id);
    for (const s of s2) await t.subscriptions.waiveSubscription(await sub(s.id), manager.id);
    expect(await summaryOf(g2.id)).toMatchObject({ paidStudents: 0, unpaidStudents: 0, waivedStudents: 2, totalStudents: 2 });
  });

  it('a regular/active student WITHOUT a subscription record is reported explicitly and is never counted paid or unpaid', async () => {
    const { t, school, manager, g1, sub, summaryOf } = await setup();
    await t.subscriptions.createMonthlySubscriptions(school.id, manager.id);
    const late = await t.newStudentInGroup(school.id, manager.id, g1.id); // joined AFTER the bulk creation, no individual subscription yet
    expect(await summaryOf(g1.id)).toMatchObject({ unpaidStudents: 3, paidStudents: 0, waivedStudents: 0, withoutSubscription: 1, totalStudents: 4 });
    expect(await t.subscriptionRepo.findByStudentMonth(late.id, '2026-11')).toBeUndefined();

    await t.subscriptions.createIndividualSubscription(school.id, late.id, manager.id); // after the explicit individual creation the student is UNPAID
    expect(await summaryOf(g1.id)).toMatchObject({ unpaidStudents: 4, withoutSubscription: 0, totalStudents: 4 });
    expect(await sub(late.id)).toBeDefined();
  });

  it('before the bulk creation every student is "without subscription" and subscriptionsCreated is false (nothing is invented as UNPAID)', async () => {
    const { g1, g2, summaryOf } = await setup();
    expect(await summaryOf(g1.id)).toMatchObject({ subscriptionsCreated: false, paidStudents: 0, unpaidStudents: 0, withoutSubscription: 3, totalStudents: 3 });
    expect(await summaryOf(g2.id)).toMatchObject({ subscriptionsCreated: false, withoutSubscription: 2, totalStudents: 2 });
  });

  it('filters by the requested month: other months do not leak in, and the default is the current Africa/Cairo month', async () => {
    const { t, school, manager, g1, s1, sub, summaryOf } = await setup();
    t.setNow('2026-10-10T09:00:00Z');
    await t.subscriptions.createMonthlySubscriptions(school.id, manager.id);
    await t.subscriptions.markPaid(await sub(s1[0]!.id, '2026-10'), manager.id);
    await t.subscriptions.markPaid(await sub(s1[1]!.id, '2026-10'), manager.id);
    t.setNow('2026-11-10T09:00:00Z');
    await t.subscriptions.createMonthlySubscriptions(school.id, manager.id);

    expect(await summaryOf(g1.id, '2026-10')).toMatchObject({ month: '2026-10', paidStudents: 2, unpaidStudents: 1, totalStudents: 3 });
    expect(await summaryOf(g1.id, '2026-11')).toMatchObject({ month: '2026-11', paidStudents: 0, unpaidStudents: 3, totalStudents: 3 });
    expect(await summaryOf(g1.id)).toMatchObject({ month: '2026-11', paidStudents: 0, unpaidStudents: 3 }); // default = current month
    expect(await summaryOf(g1.id, '2026-09')).toMatchObject({ month: '2026-09', subscriptionsCreated: false, withoutSubscription: 3 });
    t.setNow('2026-10-31T22:30:00Z'); // 00:30 on 1 Nov in Cairo: the default month follows the Cairo calendar
    expect((await summaryOf(g1.id)).month).toBe('2026-11');
    expect(await codeOf(t.groupSummaries.listGroupSummaries(school.id, { month: '2026-13', page: page() }))).toBe('INVALID_SUBSCRIPTION_MONTH');
  });

  it('counts only regular/active students: INACTIVE and ARCHIVED students are excluded from every count', async () => {
    const { t, school, manager, g1, s1, sub, summaryOf } = await setup();
    await t.subscriptions.createMonthlySubscriptions(school.id, manager.id);
    await t.subscriptions.markPaid(await sub(s1[0]!.id), manager.id);
    await t.students.deactivateStudent(s1[0]!.id, 'paused', manager.id); // a PAID student who is no longer regular/active
    await t.students.archiveStudent(s1[2]!.id, 'left', manager.id);
    expect(await summaryOf(g1.id)).toMatchObject({ paidStudents: 0, unpaidStudents: 1, totalStudents: 1 });
  });

  it('never counts a student twice: moving a student between groups moves the count, the school total stays the same', async () => {
    const { t, manager, g1, g2, s1, summaries } = await setup();
    await t.groups.moveStudent(g1.id, s1[0]!.id, g2.id, manager.id);
    const [a, b] = [await summaries(), await summaries()];
    expect(a).toEqual(b);
    const byId = new Map(a.map((g) => [g.groupId, g.totalStudents]));
    expect(byId.get(g1.id)).toBe(2);
    expect(byId.get(g2.id)).toBe(3);
    expect(a.reduce((sum, g) => sum + g.totalStudents, 0)).toBe(5); // 5 students in the school, each in exactly one group
  });

  it('a student of another group never appears in this group\'s counts', async () => {
    const { t, school, manager, g1, g2, s2, sub, summaryOf } = await setup();
    await t.subscriptions.createMonthlySubscriptions(school.id, manager.id);
    for (const s of s2) await t.subscriptions.markPaid(await sub(s.id), manager.id);
    expect(await summaryOf(g2.id)).toMatchObject({ paidStudents: 2 });
    expect(await summaryOf(g1.id)).toMatchObject({ paidStudents: 0 });
  });

  it('is sorted by name, paginated (default rules are applied by the route) and complete across pages', async () => {
    const { t, school, manager } = await setup();
    for (let i = 0; i < 24; i += 1) await t.newGroup(school.id, manager.id, `مجموعة ${String(i).padStart(2, '0')}`);
    const first = await t.groupSummaries.listGroupSummaries(school.id, { page: page(1, 20) });
    const second = await t.groupSummaries.listGroupSummaries(school.id, { page: page(2, 20) });
    expect(first.total).toBe(27);
    expect(first.items).toHaveLength(20);
    expect(second.items).toHaveLength(7);
    const names = [...first.items, ...second.items].map((g) => g.groupName);
    expect(new Set(names).size).toBe(27); // no group twice, none missing
    expect(names).toEqual([...names].sort((a, b) => (a < b ? -1 : 1)));
    const desc = await t.groupSummaries.listGroupSummaries(school.id, { direction: 'desc', page: page(1, 3) });
    expect(desc.items.map((g) => g.groupName)).toEqual([...names].sort().reverse().slice(0, 3));
  });

  it('refuses an unknown or inactive school', async () => {
    const { t } = await setup();
    expect(await codeOf(t.groupSummaries.listGroupSummaries('00000000-0000-4000-8000-000000000000', { page: page() }))).toBe('SUBSCRIPTION_SCHOOL_NOT_ACTIVE');
  });

  it('is read-only: it changes no subscription and publishes no event', async () => {
    const { t, school, manager, summaries } = await setup();
    await t.subscriptions.createMonthlySubscriptions(school.id, manager.id);
    const before = JSON.stringify([...t.subscriptionRepo.rows]);
    const events = t.events().length;
    await summaries();
    await summaries('2026-10');
    expect(JSON.stringify([...t.subscriptionRepo.rows])).toBe(before);
    expect(t.events()).toHaveLength(events);
  });
});

describe('group students: every regular/active student of ONE group with the status of the month', () => {
  it('returns the group\'s students with their status (PAID / UNPAID / WAIVED / null when there is no record), and only that group\'s students', async () => {
    const { t, school, manager, g1, g2, s1, s2, sub } = await setup();
    await t.subscriptions.createMonthlySubscriptions(school.id, manager.id);
    await t.subscriptions.markPaid(await sub(s1[0]!.id), manager.id);
    await t.subscriptions.waiveSubscription(await sub(s1[1]!.id), manager.id);
    const late = await t.newStudentInGroup(school.id, manager.id, g1.id);

    const result = await t.groupSummaries.listGroupStudents(school.id, g1.id, { page: page() });
    expect(result.total).toBe(4);
    const byId = new Map(result.items.map((s) => [s.studentId, s]));
    expect(byId.get(s1[0]!.id)).toMatchObject({ status: 'PAID', hasSubscription: true, month: '2026-11' });
    expect(byId.get(s1[1]!.id)).toMatchObject({ status: 'WAIVED', hasSubscription: true }); // waived students are listed
    expect(byId.get(s1[2]!.id)).toMatchObject({ status: 'UNPAID', hasSubscription: true });
    expect(byId.get(late.id)).toMatchObject({ status: null, subscriptionId: null, hasSubscription: false }); // never inferred as UNPAID
    expect(byId.get(s1[0]!.id)!.subscriptionId).toBe(await sub(s1[0]!.id));
    expect(byId.get(s1[0]!.id)!.studentName).toBeTruthy();
    for (const other of s2) expect(byId.has(other.id)).toBe(false);
    const other = await t.groupSummaries.listGroupStudents(school.id, g2.id, { page: page() });
    expect(other.items.map((s) => s.studentId).sort()).toEqual(s2.map((s) => s.id).sort());
  });

  it('returns the WHOLE group through pagination, with no arbitrary limit of 20 and no duplicate or missing student', async () => {
    const t = await createSubscriptionsHarness();
    const school = await t.newSchool();
    const manager = await t.newSchoolManager(school.id);
    const group = await t.newGroup(school.id, manager.id, 'حلقة كبيرة');
    const ids: string[] = [];
    for (let i = 0; i < 45; i += 1) ids.push((await t.newStudentInGroup(school.id, manager.id, group.id)).id);
    await t.subscriptions.createMonthlySubscriptions(school.id, manager.id);

    const collected: string[] = [];
    const sizes: number[] = [];
    for (let p = 1; p <= 3; p += 1) {
      const result = await t.groupSummaries.listGroupStudents(school.id, group.id, { page: page(p, 20) });
      expect(result.total).toBe(45);
      sizes.push(result.items.length);
      collected.push(...result.items.map((s) => s.studentId));
    }
    expect(sizes).toEqual([20, 20, 5]);
    expect(new Set(collected).size).toBe(45);
    expect(collected.sort()).toEqual([...ids].sort());
    expect((await t.groupSummaries.listGroupStudents(school.id, group.id, { page: page(1, 100) })).items).toHaveLength(45); // one page of 100 holds everyone
    expect((await t.groupSummaries.listGroupStudents(school.id, group.id, { page: page(4, 20) })).items).toHaveLength(0);
    expect((await t.groupSummaries.listGroupSummaries(school.id, { page: page() })).items[0]).toMatchObject({ totalStudents: 45, unpaidStudents: 45 });
  });

  it('is sorted by student name (ascending by default, descending on request) and stable across pages', async () => {
    const { t, school, g1 } = await setup();
    const asc = (await t.groupSummaries.listGroupStudents(school.id, g1.id, { page: page() })).items.map((s) => s.studentName);
    expect(asc).toEqual([...asc].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    const desc = (await t.groupSummaries.listGroupStudents(school.id, g1.id, { direction: 'desc', page: page() })).items.map((s) => s.studentName);
    expect(desc).toEqual([...asc].reverse());
  });

  it('honours the requested month (other months do not leak in)', async () => {
    const { t, school, manager, g1, s1, sub } = await setup();
    t.setNow('2026-10-10T09:00:00Z');
    await t.subscriptions.createMonthlySubscriptions(school.id, manager.id);
    await t.subscriptions.markPaid(await sub(s1[0]!.id, '2026-10'), manager.id);
    t.setNow('2026-11-10T09:00:00Z');
    await t.subscriptions.createMonthlySubscriptions(school.id, manager.id);
    const oct = (await t.groupSummaries.listGroupStudents(school.id, g1.id, { month: '2026-10', page: page() })).items;
    const nov = (await t.groupSummaries.listGroupStudents(school.id, g1.id, { page: page() })).items;
    expect(oct.find((s) => s.studentId === s1[0]!.id)).toMatchObject({ status: 'PAID', month: '2026-10' });
    expect(nov.find((s) => s.studentId === s1[0]!.id)).toMatchObject({ status: 'UNPAID', month: '2026-11' });
    expect((await t.groupSummaries.listGroupStudents(school.id, g1.id, { month: '2026-08', page: page() })).items.every((s) => s.status === null)).toBe(true);
  });

  it('excludes INACTIVE and ARCHIVED students and shows a moved student only in the new group', async () => {
    const { t, school, manager, g1, g2, s1 } = await setup();
    await t.students.deactivateStudent(s1[0]!.id, 'paused', manager.id);
    await t.students.archiveStudent(s1[1]!.id, 'left', manager.id);
    expect((await t.groupSummaries.listGroupStudents(school.id, g1.id, { page: page() })).items.map((s) => s.studentId)).toEqual([s1[2]!.id]);
    await t.groups.moveStudent(g1.id, s1[2]!.id, g2.id, manager.id);
    expect((await t.groupSummaries.listGroupStudents(school.id, g1.id, { page: page() })).total).toBe(0);
    expect((await t.groupSummaries.listGroupStudents(school.id, g2.id, { page: page() })).items.map((s) => s.studentId)).toContain(s1[2]!.id);
  });

  it('a group of another school (or organization), an archived group and an unknown group are the same SUBSCRIPTION_GROUP_NOT_FOUND', async () => {
    const { t, school, manager } = await setup();
    const other = await t.newSchool('مدرسة أخرى');
    const otherManager = await t.newSchoolManager(other.id);
    const foreign = await t.newGroup(other.id, otherManager.id, 'حلقة غريبة');
    await t.newStudentInGroup(other.id, otherManager.id, foreign.id);
    const org2 = await t.otherOrg();
    const school3 = await t.newSchool('مدرسة المؤسسة الثانية', org2.id);
    const manager3 = await t.newSchoolManager(school3.id, org2.id);
    const foreignOrg = await t.newGroup(school3.id, manager3.id, 'حلقة مؤسسة أخرى');
    const archived = await t.newGroup(school.id, manager.id, 'حلقة قديمة');
    await t.groups.archiveGroup(archived.id, null, manager.id);
    for (const groupId of [foreign.id, foreignOrg.id, archived.id, '00000000-0000-4000-8000-000000000000']) {
      expect(await codeOf(t.groupSummaries.listGroupStudents(school.id, groupId, { page: page() })), groupId).toBe('SUBSCRIPTION_GROUP_NOT_FOUND');
    }
    expect(await codeOf(t.groupSummaries.listGroupStudents(school.id, foreign.id, { month: '2026-13', page: page() }))).toBe('INVALID_SUBSCRIPTION_MONTH');
  });
});
