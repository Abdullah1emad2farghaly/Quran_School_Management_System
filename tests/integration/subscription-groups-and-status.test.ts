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
    const { app, t, authA, authC, schoolA, managerA, g1, g2, s1, sub } = await setup();
    await t.payViaWorkflow(await sub(s1[0]!.id), managerA.id);
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
    await t.payViaWorkflow(await sub(s1[0]!.id), managerA.id);
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

describe('Module 33 exposes no payment-status endpoint (Module 34 owns PAID <-> UNPAID)', () => {
  it('POST /subscriptions/:id/mark-paid and /mark-unpaid no longer exist for anyone, and the status never changes', async () => {
    const { app, authA, authC, s1, sub } = await setup();
    const id = await sub(s1[0]!.id);
    for (const auth of [authA, authC]) {
      for (const action of ['mark-paid', 'mark-unpaid']) {
        const res = await request(app).post(`${SUBSCRIPTIONS}/${id}/${action}`).set(auth);
        expect([404, 405], `${action}`).toContain(res.status);
      }
    }
    expect((await request(app).get(`${SUBSCRIPTIONS}/${id}`).set(authA)).body.data.status).toBe('UNPAID');
  });

  it('the group endpoints show a status change made by the payment workflow immediately (summary and student list agree)', async () => {
    const { app, t, authA, managerA, schoolA, g1, s1, sub } = await setup();
    const id = await sub(s1[0]!.id);
    await t.payViaWorkflow(id, managerA.id);
    let summary = (await request(app).get(`${forSchool(schoolA.id)}/groups`).set(authA)).body.data.find((g: { groupId: string }) => g.groupId === g1.id);
    expect(summary).toMatchObject({ paidStudents: 1, unpaidStudents: 2 });
    await t.reverseViaWorkflow(id, managerA.id);
    summary = (await request(app).get(`${forSchool(schoolA.id)}/groups`).set(authA)).body.data.find((g: { groupId: string }) => g.groupId === g1.id);
    expect(summary).toMatchObject({ paidStudents: 0, unpaidStudents: 3, totalStudents: 3 });
    const students = (await request(app).get(`${forSchool(schoolA.id)}/groups/${g1.id}/students`).set(authA)).body.data;
    expect(students.find((s: { studentId: string }) => s.studentId === s1[0]!.id).status).toBe('UNPAID');
  });
});
