import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { SUBSCRIPTIONS, createSubscriptionsApi } from '../helpers/subscriptions-api-harness';

const forSchool = (schoolId: string) => `${SUBSCRIPTIONS}/schools/${schoolId}`;
const UNKNOWN = '00000000-0000-4000-8000-000000000000';

/** School A (manager A, collector C linked) with groups G1 (3 students) and G2 (2 students) and the bulk creation of the current month; school B in the same organization; a school in another organization. */
async function setup() {
  const api = await createSubscriptionsApi();
  const { t, login } = api;
  const schoolA = await t.newSchool('مدرسة أ');
  const schoolB = await t.newSchool('مدرسة ب');
  const managerA = await t.newSchoolManager(schoolA.id);
  const managerB = await t.newSchoolManager(schoolB.id);
  const g1 = await t.newGroup(schoolA.id, managerA.id, 'حلقة الفجر');
  const g2 = await t.newGroup(schoolA.id, managerA.id, 'حلقة الضحى');
  const gB = await t.newGroup(schoolB.id, managerB.id, 'حلقة ب');
  const s1 = [await t.newStudentInGroup(schoolA.id, managerA.id, g1.id), await t.newStudentInGroup(schoolA.id, managerA.id, g1.id), await t.newStudentInGroup(schoolA.id, managerA.id, g1.id)];
  const s2 = [await t.newStudentInGroup(schoolA.id, managerA.id, g2.id), await t.newStudentInGroup(schoolA.id, managerA.id, g2.id)];
  await t.newStudentInGroup(schoolB.id, managerB.id, gB.id);
  const authA = await login(managerA);
  const authB = await login(managerB);
  await request(api.app).post(`${forSchool(schoolA.id)}/monthly`).set(authA);
  const collector = await t.newCollector(schoolA.id, managerA.id);
  await t.h.identity.changePassword?.(collector.collector.userId, 'New-pass-123');
  const authC = await login({ phone: collector.phone, password: 'New-pass-123' });
  const sub = async (studentId: string, month = '2026-11') => (await t.subscriptionRepo.findByStudentMonth(studentId, month))!.id;
  return { ...api, schoolA, schoolB, managerA, managerB, g1, g2, gB, s1, s2, authA, authB, authC, collector, sub };
}

describe('GET /subscriptions/schools/:schoolId/groups', () => {
  it('returns the school\'s groups with paid / unpaid / total, waived in the total only, and a localized-free JSON shape', async () => {
    const { app, authA, authC, schoolA, g1, g2, s1, sub } = await setup();
    await request(app).post(`${SUBSCRIPTIONS}/${await sub(s1[0]!.id)}/mark-paid`).set(authA);
    await request(app).post(`${SUBSCRIPTIONS}/${await sub(s1[1]!.id)}/waive`).set(authA);

    for (const auth of [authA, authC]) {
      const res = await request(app).get(`${forSchool(schoolA.id)}/groups`).set(auth);
      expect(res.status).toBe(200);
      expect(res.body.meta).toMatchObject({ total: 2, page: 1, pageSize: 20 });
      const byId = new Map(res.body.data.map((g: { groupId: string }) => [g.groupId, g]));
      expect(byId.get(g1.id)).toEqual({ groupId: g1.id, groupName: 'حلقة الفجر', month: '2026-11', subscriptionsCreated: true, paidStudents: 1, unpaidStudents: 1, waivedStudents: 1, withoutSubscription: 0, totalStudents: 3 });
      expect(byId.get(g2.id)).toMatchObject({ paidStudents: 0, unpaidStudents: 2, waivedStudents: 0, totalStudents: 2 });
    }
  });

  it('honours filter[month], the default month, sorting and validation', async () => {
    const { app, authA, schoolA, g1 } = await setup();
    const past = await request(app).get(`${forSchool(schoolA.id)}/groups?filter[month]=2026-09`).set(authA);
    expect(past.status).toBe(200);
    expect(past.body.data.find((g: { groupId: string }) => g.groupId === g1.id)).toMatchObject({ month: '2026-09', subscriptionsCreated: false, withoutSubscription: 3, unpaidStudents: 0, totalStudents: 3 });
    expect((await request(app).get(`${forSchool(schoolA.id)}/groups`).set(authA)).body.data[0].month).toBe('2026-11');
    expect((await request(app).get(`${forSchool(schoolA.id)}/groups?sort=-name`).set(authA)).body.data[0].groupName).toBe('حلقة الفجر');
    const bad = await request(app).get(`${forSchool(schoolA.id)}/groups?filter[month]=2026-13`).set(authA);
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_SUBSCRIPTION_MONTH');
    expect((await request(app).get(`${forSchool('not-a-uuid')}/groups`).set(authA)).status).toBe(400);
  });

  it('enforces school, organization and assignment boundaries', async () => {
    const { app, t, login, authA, authB, authC, schoolA, managerA, collector } = await setup();
    const url = `${forSchool(schoolA.id)}/groups`;
    expect((await request(app).get(url)).status).toBe(401);
    expect((await request(app).get(url).set(authB)).status).toBe(403); // another school's manager
    expect((await request(app).get(url).set(await login(t.orgAdmin))).status).toBe(403);
    expect((await request(app).get(url).set(await login(await t.h.createUser({ role: 'MAIN_ADMIN' })))).status).toBe(403);
    // a manager/collector of ANOTHER ORGANIZATION
    const org2 = await t.otherOrg();
    const school2 = await t.newSchool('مدرسة المؤسسة الثانية', org2.id);
    const manager2 = await t.newSchoolManager(school2.id, org2.id);
    expect((await request(app).get(url).set(await login(manager2))).status).toBe(403);
    // a Collector linked to ANOTHER school only
    const other = await t.newCollector(school2.id, manager2.id);
    await t.h.identity.changePassword?.(other.collector.userId, 'New-pass-123');
    expect((await request(app).get(url).set(await login({ phone: other.phone, password: 'New-pass-123' }))).status).toBe(403);
    // an unassigned Collector loses access at once (historical assignments grant nothing)
    expect((await request(app).get(url).set(authC)).status).toBe(200);
    await request(app).delete(`${forSchool(schoolA.id)}/collectors/${collector.collector.userId}`).set(authA);
    expect((await request(app).get(url).set(authC)).status).toBe(403);
    expect((await request(app).get(`${url}/${UNKNOWN}/students`).set(authC)).status).toBe(403);
    expect(managerA.id).toBeDefined();
  });
});

describe('GET /subscriptions/schools/:schoolId/groups/:groupId/students', () => {
  it('lists the group\'s students with their status for the month, including WAIVED and "no record" explicitly', async () => {
    const { app, t, authA, authC, schoolA, managerA, g1, s1, s2, sub } = await setup();
    await request(app).post(`${SUBSCRIPTIONS}/${await sub(s1[0]!.id)}/mark-paid`).set(authA);
    await request(app).post(`${SUBSCRIPTIONS}/${await sub(s1[1]!.id)}/waive`).set(authA);
    const late = await t.newStudentInGroup(schoolA.id, managerA.id, g1.id);

    for (const auth of [authA, authC]) {
      const res = await request(app).get(`${forSchool(schoolA.id)}/groups/${g1.id}/students`).set(auth);
      expect(res.status).toBe(200);
      expect(res.body.meta.total).toBe(4);
      const byId = new Map(res.body.data.map((s: { studentId: string }) => [s.studentId, s]));
      expect(byId.get(s1[0]!.id)).toMatchObject({ status: 'PAID', hasSubscription: true, month: '2026-11' });
      expect(byId.get(s1[1]!.id)).toMatchObject({ status: 'WAIVED' });
      expect(byId.get(s1[2]!.id)).toMatchObject({ status: 'UNPAID' });
      expect(byId.get(late.id)).toMatchObject({ status: null, subscriptionId: null, hasSubscription: false });
      expect(byId.get(s1[0]!.id)).toHaveProperty('studentName');
      for (const other of s2) expect(byId.has(other.id)).toBe(false);
    }
  });

  it('returns the whole group through pagination (default 20, maximum 100) with no duplicate and no missing student', async () => {
    const { app, t, authA, schoolA, managerA, g1 } = await setup();
    for (let i = 0; i < 52; i += 1) await t.newStudentInGroup(schoolA.id, managerA.id, g1.id); // 55 students in G1
    const url = `${forSchool(schoolA.id)}/groups/${g1.id}/students`;
    const ids: string[] = [];
    for (let p = 1; p <= 3; p += 1) {
      const res = await request(app).get(`${url}?page=${p}`).set(authA);
      expect(res.status).toBe(200);
      expect(res.body.meta).toMatchObject({ total: 55, page: p, pageSize: 20 }); // the default page size is 20
      ids.push(...res.body.data.map((s: { studentId: string }) => s.studentId));
    }
    expect(new Set(ids).size).toBe(55);
    const all = await request(app).get(`${url}?pageSize=100`).set(authA);
    expect(all.body.data).toHaveLength(55);
    expect([...all.body.data.map((s: { studentId: string }) => s.studentId)].sort()).toEqual([...ids].sort());
    const capped = await request(app).get(`${url}?pageSize=1000`).set(authA); // the maximum is enforced by the project's pagination convention
    expect([200, 400]).toContain(capped.status);
    if (capped.status === 200) expect(capped.body.meta.pageSize).toBe(100);
    expect((await request(app).get(`${url}?page=4`).set(authA)).body.data).toHaveLength(0);
    expect((await request(app).get(`${url}?page=0`).set(authA)).status).toBe(400);
  });

  it('refuses groups that are not this school\'s (404, the same for another school, another organization, an archived and an unknown group) and invalid input (400)', async () => {
    const { app, t, login, authA, schoolA, managerA, gB, g1 } = await setup();
    const url = (groupId: string) => `${forSchool(schoolA.id)}/groups/${groupId}/students`;
    const org2 = await t.otherOrg();
    const school2 = await t.newSchool('مدرسة المؤسسة الثانية', org2.id);
    const manager2 = await t.newSchoolManager(school2.id, org2.id);
    const g2org = await t.newGroup(school2.id, manager2.id, 'حلقة أخرى');
    const archived = await t.newGroup(schoolA.id, managerA.id, 'قديمة');
    await t.groups.archiveGroup(archived.id, null, managerA.id);
    for (const groupId of [gB.id, g2org.id, archived.id, UNKNOWN]) {
      const res = await request(app).get(url(groupId)).set(authA);
      expect(res.status, groupId).toBe(404);
      expect(res.body.error.code).toBe('SUBSCRIPTION_GROUP_NOT_FOUND');
    }
    expect((await request(app).get(url('not-a-uuid')).set(authA)).status).toBe(400);
    expect((await request(app).get(`${url(g1.id)}?filter[month]=bad`).set(authA)).status).toBe(400);
    // a manager of another school cannot reach school A's group, and school A's manager cannot read school B through A's group id
    expect((await request(app).get(url(g1.id)).set(await login(manager2))).status).toBe(403);
    const unrelated = await t.newSchool('مدرسة غير مرتبطة');
    expect((await request(app).get(`${forSchool(unrelated.id)}/groups/${g1.id}/students`).set(authA)).status).toBe(403); // A's manager cannot use another school's path with A's group id
  });
});

describe('POST /subscriptions/:id/mark-paid', () => {
  it('marks an UNPAID subscription PAID, publishes SubscriptionPaid exactly once, and refuses a second call', async () => {
    const { app, t, authA, s1, sub } = await setup();
    const id = await sub(s1[0]!.id);
    const res = await request(app).post(`${SUBSCRIPTIONS}/${id}/mark-paid`).set(authA);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id, status: 'PAID', studentId: s1[0]!.id });
    expect(res.body.data.paidAt).toBeTruthy();
    expect(t.events('SubscriptionPaid')).toHaveLength(1);
    const again = await request(app).post(`${SUBSCRIPTIONS}/${id}/mark-paid`).set(authA);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('SUBSCRIPTION_ALREADY_PAID');
    expect(t.events('SubscriptionPaid')).toHaveLength(1);
  });

  it('enforces the Oldest-Unpaid Rule through HTTP and rejects a WAIVED subscription', async () => {
    const { app, t, authA, schoolA, managerA, s1 } = await setup();
    // give student s1[0] an OLDER month (October) that stays unpaid
    const oct = (await import('../../src/modules/33-subscriptions/public')).Subscription.openInBatch({ studentId: s1[0]!.id, schoolId: schoolA.id, organizationId: t.org.id, month: '2026-10', createdBy: managerA.id, batchId: (await t.subscriptionRepo.findByStudentMonth(s1[0]!.id, '2026-11'))!.id, clock: t.clock });
    await t.unitOfWork.run((tx) => t.subscriptionRepo.insert(oct, tx));
    const nov = (await t.subscriptionRepo.findByStudentMonth(s1[0]!.id, '2026-11'))!.id;
    const blocked = await request(app).post(`${SUBSCRIPTIONS}/${nov}/mark-paid`).set(authA);
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.code).toBe('OLDER_UNPAID_SUBSCRIPTIONS_EXIST');
    expect((await t.subscriptionRepo.findById(nov))!.status).toBe('UNPAID');
    expect(t.events('SubscriptionPaid')).toHaveLength(0);
    // pay October first (via the contract), then November succeeds
    await t.subscriptions.markPaid(oct.id, managerA.id);
    expect((await request(app).post(`${SUBSCRIPTIONS}/${nov}/mark-paid`).set(authA)).status).toBe(200);

    const waivedId = await (async () => {
      const id = (await t.subscriptionRepo.findByStudentMonth(s1[1]!.id, '2026-11'))!.id;
      await request(app).post(`${SUBSCRIPTIONS}/${id}/waive`).set(authA);
      return id;
    })();
    const waived = await request(app).post(`${SUBSCRIPTIONS}/${waivedId}/mark-paid`).set(authA);
    expect(waived.status).toBe(422);
    expect(waived.body.error.code).toBe('SUBSCRIPTION_NOT_UNPAID');
  });

  it('is available to the school\'s manager and its CURRENT collector only', async () => {
    const { app, t, login, authA, authB, authC, schoolA, managerA, collector, s1, s2, sub } = await setup();
    const id = await sub(s1[0]!.id);
    expect((await request(app).post(`${SUBSCRIPTIONS}/${id}/mark-paid`)).status).toBe(401);
    expect((await request(app).post(`${SUBSCRIPTIONS}/${id}/mark-paid`).set(authB)).status).toBe(403);
    expect((await request(app).post(`${SUBSCRIPTIONS}/${id}/mark-paid`).set(await login(t.orgAdmin))).status).toBe(403);
    expect((await request(app).post(`${SUBSCRIPTIONS}/${id}/mark-paid`).set(await login(await t.h.createUser({ role: 'PARENT' })))).status).toBe(403);
    expect((await request(app).post(`${SUBSCRIPTIONS}/${UNKNOWN}/mark-paid`).set(authA)).status).toBe(403);
    expect((await request(app).post(`${SUBSCRIPTIONS}/not-a-uuid/mark-paid`).set(authA)).status).toBe(400);
    expect((await t.subscriptionRepo.findById(id))!.status).toBe('UNPAID');
    expect((await request(app).post(`${SUBSCRIPTIONS}/${id}/mark-paid`).set(authC)).status).toBe(200); // the linked collector
    await request(app).delete(`${forSchool(schoolA.id)}/collectors/${collector.collector.userId}`).set(authA);
    expect((await request(app).post(`${SUBSCRIPTIONS}/${await sub(s2[0]!.id)}/mark-paid`).set(authC)).status).toBe(403); // the ended link grants nothing
    expect(managerA.id).toBeDefined();
  });

  it('is concurrency-safe: simultaneous requests pay the subscription once', async () => {
    const { app, t, authA, s1, sub } = await setup();
    const id = await sub(s1[0]!.id);
    const results = await Promise.all([1, 2, 3, 4].map(() => request(app).post(`${SUBSCRIPTIONS}/${id}/mark-paid`).set(authA)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(t.events('SubscriptionPaid')).toHaveLength(1);
    for (const r of results.filter((x) => x.status !== 200)) expect([409, 422]).toContain(r.status);
  });
});

describe('POST /subscriptions/:id/mark-unpaid', () => {
  it('changes a PAID subscription of the current month to UNPAID and publishes no SubscriptionPaid', async () => {
    const { app, t, authA, authC, s1, s2, sub } = await setup();
    const id = await sub(s1[0]!.id);
    await request(app).post(`${SUBSCRIPTIONS}/${id}/mark-paid`).set(authA);
    const res = await request(app).post(`${SUBSCRIPTIONS}/${id}/mark-unpaid`).set(authA);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id, status: 'UNPAID', paidAt: null });
    expect(t.events('SubscriptionPaid')).toHaveLength(1); // only the original payment
    expect(t.events('SubscriptionMarkedUnpaid')).toHaveLength(1);
    // the linked collector may do it too
    const id2 = await sub(s2[0]!.id);
    await request(app).post(`${SUBSCRIPTIONS}/${id2}/mark-paid`).set(authC);
    expect((await request(app).post(`${SUBSCRIPTIONS}/${id2}/mark-unpaid`).set(authC)).status).toBe(200);
  });

  it('rejects an already UNPAID, a WAIVED and a PAST-month subscription with distinct errors', async () => {
    const { app, t, authA, schoolA, managerA, s1, sub } = await setup();
    const id = await sub(s1[0]!.id);
    const already = await request(app).post(`${SUBSCRIPTIONS}/${id}/mark-unpaid`).set(authA);
    expect(already.status).toBe(409);
    expect(already.body.error.code).toBe('SUBSCRIPTION_ALREADY_UNPAID');

    const waivedId = await sub(s1[1]!.id);
    await request(app).post(`${SUBSCRIPTIONS}/${waivedId}/waive`).set(authA);
    const waived = await request(app).post(`${SUBSCRIPTIONS}/${waivedId}/mark-unpaid`).set(authA);
    expect(waived.status).toBe(422);
    expect(waived.body.error.code).toBe('SUBSCRIPTION_NOT_PAID');

    // a PAID subscription of OCTOBER while the clock is in November: never changed back
    const { Subscription } = await import('../../src/modules/33-subscriptions/public');
    const october = Subscription.openInBatch({ studentId: s1[2]!.id, schoolId: schoolA.id, organizationId: t.org.id, month: '2026-10', createdBy: managerA.id, batchId: (await t.subscriptionRepo.findByStudentMonth(s1[2]!.id, '2026-11'))!.id, clock: t.clock });
    await t.unitOfWork.run((tx) => t.subscriptionRepo.insert(october, tx));
    await t.subscriptions.markPaid(october.id, managerA.id);
    const past = await request(app).post(`${SUBSCRIPTIONS}/${october.id}/mark-unpaid`).set(authA);
    expect(past.status).toBe(422);
    expect(past.body.error.code).toBe('SUBSCRIPTION_MONTH_NOT_CURRENT');
    expect((await t.subscriptionRepo.findById(october.id))!.status).toBe('PAID');
    expect(t.events('SubscriptionMarkedUnpaid')).toHaveLength(0);
  });

  it('follows the Cairo month boundary over HTTP', async () => {
    const { app, t, authA, s1, sub } = await setup();
    const id = await sub(s1[0]!.id);
    await request(app).post(`${SUBSCRIPTIONS}/${id}/mark-paid`).set(authA);
    t.setNow('2026-11-30T21:59:59Z'); // 23:59:59 on 30 Nov in Cairo
    expect((await request(app).post(`${SUBSCRIPTIONS}/${id}/mark-unpaid`).set(authA)).status).toBe(200);
    await request(app).post(`${SUBSCRIPTIONS}/${id}/mark-paid`).set(authA);
    t.setNow('2026-11-30T22:00:00Z'); // 00:00 on 1 Dec in Cairo
    const res = await request(app).post(`${SUBSCRIPTIONS}/${id}/mark-unpaid`).set(authA);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('SUBSCRIPTION_MONTH_NOT_CURRENT');
  });

  it('enforces authorization (roles, school, organization, current assignment) and validates the id', async () => {
    const { app, t, login, authA, authB, authC, schoolA, collector, s1, sub } = await setup();
    const id = await sub(s1[0]!.id);
    await request(app).post(`${SUBSCRIPTIONS}/${id}/mark-paid`).set(authA);
    expect((await request(app).post(`${SUBSCRIPTIONS}/${id}/mark-unpaid`)).status).toBe(401);
    expect((await request(app).post(`${SUBSCRIPTIONS}/${id}/mark-unpaid`).set(authB)).status).toBe(403);
    expect((await request(app).post(`${SUBSCRIPTIONS}/${id}/mark-unpaid`).set(await login(t.orgAdmin))).status).toBe(403);
    expect((await request(app).post(`${SUBSCRIPTIONS}/${id}/mark-unpaid`).set(await login(await t.h.createUser({ role: 'TEACHER' })))).status).toBe(403);
    expect((await request(app).post(`${SUBSCRIPTIONS}/${UNKNOWN}/mark-unpaid`).set(authA)).status).toBe(403);
    expect((await request(app).post(`${SUBSCRIPTIONS}/bad-id/mark-unpaid`).set(authA)).status).toBe(400);
    expect((await t.subscriptionRepo.findById(id))!.status).toBe('PAID');
    await request(app).delete(`${forSchool(schoolA.id)}/collectors/${collector.collector.userId}`).set(authA);
    expect((await request(app).post(`${SUBSCRIPTIONS}/${id}/mark-unpaid`).set(authC)).status).toBe(403);
    expect((await t.subscriptionRepo.findById(id))!.status).toBe('PAID');
  });

  it('is concurrency-safe: simultaneous requests change it once and publish one SubscriptionMarkedUnpaid', async () => {
    const { app, t, authA, s1, sub } = await setup();
    const id = await sub(s1[0]!.id);
    await request(app).post(`${SUBSCRIPTIONS}/${id}/mark-paid`).set(authA);
    const results = await Promise.all([1, 2, 3, 4].map(() => request(app).post(`${SUBSCRIPTIONS}/${id}/mark-unpaid`).set(authA)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(t.events('SubscriptionMarkedUnpaid')).toHaveLength(1);
    expect(t.events('SubscriptionPaid')).toHaveLength(1);
  });

  it('the group endpoints show the new status immediately (summary and student list agree)', async () => {
    const { app, authA, schoolA, g1, s1, sub } = await setup();
    const id = await sub(s1[0]!.id);
    await request(app).post(`${SUBSCRIPTIONS}/${id}/mark-paid`).set(authA);
    let summary = (await request(app).get(`${forSchool(schoolA.id)}/groups`).set(authA)).body.data.find((g: { groupId: string }) => g.groupId === g1.id);
    expect(summary).toMatchObject({ paidStudents: 1, unpaidStudents: 2 });
    await request(app).post(`${SUBSCRIPTIONS}/${id}/mark-unpaid`).set(authA);
    summary = (await request(app).get(`${forSchool(schoolA.id)}/groups`).set(authA)).body.data.find((g: { groupId: string }) => g.groupId === g1.id);
    expect(summary).toMatchObject({ paidStudents: 0, unpaidStudents: 3, totalStudents: 3 });
    const students = (await request(app).get(`${forSchool(schoolA.id)}/groups/${g1.id}/students`).set(authA)).body.data;
    expect(students.find((s: { studentId: string }) => s.studentId === s1[0]!.id).status).toBe('UNPAID');
  });
});
