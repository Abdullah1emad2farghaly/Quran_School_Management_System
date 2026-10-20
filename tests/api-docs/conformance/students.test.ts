import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { NATIONAL_ID, STUDENT_NAME } from '../../helpers/students-harness';
import { STUDENTS, createStudentsApi } from '../../helpers/students-api-harness';
import { ApiConformance } from '../support/conformance';

const UNKNOWN = '00000000-0000-4000-8000-000000000000';

describe('Module 19 endpoints conform to their OpenAPI documentation (real responses)', () => {
  let api: ApiConformance;
  beforeAll(async () => {
    api = await ApiConformance.create();
  });

  it('students: register, read, list, own children, update, lifecycle and history, with their error responses', async () => {
    const { app, t, login, loginParent } = await createStudentsApi();
    const school = await t.newSchool('مدرسة أ');
    const school2 = await t.newSchool('مدرسة ب');
    const manager = await t.newSchoolManager(school.id);
    const manager2 = await t.newSchoolManager(school2.id);
    const auth = await login(manager);
    const auth2 = await login(manager2);
    const parent = await t.newParent(school.id, manager.id);
    const body = (over: Record<string, unknown> = {}) => ({ schoolId: school.id, parentId: parent.id, fullName: STUDENT_NAME, nationalId: NATIONAL_ID, ...over });

    // register
    const created = api.conforms(await request(app).post(STUDENTS).set(auth).send(body()));
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    api.conforms(await request(app).post(STUDENTS).set(auth).send({})); // 400 validation
    api.conforms(await request(app).post(STUDENTS).set(auth).send(body({ fullName: 'عمر أحمد' }))); // 400 name
    api.conforms(await request(app).post(STUDENTS).send(body())); // 401
    api.conforms(await request(app).post(STUDENTS).set(auth2).send(body())); // 403
    api.conforms(await request(app).post(STUDENTS).set(auth).send(body())); // 409 duplicate National ID
    api.conforms(await request(app).post(STUDENTS).set(auth).send(body({ nationalId: '30001010123457', fullName: 'عمر خالد محمد' }))); // 422 name mismatch

    // own children (Parent) and read
    const parentAuth = await loginParent((await t.h.identity.findById(parent.userId))!.phone);
    expect(api.conforms(await request(app).get(`${STUDENTS}/mine?page=1&pageSize=5`).set(parentAuth)).status).toBe(200);
    api.conforms(await request(app).get(`${STUDENTS}/mine`).set(auth)); // 403
    api.conforms(await request(app).get(`${STUDENTS}/mine`)); // 401

    expect(api.conforms(await request(app).get(`${STUDENTS}/schools/${school.id}?filter[status]=ACTIVE&sort=-createdAt`).set(auth)).status).toBe(200);
    api.conforms(await request(app).get(`${STUDENTS}/schools/${school.id}`).set(auth2)); // 403
    api.conforms(await request(app).get(`${STUDENTS}/schools/not-a-uuid`).set(auth)); // 400

    expect(api.conforms(await request(app).get(`${STUDENTS}/${id}`).set(auth)).status).toBe(200);
    expect(api.conforms(await request(app).get(`${STUDENTS}/${id}`).set(parentAuth)).status).toBe(200);
    api.conforms(await request(app).get(`${STUDENTS}/${id}`).set(auth2)); // 403
    api.conforms(await request(app).get(`${STUDENTS}/${UNKNOWN}`).set(auth)); // 403 (never reveals existence)
    api.conforms(await request(app).get(`${STUDENTS}/not-a-uuid`).set(auth)); // 400

    // history
    expect(api.conforms(await request(app).get(`${STUDENTS}/${id}/history`).set(auth)).status).toBe(200);
    api.conforms(await request(app).get(`${STUDENTS}/${id}/history`).set(auth2)); // 403

    // update
    expect(api.conforms(await request(app).patch(`${STUDENTS}/${id}`).set(auth).send({ joinDate: '2026-09-15' })).status).toBe(200);
    api.conforms(await request(app).patch(`${STUDENTS}/${id}`).set(auth).send({})); // 400 empty
    api.conforms(await request(app).patch(`${STUDENTS}/${id}`).set(auth).send({ fullName: 'يوسف خالد محمد' })); // 422 mismatch
    api.conforms(await request(app).patch(`${STUDENTS}/${id}`).set(auth2).send({ joinDate: '2026-09-15' })); // 403

    // lifecycle
    expect(api.conforms(await request(app).post(`${STUDENTS}/${id}/deactivate`).set(auth).send({ reason: 'توقف مؤقت' })).status).toBe(200);
    api.conforms(await request(app).post(`${STUDENTS}/${id}/deactivate`).set(auth).send({})); // 422 invalid transition
    await t.service.deactivateSchool(school.id, t.orgAdmin.id);
    api.conforms(await request(app).post(`${STUDENTS}/${id}/reactivate`).set(auth).send({})); // 422 school not active
    await t.service.reactivateSchool(school.id, t.orgAdmin.id);
    expect(api.conforms(await request(app).post(`${STUDENTS}/${id}/reactivate`).set(auth).send({})).status).toBe(200);
    expect(api.conforms(await request(app).post(`${STUDENTS}/${id}/archive`).set(auth).send({})).status).toBe(200);
    api.conforms(await request(app).post(`${STUDENTS}/${id}/reactivate`).set(auth).send({})); // 422 archived
    api.conforms(await request(app).patch(`${STUDENTS}/${id}`).set(auth).send({ joinDate: '2026-09-16' })); // 422 archived
    api.conforms(await request(app).post(`${STUDENTS}/${UNKNOWN}/archive`).set(auth)); // 403
  });

  it('exercised every documented operation of Module 19', () => {
    expect(api.operationCount('19')).toBe(9);
    api.assertAllExercised('19');
  });
});
