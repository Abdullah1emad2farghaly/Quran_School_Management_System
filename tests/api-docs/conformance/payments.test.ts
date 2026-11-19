import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { PAYMENTS, createPaymentsApi } from '../../helpers/payments-api-harness';
import { ApiConformance } from '../support/conformance';

const UNKNOWN = '00000000-0000-4000-8000-000000000000';

describe('Module 34 endpoints conform to their OpenAPI documentation (real responses, real authorization)', () => {
  let api: ApiConformance;
  beforeAll(async () => {
    api = await ApiConformance.create();
  });

  it('payments: record, list, read and reverse, with their error responses', async () => {
    const { app, t, login } = await createPaymentsApi();
    const schoolA = await t.newSchool('مدرسة أ');
    const schoolB = await t.newSchool('مدرسة ب');
    const managerA = await t.newSchoolManager(schoolA.id);
    const managerB = await t.newSchoolManager(schoolB.id);
    const students = [await t.newStudent(schoolA.id, managerA.id), await t.newStudent(schoolA.id, managerA.id)];
    await t.newStudent(schoolB.id, managerB.id);
    t.setNow('2026-10-10T09:00:00Z');
    await t.subscriptions.createMonthlySubscriptions(schoolA.id, managerA.id);
    t.setNow('2026-11-10T09:00:00Z');
    await t.subscriptions.createMonthlySubscriptions(schoolA.id, managerA.id);
    const sub = async (i: number, month: string) => (await t.subscriptionRepo.findByStudentMonth(students[i]!.id, month))!.snapshot.id;
    const authA = await login(managerA);
    const authB = await login(managerB);

    // ---- record
    const nov = await sub(0, '2026-11');
    api.conforms(await request(app).post(`${PAYMENTS}/subscriptions/${nov}`).set(authA)); // 422 older month unpaid
    const first = api.conforms(await request(app).post(`${PAYMENTS}/subscriptions/${await sub(0, '2026-10')}`).set(authA).send({ method: 'CASH' }));
    expect(first.status).toBe(201);
    api.conforms(await request(app).post(`${PAYMENTS}/subscriptions/${await sub(0, '2026-10')}`).set(authA)); // 409 already paid
    api.conforms(await request(app).post(`${PAYMENTS}/subscriptions/${await sub(1, '2026-10')}`).set(authA).send({ method: 'CARD' })); // 400
    api.conforms(await request(app).post(`${PAYMENTS}/subscriptions/${nov}`).set(authB)); // 403
    api.conforms(await request(app).post(`${PAYMENTS}/subscriptions/${nov}`)); // 401
    api.conforms(await request(app).post(`${PAYMENTS}/subscriptions/${UNKNOWN}`).set(authA)); // 403 (existence never revealed)
    api.conforms(await request(app).post(`${PAYMENTS}/subscriptions/not-a-uuid`).set(authA)); // 400
    const second = api.conforms(await request(app).post(`${PAYMENTS}/subscriptions/${nov}`).set(authA));
    expect(second.status).toBe(201);
    const waivedTarget = await sub(1, '2026-10');
    await t.subscriptions.waiveSubscription(waivedTarget, managerA.id);
    api.conforms(await request(app).post(`${PAYMENTS}/subscriptions/${waivedTarget}`).set(authA)); // 422 waived

    // ---- list and read
    expect(api.conforms(await request(app).get(`${PAYMENTS}/schools/${schoolA.id}?filter[status]=SUCCESSFUL&sort=-recordedAt`).set(authA)).status).toBe(200);
    api.conforms(await request(app).get(`${PAYMENTS}/schools/${schoolA.id}?filter[month]=2026-13`).set(authA)); // 400
    api.conforms(await request(app).get(`${PAYMENTS}/schools/${schoolA.id}`).set(authB)); // 403
    api.conforms(await request(app).get(`${PAYMENTS}/schools/${schoolA.id}`)); // 401
    const id = first.body.data.id as string;
    expect(api.conforms(await request(app).get(`${PAYMENTS}/${id}`).set(authA)).status).toBe(200);
    api.conforms(await request(app).get(`${PAYMENTS}/${id}`).set(authB)); // 403
    api.conforms(await request(app).get(`${PAYMENTS}/${UNKNOWN}`).set(authA)); // 403
    api.conforms(await request(app).get(`${PAYMENTS}/not-a-uuid`).set(authA)); // 400

    // ---- reverse
    const url = `${PAYMENTS}/${id}/reverse`;
    api.conforms(await request(app).post(url).set(authA).send({ reason: 'سبب' })); // 422: November (newer) is PAID
    api.conforms(await request(app).post(url).set(authA).send({})); // 400
    api.conforms(await request(app).post(url).set(authA).send({ reason: '   ' })); // 400 blank
    api.conforms(await request(app).post(url).set(authB).send({ reason: 'سبب' })); // 403
    api.conforms(await request(app).post(url).send({ reason: 'سبب' })); // 401
    api.conforms(await request(app).post(`${PAYMENTS}/${UNKNOWN}/reverse`).set(authA).send({ reason: 'سبب' })); // 403
    api.conforms(await request(app).post(`${PAYMENTS}/not-a-uuid/reverse`).set(authA).send({ reason: 'سبب' })); // 400
    const novPayment = second.body.data.id as string;
    expect(api.conforms(await request(app).post(`${PAYMENTS}/${novPayment}/reverse`).set(authA).send({ reason: 'سُجلت بالخطأ' })).status).toBe(200);
    api.conforms(await request(app).post(`${PAYMENTS}/${novPayment}/reverse`).set(authA).send({ reason: 'again' })); // 409 already reversed
    expect(api.conforms(await request(app).post(url).set(authA).send({ reason: 'سبب' })).status).toBe(200);

    api.assertAllExercised('34');
  });
});
