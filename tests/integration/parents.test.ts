import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AUTH, PARENTS, createParentsApi } from '../helpers/parents-api-harness';

const PHONE = '01001234567';
const body = (schoolId: string, over: Record<string, unknown> = {}) => ({ schoolId, name: 'أحمد محمد علي', phone: PHONE, address: 'المنيا / سمالوط / برمشا', ...over });

async function setup() {
  const api = await createParentsApi();
  const { t } = api;
  const schoolA = await t.newSchool('مدرسة أ');
  const schoolB = await t.newSchool('مدرسة ب');
  const managerA = await t.newSchoolManager(schoolA.id);
  const managerB = await t.newSchoolManager(schoolB.id);
  const authA = await api.login(managerA);
  const authB = await api.login(managerB);
  return { ...api, schoolA, schoolB, managerA, managerB, authA, authB };
}

describe('POST /parents', () => {
  it('lets the School Manager register a Parent; the response never carries a password', async () => {
    const { app, authA, schoolA } = await setup();
    const res = await request(app).post(PARENTS).set(authA).send(body(schoolA.id));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ accountCreated: true, parent: { name: 'أحمد محمد علي', phone: '+201001234567', schoolIds: [schoolA.id] }, link: { schoolId: schoolA.id, isActive: true } });
    expect(JSON.stringify(res.body)).not.toMatch(/password|hash/i);
  });

  it('accepts the address as structured fields too, and refuses both or neither', async () => {
    const { app, t, authA, schoolA } = await setup();
    const fields = { governorateId: t.gov.id, centerName: 'سمالوط' };
    const ok = await request(app).post(PARENTS).set(authA).send(body(schoolA.id, { address: undefined, addressFields: fields }));
    expect(ok.status).toBe(201);
    const both = await request(app).post(PARENTS).set(authA).send(body(schoolA.id, { phone: '01002222222', addressFields: fields }));
    expect(both.status).toBe(400);
    expect(both.body.error.code).toBe('PARENT_ADDRESS_REQUIRED');
    const none = await request(app).post(PARENTS).set(authA).send(body(schoolA.id, { phone: '01003333333', address: undefined }));
    expect(none.body.error.code).toBe('PARENT_ADDRESS_REQUIRED');
  });

  it('validates the input (400) before authorization decisions leak anything', async () => {
    const { app, authA, schoolA } = await setup();
    expect((await request(app).post(PARENTS).set(authA).send({})).body.error.code).toBe('VALIDATION_FAILED');
    expect((await request(app).post(PARENTS).set(authA).send(body('not-a-uuid'))).status).toBe(400);
    expect((await request(app).post(PARENTS).set(authA).send(body(schoolA.id, { name: 'أحمد محمد' }))).body.error.code).toBe('INVALID_PARENT_NAME');
    expect((await request(app).post(PARENTS).set(authA).send(body(schoolA.id, { address: 'مكان / سمالوط' }))).body.error.code).toBe('PARENT_ADDRESS_GOVERNORATE_NOT_FOUND');
  });

  it('denies: no token (401), a manager of ANOTHER school, the organization manager and a Parent (403)', async () => {
    const { app, t, authB, schoolA, login } = await setup();
    expect((await request(app).post(PARENTS).send(body(schoolA.id))).status).toBe(401);
    expect((await request(app).post(PARENTS).set(authB).send(body(schoolA.id))).status).toBe(403);
    expect((await request(app).post(PARENTS).set(await login(t.orgAdmin)).send(body(schoolA.id))).status).toBe(403);
    expect((await request(app).post(PARENTS).set(await login(await t.h.createUser({ role: 'MAIN_ADMIN' }))).send(body(schoolA.id))).status).toBe(403);
  });

  it('answers identity and organization conflicts with 409 and an unknown school with 403', async () => {
    const { app, t, authA, authB, schoolA, schoolB } = await setup();
    expect((await request(app).post(PARENTS).set(authA).send(body(schoolA.id))).status).toBe(201);
    const conflict = await request(app).post(PARENTS).set(authB).send(body(schoolB.id, { name: 'محمود خالد سعيد' }));
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('PARENT_IDENTITY_CONFLICT');
    const reused = await request(app).post(PARENTS).set(authB).send(body(schoolB.id));
    expect(reused.status).toBe(201);
    expect(reused.body.data.accountCreated).toBe(false);
    expect((await request(app).post(PARENTS).set(authA).send(body(schoolA.id))).body.error.code).toBe('PARENT_ALREADY_LINKED_TO_SCHOOL');

    const org2 = await t.otherOrg();
    const school2 = await t.newSchool('مدرسة ثانية', org2.id);
    const manager2 = await t.newSchoolManager(school2.id, org2.id);
    const cross = await request(app).post(PARENTS).set(await (await createLogin(app, manager2))).send(body(school2.id));
    expect(cross.body.error.code).toBe('PARENT_ORGANIZATION_CONFLICT');
    expect((await request(app).post(PARENTS).set(authA).send(body('00000000-0000-4000-8000-000000000000'))).status).toBe(403);
  });
});

async function createLogin(app: Parameters<typeof request>[0], u: { phone: string; password: string }) {
  const res = await request(app).post(`${AUTH}/login`).send({ phone: u.phone, password: u.password });
  return { Authorization: `Bearer ${res.body.data.accessToken}` };
}

describe('the Parent\'s first login (mandatory password change, enforced by the backend)', () => {
  it('a new Parent can do nothing but change the password until they do; then reads their own profile only', async () => {
    const { app, authA, schoolA, schoolB, managerB } = await setup();
    const created = await request(app).post(PARENTS).set(authA).send(body(schoolA.id));
    const parentId = created.body.data.parent.id as string;

    const loginRes = await request(app).post(`${AUTH}/login`).send({ phone: PHONE, password: '4567' });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.data.mustChangePassword).toBe(true);
    expect(loginRes.body.data.roles).toEqual(['PARENT']);
    const parentAuth = { Authorization: `Bearer ${loginRes.body.data.accessToken}` };

    const blocked = await request(app).get(`${PARENTS}/me`).set(parentAuth);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    expect((await request(app).post(`${AUTH}/change-password`).set(parentAuth).send({ currentPassword: '4567', newPassword: 'my-pass-1' })).status).toBe(204);

    const own = await request(app).get(`${PARENTS}/me`).set(parentAuth);
    expect(own.status).toBe(200);
    expect(own.body.data).toMatchObject({ id: parentId, name: 'أحمد محمد علي', phone: '+201001234567', address: { governorateName: 'المنيا' } });

    // a Parent has no management permission: not even over their own record by id
    expect((await request(app).get(`${PARENTS}/${parentId}`).set(parentAuth)).status).toBe(403);
    expect((await request(app).patch(`${PARENTS}/${parentId}`).set(parentAuth).send({ name: 'أحمد محمد حسن' })).status).toBe(403);
    expect((await request(app).get(`${PARENTS}/schools/${schoolA.id}`).set(parentAuth)).status).toBe(403);
    expect((await request(app).delete(`${PARENTS}/${parentId}/schools/${schoolA.id}`).set(parentAuth)).status).toBe(403);

    // linking the same Parent to another school never re-imposes the requirement
    const authB = await createLogin(app, managerB);
    expect((await request(app).post(PARENTS).set(authB).send(body(schoolB.id))).status).toBe(201);
    expect((await request(app).get(`${PARENTS}/me`).set(parentAuth)).status).toBe(200);
    const relogin = await request(app).post(`${AUTH}/login`).send({ phone: PHONE, password: 'my-pass-1' });
    expect(relogin.body.data.mustChangePassword).toBe(false);
  });

  it('a non-Parent account has no own Parent profile (404 for a Parent-role user without a record is impossible by design; 403 otherwise)', async () => {
    const { app, t, login } = await setup();
    expect((await request(app).get(`${PARENTS}/me`).set(await login(t.orgAdmin))).status).toBe(403);
  });
});

describe('GET/PATCH/DELETE of a school\'s Parents', () => {
  it('lists only the school\'s Parents (paginated), reads one, corrects name and address with history, and ends the link', async () => {
    const { app, t, authA, authB, schoolA, schoolB } = await setup();
    const a1 = await request(app).post(PARENTS).set(authA).send(body(schoolA.id));
    await request(app).post(PARENTS).set(authA).send(body(schoolA.id, { phone: '01002222222', name: 'ب ب ب' }));
    await request(app).post(PARENTS).set(authB).send(body(schoolB.id, { phone: '01003333333', name: 'ج ج ج' }));
    const id = a1.body.data.parent.id as string;

    const list = await request(app).get(`${PARENTS}/schools/${schoolA.id}?pageSize=1&sort=name`).set(authA);
    expect(list.status).toBe(200);
    expect(list.body.meta.total).toBe(2);
    expect(list.body.data).toHaveLength(1);
    expect((await request(app).get(`${PARENTS}/schools/${schoolA.id}`).set(authB)).status).toBe(403);

    expect((await request(app).get(`${PARENTS}/${id}`).set(authA)).body.data.id).toBe(id);
    expect((await request(app).get(`${PARENTS}/${id}`).set(authB)).status).toBe(403); // linked only to school A
    expect((await request(app).get(`${PARENTS}/00000000-0000-4000-8000-000000000000`).set(authA)).status).toBe(403);
    expect((await request(app).get(`${PARENTS}/not-a-uuid`).set(authA)).status).toBe(400);

    const patched = await request(app).patch(`${PARENTS}/${id}`).set(authA).send({ name: 'أحمد محمد علي حسن', address: 'المنيا / مطاي' });
    expect(patched.status).toBe(200);
    expect(patched.body.data).toMatchObject({ name: 'أحمد محمد علي حسن', address: { centerName: 'مطاي', villageName: null }, phone: '+201001234567' });
    expect((await t.parents.listAddressHistory(id)).map((h) => h.centerName)).toEqual(['سمالوط', 'مطاي']);
    expect((await request(app).patch(`${PARENTS}/${id}`).set(authA).send({})).body.error.code).toBe('PARENT_UPDATE_EMPTY');
    expect((await request(app).patch(`${PARENTS}/${id}`).set(authA).send({ name: 'أحمد' })).body.error.code).toBe('INVALID_PARENT_NAME');

    const removed = await request(app).delete(`${PARENTS}/${id}/schools/${schoolA.id}`).set(authA);
    expect(removed.status).toBe(200);
    expect(removed.body.data).toMatchObject({ isActive: false });
    expect((await request(app).get(`${PARENTS}/${id}`).set(authA)).status).toBe(403); // no longer linked to A
    expect((await t.h.identity.findByPhone(PHONE))).toBeTruthy(); // the account survives
  });

  it('requires authentication on every route', async () => {
    const { app } = await setup();
    const id = '00000000-0000-4000-8000-000000000000';
    for (const [method, url] of [['get', `${PARENTS}/me`], ['get', `${PARENTS}/schools/${id}`], ['get', `${PARENTS}/${id}`], ['patch', `${PARENTS}/${id}`], ['delete', `${PARENTS}/${id}/schools/${id}`]] as const) {
      expect((await request(app)[method](url)).status, `${method} ${url}`).toBe(401);
    }
  });
});
