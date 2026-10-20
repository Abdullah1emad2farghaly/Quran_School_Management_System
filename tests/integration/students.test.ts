import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { NATIONAL_ID, STUDENT_NAME } from '../helpers/students-harness';
import { STUDENTS, createStudentsApi } from '../helpers/students-api-harness';

const UNKNOWN = '00000000-0000-4000-8000-000000000000';

async function setup() {
  const api = await createStudentsApi();
  const { t } = api;
  const schoolA = await t.newSchool('مدرسة أ');
  const schoolB = await t.newSchool('مدرسة ب');
  const managerA = await t.newSchoolManager(schoolA.id);
  const managerB = await t.newSchoolManager(schoolB.id);
  const parent = await t.newParent(schoolA.id, managerA.id);
  const body = (over: Record<string, unknown> = {}) => ({ schoolId: schoolA.id, parentId: parent.id, fullName: STUDENT_NAME, nationalId: NATIONAL_ID, ...over });
  return { ...api, schoolA, schoolB, managerA, managerB, parent, body, authA: await api.login(managerA), authB: await api.login(managerB) };
}

describe('POST /students', () => {
  it('lets the School Manager register a Student; the response carries the derived address and no login data', async () => {
    const { app, authA, schoolA, parent, body } = await setup();
    const res = await request(app).post(STUDENTS).set(authA).send(body());
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ schoolId: schoolA.id, parentId: parent.id, fullName: STUDENT_NAME, nationalId: NATIONAL_ID, status: 'ACTIVE', address: { centerName: 'سمالوط' } });
    expect(JSON.stringify(res.body)).not.toMatch(/password|hash|token/i);
  });

  it('validates the input and denies the wrong callers', async () => {
    const { app, t, authA, authB, body, login } = await setup();
    expect((await request(app).post(STUDENTS).set(authA).send({})).body.error.code).toBe('VALIDATION_FAILED');
    expect((await request(app).post(STUDENTS).set(authA).send(body({ parentId: 'x' }))).status).toBe(400);
    expect((await request(app).post(STUDENTS).set(authA).send(body({ fullName: 'عمر أحمد' }))).body.error.code).toBe('INVALID_STUDENT_NAME');
    expect((await request(app).post(STUDENTS).set(authA).send(body({ nationalId: '123' }))).body.error.code).toBe('INVALID_STUDENT_NATIONAL_ID');
    expect((await request(app).post(STUDENTS).set(authA).send(body({ nationalId: 30001010123456 }))).status).toBe(400);
    expect((await request(app).post(STUDENTS).set(authA).send(body({ fullName: 'عمر خالد محمد' }))).body.error.code).toBe('STUDENT_NAME_PARENT_MISMATCH');
    expect((await request(app).post(STUDENTS).send(body())).status).toBe(401);
    expect((await request(app).post(STUDENTS).set(authB).send(body())).status).toBe(403); // manager of another school
    expect((await request(app).post(STUDENTS).set(await login(t.orgAdmin)).send(body())).status).toBe(403);
    expect((await request(app).post(STUDENTS).set(await login(await t.h.createUser({ role: 'MAIN_ADMIN' }))).send(body())).status).toBe(403);
    expect((await request(app).post(STUDENTS).set(authA).send(body({ schoolId: UNKNOWN }))).status).toBe(403);
  });

  it('answers a duplicate National ID with 409 and the neutral message, whichever school it is in', async () => {
    const { app, t, authA, authB, schoolB, managerB, body } = await setup();
    expect((await request(app).post(STUDENTS).set(authA).send(body())).status).toBe(201);
    const dup = await request(app).post(STUDENTS).set(authA).send(body());
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('STUDENT_NATIONAL_ID_CONFLICT');
    const parentB = await t.newParent(schoolB.id, managerB.id, 'سعيد حسن محمود');
    const cross = await request(app).post(STUDENTS).set(authB).send({ schoolId: schoolB.id, parentId: parentB.id, fullName: 'علي سعيد حسن', nationalId: NATIONAL_ID });
    expect(cross.status).toBe(409);
    expect(JSON.stringify(cross.body)).not.toMatch(/مدرسة أ|عمر/);
  });
});

describe('reads', () => {
  it('School Manager lists and reads; another school\'s manager is denied; an unknown id is 403 (never reveals existence)', async () => {
    const { app, authA, authB, schoolA, body } = await setup();
    const id = (await request(app).post(STUDENTS).set(authA).send(body())).body.data.id as string;
    expect((await request(app).get(`${STUDENTS}/schools/${schoolA.id}?filter[status]=ACTIVE&sort=-joinDate`).set(authA)).body.data.length).toBe(1);
    expect((await request(app).get(`${STUDENTS}/schools/${schoolA.id}`).set(authB)).status).toBe(403);
    expect((await request(app).get(`${STUDENTS}/schools/${schoolA.id}?filter[status]=DELETED`).set(authA)).status).toBe(400);
    expect((await request(app).get(`${STUDENTS}/${id}`).set(authA)).status).toBe(200);
    expect((await request(app).get(`${STUDENTS}/${id}`).set(authB)).status).toBe(403);
    expect((await request(app).get(`${STUDENTS}/${UNKNOWN}`).set(authA)).status).toBe(403);
    expect((await request(app).get(`${STUDENTS}/not-a-uuid`).set(authA)).status).toBe(400);
  });

  it('a Parent reads ONLY their own children (full view) and cannot write', async () => {
    const { app, t, authA, schoolA, managerA, parent, body, loginParent } = await setup();
    const id = (await request(app).post(STUDENTS).set(authA).send(body())).body.data.id as string;
    const other = await t.newParent(schoolA.id, managerA.id, 'سعيد حسن محمود');
    const otherId = (await request(app).post(STUDENTS).set(authA).send(body({ parentId: other.id, fullName: 'علي سعيد حسن', nationalId: '30001010123457' }))).body.data.id as string;

    const parentAuth = await loginParent((await t.h.identity.findById(parent.userId))!.phone);
    const mine = await request(app).get(`${STUDENTS}/mine`).set(parentAuth);
    expect(mine.status).toBe(200);
    expect(mine.body.data.map((s: { id: string }) => s.id)).toEqual([id]);
    expect((await request(app).get(`${STUDENTS}/${id}`).set(parentAuth)).body.data.nationalId).toBe(NATIONAL_ID);
    expect((await request(app).get(`${STUDENTS}/${otherId}`).set(parentAuth)).status).toBe(403);
    expect((await request(app).patch(`${STUDENTS}/${id}`).set(parentAuth).send({ joinDate: '2026-09-01' })).status).toBe(403);
    expect((await request(app).post(`${STUDENTS}/${id}/archive`).set(parentAuth).send({})).status).toBe(403);
    expect((await request(app).get(`${STUDENTS}/${id}/history`).set(parentAuth)).status).toBe(403);
    expect((await request(app).get(`${STUDENTS}/schools/${schoolA.id}`).set(parentAuth)).status).toBe(403);
    expect((await request(app).get(`${STUDENTS}/mine`).set(authA)).status).toBe(403); // a School Manager has no "own children"
  });

  it('a Teacher reads only a student of an assigned group and receives the minimal view', async () => {
    const { app, t, authA, schoolA, managerA, body, login } = await setup();
    const id = (await request(app).post(STUDENTS).set(authA).send(body())).body.data.id as string;
    const { teacher } = await t.teachers.registerTeacher({ schoolId: schoolA.id, name: 'خالد أحمد حسن', phone: '01001234568' }, managerA.id);
    const first = await request(app).post('/api/v1/auth/login').send({ phone: '01001234568', password: '4568' });
    await request(app).post('/api/v1/auth/change-password').set({ Authorization: `Bearer ${first.body.data.accessToken}` }).send({ currentPassword: '4568', newPassword: 'my-pass-1' });
    const teacherAuth = await login({ phone: '01001234568', password: 'my-pass-1' });

    expect((await request(app).get(`${STUDENTS}/${id}`).set(teacherAuth)).status).toBe(403); // no group yet
    t.assignToGroup(teacher.id, id);
    const res = await request(app).get(`${STUDENTS}/${id}`).set(teacherAuth);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data).sort()).toEqual(['fullName', 'id', 'joinDate', 'schoolId', 'status']);
    expect((await request(app).patch(`${STUDENTS}/${id}`).set(teacherAuth).send({ joinDate: '2026-09-01' })).status).toBe(403);
    expect((await request(app).get(`${STUDENTS}/schools/${schoolA.id}`).set(teacherAuth)).status).toBe(403);
    expect((await request(app).get(`${STUDENTS}/mine`).set(teacherAuth)).status).toBe(403);
  });
});

describe('update and lifecycle', () => {
  it('corrects the join date, ignores attempts to change the National ID / Parent / school, and keeps the history', async () => {
    const { app, authA, schoolB, body } = await setup();
    const id = (await request(app).post(STUDENTS).set(authA).send(body({ joinDate: '2026-09-01' }))).body.data.id as string;
    const res = await request(app).patch(`${STUDENTS}/${id}`).set(authA).send({ joinDate: '2026-09-15', nationalId: '30001010999999', schoolId: schoolB.id, parentId: UNKNOWN });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ joinDate: '2026-09-15', nationalId: NATIONAL_ID });
    expect((await request(app).patch(`${STUDENTS}/${id}`).set(authA).send({})).body.error.code).toBe('STUDENT_UPDATE_EMPTY');
    const history = await request(app).get(`${STUDENTS}/${id}/history`).set(authA);
    expect(history.body.data.map((h: { action: string }) => h.action)).toEqual(['REGISTERED', 'DETAILS_UPDATED']);
  });

  it('deactivate -> reactivate -> archive; archived is final and read-only; other schools\' managers are denied', async () => {
    const { app, authA, authB, body } = await setup();
    const id = (await request(app).post(STUDENTS).set(authA).send(body())).body.data.id as string;
    expect((await request(app).post(`${STUDENTS}/${id}/deactivate`).set(authB).send({})).status).toBe(403);
    expect((await request(app).post(`${STUDENTS}/${id}/deactivate`).set(authA).send({ reason: 'توقف مؤقت' })).body.data.status).toBe('INACTIVE');
    expect((await request(app).post(`${STUDENTS}/${id}/deactivate`).set(authA).send({})).body.error.code).toBe('STUDENT_INVALID_STATUS_TRANSITION');
    expect((await request(app).post(`${STUDENTS}/${id}/reactivate`).set(authA).send({})).body.data.status).toBe('ACTIVE');
    expect((await request(app).post(`${STUDENTS}/${id}/archive`).set(authA).send({})).body.data.status).toBe('ARCHIVED');
    expect((await request(app).post(`${STUDENTS}/${id}/reactivate`).set(authA).send({})).body.error.code).toBe('STUDENT_ARCHIVED');
    expect((await request(app).patch(`${STUDENTS}/${id}`).set(authA).send({ joinDate: '2026-09-01' })).body.error.code).toBe('STUDENT_ARCHIVED');
    expect((await request(app).post(`${STUDENTS}/${id}/archive`).set(authA).send({ reason: 'ا'.repeat(501) })).status).toBe(400);
  });

  it('there is no DELETE endpoint', async () => {
    const { app, authA, body } = await setup();
    const id = (await request(app).post(STUDENTS).set(authA).send(body())).body.data.id as string;
    expect((await request(app).delete(`${STUDENTS}/${id}`).set(authA)).status).toBe(404);
  });
});
