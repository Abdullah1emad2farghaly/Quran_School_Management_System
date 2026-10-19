import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { AUTH, PARENTS, createParentsApi } from '../../helpers/parents-api-harness';
import { ApiConformance } from '../support/conformance';

const PHONE = '01001234567';
const UNKNOWN = '00000000-0000-4000-8000-000000000000';
const body = (schoolId: string, over: Record<string, unknown> = {}) => ({ schoolId, name: 'أحمد محمد علي', phone: PHONE, address: 'المنيا / سمالوط / برمشا', ...over });

describe('Module 17 endpoints conform to their OpenAPI documentation (real responses)', () => {
  let api: ApiConformance;
  beforeAll(async () => {
    api = await ApiConformance.create();
  });

  it('parents: register, read, list, update, own profile and link removal, with their error responses', async () => {
    const { app, t, login } = await createParentsApi();
    const schoolA = await t.newSchool('مدرسة أ');
    const schoolB = await t.newSchool('مدرسة ب');
    const managerA = await t.newSchoolManager(schoolA.id);
    const managerB = await t.newSchoolManager(schoolB.id);
    const authA = await login(managerA);
    const authB = await login(managerB);

    // register (201) and its errors
    const created = api.conforms(await request(app).post(PARENTS).set(authA).send(body(schoolA.id)));
    expect(created.status).toBe(201);
    const id = created.body.data.parent.id as string;
    api.conforms(await request(app).post(PARENTS).set(authA).send({})); // 400 validation
    api.conforms(await request(app).post(PARENTS).set(authA).send(body(schoolA.id, { phone: '01002222222', name: 'أحمد' }))); // 400 name
    api.conforms(await request(app).post(PARENTS).set(authA).send(body(schoolA.id, { phone: '01002222222', address: undefined }))); // 400 address required
    api.conforms(await request(app).post(PARENTS).send(body(schoolA.id))); // 401
    api.conforms(await request(app).post(PARENTS).set(authB).send(body(schoolA.id))); // 403 other school
    api.conforms(await request(app).post(PARENTS).set(authA).send(body(schoolA.id))); // 409 already linked
    api.conforms(await request(app).post(PARENTS).set(authB).send(body(schoolB.id, { name: 'محمود خالد سعيد' }))); // 409 identity conflict
    expect(api.conforms(await request(app).post(PARENTS).set(authB).send(body(schoolB.id))).status).toBe(201); // reuse for school B
    await t.service.deactivateSchool(schoolB.id, t.orgAdmin.id);
    api.conforms(await request(app).post(PARENTS).set(authB).send(body(schoolB.id, { phone: '01004444444' }))); // 422 school not active
    await t.service.reactivateSchool(schoolB.id, t.orgAdmin.id);

    // own profile: 403 until the password is changed, then 200
    const first = await request(app).post(`${AUTH}/login`).send({ phone: PHONE, password: '4567' });
    const parentAuth = { Authorization: `Bearer ${first.body.data.accessToken}` };
    expect(api.conforms(await request(app).get(`${PARENTS}/me`).set(parentAuth)).body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    await request(app).post(`${AUTH}/change-password`).set(parentAuth).send({ currentPassword: '4567', newPassword: 'my-pass-1' });
    expect(api.conforms(await request(app).get(`${PARENTS}/me`).set(parentAuth)).status).toBe(200);
    api.conforms(await request(app).get(`${PARENTS}/me`).set(authA)); // 403: not a PARENT
    api.conforms(await request(app).get(`${PARENTS}/me`)); // 401

    // list
    expect(api.conforms(await request(app).get(`${PARENTS}/schools/${schoolA.id}?page=1&pageSize=5&sort=-createdAt`).set(authA)).status).toBe(200);
    api.conforms(await request(app).get(`${PARENTS}/schools/${schoolA.id}`).set(authB)); // 403
    api.conforms(await request(app).get(`${PARENTS}/schools/not-a-uuid`).set(authA)); // 400

    // get
    expect(api.conforms(await request(app).get(`${PARENTS}/${id}`).set(authA)).status).toBe(200);
    api.conforms(await request(app).get(`${PARENTS}/${UNKNOWN}`).set(authA)); // 403 (never reveals existence)
    api.conforms(await request(app).get(`${PARENTS}/not-a-uuid`).set(authA)); // 400

    // update
    expect(api.conforms(await request(app).patch(`${PARENTS}/${id}`).set(authA).send({ address: 'المنيا / مطاي' })).status).toBe(200);
    api.conforms(await request(app).patch(`${PARENTS}/${id}`).set(authA).send({ name: 'محمود خالد سعيد' })); // 400 nothing to update (the name is not updatable)
    api.conforms(await request(app).patch(`${PARENTS}/${id}`).set(authA).send({})); // 400 empty
    api.conforms(await request(app).patch(`${PARENTS}/${id}`).set(parentAuth).send({ name: 'أحمد محمد حسن' })); // 403 a Parent cannot edit

    // remove one school link (the parent keeps the link to school B)
    expect(api.conforms(await request(app).delete(`${PARENTS}/${id}/schools/${schoolA.id}`).set(authA)).status).toBe(200);
    api.conforms(await request(app).delete(`${PARENTS}/${id}/schools/${schoolA.id}`).set(authA)); // 404 not linked any more
    api.conforms(await request(app).delete(`${PARENTS}/${id}/schools/${schoolB.id}`).set(authA)); // 403 not A's school
    api.conforms(await request(app).delete(`${PARENTS}/${id}/schools/not-a-uuid`).set(authA)); // 400
    // a Parent with students in the school cannot be unlinked (422)
    t.studentCounts.set(`${id}:${schoolB.id}`, 1);
    api.conforms(await request(app).delete(`${PARENTS}/${id}/schools/${schoolB.id}`).set(authB));
  });

  it('exercised every documented operation of Module 17', () => {
    expect(api.operationCount('17')).toBe(6);
    api.assertAllExercised('17');
  });
});
