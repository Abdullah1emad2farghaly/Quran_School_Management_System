import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { IMPORTS, createExcelImportApi } from '../../helpers/excel-import-api-harness';
import { validRow, workbook } from '../../helpers/excel-import-harness';
import { ApiConformance } from '../support/conformance';

const UNKNOWN = '00000000-0000-4000-8000-000000000000';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

describe('Module 36 endpoints conform to their OpenAPI documentation (real responses)', () => {
  let api: ApiConformance;
  beforeAll(async () => {
    api = await ApiConformance.create();
  });

  it('template, upload, read, confirm and cancel, with their error responses', async () => {
    const { app, t, login } = await createExcelImportApi();
    const school = await t.newSchool('مدرسة أ');
    const school2 = await t.newSchool('مدرسة ب');
    const manager = await t.newSchoolManager(school.id);
    const manager2 = await t.newSchoolManager(school2.id);
    const auth = await login(manager);
    const auth2 = await login(manager2);
    const parent = await t.newParent(school.id, manager.id);
    const parentAuth = await login(await t.h.identity.findById(parent.userId).then((u) => ({ phone: u!.phone, password: u!.phone.slice(-4) })));
    const upload = (headers: Record<string, string>, data: Buffer | undefined, query = '') => {
      const r = request(app).post(`${IMPORTS}/previews${query}`).set(headers);
      return data ? r.attach('file', data, { filename: 'students.xlsx', contentType: XLSX }) : r;
    };

    // template (binary)
    const template = api.conforms(await request(app).get(`${IMPORTS}/template?language=ar`).set(auth));
    expect(template.status).toBe(200);
    expect(template.headers['content-type']).toContain('spreadsheetml');
    expect(template.headers['content-disposition']).toContain('attachment');
    expect(api.conforms(await request(app).get(`${IMPORTS}/template`).set('Accept-Language', 'en').set(auth)).status).toBe(200);
    api.conforms(await request(app).get(`${IMPORTS}/template?language=fr`).set(auth)); // 400
    api.conforms(await request(app).get(`${IMPORTS}/template`)); // 401
    api.conforms(await request(app).get(`${IMPORTS}/template`).set(parentAuth)); // 403

    // upload -> preview
    const created = api.conforms(await upload(auth, workbook([validRow()])));
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ status: 'PENDING', canConfirm: true, schoolId: school.id });
    const id = created.body.data.id as string;
    api.conforms(await upload(auth, undefined)); // 400 no file
    api.conforms(await upload(auth, Buffer.from(JSON.stringify({ rows: [['x']] })))); // 400 header not found
    api.conforms(await upload(auth2, workbook([validRow()]), `?schoolId=${school.id}`)); // 403: not their school
    api.conforms(await upload({}, workbook([validRow()]))); // 401
    api.conforms(await upload(parentAuth, workbook([validRow()]))); // 403

    // read
    expect(api.conforms(await request(app).get(`${IMPORTS}/previews/${id}?page=1&pageSize=10`).set(auth)).status).toBe(200);
    api.conforms(await request(app).get(`${IMPORTS}/previews/${id}`).set(auth2)); // 403: someone else's preview
    api.conforms(await request(app).get(`${IMPORTS}/previews/${UNKNOWN}`).set(auth)); // 403 (unknown targets grant nothing)
    api.conforms(await request(app).get(`${IMPORTS}/previews/not-a-uuid`).set(auth)); // 400

    // confirm
    const bad = api.conforms(await upload(auth, workbook([validRow('ar', { studentNationalId: '12' })])));
    expect(bad.body.data.canConfirm).toBe(false);
    api.conforms(await request(app).post(`${IMPORTS}/previews/${bad.body.data.id}/confirm`).set(auth)); // 422 blocked
    api.conforms(await request(app).post(`${IMPORTS}/previews/${id}/confirm`).set(auth2)); // 403
    const confirmed = api.conforms(await request(app).post(`${IMPORTS}/previews/${id}/confirm`).set(auth));
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data).toMatchObject({ status: 'CONFIRMED', result: { studentsCreated: 1, groupsCreated: 1 } });
    api.conforms(await request(app).post(`${IMPORTS}/previews/${id}/confirm`).set(auth)); // 409 not pending

    // cancel
    const toCancel = api.conforms(await upload(auth, workbook([validRow('ar', { groupName: 'حلقة العصر' })])));
    const cancelled = api.conforms(await request(app).post(`${IMPORTS}/previews/${toCancel.body.data.id}/cancel`).set(auth));
    expect(cancelled.body.data.status).toBe('CANCELLED');
    api.conforms(await request(app).post(`${IMPORTS}/previews/${toCancel.body.data.id}/cancel`).set(auth)); // 409
    api.conforms(await request(app).post(`${IMPORTS}/previews/${id}/cancel`).set(auth2)); // 403

    // expired
    const old = api.conforms(await upload(auth, workbook([validRow('ar', { groupName: 'حلقة المغرب' })])));
    t.h.advance(25 * 3_600_000);
    api.conforms(await request(app).get(`${IMPORTS}/previews/${old.body.data.id}`).set(auth)); // 422 expired
  });

  it('every documented operation was exercised with its success response', () => {
    expect(api.operationCount('36')).toBe(5);
    api.assertAllExercised('36');
  });
});
