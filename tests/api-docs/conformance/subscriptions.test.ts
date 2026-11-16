import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { AUTH, SUBSCRIPTIONS, createSubscriptionsApi } from '../../helpers/subscriptions-api-harness';
import { ApiConformance } from '../support/conformance';

const NAME = 'محمود سعيد علي';
const PHONE = '01001234569';
const UNKNOWN = '00000000-0000-4000-8000-000000000000';

describe('Module 33 endpoints conform to their OpenAPI documentation (real responses, real authorization)', () => {
  let api: ApiConformance;
  beforeAll(async () => {
    api = await ApiConformance.create();
  });

  it('subscriptions: bulk and individual creation, list, read, waive and Collector management, with their error responses', async () => {
    const { app, t, login } = await createSubscriptionsApi();
    const schoolA = await t.newSchool('مدرسة أ');
    const schoolB = await t.newSchool('مدرسة ب');
    const managerA = await t.newSchoolManager(schoolA.id);
    const managerB = await t.newSchoolManager(schoolB.id);
    const students = [await t.newStudent(schoolA.id, managerA.id), await t.newStudent(schoolA.id, managerA.id)];
    await t.newStudent(schoolB.id, managerB.id);
    const authA = await login(managerA);
    const authB = await login(managerB);
    const onSchool = (id: string) => `${SUBSCRIPTIONS}/schools/${id}`;

    // ---- bulk creation
    api.conforms(await request(app).post(`${onSchool(schoolA.id)}/students/${students[0]!.id}`).set(authA)); // 422 month not created yet
    expect(api.conforms(await request(app).post(`${onSchool(schoolA.id)}/monthly`).set(authA)).status).toBe(201);
    api.conforms(await request(app).post(`${onSchool(schoolA.id)}/monthly`).set(authA)); // 409 already created
    api.conforms(await request(app).post(`${onSchool(schoolA.id)}/monthly`)); // 401
    api.conforms(await request(app).post(`${onSchool(schoolA.id)}/monthly`).set(authB)); // 403 other school
    api.conforms(await request(app).post(`${onSchool('not-a-uuid')}/monthly`).set(authA)); // 400
    const emptySchool = await t.newSchool('مدرسة فارغة');
    const emptyManager = await t.newSchoolManager(emptySchool.id);
    api.conforms(await request(app).post(`${onSchool(emptySchool.id)}/monthly`).set(await login(emptyManager))); // 422 no active students

    // ---- individual creation
    const late = await t.newStudent(schoolA.id, managerA.id);
    expect(api.conforms(await request(app).post(`${onSchool(schoolA.id)}/students/${late.id}`).set(authA)).status).toBe(201);
    api.conforms(await request(app).post(`${onSchool(schoolA.id)}/students/${late.id}`).set(authA)); // 409 duplicate
    api.conforms(await request(app).post(`${onSchool(schoolA.id)}/students/${UNKNOWN}`).set(authA)); // 404 student
    const stranger = await t.newStudent(schoolB.id, managerB.id);
    api.conforms(await request(app).post(`${onSchool(schoolA.id)}/students/${stranger.id}`).set(authA)); // 422 other school
    api.conforms(await request(app).post(`${onSchool(schoolA.id)}/students/not-a-uuid`).set(authA)); // 400

    // ---- list and read
    const list = api.conforms(await request(app).get(`${onSchool(schoolA.id)}?page=1&pageSize=5&filter[status]=UNPAID&sort=-month`).set(authA));
    expect(list.status).toBe(200);
    const id = list.body.data[0].id as string;
    api.conforms(await request(app).get(`${onSchool(schoolA.id)}?filter[month]=2026-13`).set(authA)); // 400 month
    api.conforms(await request(app).get(onSchool(schoolA.id)).set(authB)); // 403
    expect(api.conforms(await request(app).get(`${SUBSCRIPTIONS}/${id}`).set(authA)).status).toBe(200);
    api.conforms(await request(app).get(`${SUBSCRIPTIONS}/${id}`).set(authB)); // 403
    api.conforms(await request(app).get(`${SUBSCRIPTIONS}/${UNKNOWN}`).set(authA)); // 403 (never reveals existence)
    api.conforms(await request(app).get(`${SUBSCRIPTIONS}/not-a-uuid`).set(authA)); // 400

    // ---- waive
    expect(api.conforms(await request(app).post(`${SUBSCRIPTIONS}/${id}/waive`).set(authA)).status).toBe(200);
    api.conforms(await request(app).post(`${SUBSCRIPTIONS}/${id}/waive`).set(authA)); // 422 not unpaid
    api.conforms(await request(app).post(`${SUBSCRIPTIONS}/${id}/waive`).set(authB)); // 403
    api.conforms(await request(app).post(`${SUBSCRIPTIONS}/${id}/waive`)); // 401


    // ---- group-based statistics and group students (approved enhancement)
    const group = await t.newGroup(schoolA.id, managerA.id, 'حلقة الفجر');
    const inGroup = [await t.newStudentInGroup(schoolA.id, managerA.id, group.id), await t.newStudentInGroup(schoolA.id, managerA.id, group.id)];
    const groupB = await t.newGroup(schoolB.id, managerB.id, 'حلقة ب');
    const groups = api.conforms(await request(app).get(`${onSchool(schoolA.id)}/groups?page=1&pageSize=5&sort=name&filter[month]=2026-11`).set(authA));
    expect(groups.status).toBe(200);
    api.conforms(await request(app).get(`${onSchool(schoolA.id)}/groups?filter[month]=2026-13`).set(authA)); // 400
    api.conforms(await request(app).get(`${onSchool(schoolA.id)}/groups`).set(authB)); // 403
    api.conforms(await request(app).get(`${onSchool(schoolA.id)}/groups`)); // 401
    const members = api.conforms(await request(app).get(`${onSchool(schoolA.id)}/groups/${group.id}/students?page=1&pageSize=10`).set(authA));
    expect(members.status).toBe(200);
    expect(members.body.data).toHaveLength(2);
    api.conforms(await request(app).get(`${onSchool(schoolA.id)}/groups/${groupB.id}/students`).set(authA)); // 404 another school's group
    api.conforms(await request(app).get(`${onSchool(schoolA.id)}/groups/${group.id}/students?filter[month]=bad`).set(authA)); // 400
    api.conforms(await request(app).get(`${onSchool(schoolA.id)}/groups/${group.id}/students`).set(authB)); // 403
    api.conforms(await request(app).get(`${onSchool(schoolA.id)}/groups/not-a-uuid/students`).set(authA)); // 400

    // ---- mark-paid and mark-unpaid
    await request(app).post(`${onSchool(schoolA.id)}/students/${inGroup[0]!.id}`).set(authA); // already in the bulk run? it was created after it, so this adds its subscription
    const pay = (await t.subscriptionRepo.findByStudentMonth(inGroup[0]!.id, '2026-11'))?.id ?? (await request(app).get(`${onSchool(schoolA.id)}?filter[studentId]=${inGroup[0]!.id}`).set(authA)).body.data[0]?.id;
    expect(api.conforms(await request(app).post(`${SUBSCRIPTIONS}/${pay}/mark-paid`).set(authA)).status).toBe(200);
    api.conforms(await request(app).post(`${SUBSCRIPTIONS}/${pay}/mark-paid`).set(authA)); // 409 already paid
    api.conforms(await request(app).post(`${SUBSCRIPTIONS}/${pay}/mark-paid`).set(authB)); // 403
    api.conforms(await request(app).post(`${SUBSCRIPTIONS}/${pay}/mark-paid`)); // 401
    api.conforms(await request(app).post(`${SUBSCRIPTIONS}/${UNKNOWN}/mark-paid`).set(authA)); // 403
    api.conforms(await request(app).post(`${SUBSCRIPTIONS}/not-a-uuid/mark-paid`).set(authA)); // 400
    expect(api.conforms(await request(app).post(`${SUBSCRIPTIONS}/${pay}/mark-unpaid`).set(authA)).status).toBe(200);
    api.conforms(await request(app).post(`${SUBSCRIPTIONS}/${pay}/mark-unpaid`).set(authA)); // 409 already unpaid
    api.conforms(await request(app).post(`${SUBSCRIPTIONS}/${pay}/mark-unpaid`).set(authB)); // 403
    api.conforms(await request(app).post(`${SUBSCRIPTIONS}/${pay}/mark-unpaid`)); // 401
    api.conforms(await request(app).post(`${SUBSCRIPTIONS}/not-a-uuid/mark-unpaid`).set(authA)); // 400
    const waivedFirst = (await request(app).get(`${onSchool(schoolA.id)}?filter[status]=WAIVED`).set(authA)).body.data[0].id as string;
    api.conforms(await request(app).post(`${SUBSCRIPTIONS}/${waivedFirst}/mark-paid`).set(authA)); // 422 waived
    api.conforms(await request(app).post(`${SUBSCRIPTIONS}/${waivedFirst}/mark-unpaid`).set(authA)); // 422 waived -> unpaid

    // ---- Collector management
    const url = `${onSchool(schoolA.id)}/collectors`;
    const registered = api.conforms(await request(app).post(url).set(authA).send({ name: NAME, phone: PHONE }));
    expect(registered.status).toBe(201);
    const collectorId = registered.body.data.collector.userId as string;
    api.conforms(await request(app).post(url).set(authA).send({})); // 400
    api.conforms(await request(app).post(url).set(authA).send({ name: 'محمود سعيد', phone: '01002222222' })); // 400 name
    api.conforms(await request(app).post(url).set(authA).send({ name: NAME, phone: PHONE })); // 409 already linked
    api.conforms(await request(app).post(url).set(authB).send({ name: NAME, phone: PHONE })); // 403
    api.conforms(await request(app).post(`${onSchool(schoolB.id)}/collectors`).set(authB).send({ name: 'سامي علي حسن', phone: PHONE })); // 409 identity conflict
    expect(api.conforms(await request(app).get(url).set(authA)).status).toBe(200);
    api.conforms(await request(app).get(url).set(authB)); // 403

    // own profile: 403 until the initial password is changed, then 200
    const first = await request(app).post(`${AUTH}/login`).send({ phone: PHONE, password: '4569' });
    const collectorAuth = { Authorization: `Bearer ${first.body.data.accessToken}` };
    expect(api.conforms(await request(app).get(`${SUBSCRIPTIONS}/collectors/me`).set(collectorAuth)).body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    await request(app).post(`${AUTH}/change-password`).set(collectorAuth).send({ currentPassword: '4569', newPassword: 'my-pass-1' });
    expect(api.conforms(await request(app).get(`${SUBSCRIPTIONS}/collectors/me`).set(await login({ phone: PHONE, password: 'my-pass-1' }))).status).toBe(200);
    api.conforms(await request(app).get(`${SUBSCRIPTIONS}/collectors/me`).set(authA)); // 403 not a Collector
    api.conforms(await request(app).get(`${SUBSCRIPTIONS}/collectors/me`)); // 401

    expect(api.conforms(await request(app).delete(`${url}/${collectorId}`).set(authA)).status).toBe(200);
    api.conforms(await request(app).delete(`${url}/${collectorId}`).set(authA)); // 404 not linked any more
    api.conforms(await request(app).delete(`${url}/${collectorId}`).set(authB)); // 403
    api.conforms(await request(app).delete(`${url}/not-a-uuid`).set(authA)); // 400
  });

  it('exercised every documented operation of Module 33', () => {
    expect(api.operationCount('33')).toBe(13);
    api.assertAllExercised('33');
  });
});
