import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { AUTH, TEACHERS, createTeachersApi } from '../../helpers/teachers-api-harness';
import { ApiConformance } from '../support/conformance';

const PHONE = '01001234568';
const UNKNOWN = '00000000-0000-4000-8000-000000000000';
const body = (schoolId: string, over: Record<string, unknown> = {}) => ({ schoolId, name: 'خالد أحمد حسن', phone: PHONE, ...over });

describe('Module 18 endpoints conform to their OpenAPI documentation (real responses)', () => {
  let api: ApiConformance;
  beforeAll(async () => {
    api = await ApiConformance.create();
  });

  it('teachers: register, read, list, own profile and link removal, with their error responses', async () => {
    const { app, t, login } = await createTeachersApi();
    const schoolA = await t.newSchool('مدرسة أ');
    const schoolB = await t.newSchool('مدرسة ب');
    const managerA = await t.newSchoolManager(schoolA.id);
    const managerB = await t.newSchoolManager(schoolB.id);
    const authA = await login(managerA);
    const authB = await login(managerB);

    const created = api.conforms(await request(app).post(TEACHERS).set(authA).send(body(schoolA.id)));
    expect(created.status).toBe(201);
    const id = created.body.data.teacher.id as string;
    api.conforms(await request(app).post(TEACHERS).set(authA).send({})); // 400 validation
    api.conforms(await request(app).post(TEACHERS).set(authA).send(body(schoolA.id, { phone: '01002222222', name: 'خالد أحمد' }))); // 400 name
    api.conforms(await request(app).post(TEACHERS).send(body(schoolA.id))); // 401
    api.conforms(await request(app).post(TEACHERS).set(authB).send(body(schoolA.id))); // 403 other school
    api.conforms(await request(app).post(TEACHERS).set(authA).send(body(schoolA.id))); // 409 already linked
    api.conforms(await request(app).post(TEACHERS).set(authB).send(body(schoolB.id, { name: 'محمود خالد سعيد' }))); // 409 identity conflict
    expect(api.conforms(await request(app).post(TEACHERS).set(authB).send(body(schoolB.id))).status).toBe(201); // reuse for school B
    await t.service.deactivateSchool(schoolB.id, t.orgAdmin.id);
    api.conforms(await request(app).post(TEACHERS).set(authB).send(body(schoolB.id, { phone: '01004444444' }))); // 422 school not active
    await t.service.reactivateSchool(schoolB.id, t.orgAdmin.id);

    // own profile: 403 until the password is changed, then 200
    const first = await request(app).post(`${AUTH}/login`).send({ phone: PHONE, password: '4568' });
    const teacherAuth = { Authorization: `Bearer ${first.body.data.accessToken}` };
    expect(api.conforms(await request(app).get(`${TEACHERS}/me`).set(teacherAuth)).body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    await request(app).post(`${AUTH}/change-password`).set(teacherAuth).send({ currentPassword: '4568', newPassword: 'my-pass-1' });
    expect(api.conforms(await request(app).get(`${TEACHERS}/me`).set(teacherAuth)).status).toBe(200);
    api.conforms(await request(app).get(`${TEACHERS}/me`).set(authA)); // 403: not a TEACHER
    api.conforms(await request(app).get(`${TEACHERS}/me`)); // 401

    // list
    expect(api.conforms(await request(app).get(`${TEACHERS}/schools/${schoolA.id}?page=1&pageSize=5&sort=-createdAt`).set(authA)).status).toBe(200);
    api.conforms(await request(app).get(`${TEACHERS}/schools/${schoolA.id}`).set(authB)); // 403
    api.conforms(await request(app).get(`${TEACHERS}/schools/not-a-uuid`).set(authA)); // 400

    // get
    expect(api.conforms(await request(app).get(`${TEACHERS}/${id}`).set(authA)).status).toBe(200);
    api.conforms(await request(app).get(`${TEACHERS}/${UNKNOWN}`).set(authA)); // 403 (never reveals existence)
    api.conforms(await request(app).get(`${TEACHERS}/not-a-uuid`).set(authA)); // 400

    // remove one school link (the teacher keeps the link to school B)
    expect(api.conforms(await request(app).delete(`${TEACHERS}/${id}/schools/${schoolA.id}`).set(authA)).status).toBe(200);
    api.conforms(await request(app).delete(`${TEACHERS}/${id}/schools/${schoolA.id}`).set(authA)); // 404 not linked any more
    api.conforms(await request(app).delete(`${TEACHERS}/${id}/schools/${schoolB.id}`).set(authA)); // 403 not A's school
    api.conforms(await request(app).delete(`${TEACHERS}/${id}/schools/not-a-uuid`).set(authA)); // 400
    t.groupCounts.set(`${id}:${schoolB.id}`, 1);
    api.conforms(await request(app).delete(`${TEACHERS}/${id}/schools/${schoolB.id}`).set(authB)); // 422 still has groups
  });

  it('exercised every documented operation of Module 18', () => {
    expect(api.operationCount('18')).toBe(5);
    api.assertAllExercised('18');
  });
});
