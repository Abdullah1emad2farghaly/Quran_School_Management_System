import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AUTH, PARENTS, TEACHERS, createTeachersApi } from '../helpers/teachers-api-harness';

const PHONE = '01001234568';
const NAME = 'خالد أحمد حسن';
const body = (schoolId: string, over: Record<string, unknown> = {}) => ({ schoolId, name: NAME, phone: PHONE, ...over });

async function setup() {
  const api = await createTeachersApi();
  const schoolA = await api.t.newSchool('مدرسة أ');
  const schoolB = await api.t.newSchool('مدرسة ب');
  const managerA = await api.t.newSchoolManager(schoolA.id);
  const managerB = await api.t.newSchoolManager(schoolB.id);
  return { ...api, schoolA, schoolB, managerA, managerB, authA: await api.login(managerA), authB: await api.login(managerB) };
}
const loginRaw = (app: Parameters<typeof request>[0], phone: string, password: string) => request(app).post(`${AUTH}/login`).send({ phone, password });

describe('POST /teachers', () => {
  it('lets the School Manager register a Teacher; the response never carries a password', async () => {
    const { app, authA, schoolA } = await setup();
    const res = await request(app).post(TEACHERS).set(authA).send(body(schoolA.id));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ accountCreated: true, teacher: { name: NAME, phone: '+201001234568', schoolIds: [schoolA.id] }, link: { schoolId: schoolA.id, isActive: true } });
    expect(JSON.stringify(res.body)).not.toMatch(/password|hash/i);
  });

  it('validates the input (exactly three name parts) and denies the wrong callers', async () => {
    const { app, t, authA, authB, schoolA, login } = await setup();
    expect((await request(app).post(TEACHERS).set(authA).send({})).body.error.code).toBe('VALIDATION_FAILED');
    expect((await request(app).post(TEACHERS).set(authA).send(body('not-a-uuid'))).status).toBe(400);
    for (const bad of ['خالد أحمد', 'خالد أحمد حسن علي']) {
      expect((await request(app).post(TEACHERS).set(authA).send(body(schoolA.id, { name: bad }))).body.error.code).toBe('INVALID_TEACHER_NAME');
    }
    expect((await request(app).post(TEACHERS).send(body(schoolA.id))).status).toBe(401);
    expect((await request(app).post(TEACHERS).set(authB).send(body(schoolA.id))).status).toBe(403); // manager of another school
    expect((await request(app).post(TEACHERS).set(await login(t.orgAdmin)).send(body(schoolA.id))).status).toBe(403); // organization manager
    expect((await request(app).post(TEACHERS).set(await login(await t.h.createUser({ role: 'MAIN_ADMIN' }))).send(body(schoolA.id))).status).toBe(403);
    expect((await request(app).post(TEACHERS).set(authA).send(body('00000000-0000-4000-8000-000000000000'))).status).toBe(403);
  });

  it('answers identity and organization conflicts with 409 and a double link with 409', async () => {
    const { app, t, authA, authB, schoolA, schoolB } = await setup();
    expect((await request(app).post(TEACHERS).set(authA).send(body(schoolA.id))).status).toBe(201);
    const conflict = await request(app).post(TEACHERS).set(authB).send(body(schoolB.id, { name: 'محمود خالد سعيد' }));
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('TEACHER_IDENTITY_CONFLICT');
    const reused = await request(app).post(TEACHERS).set(authB).send(body(schoolB.id));
    expect(reused.status).toBe(201);
    expect(reused.body.data.accountCreated).toBe(false);
    expect((await request(app).post(TEACHERS).set(authA).send(body(schoolA.id))).body.error.code).toBe('TEACHER_ALREADY_LINKED_TO_SCHOOL');

    const org2 = await t.otherOrg();
    const school2 = await t.newSchool('مدرسة ثانية', org2.id);
    const manager2 = await t.newSchoolManager(school2.id, org2.id);
    const cross = await request(app).post(TEACHERS).set({ Authorization: `Bearer ${(await loginRaw(app, manager2.phone, manager2.password)).body.data.accessToken}` }).send(body(school2.id));
    expect(cross.body.error.code).toBe('TEACHER_ORGANIZATION_CONFLICT');
  });
});

describe('the Teacher\'s first login: initial password and mandatory change, enforced by the backend', () => {
  it('a new Teacher logs in with the last four digits, is blocked from every normal route, changes the password and then reads their own profile only', async () => {
    const { app, authA, schoolA } = await setup();
    const created = await request(app).post(TEACHERS).set(authA).send(body(schoolA.id));
    const teacherId = created.body.data.teacher.id as string;

    const loginRes = await loginRaw(app, PHONE, '4568'); // the initial password: last four digits of the phone
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.data.mustChangePassword).toBe(true);
    expect(loginRes.body.data.roles).toEqual(['TEACHER']);
    const teacherAuth = { Authorization: `Bearer ${loginRes.body.data.accessToken}` };

    const blocked = await request(app).get(`${TEACHERS}/me`).set(teacherAuth);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await request(app).get(`${TEACHERS}/${teacherId}`).set(teacherAuth)).body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    // wrong current password and an unchanged password do not clear the requirement
    expect((await request(app).post(`${AUTH}/change-password`).set(teacherAuth).send({ currentPassword: 'nope', newPassword: 'my-pass-1' })).body.error.code).toBe('CURRENT_PASSWORD_INCORRECT');
    expect((await request(app).post(`${AUTH}/change-password`).set(teacherAuth).send({ currentPassword: '4568', newPassword: '4568' })).body.error.code).toBe('NEW_PASSWORD_SAME_AS_CURRENT');
    expect((await request(app).get(`${TEACHERS}/me`).set(teacherAuth)).status).toBe(403);

    expect((await request(app).post(`${AUTH}/change-password`).set(teacherAuth).send({ currentPassword: '4568', newPassword: 'my-pass-1' })).status).toBe(204);
    const own = await request(app).get(`${TEACHERS}/me`).set(teacherAuth);
    expect(own.status).toBe(200);
    expect(own.body.data).toMatchObject({ id: teacherId, name: NAME, phone: '+201001234568' });

    // a Teacher has no management permission
    expect((await request(app).get(`${TEACHERS}/${teacherId}`).set(teacherAuth)).status).toBe(403);
    expect((await request(app).get(`${TEACHERS}/schools/${schoolA.id}`).set(teacherAuth)).status).toBe(403);
    expect((await request(app).delete(`${TEACHERS}/${teacherId}/schools/${schoolA.id}`).set(teacherAuth)).status).toBe(403);
    expect((await request(app).post(TEACHERS).set(teacherAuth).send(body(schoolA.id, { phone: '01009998887' }))).status).toBe(403);

    const relogin = await loginRaw(app, PHONE, 'my-pass-1');
    expect(relogin.body.data.mustChangePassword).toBe(false);
    expect((await loginRaw(app, PHONE, '4568')).status).toBe(401);
  });

  it('linking the Teacher to another school never re-imposes the requirement or resets the chosen password', async () => {
    const { app, authA, authB, schoolA, schoolB } = await setup();
    await request(app).post(TEACHERS).set(authA).send(body(schoolA.id));
    const first = await loginRaw(app, PHONE, '4568');
    const auth = { Authorization: `Bearer ${first.body.data.accessToken}` };
    await request(app).post(`${AUTH}/change-password`).set(auth).send({ currentPassword: '4568', newPassword: 'my-pass-1' });

    expect((await request(app).post(TEACHERS).set(authB).send(body(schoolB.id))).status).toBe(201);
    expect((await request(app).get(`${TEACHERS}/me`).set(auth)).status).toBe(200);
    const relogin = await loginRaw(app, PHONE, 'my-pass-1');
    expect(relogin.status).toBe(200);
    expect(relogin.body.data.mustChangePassword).toBe(false);
  });

  it('the same person as Parent + Teacher: ONE account; the Teacher registration changes neither password nor flag; only the account\'s pending change applies', async () => {
    const { app, t, authA, schoolA } = await setup();
    // the person is first registered as a Parent (initial password + pending change), then as a Teacher of the same organization
    const parentMakerAuth = authA;
    const parent = await request(app).post(PARENTS).set(parentMakerAuth).send({ schoolId: schoolA.id, name: NAME, phone: PHONE, address: 'المنيا / سمالوط' });
    expect(parent.status).toBe(201);
    const teacher = await request(app).post(TEACHERS).set(authA).send(body(schoolA.id));
    expect(teacher.status).toBe(201);
    expect(teacher.body.data.accountCreated).toBe(false);
    expect(teacher.body.data.teacher.userId).toBe(parent.body.data.parent.userId);

    const loginRes = await loginRaw(app, PHONE, '4568');
    expect(loginRes.body.data.mustChangePassword).toBe(true); // the SAME pending change, not a second one
    expect([...loginRes.body.data.roles].sort()).toEqual(['PARENT', 'TEACHER']);
    expect((await t.h.identity.findByPhone(PHONE))!.mustChangePassword).toBe(true);
  });
});

describe('GET/DELETE of a school\'s Teachers', () => {
  it('lists only the school\'s Teachers (paginated), reads one, and ends the link; the account survives', async () => {
    const { app, t, authA, authB, schoolA, schoolB } = await setup();
    const a1 = await request(app).post(TEACHERS).set(authA).send(body(schoolA.id));
    await request(app).post(TEACHERS).set(authA).send(body(schoolA.id, { phone: '01002222222', name: 'ب ب ب' }));
    await request(app).post(TEACHERS).set(authB).send(body(schoolB.id, { phone: '01003333333', name: 'ج ج ج' }));
    const id = a1.body.data.teacher.id as string;

    const list = await request(app).get(`${TEACHERS}/schools/${schoolA.id}?pageSize=1&sort=createdAt`).set(authA);
    expect(list.status).toBe(200);
    expect(list.body.meta.total).toBe(2);
    expect(list.body.data).toHaveLength(1);
    expect((await request(app).get(`${TEACHERS}/schools/${schoolA.id}`).set(authB)).status).toBe(403);

    expect((await request(app).get(`${TEACHERS}/${id}`).set(authA)).body.data.id).toBe(id);
    expect((await request(app).get(`${TEACHERS}/${id}`).set(authB)).status).toBe(403); // linked only to school A
    expect((await request(app).get(`${TEACHERS}/not-a-uuid`).set(authA)).status).toBe(400);

    t.groupCounts.set(`${id}:${schoolA.id}`, 1);
    expect((await request(app).delete(`${TEACHERS}/${id}/schools/${schoolA.id}`).set(authA)).body.error.code).toBe('TEACHER_HAS_GROUPS_IN_SCHOOL');
    t.groupCounts.set(`${id}:${schoolA.id}`, 0);
    const removed = await request(app).delete(`${TEACHERS}/${id}/schools/${schoolA.id}`).set(authA);
    expect(removed.status).toBe(200);
    expect(removed.body.data).toMatchObject({ isActive: false });
    expect((await request(app).get(`${TEACHERS}/${id}`).set(authA)).status).toBe(403); // no longer linked to A
    expect(await t.h.identity.findByPhone(PHONE)).toBeTruthy();
  });

  it('requires authentication on every route', async () => {
    const { app } = await setup();
    const id = '00000000-0000-4000-8000-000000000000';
    for (const [method, url] of [['get', `${TEACHERS}/me`], ['get', `${TEACHERS}/schools/${id}`], ['get', `${TEACHERS}/${id}`], ['delete', `${TEACHERS}/${id}/schools/${id}`]] as const) {
      expect((await request(app)[method](url)).status, `${method} ${url}`).toBe(401);
    }
  });
});
