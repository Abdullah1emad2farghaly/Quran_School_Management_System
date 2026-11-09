import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AUTH, SUBSCRIPTIONS, createSubscriptionsApi } from '../helpers/subscriptions-api-harness';

const NAME = 'محمود سعيد علي';
const PHONE = '01001234569';

async function setup(students = 2) {
  const api = await createSubscriptionsApi();
  const { t } = api;
  const schoolA = await t.newSchool('مدرسة أ');
  const schoolB = await t.newSchool('مدرسة ب');
  const managerA = await t.newSchoolManager(schoolA.id);
  const managerB = await t.newSchoolManager(schoolB.id);
  const studentsA = [];
  for (let i = 0; i < students; i += 1) studentsA.push(await t.newStudent(schoolA.id, managerA.id));
  await t.newStudent(schoolB.id, managerB.id);
  return { ...api, schoolA, schoolB, managerA, managerB, studentsA, authA: await api.login(managerA), authB: await api.login(managerB) };
}
const monthly = (schoolId: string) => `${SUBSCRIPTIONS}/schools/${schoolId}/monthly`;
const forSchool = (schoolId: string) => `${SUBSCRIPTIONS}/schools/${schoolId}`;

describe('POST /subscriptions/schools/:schoolId/monthly', () => {
  it('lets the School Manager bulk-create the current month; the month is never sent by the caller', async () => {
    const { app, authA, schoolA } = await setup(3);
    const res = await request(app).post(monthly(schoolA.id)).set(authA).send({ month: '2020-01' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ schoolId: schoolA.id, month: '2026-11', count: 3 });
    const list = await request(app).get(forSchool(schoolA.id)).set(authA);
    expect(list.body.data).toHaveLength(3);
    for (const s of list.body.data) expect(s).toMatchObject({ month: '2026-11', status: 'UNPAID' });
  });

  it('answers a second run with 409 SUBSCRIPTIONS_ALREADY_CREATED_FOR_MONTH and a localized message, creating nothing', async () => {
    const { app, authA, schoolA } = await setup(2);
    await request(app).post(monthly(schoolA.id)).set(authA);
    const again = await request(app).post(monthly(schoolA.id)).set(authA).set('Accept-Language', 'en');
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('SUBSCRIPTIONS_ALREADY_CREATED_FOR_MONTH');
    expect(again.body.error.message).toMatch(/already been created/i);
    const ar = await request(app).post(monthly(schoolA.id)).set(authA).set('Accept-Language', 'ar');
    expect(ar.body.error.message).toMatch(/تم إنشاء اشتراكات/);
    expect((await request(app).get(forSchool(schoolA.id)).set(authA)).body.data).toHaveLength(2);
  });

  it('lets the school\'s Subscription Collector do it too, and denies everyone else', async () => {
    const { app, t, authB, schoolA, managerA, login } = await setup(2);
    const collector = await t.newCollector(schoolA.id, managerA.id);
    // the Collector has to change the initial password before using the API (account-level rule of Module 10)
    expect((await request(app).post(`${AUTH}/login`).send({ phone: collector.phone, password: collector.password })).status).toBe(200);
    const first = await request(app).post(`${AUTH}/login`).send({ phone: collector.phone, password: collector.password });
    const blocked = await request(app).post(monthly(schoolA.id)).set({ Authorization: `Bearer ${first.body.data.accessToken}` });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    await t.h.identity.changePassword?.(collector.collector.userId, 'New-pass-123');
    const authC = await login({ phone: collector.phone, password: 'New-pass-123' });
    expect((await request(app).post(monthly(schoolA.id)).set(authC)).status).toBe(201);

    expect((await request(app).post(monthly(schoolA.id)).set(authB)).status).toBe(403); // manager of another school
    expect((await request(app).post(monthly(schoolA.id)).set(await login(t.orgAdmin))).status).toBe(403);
    expect((await request(app).post(monthly(schoolA.id)).set(await login(await t.h.createUser({ role: 'MAIN_ADMIN' }))).send()).status).toBe(403);
    expect((await request(app).post(monthly(schoolA.id))).status).toBe(401);
    expect((await request(app).post(monthly('not-a-uuid')).set(authB)).status).toBe(400);
  });

  it('a school with no ACTIVE student answers 422 and creates nothing', async () => {
    const { app, t, login } = await setup(0);
    const empty = await t.newSchool('مدرسة فارغة');
    const manager = await t.newSchoolManager(empty.id);
    const res = await request(app).post(monthly(empty.id)).set(await login(manager));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('SUBSCRIPTION_NO_ACTIVE_STUDENTS');
  });
});

describe('POST /subscriptions/schools/:schoolId/students/:studentId', () => {
  it('creates the late student\'s subscription after the bulk run, refuses a duplicate with 409, and needs the bulk run first', async () => {
    const { app, t, authA, schoolA, managerA } = await setup(1);
    const late = await t.newStudent(schoolA.id, managerA.id);
    const early = await request(app).post(`${forSchool(schoolA.id)}/students/${late.id}`).set(authA);
    expect(early.status).toBe(422);
    expect(early.body.error.code).toBe('SUBSCRIPTIONS_NOT_CREATED_FOR_MONTH');

    await request(app).post(monthly(schoolA.id)).set(authA);
    const lateAgain = await t.newStudent(schoolA.id, managerA.id);
    const ok = await request(app).post(`${forSchool(schoolA.id)}/students/${lateAgain.id}`).set(authA);
    expect(ok.status).toBe(201);
    expect(ok.body.data).toMatchObject({ studentId: lateAgain.id, status: 'UNPAID', month: '2026-11' });
    const dup = await request(app).post(`${forSchool(schoolA.id)}/students/${lateAgain.id}`).set(authA);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('SUBSCRIPTION_ALREADY_EXISTS');
  });

  it('refuses a student of another school (422) and is scoped to the caller\'s school (403)', async () => {
    const { app, t, authA, authB, schoolA, schoolB, managerB } = await setup(1);
    await request(app).post(monthly(schoolA.id)).set(authA);
    const stranger = await t.newStudent(schoolB.id, managerB.id);
    const res = await request(app).post(`${forSchool(schoolA.id)}/students/${stranger.id}`).set(authA);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('SUBSCRIPTION_STUDENT_NOT_IN_SCHOOL');
    expect((await request(app).post(`${forSchool(schoolA.id)}/students/${stranger.id}`).set(authB)).status).toBe(403);
  });
});

describe('GET list / GET one / waive', () => {
  it('lists with filters and pagination, reads one, and keeps schools apart', async () => {
    const { app, authA, authB, schoolA, studentsA } = await setup(3);
    await request(app).post(monthly(schoolA.id)).set(authA);
    const list = await request(app).get(`${forSchool(schoolA.id)}?pageSize=2&page=1`).set(authA);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(2);
    expect(list.body.meta.total).toBe(3);
    expect(list.body.data[0]).toHaveProperty('studentName');
    expect((await request(app).get(`${forSchool(schoolA.id)}?filter[status]=PAID`).set(authA)).body.data).toHaveLength(0);
    expect((await request(app).get(`${forSchool(schoolA.id)}?filter[studentId]=${studentsA[0]!.id}`).set(authA)).body.data).toHaveLength(1);
    expect((await request(app).get(`${forSchool(schoolA.id)}?filter[month]=2026-13`).set(authA)).status).toBe(400);
    expect((await request(app).get(forSchool(schoolA.id)).set(authB)).status).toBe(403);

    const id = list.body.data[0].id;
    const one = await request(app).get(`${SUBSCRIPTIONS}/${id}`).set(authA);
    expect(one.status).toBe(200);
    expect(one.body.data.id).toBe(id);
    expect((await request(app).get(`${SUBSCRIPTIONS}/${id}`).set(authB)).status).toBe(403);
    expect((await request(app).get(`${SUBSCRIPTIONS}/not-a-uuid`).set(authA)).status).toBe(400);
  });

  it('only the School Manager can waive: UNPAID -> WAIVED once, then 422; a Collector and other schools get 403', async () => {
    const { app, t, authA, authB, schoolA, managerA, login } = await setup(1);
    await request(app).post(monthly(schoolA.id)).set(authA);
    const collector = await t.newCollector(schoolA.id, managerA.id);
    await t.h.identity.changePassword?.(collector.collector.userId, 'New-pass-123');
    const authC = await login({ phone: collector.phone, password: 'New-pass-123' });
    const id = (await request(app).get(forSchool(schoolA.id)).set(authA)).body.data[0].id;

    expect((await request(app).post(`${SUBSCRIPTIONS}/${id}/waive`).set(authC)).status).toBe(403);
    expect((await request(app).post(`${SUBSCRIPTIONS}/${id}/waive`).set(authB)).status).toBe(403);
    const waived = await request(app).post(`${SUBSCRIPTIONS}/${id}/waive`).set(authA);
    expect(waived.status).toBe(200);
    expect(waived.body.data).toMatchObject({ status: 'WAIVED' });
    const again = await request(app).post(`${SUBSCRIPTIONS}/${id}/waive`).set(authA);
    expect(again.status).toBe(422);
    expect(again.body.error.code).toBe('SUBSCRIPTION_NOT_UNPAID');
  });

  it('there is NO HTTP endpoint that marks a subscription PAID (Module 34 calls the markPaid contract)', async () => {
    const { app, authA, schoolA } = await setup(1);
    await request(app).post(monthly(schoolA.id)).set(authA);
    const id = (await request(app).get(forSchool(schoolA.id)).set(authA)).body.data[0].id;
    for (const [method, path] of [['post', `/${id}/pay`], ['post', `/${id}/paid`], ['post', `/${id}/mark-paid`], ['put', `/${id}`], ['patch', `/${id}`], ['delete', `/${id}`]] as const) {
      const res = await request(app)[method](`${SUBSCRIPTIONS}${path}`).set(authA).send({ status: 'PAID' });
      expect([404, 405], `${method} ${path}`).toContain(res.status);
    }
    const state = await request(app).get(`${SUBSCRIPTIONS}/${id}`).set(authA);
    expect(state.body.data.status).toBe('UNPAID');
  });
});

describe('Collector management over HTTP', () => {
  it('registers a Collector (no password in any response), lists them, reads own profile, and unassigns', async () => {
    const { app, t, authA, schoolA, login } = await setup(1);
    const res = await request(app).post(`${forSchool(schoolA.id)}/collectors`).set(authA).send({ name: NAME, phone: PHONE });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ accountCreated: true, collector: { name: NAME, phone: '+201001234569', schoolIds: [schoolA.id] }, link: { schoolId: schoolA.id, isActive: true } });
    expect(JSON.stringify(res.body)).not.toMatch(/password|hash/i);

    const listed = await request(app).get(`${forSchool(schoolA.id)}/collectors`).set(authA);
    expect(listed.body.data).toHaveLength(1);
    const userId = listed.body.data[0].userId;

    // first login with the last four digits; the initial password must be changed before anything else
    const loginRes = await request(app).post(`${AUTH}/login`).send({ phone: PHONE, password: '4569' });
    expect(loginRes.status).toBe(200);
    await t.h.identity.changePassword?.(userId, 'New-pass-123');
    const authC = await login({ phone: PHONE, password: 'New-pass-123' });
    const me = await request(app).get(`${SUBSCRIPTIONS}/collectors/me`).set(authC);
    expect(me.status).toBe(200);
    expect(me.body.data).toMatchObject({ userId, schoolIds: [schoolA.id] });
    expect((await request(app).get(`${SUBSCRIPTIONS}/collectors/me`).set(authA)).status).toBe(403); // a manager is not a Collector

    const removed = await request(app).delete(`${forSchool(schoolA.id)}/collectors/${userId}`).set(authA);
    expect(removed.status).toBe(200);
    expect(removed.body.data).toMatchObject({ isActive: false });
    expect((await request(app).get(`${forSchool(schoolA.id)}/collectors`).set(authA)).body.data).toHaveLength(0);
    expect((await request(app).delete(`${forSchool(schoolA.id)}/collectors/${userId}`).set(authA)).status).toBe(404);
  });

  it('an unassigned Collector loses access to that school at once', async () => {
    const { app, t, authA, schoolA, managerA, login } = await setup(2);
    const collector = await t.newCollector(schoolA.id, managerA.id);
    await t.h.identity.changePassword?.(collector.collector.userId, 'New-pass-123');
    const authC = await login({ phone: collector.phone, password: 'New-pass-123' });
    expect((await request(app).post(monthly(schoolA.id)).set(authC)).status).toBe(201);
    expect((await request(app).get(forSchool(schoolA.id)).set(authC)).status).toBe(200);
    await request(app).delete(`${forSchool(schoolA.id)}/collectors/${collector.collector.userId}`).set(authA);
    expect((await request(app).get(forSchool(schoolA.id)).set(authC)).status).toBe(403);
  });

  it('validates the input and denies the wrong callers', async () => {
    const { app, t, authA, authB, schoolA, login } = await setup(1);
    const url = `${forSchool(schoolA.id)}/collectors`;
    expect((await request(app).post(url).set(authA).send({})).body.error.code).toBe('VALIDATION_FAILED');
    for (const bad of ['محمود سعيد', 'محمود سعيد علي حسن']) expect((await request(app).post(url).set(authA).send({ name: bad, phone: PHONE })).body.error.code).toBe('INVALID_COLLECTOR_NAME');
    expect((await request(app).post(url).send({ name: NAME, phone: PHONE })).status).toBe(401);
    expect((await request(app).post(url).set(authB).send({ name: NAME, phone: PHONE })).status).toBe(403);
    expect((await request(app).post(url).set(await login(t.orgAdmin)).send({ name: NAME, phone: PHONE })).status).toBe(403);
    expect((await request(app).get(url).set(authB)).status).toBe(403);
  });

  it('a Collector of another organization can never be created from this school (409) and a Collector cannot manage Collectors (403)', async () => {
    const { app, t, authA, schoolA, managerA, login } = await setup(1);
    await request(app).post(`${forSchool(schoolA.id)}/collectors`).set(authA).send({ name: NAME, phone: PHONE });
    const org2 = await t.otherOrg();
    const school2 = await t.newSchool('مدرسة ثانية', org2.id);
    const manager2 = await t.newSchoolManager(school2.id, org2.id);
    const conflict = await request(app).post(`${forSchool(school2.id)}/collectors`).set(await login(manager2)).send({ name: NAME, phone: PHONE });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('COLLECTOR_ORGANIZATION_CONFLICT');

    const c = await t.newCollector(schoolA.id, managerA.id);
    await t.h.identity.changePassword?.(c.collector.userId, 'New-pass-123');
    const authC = await login({ phone: c.phone, password: 'New-pass-123' });
    expect((await request(app).post(`${forSchool(schoolA.id)}/collectors`).set(authC).send({ name: 'سامي علي حسن', phone: '01001234570' })).status).toBe(403);
    expect((await request(app).get(`${forSchool(schoolA.id)}/collectors`).set(authC)).status).toBe(403);
  });
});
