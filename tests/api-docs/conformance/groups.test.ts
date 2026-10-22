import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { GROUPS, createGroupsApi } from '../../helpers/groups-api-harness';
import { ApiConformance } from '../support/conformance';

const UNKNOWN = '00000000-0000-4000-8000-000000000000';

describe('Module 20 endpoints conform to their OpenAPI documentation (real responses)', () => {
  let api: ApiConformance;
  beforeAll(async () => {
    api = await ApiConformance.create();
  });

  it('groups: create, read, list, own groups, update, teacher, archive, history, students, assign / move / unassign, with their error responses', async () => {
    const { app, t, login, loginInitial } = await createGroupsApi();
    const school = await t.newSchool('مدرسة أ');
    const school2 = await t.newSchool('مدرسة ب');
    const manager = await t.newSchoolManager(school.id);
    const manager2 = await t.newSchoolManager(school2.id);
    const auth = await login(manager);
    const auth2 = await login(manager2);
    const teacher = await t.newTeacher(school.id, manager.id);
    const parent = await t.newParent(school.id, manager.id);
    const body = (over: Record<string, unknown> = {}) => ({ schoolId: school.id, name: 'حلقة الفجر', learningMode: 'GROUP', progression: 'FORWARD', startingSurah: 78, ...over });

    // create
    const created = api.conforms(await request(app).post(GROUPS).set(auth).send(body({ teacherId: teacher.id })));
    expect(created.status).toBe(201);
    const id = created.body.data.id as string;
    api.conforms(await request(app).post(GROUPS).set(auth).send({})); // 400 validation
    api.conforms(await request(app).post(GROUPS).set(auth).send(body({ name: 'ب', startingSurah: 0 }))); // 400 surah
    api.conforms(await request(app).post(GROUPS).send(body())); // 401
    api.conforms(await request(app).post(GROUPS).set(auth2).send(body({ name: 'ب' }))); // 403
    api.conforms(await request(app).post(GROUPS).set(auth).send(body())); // 409 name
    api.conforms(await request(app).post(GROUPS).set(auth).send(body({ name: 'ج', teacherId: UNKNOWN }))); // 422 teacher
    const second = api.conforms(await request(app).post(GROUPS).set(auth).send(body({ name: 'حلقة ثانية' })));
    const id2 = second.body.data.id as string;

    // lists
    expect(api.conforms(await request(app).get(`${GROUPS}/schools/${school.id}?filter[status]=ACTIVE&sort=name`).set(auth)).status).toBe(200);
    api.conforms(await request(app).get(`${GROUPS}/schools/${school.id}`).set(auth2)); // 403
    api.conforms(await request(app).get(`${GROUPS}/schools/not-a-uuid`).set(auth)); // 400
    const tAuth = await loginInitial((await t.h.identity.findById(teacher.userId))!.phone);
    expect(api.conforms(await request(app).get(`${GROUPS}/mine?page=1&pageSize=5`).set(tAuth)).status).toBe(200);
    api.conforms(await request(app).get(`${GROUPS}/mine`).set(auth)); // 403
    api.conforms(await request(app).get(`${GROUPS}/mine`)); // 401

    // students in the group (assign first so the reads below have data)
    const student = await t.registerStudent(school.id, parent.id, manager.id);
    expect(api.conforms(await request(app).post(`${GROUPS}/${id}/students`).set(auth).send({ studentId: student.id })).status).toBe(201);
    api.conforms(await request(app).post(`${GROUPS}/${id}/students`).set(auth).send({ studentId: student.id })); // 409 already
    api.conforms(await request(app).post(`${GROUPS}/${id}/students`).set(auth).send({ studentId: UNKNOWN })); // 422 not in school
    api.conforms(await request(app).post(`${GROUPS}/${id}/students`).set(auth2).send({ studentId: student.id })); // 403

    // reads
    expect(api.conforms(await request(app).get(`${GROUPS}/${id}`).set(auth)).status).toBe(200);
    expect(api.conforms(await request(app).get(`${GROUPS}/${id}`).set(tAuth)).status).toBe(200);
    const pAuth = await loginInitial((await t.h.identity.findById(parent.userId))!.phone);
    expect(api.conforms(await request(app).get(`${GROUPS}/${id}`).set(pAuth)).status).toBe(200);
    api.conforms(await request(app).get(`${GROUPS}/${id}`).set(auth2)); // 403
    api.conforms(await request(app).get(`${GROUPS}/${UNKNOWN}`).set(auth)); // 403
    api.conforms(await request(app).get(`${GROUPS}/not-a-uuid`).set(auth)); // 400
    expect(api.conforms(await request(app).get(`${GROUPS}/${id}/students?page=1&pageSize=5`).set(auth)).status).toBe(200);
    expect(api.conforms(await request(app).get(`${GROUPS}/${id}/students`).set(tAuth)).status).toBe(200);
    api.conforms(await request(app).get(`${GROUPS}/${id}/students`).set(pAuth)); // 403
    expect(api.conforms(await request(app).get(`${GROUPS}/${id}/history`).set(auth)).status).toBe(200);
    api.conforms(await request(app).get(`${GROUPS}/${id}/history`).set(tAuth)); // 403
    expect(api.conforms(await request(app).get(`${GROUPS}/students/${student.id}/assignments`).set(auth)).status).toBe(200);
    api.conforms(await request(app).get(`${GROUPS}/students/${student.id}/assignments`).set(auth2)); // 403

    // update and teacher
    expect(api.conforms(await request(app).patch(`${GROUPS}/${id}`).set(auth).send({ progression: 'BACKWARD' })).status).toBe(200);
    api.conforms(await request(app).patch(`${GROUPS}/${id}`).set(auth).send({})); // 400 empty
    api.conforms(await request(app).patch(`${GROUPS}/${id}`).set(auth).send({ name: 'حلقة ثانية' })); // 409 name
    api.conforms(await request(app).patch(`${GROUPS}/${id}`).set(auth2).send({ name: 'x' })); // 403
    expect(api.conforms(await request(app).put(`${GROUPS}/${id2}/teacher`).set(auth).send({ teacherId: teacher.id })).status).toBe(200);
    api.conforms(await request(app).put(`${GROUPS}/${id2}/teacher`).set(auth).send({ teacherId: UNKNOWN })); // 422
    api.conforms(await request(app).put(`${GROUPS}/${id2}/teacher`).set(auth2).send({ teacherId: teacher.id })); // 403
    expect(api.conforms(await request(app).delete(`${GROUPS}/${id2}/teacher`).set(auth)).status).toBe(200);
    api.conforms(await request(app).delete(`${GROUPS}/${id2}/teacher`).set(auth)); // 422 no teacher

    // move, unassign
    expect(api.conforms(await request(app).post(`${GROUPS}/${id}/students/${student.id}/move`).set(auth).send({ targetGroupId: id2 })).status).toBe(200);
    api.conforms(await request(app).post(`${GROUPS}/${id}/students/${student.id}/move`).set(auth).send({ targetGroupId: id2 })); // 404 not in source
    api.conforms(await request(app).post(`${GROUPS}/${id2}/students/${student.id}/move`).set(auth).send({ targetGroupId: id2 })); // 422 same group
    api.conforms(await request(app).post(`${GROUPS}/${id2}/students/${student.id}/move`).set(auth2).send({ targetGroupId: id })); // 403
    expect(api.conforms(await request(app).delete(`${GROUPS}/${id2}/students/${student.id}`).set(auth)).status).toBe(204);
    api.conforms(await request(app).delete(`${GROUPS}/${id2}/students/${student.id}`).set(auth)); // 404 not assigned
    api.conforms(await request(app).delete(`${GROUPS}/${id2}/students/${student.id}`).set(auth2)); // 403

    // archive
    expect(api.conforms(await request(app).post(`${GROUPS}/${id}/archive`).set(auth).send({ reason: 'انتهت' })).status).toBe(200);
    api.conforms(await request(app).post(`${GROUPS}/${id}/archive`).set(auth).send({})); // 422 archived
    api.conforms(await request(app).patch(`${GROUPS}/${id}`).set(auth).send({ name: 'z' })); // 422 archived
    api.conforms(await request(app).post(`${GROUPS}/${id2}/archive`).set(auth2).send({})); // 403
  });

  it('exercised every documented operation of Module 20', () => {
    expect(api.operationCount('20')).toBe(14);
    api.assertAllExercised('20');
  });
});
