import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AUTH, PAYMENTS, SUBSCRIPTIONS, createPaymentsApi } from '../helpers/payments-api-harness';

const UNKNOWN = '00000000-0000-4000-8000-000000000000';

async function setup() {
  const { app, t, login } = await createPaymentsApi();
  const schoolA = await t.newSchool('مدرسة أ');
  const schoolB = await t.newSchool('مدرسة ب');
  const managerA = await t.newSchoolManager(schoolA.id);
  const managerB = await t.newSchoolManager(schoolB.id);
  const studentsA = [await t.newStudent(schoolA.id, managerA.id), await t.newStudent(schoolA.id, managerA.id)];
  await t.newStudent(schoolB.id, managerB.id);
  await t.subscriptions.createMonthlySubscriptions(schoolA.id, managerA.id);
  await t.subscriptions.createMonthlySubscriptions(schoolB.id, managerB.id);
  const subsA = await Promise.all(studentsA.map(async (s) => (await t.subscriptionRepo.findByStudentMonth(s.id, '2026-11'))!.snapshot));
  const authA = await login(managerA);
  const authB = await login(managerB);
  const collectorOf = async (schoolId: string, managerId: string) => {
    const c = await t.newCollector(schoolId, managerId);
    await t.h.identity.changePassword?.(c.collector.userId, 'New-pass-123');
    return { c, auth: await login({ phone: c.phone, password: 'New-pass-123' }) };
  };
  return { app, t, login, schoolA, schoolB, managerA, managerB, subsA, authA, authB, collectorOf };
}
const pay = (app: Parameters<typeof request>[0], id: string, auth: Record<string, string>, body: unknown = {}) => request(app).post(`${PAYMENTS}/subscriptions/${id}`).set(auth).send(body as object);

describe('POST /payments/subscriptions/:subscriptionId', () => {
  it('lets the School Manager record a cash payment (201), takes the actor from the token, and returns no amount', async () => {
    const { app, subsA, managerA, authA } = await setup();
    const res = await pay(app, subsA[0]!.id, authA, { recordedBy: 'someone-else', amount: 500 });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ subscriptionId: subsA[0]!.id, method: 'CASH', status: 'SUCCESSFUL', recordedBy: managerA.id });
    expect(Object.keys(res.body.data).some((k) => /amount/i.test(k))).toBe(false);
  });

  it('lets the school\'s Subscription Collector record one, but not a Collector of another school nor a removed Collector', async () => {
    const { app, t, subsA, schoolA, schoolB, managerA, managerB, collectorOf } = await setup();
    const own = await collectorOf(schoolA.id, managerA.id);
    const foreign = await collectorOf(schoolB.id, managerB.id);
    expect((await pay(app, subsA[0]!.id, foreign.auth)).status).toBe(403);
    const ok = await pay(app, subsA[0]!.id, own.auth);
    expect(ok.status).toBe(201);
    expect(ok.body.data.recordedBy).toBe(own.c.collector.userId);
    await t.collectors.removeSchoolLink(own.c.collector.userId, schoolA.id, managerA.id); // an ended link grants nothing
    expect((await pay(app, subsA[1]!.id, own.auth)).status).toBe(403);
  });

  it('denies everyone else: another school\'s manager, no token, an unknown subscription (existence not revealed), a malformed id', async () => {
    const { app, t, subsA, authB } = await setup();
    expect((await pay(app, subsA[0]!.id, authB)).status).toBe(403);
    expect((await request(app).post(`${PAYMENTS}/subscriptions/${subsA[0]!.id}`)).status).toBe(401);
    expect((await pay(app, UNKNOWN, authB)).status).toBe(403);
    expect((await pay(app, 'not-a-uuid', authB)).status).toBe(400);
    expect((await t.paymentRepo.rows.size)).toBe(0);
  });

  it('denies the Main Admin, the Organization Manager and the Parent (no payment permission by role alone)', async () => {
    const { app, t, login, subsA } = await setup();
    expect((await pay(app, subsA[0]!.id, await login(t.orgAdmin))).status).toBe(403);
    expect((await pay(app, subsA[0]!.id, await login(await t.h.createUser({ role: 'MAIN_ADMIN' })))).status).toBe(403);
    expect(t.paymentRepo.rows.size).toBe(0);
  });

  it('accepts method CASH, refuses another method (400) and a repeated payment (409), and enforces the Oldest-Unpaid Rule (422)', async () => {
    const { app, t, subsA, managerA, schoolA, authA } = await setup();
    expect((await pay(app, subsA[0]!.id, authA, { method: 'CARD' })).body.error.code).toBe('PAYMENT_METHOD_NOT_ALLOWED');
    expect((await pay(app, subsA[0]!.id, authA, { method: 'CASH' })).status).toBe(201);
    const again = await pay(app, subsA[0]!.id, authA);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('SUBSCRIPTION_ALREADY_PAID');
    // an OLDER unpaid month blocks a newer one
    t.setNow('2026-12-05T09:00:00Z');
    await t.subscriptions.createMonthlySubscriptions(schoolA.id, managerA.id);
    const dec = (await t.subscriptionRepo.findByStudentMonth(subsA[1]!.studentId, '2026-12'))!.snapshot;
    const blocked = await pay(app, dec.id, authA);
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.code).toBe('OLDER_UNPAID_SUBSCRIPTIONS_EXIST');
  });

  it('answers in Arabic by default for a refusal', async () => {
    const { app, subsA, authA } = await setup();
    const res = await pay(app, subsA[0]!.id, authA, { method: 'CARD' });
    expect(res.body.error.message).toBe('طريقة الدفع المسموح بها هي النقدي فقط.');
  });
});

describe('GET /payments/schools/:schoolId and /payments/:id', () => {
  it('lists and reads for the manager and the Collector of the school only', async () => {
    const { app, subsA, schoolA, schoolB, managerA, authA, authB, collectorOf } = await setup();
    const own = await collectorOf(schoolA.id, managerA.id);
    const created = (await pay(app, subsA[0]!.id, authA)).body.data;
    const list = await request(app).get(`${PAYMENTS}/schools/${schoolA.id}?filter[status]=SUCCESSFUL`).set(own.auth);
    expect(list.status).toBe(200);
    expect(list.body.data.map((p: { id: string }) => p.id)).toEqual([created.id]);
    expect((await request(app).get(`${PAYMENTS}/${created.id}`).set(own.auth)).body.data.id).toBe(created.id);
    expect((await request(app).get(`${PAYMENTS}/schools/${schoolA.id}`).set(authB)).status).toBe(403);
    expect((await request(app).get(`${PAYMENTS}/${created.id}`).set(authB)).status).toBe(403);
    expect((await request(app).get(`${PAYMENTS}/${UNKNOWN}`).set(authA)).status).toBe(403); // existence never revealed
    expect((await request(app).get(`${PAYMENTS}/schools/${schoolB.id}`).set(authA)).status).toBe(403);
    expect((await request(app).get(`${PAYMENTS}/schools/${schoolA.id}?filter[month]=2026-13`).set(authA)).body.error.code).toBe('INVALID_PAYMENT_MONTH');
    expect((await request(app).get(`${PAYMENTS}/not-a-uuid`).set(authA)).status).toBe(400);
    expect((await request(app).get(`${PAYMENTS}/schools/${schoolA.id}`)).status).toBe(401);
  });
});

describe('POST /payments/:id/reverse', () => {
  it('reverses with a reason (200): the payment is kept, the subscription is UNPAID again, and the reason, actor and time are shown', async () => {
    const { app, subsA, managerA, authA } = await setup();
    const created = (await pay(app, subsA[0]!.id, authA)).body.data;
    const res = await request(app).post(`${PAYMENTS}/${created.id}/reverse`).set(authA).send({ reason: 'سُجلت بالخطأ' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: created.id, status: 'REVERSED', reversedBy: managerA.id, reversalReason: 'سُجلت بالخطأ' });
    expect(res.body.data.reversedAt).toBeTruthy();
    expect((await request(app).get(`${SUBSCRIPTIONS}/${subsA[0]!.id}`).set(authA)).body.data.status).toBe('UNPAID');
    expect((await request(app).get(`${PAYMENTS}/${created.id}`).set(authA)).body.data.status).toBe('REVERSED'); // still readable: never deleted
    expect((await request(app).post(`${PAYMENTS}/${created.id}/reverse`).set(authA).send({ reason: 'again' })).body.error.code).toBe('PAYMENT_ALREADY_REVERSED');
  });

  it('requires the reason (400) and refuses another school\'s manager and Collector, a removed Collector, no token and an unknown payment', async () => {
    const { app, t, subsA, schoolA, schoolB, managerA, managerB, authA, authB, collectorOf } = await setup();
    const own = await collectorOf(schoolA.id, managerA.id);
    const foreign = await collectorOf(schoolB.id, managerB.id);
    const created = (await pay(app, subsA[0]!.id, own.auth)).body.data;
    const url = `${PAYMENTS}/${created.id}/reverse`;
    expect((await request(app).post(url).set(authA).send({})).body.error.code).toBe('VALIDATION_FAILED');
    expect((await request(app).post(url).set(authA).send({ reason: '   ' })).body.error.code).toBe('PAYMENT_REVERSAL_REASON_REQUIRED');
    expect((await request(app).post(url).set(authA).send({ reason: 'x'.repeat(501) })).body.error.code).toBe('PAYMENT_REVERSAL_REASON_TOO_LONG');
    expect((await request(app).post(url).set(foreign.auth).send({ reason: 'r' })).status).toBe(403); // a Collector of another school
    const removed = await collectorOf(schoolA.id, managerA.id);
    await t.collectors.removeSchoolLink(removed.c.collector.userId, schoolA.id, managerA.id);
    expect((await request(app).post(url).set(removed.auth).send({ reason: 'r' })).status).toBe(403); // an ended link grants nothing
    expect((await request(app).post(url).set(authB).send({ reason: 'r' })).status).toBe(403);
    expect((await request(app).post(url).send({ reason: 'r' })).status).toBe(401);
    expect((await request(app).post(`${PAYMENTS}/${UNKNOWN}/reverse`).set(authA).send({ reason: 'r' })).status).toBe(403);
    expect((await request(app).post(url).set(authA).send({ reason: 'r' })).status).toBe(200);
  });

  it('lets the school\'s own Subscription Collector reverse a payment (approved 2026-11-17), once, with a reason, and nobody else role-wise', async () => {
    const { app, t, login, subsA, schoolA, managerA, collectorOf } = await setup();
    const own = await collectorOf(schoolA.id, managerA.id);
    const created = (await pay(app, subsA[0]!.id, own.auth)).body.data;
    const url = `${PAYMENTS}/${created.id}/reverse`;
    expect((await request(app).post(url).set(own.auth).send({})).status).toBe(400); // the reason is mandatory
    const res = await request(app).post(url).set(own.auth).send({ reason: 'سُجلت بالخطأ' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: created.id, status: 'REVERSED', reversedBy: own.c.collector.userId, reversalReason: 'سُجلت بالخطأ' });
    expect((await request(app).post(url).set(own.auth).send({ reason: 'again' })).body.error.code).toBe('PAYMENT_ALREADY_REVERSED');
    for (const role of ['PARENT', 'TEACHER'] as const) expect((await request(app).post(url).set(await login(await t.h.createUser({ role }))).send({ reason: 'r' })).status).toBe(403);
    expect((await request(app).post(url).set(await login(t.orgAdmin)).send({ reason: 'r' })).status).toBe(403);
    expect((await request(app).delete(`${PAYMENTS}/${created.id}`).set(own.auth)).status).toBe(404);
  });

  it('has no DELETE endpoint: a payment can never be hard-deleted over HTTP', async () => {
    const { app, subsA, authA } = await setup();
    const created = (await pay(app, subsA[0]!.id, authA)).body.data;
    expect((await request(app).delete(`${PAYMENTS}/${created.id}`).set(authA)).status).toBe(404);
    expect((await request(app).put(`${PAYMENTS}/${created.id}`).set(authA).send({})).status).toBe(404);
    expect((await request(app).patch(`${PAYMENTS}/${created.id}`).set(authA).send({})).status).toBe(404);
  });
});

describe('auth plumbing used by the tests', () => {
  it('the harness login works', async () => {
    const { app, managerA } = await setup();
    expect((await request(app).post(`${AUTH}/login`).send({ phone: managerA.phone, password: managerA.password })).status).toBe(200);
  });
});
