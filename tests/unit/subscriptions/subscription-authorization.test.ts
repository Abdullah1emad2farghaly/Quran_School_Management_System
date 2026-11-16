import { describe, expect, it } from 'vitest';
import { SCHOOL_TARGET_TYPE } from '../../../src/modules/16-schools/public';
import { SUBSCRIPTION_SCHOOL_TARGET_TYPE, SUBSCRIPTION_TARGET_TYPE, SubscriptionPermissions as P } from '../../../src/modules/33-subscriptions/public';
import { createSubscriptionsHarness } from '../../helpers/subscriptions-harness';

async function setup() {
  const t = await createSubscriptionsHarness();
  const schoolA = await t.newSchool('مدرسة أ');
  const schoolB = await t.newSchool('مدرسة ب');
  const managerA = await t.newSchoolManager(schoolA.id);
  const managerB = await t.newSchoolManager(schoolB.id);
  const studentA = await t.newStudent(schoolA.id, managerA.id);
  await t.newStudent(schoolB.id, managerB.id);
  await t.subscriptions.createMonthlySubscriptions(schoolA.id, managerA.id);
  await t.subscriptions.createMonthlySubscriptions(schoolB.id, managerB.id);
  const subA = (await t.subscriptions.listSubscriptionsOfSchool({ schoolId: schoolA.id, studentId: studentA.id, page: { page: 1, pageSize: 5 } })).items[0]!;
  const collector = await t.newCollector(schoolA.id, managerA.id);
  const allowed = async (userId: string, permission: string, target?: { type: string; id: string }) => (await t.engine.authorize({ userId, permission, ...(target ? { target } : {}) })).allowed;
  const onSchool = (s: { id: string }) => ({ type: SUBSCRIPTION_SCHOOL_TARGET_TYPE, id: s.id });
  const onSub = (id: string) => ({ type: SUBSCRIPTION_TARGET_TYPE, id });
  return { t, schoolA, schoolB, managerA, managerB, subA, collector, allowed, onSchool, onSub };
}

describe('subscription permissions (deny by default)', () => {
  it('SCHOOL_MANAGER: create (bulk and individual), list, read and WAIVE for THEIR school only', async () => {
    const { schoolA, schoolB, managerA, managerB, subA, allowed, onSchool, onSub } = await setup();
    for (const perm of [P.CREATE_MONTHLY, P.CREATE_INDIVIDUAL, P.LIST]) {
      expect(await allowed(managerA.id, perm, onSchool(schoolA)), `${perm} own school`).toBe(true);
      expect(await allowed(managerA.id, perm, onSchool(schoolB)), `${perm} other school`).toBe(false);
      expect(await allowed(managerB.id, perm, onSchool(schoolA)), `${perm} B on A`).toBe(false);
    }
    for (const perm of [P.READ, P.WAIVE]) {
      expect(await allowed(managerA.id, perm, onSub(subA.id)), `${perm} own subscription`).toBe(true);
      expect(await allowed(managerB.id, perm, onSub(subA.id)), `${perm} other school's subscription`).toBe(false);
    }
  });

  it('SUBSCRIPTION_COLLECTOR: create, list and read for a school they are linked to, but NEVER waive and never manage Collectors', async () => {
    const { schoolA, schoolB, subA, collector, allowed, onSchool, onSub } = await setup();
    const id = collector.collector.userId;
    for (const perm of [P.CREATE_MONTHLY, P.CREATE_INDIVIDUAL, P.LIST]) {
      expect(await allowed(id, perm, onSchool(schoolA)), `${perm} linked school`).toBe(true);
      expect(await allowed(id, perm, onSchool(schoolB)), `${perm} unlinked school`).toBe(false);
    }
    expect(await allowed(id, P.READ, onSub(subA.id))).toBe(true);
    expect(await allowed(id, P.WAIVE, onSub(subA.id))).toBe(false); // §61: a Collector cannot waive in V1
    for (const perm of [P.COLLECTOR_ASSIGN, P.COLLECTOR_LIST, P.COLLECTOR_REMOVE]) {
      expect(await allowed(id, perm, { type: SCHOOL_TARGET_TYPE, id: schoolA.id }), perm).toBe(false);
    }
    expect(await allowed(id, P.COLLECTOR_READ_OWN)).toBe(true);
  });

  it('a Collector linked to two schools reaches both; ending ONE link removes only that school\'s access at once (history grants nothing)', async () => {
    const { t, schoolA, schoolB, managerA, managerB, subA, collector, allowed, onSchool, onSub } = await setup();
    const id = collector.collector.userId;
    await t.collectors.registerCollector({ schoolId: schoolB.id, name: 'محمود سعيد علي', phone: collector.phone }, managerB.id);
    expect(await allowed(id, P.LIST, onSchool(schoolB))).toBe(true);

    await t.collectors.removeSchoolLink(id, schoolA.id, managerA.id);
    expect(await allowed(id, P.LIST, onSchool(schoolA))).toBe(false);
    expect(await allowed(id, P.CREATE_MONTHLY, onSchool(schoolA))).toBe(false);
    expect(await allowed(id, P.READ, onSub(subA.id))).toBe(false);
    expect(await allowed(id, P.LIST, onSchool(schoolB))).toBe(true);
    expect((await t.collectors.listSchoolLinkHistory(id)).find((l) => l.schoolId === schoolA.id)).toMatchObject({ isActive: false });
  });

  it('only the School Manager of the school manages its Collectors (assign, list, remove)', async () => {
    const { schoolA, schoolB, managerA, managerB, allowed } = await setup();
    for (const perm of [P.COLLECTOR_ASSIGN, P.COLLECTOR_LIST, P.COLLECTOR_REMOVE]) {
      expect(await allowed(managerA.id, perm, { type: SCHOOL_TARGET_TYPE, id: schoolA.id }), perm).toBe(true);
      expect(await allowed(managerB.id, perm, { type: SCHOOL_TARGET_TYPE, id: schoolA.id }), perm).toBe(false);
      expect(await allowed(managerA.id, perm, { type: SCHOOL_TARGET_TYPE, id: schoolB.id }), perm).toBe(false);
    }
  });

  it('a manager or Collector of ANOTHER ORGANIZATION never reaches the school or the subscription', async () => {
    const { t, schoolA, subA, allowed, onSchool, onSub } = await setup();
    const org2 = await t.otherOrg();
    const school2 = await t.newSchool('مدرسة ثانية', org2.id);
    const manager2 = await t.newSchoolManager(school2.id, org2.id);
    const collector2 = await t.newCollector(school2.id, manager2.id);
    for (const user of [manager2.id, collector2.collector.userId]) {
      expect(await allowed(user, P.LIST, onSchool(schoolA))).toBe(false);
      expect(await allowed(user, P.CREATE_MONTHLY, onSchool(schoolA))).toBe(false);
      expect(await allowed(user, P.READ, onSub(subA.id))).toBe(false);
    }
  });

  it('PARENT, TEACHER, ORGANIZATION_MANAGER and MAIN_ADMIN get NO subscription permission, and an unknown subscription is denied', async () => {
    const { t, schoolA, subA, allowed, onSchool, onSub } = await setup();
    const mainAdmin = await t.h.createUser({ role: 'MAIN_ADMIN' });
    const parent = await t.h.createUser({ role: 'PARENT' });
    const teacher = await t.h.createUser({ role: 'TEACHER' });
    for (const user of [t.orgAdmin, mainAdmin, parent, teacher]) {
      for (const perm of [P.CREATE_MONTHLY, P.CREATE_INDIVIDUAL, P.LIST]) expect(await allowed(user.id, perm, onSchool(schoolA)), perm).toBe(false);
      for (const perm of [P.READ, P.WAIVE]) expect(await allowed(user.id, perm, onSub(subA.id)), perm).toBe(false);
      expect(await allowed(user.id, P.COLLECTOR_READ_OWN)).toBe(false);
    }
    const manager = await t.newSchoolManager(schoolA.id).catch(() => undefined);
    const managerId = manager?.id ?? subA.id;
    expect(await allowed(managerId, P.READ, onSub('00000000-0000-4000-8000-000000000000'))).toBe(false);
  });

  it('the approved status endpoints and group reads are granted to BOTH collection roles for their own school only (never to anyone else), and waiving stays School-Manager-only', async () => {
    const { t, schoolA, schoolB, managerA, managerB, subA, collector, allowed, onSchool, onSub } = await setup();
    const id = collector.collector.userId;
    for (const perm of [P.MARK_PAID, P.MARK_UNPAID]) {
      expect(await allowed(managerA.id, perm, onSub(subA.id)), `${perm} manager`).toBe(true);
      expect(await allowed(id, perm, onSub(subA.id)), `${perm} linked collector`).toBe(true);
      expect(await allowed(managerB.id, perm, onSub(subA.id)), `${perm} other school's manager`).toBe(false);
    }
    expect(await allowed(managerA.id, P.GROUP_LIST, onSchool(schoolA))).toBe(true);
    expect(await allowed(id, P.GROUP_LIST, onSchool(schoolA))).toBe(true);
    expect(await allowed(id, P.GROUP_LIST, onSchool(schoolB))).toBe(false);
    expect(await allowed(managerB.id, P.GROUP_LIST, onSchool(schoolA))).toBe(false);
    // ending the link removes the new permissions at once, like every other collector access
    await t.collectors.removeSchoolLink(id, schoolA.id, managerA.id);
    for (const perm of [P.MARK_PAID, P.MARK_UNPAID]) expect(await allowed(id, perm, onSub(subA.id)), `${perm} after unassignment`).toBe(false);
    expect(await allowed(id, P.GROUP_LIST, onSchool(schoolA))).toBe(false);
    // nobody else gets them
    const mainAdmin = await t.h.createUser({ role: 'MAIN_ADMIN' });
    const parent = await t.h.createUser({ role: 'PARENT' });
    const teacher = await t.h.createUser({ role: 'TEACHER' });
    for (const user of [t.orgAdmin, mainAdmin, parent, teacher]) {
      for (const perm of [P.MARK_PAID, P.MARK_UNPAID]) expect(await allowed(user.id, perm, onSub(subA.id)), perm).toBe(false);
      expect(await allowed(user.id, P.GROUP_LIST, onSchool(schoolA))).toBe(false);
    }
  });

  it('no permission collects a payment or stores an amount (Module 34): only the approved status transitions exist', () => {
    const codes = Object.values(P);
    expect(codes.filter((c) => /payment|collect(?!or)|charge|amount|reversal|refund/i.test(c))).toEqual([]);
    expect(codes.filter((c) => /paid/i.test(c)).sort()).toEqual(['subscriptions.subscription.mark-paid', 'subscriptions.subscription.mark-unpaid']);
  });
});
