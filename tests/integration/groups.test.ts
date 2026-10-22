import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { GROUPS, STUDENTS, createGroupsApi } from '../helpers/groups-api-harness';

const UNKNOWN = '00000000-0000-4000-8000-000000000000';

async function setup() {
  const api = await createGroupsApi();
  const { t } = api;
  const school = await t.newSchool('مدرسة أ');
  const school2 = await t.newSchool('مدرسة ب');
  const manager = await t.newSchoolManager(school.id);
  const manager2 = await t.newSchoolManager(school2.id);
  const teacher = await t.newTeacher(school.id, manager.id);
  const parent = await t.newParent(school.id, manager.id);
  const body = (over: Record<string, unknown> = {}) => ({ schoolId: school.id, name: 'حلقة الفجر', learningMode: 'GROUP', progression: 'FORWARD', startingSurah: 78, ...over });
  return { ...api, school, school2, manager, manager2, teacher, parent, body, auth: await api.login(manager), auth2: await api.login(manager2) };
}

describe('POST /groups', () => {
  it('lets the School Manager create a group (with a Teacher) and rejects bad input and the wrong callers', async () => {
    const { app, t, auth, auth2, school, teacher, body, login } = await setup();
    const res = await request(app).post(GROUPS).set(auth).send(body({ teacherId: teacher.id }));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ schoolId: school.id, name: 'حلقة الفجر', status: 'ACTIVE', learningMode: 'GROUP', progression: 'FORWARD', startingSurah: 78, teacher: { id: teacher.id } });
    expect((await request(app).post(GROUPS).set(auth).send({})).body.error.code).toBe('VALIDATION_FAILED');
    expect((await request(app).post(GROUPS).set(auth).send(body({ name: 'ب', startingSurah: 0 }))).body.error.code).toBe('INVALID_GROUP_STARTING_SURAH');
    expect((await request(app).post(GROUPS).set(auth).send(body({ name: 'ب', startingSurah: 115 }))).body.error.code).toBe('INVALID_GROUP_STARTING_SURAH');
    expect((await request(app).post(GROUPS).set(auth).send(body({ name: 'ب', learningMode: 'x' }))).body.error.code).toBe('INVALID_GROUP_LEARNING_MODE');
    expect((await request(app).post(GROUPS).set(auth).send(body({ name: 'ب', progression: 'x' }))).body.error.code).toBe('INVALID_GROUP_PROGRESSION');
    expect((await request(app).post(GROUPS).set(auth).send(body({ name: 'ب', teacherId: UNKNOWN }))).body.error.code).toBe('GROUP_TEACHER_NOT_LINKED_TO_SCHOOL');
    expect((await request(app).post(GROUPS).send(body())).status).toBe(401);
    expect((await request(app).post(GROUPS).set(auth2).send(body({ name: 'ج' }))).status).toBe(403); // manager of another school
    expect((await request(app).post(GROUPS).set(await login(t.orgAdmin)).send(body({ name: 'ج' }))).status).toBe(403);
    expect((await request(app).post(GROUPS).set(await login(await t.h.createUser({ role: 'MAIN_ADMIN' }))).send(body({ name: 'ج' }))).status).toBe(403);
  });

  it('answers a duplicate ACTIVE name with 409, and allows the name again once that group is ARCHIVED', async () => {
    const { app, auth, body } = await setup();
    const first = await request(app).post(GROUPS).set(auth).send(body());
    expect((await request(app).post(GROUPS).set(auth).send(body())).body.error.code).toBe('GROUP_NAME_CONFLICT');
    expect((await request(app).post(`${GROUPS}/${first.body.data.id}/archive`).set(auth).send({})).status).toBe(200);
    expect((await request(app).post(GROUPS).set(auth).send(body())).status).toBe(201);
  });
});

describe('reads', () => {
  it('manager lists / reads / sees history; another school\'s manager is denied; an unknown id is 403', async () => {
    const { app, auth, auth2, school, body } = await setup();
    const id = (await request(app).post(GROUPS).set(auth).send(body())).body.data.id as string;
    expect((await request(app).get(`${GROUPS}/schools/${school.id}?filter[status]=ACTIVE&sort=name`).set(auth)).body.data.length).toBe(1);
    expect((await request(app).get(`${GROUPS}/schools/${school.id}`).set(auth2)).status).toBe(403);
    expect((await request(app).get(`${GROUPS}/schools/${school.id}?filter[status]=DELETED`).set(auth)).status).toBe(400);
    expect((await request(app).get(`${GROUPS}/${id}`).set(auth)).status).toBe(200);
    expect((await request(app).get(`${GROUPS}/${id}`).set(auth2)).status).toBe(403);
    expect((await request(app).get(`${GROUPS}/${UNKNOWN}`).set(auth)).status).toBe(403);
    expect((await request(app).get(`${GROUPS}/not-a-uuid`).set(auth)).status).toBe(400);
    expect((await request(app).get(`${GROUPS}/${id}/history`).set(auth)).body.data.map((h: { action: string }) => h.action)).toEqual(['CREATED']);
    expect((await request(app).delete(`${GROUPS}/${id}`).set(auth)).status).toBe(404); // there is no delete
  });

  it('a Teacher reads and lists ONLY their group and its students, and cannot change anything', async () => {
    const { app, t, auth, school, manager, teacher, parent, body, loginInitial } = await setup();
    const g = (await request(app).post(GROUPS).set(auth).send(body({ teacherId: teacher.id }))).body.data.id as string;
    const other = (await request(app).post(GROUPS).set(auth).send(body({ name: 'حلقة ثانية' }))).body.data.id as string;
    const s = await t.registerStudent(school.id, parent.id, manager.id);
    expect((await request(app).post(`${GROUPS}/${g}/students`).set(auth).send({ studentId: s.id })).status).toBe(201);
    const phone = (await t.h.identity.findById(teacher.userId))!.phone;
    const tAuth = await loginInitial(phone);
    expect((await request(app).get(`${GROUPS}/${g}`).set(tAuth)).body.data.name).toBe('حلقة الفجر');
    expect((await request(app).get(`${GROUPS}/${other}`).set(tAuth)).status).toBe(403);
    expect((await request(app).get(`${GROUPS}/${g}/students`).set(tAuth)).body.data.map((x: { studentId: string }) => x.studentId)).toEqual([s.id]);
    expect((await request(app).get(`${GROUPS}/mine`).set(tAuth)).body.data.map((x: { id: string }) => x.id)).toEqual([g]);
    expect((await request(app).get(`${STUDENTS}/${s.id}`).set(tAuth)).status).toBe(200); // Module 19: readable through the real group assignment
    for (const call of [
      request(app).patch(`${GROUPS}/${g}`).set(tAuth).send({ name: 'x' }),
      request(app).post(`${GROUPS}/${g}/archive`).set(tAuth).send({}),
      request(app).put(`${GROUPS}/${g}/teacher`).set(tAuth).send({ teacherId: teacher.id }),
      request(app).post(`${GROUPS}/${g}/students`).set(tAuth).send({ studentId: s.id }),
      request(app).get(`${GROUPS}/${g}/history`).set(tAuth),
      request(app).get(`${GROUPS}/schools/${school.id}`).set(tAuth),
    ]) expect((await call).status).toBe(403);
    expect((await request(app).get(`${GROUPS}/mine`).set(auth)).status).toBe(403); // a manager has no "own groups"
  });

  it('a Parent reads the group of their own child (minimal view) and nothing else', async () => {
    const { app, t, auth, school, manager, parent, body, loginInitial } = await setup();
    const g = (await request(app).post(GROUPS).set(auth).send(body())).body.data.id as string;
    const other = (await request(app).post(GROUPS).set(auth).send(body({ name: 'حلقة ثانية' }))).body.data.id as string;
    const s = await t.registerStudent(school.id, parent.id, manager.id);
    await request(app).post(`${GROUPS}/${g}/students`).set(auth).send({ studentId: s.id });
    const pAuth = await loginInitial((await t.h.identity.findById(parent.userId))!.phone);
    const res = await request(app).get(`${GROUPS}/${g}`).set(pAuth);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data).sort()).toEqual(['id', 'name', 'schoolId', 'teacherName']);
    expect((await request(app).get(`${GROUPS}/${other}`).set(pAuth)).status).toBe(403);
    expect((await request(app).get(`${GROUPS}/${g}/students`).set(pAuth)).status).toBe(403);
    expect((await request(app).patch(`${GROUPS}/${g}`).set(pAuth).send({ name: 'x' })).status).toBe(403);
  });
});

describe('teacher, update and archive', () => {
  it('changes settings with history, assigns / changes / removes the Teacher, and archives (final)', async () => {
    const { app, t, auth, school, manager, teacher, body } = await setup();
    const g = (await request(app).post(GROUPS).set(auth).send(body())).body.data.id as string;
    expect((await request(app).patch(`${GROUPS}/${g}`).set(auth).send({ progression: 'BACKWARD', startingSurah: 114 })).body.data).toMatchObject({ progression: 'BACKWARD', startingSurah: 114 });
    expect((await request(app).patch(`${GROUPS}/${g}`).set(auth).send({})).body.error.code).toBe('GROUP_UPDATE_EMPTY');
    expect((await request(app).put(`${GROUPS}/${g}/teacher`).set(auth).send({ teacherId: teacher.id })).body.data.teacher.id).toBe(teacher.id);
    expect((await request(app).put(`${GROUPS}/${g}/teacher`).set(auth).send({ teacherId: UNKNOWN })).body.error.code).toBe('GROUP_TEACHER_NOT_LINKED_TO_SCHOOL');
    expect((await request(app).delete(`${GROUPS}/${g}/teacher`).set(auth)).body.data.teacher).toBeNull();
    expect((await request(app).delete(`${GROUPS}/${g}/teacher`).set(auth)).body.error.code).toBe('GROUP_HAS_NO_TEACHER');
    const history = await request(app).get(`${GROUPS}/${g}/history`).set(auth);
    expect(history.body.data.map((h: { action: string }) => h.action)).toEqual(['CREATED', 'UPDATED', 'TEACHER_CHANGED', 'TEACHER_CHANGED']);
    expect((await request(app).post(`${GROUPS}/${g}/archive`).set(auth).send({ reason: 'انتهت' })).body.data.status).toBe('ARCHIVED');
    expect((await request(app).patch(`${GROUPS}/${g}`).set(auth).send({ name: 'x' })).body.error.code).toBe('GROUP_ARCHIVED');
    expect((await request(app).post(`${GROUPS}/${g}/archive`).set(auth).send({ reason: 'ا'.repeat(501) })).status).toBe(400);
    expect(school.id && manager.id && t).toBeTruthy();
  });
});

describe('students in groups', () => {
  it('assigns (201), refuses a second group (409), moves, unassigns (204), and keeps the assignment history', async () => {
    const { app, t, auth, auth2, school, manager, parent, body } = await setup();
    const a = (await request(app).post(GROUPS).set(auth).send(body({ name: 'A' }))).body.data.id as string;
    const b = (await request(app).post(GROUPS).set(auth).send(body({ name: 'B' }))).body.data.id as string;
    const s = await t.registerStudent(school.id, parent.id, manager.id);
    expect((await request(app).post(`${GROUPS}/${a}/students`).set(auth2).send({ studentId: s.id })).status).toBe(403);
    expect((await request(app).post(`${GROUPS}/${a}/students`).set(auth).send({ studentId: UNKNOWN })).body.error.code).toBe('GROUP_STUDENT_NOT_IN_SCHOOL');
    expect((await request(app).post(`${GROUPS}/${a}/students`).set(auth).send({ studentId: s.id })).status).toBe(201);
    expect((await request(app).post(`${GROUPS}/${b}/students`).set(auth).send({ studentId: s.id })).body.error.code).toBe('GROUP_STUDENT_ALREADY_ASSIGNED');
    expect((await request(app).post(`${GROUPS}/${a}/students/${s.id}/move`).set(auth).send({ targetGroupId: a })).body.error.code).toBe('GROUP_MOVE_TARGET_INVALID');
    expect((await request(app).post(`${GROUPS}/${a}/students/${s.id}/move`).set(auth).send({ targetGroupId: b })).status).toBe(200);
    expect((await request(app).delete(`${GROUPS}/${a}/students/${s.id}`).set(auth)).body.error.code).toBe('GROUP_STUDENT_NOT_ASSIGNED');
    expect((await request(app).delete(`${GROUPS}/${b}/students/${s.id}`).set(auth)).status).toBe(204);
    const periods = await request(app).get(`${GROUPS}/students/${s.id}/assignments`).set(auth);
    expect(periods.body.data.map((p: { groupName: string; endReason: string }) => [p.groupName, p.endReason])).toEqual([['A', 'MOVED'], ['B', 'MANUAL']]);
    expect((await request(app).get(`${GROUPS}/students/${s.id}/assignments`).set(auth2)).status).toBe(403);
  });
});
