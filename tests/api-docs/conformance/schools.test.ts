import express from 'express';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { registerAllErrorMessages } from '../../../src/app/bootstrap/register-error-messages';
import { errorHandler, notFoundHandler } from '../../../src/app/middleware/error-handler.middleware';
import { requestContextMiddleware } from '../../../src/app/middleware/request-context.middleware';
import { createAuthRouter, createRequireAuthentication } from '../../../src/modules/10-sessions-jwt/public';
import { createOrganizationRouter, createPublicSubmissionRateLimiter, createSchoolRouter } from '../../../src/modules/16-schools/public';
import { createSchoolsApiHarness } from '../../helpers/schools-api-harness';
import { ApiConformance } from '../support/conformance';

const gps = { latitude: 30.0444, longitude: 31.2357, accuracyMeters: 12 };
const orgs = '/api/v1/organizations';
const schools = '/api/v1/schools';
const UNKNOWN = '00000000-0000-4000-8000-000000000000';

async function build(maxSubmissions = 1000) {
  registerAllErrorMessages();
  const t = await createSchoolsApiHarness();
  const requireAuthentication = createRequireAuthentication(() => t.h.service);
  const limit = () => createPublicSubmissionRateLimiter({ maxRequests: maxSubmissions, windowMs: 60_000 });
  const app = express();
  app.use(requestContextMiddleware);
  app.use(express.json());
  app.use('/api/v1/organizations', createOrganizationRouter({ getService: () => t.registration, requireAuthentication, requirePermission: t.requirePermission, publicSubmissionLimit: limit() }));
  app.use('/api/v1/schools', createSchoolRouter({ getService: () => t.service, requireAuthentication, requirePermission: t.requirePermission, publicSubmissionLimit: limit() }));
  app.use('/api/v1/auth', createAuthRouter({ getService: () => t.h.service, requireAuthentication }));
  app.use(notFoundHandler);
  app.use(errorHandler);
  const login = async (u: { phone: string; password: string }) => {
    const res = await request(app).post('/api/v1/auth/login').send({ phone: u.phone, password: u.password });
    return { Authorization: `Bearer ${res.body.data.accessToken}` };
  };
  const admin = await t.newOrgAdmin(t.org.id);
  const auth = await login(admin);
  return { app, t, auth, login };
}

describe('Module 16 endpoints conform to their OpenAPI documentation (real responses)', () => {
  let api: ApiConformance;
  beforeAll(async () => {
    api = await ApiConformance.create();
  });

  it('organizations: register, list and get, with their error responses', async () => {
    const { app, t, auth } = await build();
    const form = (name: string, phone: string) => ({
      applicant: { name: 'أحمد محمد علي', phone, password: 'Pass1234' },
      organization: { name, countryId: t.country.id, governorateId: t.gov.id, centerName: 'مركز حر' },
    });
    const registered = api.conforms(await request(app).post(orgs).send(form('دار القرآن', '01112345678')));
    expect(registered.status).toBe(201);
    api.conforms(await request(app).post(orgs).send({}));
    expect(api.conforms(await request(app).post(orgs).send(form('دار القرآن', '01155556666'))).status).toBe(409); // name taken
    api.conforms(await request(app).post(orgs).send({ ...form('اسم آخر', '01166667777'), organization: { name: 'اسم آخر', countryId: t.france.id, governorateId: t.gov.id } })); // country mismatch
    api.conforms(await request(app).post(orgs).send({ ...form('اسم ثالث', '01177778888'), organization: { name: 'اسم ثالث', countryId: t.country.id, governorateId: UNKNOWN } })); // unknown governorate

    expect(api.conforms(await request(app).get(`${orgs}?page=1&pageSize=5&sort=name`).set(auth)).status).toBe(200);
    api.conforms(await request(app).get(orgs)); // 401
    expect(api.conforms(await request(app).get(`${orgs}/${t.org.id}`).set(auth)).status).toBe(200);
    expect(api.conforms(await request(app).get(`${orgs}/${registered.body.data.organization.id}`).set(auth)).status).toBe(403); // not its manager
  });

  it('schools: the whole workflow with its error responses', async () => {
    const { app, t, auth, login } = await build();
    const body = (name: string) => ({ organizationId: t.org.id, school: { name, governorateId: t.gov.id, centerName: 'مركز حر', gps } });
    const sub = (name: string, phone: string) => ({ applicant: { name: 'سارة أحمد علي', phone, password: 'Pass1234' }, organizationId: t.org.id, school: { name, governorateId: t.gov.id, gps } });

    // create (201, PENDING) and its errors
    const main = api.conforms(await request(app).post(schools).set(auth).send(body('الرئيسية')));
    expect(main.status).toBe(201);
    api.conforms(await request(app).post(schools).set(auth).send({}));
    expect(api.conforms(await request(app).post(schools).set(auth).send(body('الرئيسية'))).status).toBe(409);
    const outsider = await login(await t.h.createUser({ role: 'MAIN_ADMIN' }));
    expect(api.conforms(await request(app).post(schools).set(outsider).send(body('ممنوع'))).status).toBe(403);
    api.conforms(await request(app).post(schools).set(auth).send({ ...body('بعيد'), school: { name: 'بعيد', governorateId: t.paris.id, gps } })); // hierarchy/country
    api.conforms(await request(app).post(schools).send(body('بدون تسجيل'))); // 401

    // public submissions (201) and their errors
    const first = api.conforms(await request(app).post(`${schools}/submissions`).send(sub('الفرع 1', '01122223333')));
    expect(first.status).toBe(201);
    api.conforms(await request(app).post(`${schools}/submissions`).send({}));
    api.conforms(await request(app).post(`${schools}/submissions`).send({ ...sub('الفرع 2', '01133334444'), organizationId: UNKNOWN })); // unknown organization
    api.conforms(await request(app).post(`${schools}/submissions`).send(sub('الفرع 1', '01144445555'))); // name taken
    const second = api.conforms(await request(app).post(`${schools}/submissions`).send(sub('الفرع 3', '01155556666')));
    const third = api.conforms(await request(app).post(`${schools}/submissions`).send(sub('الفرع 4', '01166667777')));
    api.conforms(await request(app).post(`${schools}/submissions`).set({ Authorization: 'Bearer not-a-token' }).send(sub('الفرع 5', '01177778888'))); // invalid token

    // read
    expect(api.conforms(await request(app).get(`${schools}?page=1&pageSize=10&sort=-createdAt&filter[status]=PENDING,ACTIVE`).set(auth)).status).toBe(200);
    api.conforms(await request(app).get(schools)); // 401
    api.conforms(await request(app).get(schools).set(outsider)); // 403
    expect(api.conforms(await request(app).get(`${schools}/${first.body.data.school.id}`).set(auth)).status).toBe(200);
    expect(api.conforms(await request(app).get(`${schools}/${UNKNOWN}`).set(auth)).status).toBe(403); // the scope target does not exist: denied

    // PENDING: GPS correction, rejection, approval
    expect(api.conforms(await request(app).patch(`${schools}/${third.body.data.school.id}/gps`).set(auth).send({ gps })).status).toBe(200);
    api.conforms(await request(app).patch(`${schools}/${third.body.data.school.id}/gps`).set(auth).send({ gps: { ...gps, accuracyMeters: 500 } })); // accuracy
    api.conforms(await request(app).post(`${schools}/${second.body.data.school.id}/reject`).set(auth).send({ reason: '   ' }));
    expect(api.conforms(await request(app).post(`${schools}/${second.body.data.school.id}/reject`).set(auth).send({ reason: 'الموقع لا يطابق العنوان' })).status).toBe(200);
    api.conforms(await request(app).post(`${schools}/${second.body.data.school.id}/approve`).set(auth)); // REJECTED is terminal: 422
    const approved = api.conforms(await request(app).post(`${schools}/${first.body.data.school.id}/approve`).set(auth));
    expect(approved.status).toBe(200);
    api.conforms(await request(app).post(`${schools}/${first.body.data.school.id}/approve`).set(outsider)); // 403
    api.conforms(await request(app).patch(`${schools}/${first.body.data.school.id}/gps`).set(auth).send({ gps })); // locked after approval

    // status changes
    expect(api.conforms(await request(app).post(`${schools}/${first.body.data.school.id}/deactivate`).set(auth)).status).toBe(200);
    api.conforms(await request(app).post(`${schools}/${first.body.data.school.id}/deactivate`).set(auth)); // already INACTIVE: 422
    expect(api.conforms(await request(app).post(`${schools}/${first.body.data.school.id}/reactivate`).set(auth)).status).toBe(200);
    api.conforms(await request(app).post(`${schools}/${UNKNOWN}/reactivate`).set(auth)); // unknown school: denied

    // manager of an ACTIVE school created by the organization manager
    expect(api.conforms(await request(app).post(`${schools}/${main.body.data.id}/approve`).set(auth)).status).toBe(200);
    const candidate = await t.h.createUser();
    expect(api.conforms(await request(app).put(`${schools}/${main.body.data.id}/manager`).set(auth).send({ userId: candidate.id })).status).toBe(200);
    api.conforms(await request(app).put(`${schools}/${main.body.data.id}/manager`).set(auth).send({ userId: candidate.id })); // already has a manager: 409
    api.conforms(await request(app).put(`${schools}/${main.body.data.id}/manager`).set(auth).send({})); // 400
    expect(api.conforms(await request(app).delete(`${schools}/${main.body.data.id}/manager`).set(auth)).status).toBe(200);
    api.conforms(await request(app).delete(`${schools}/${main.body.data.id}/manager`).set(auth)); // no active manager: 404
  });

  it('answers 429 RATE_LIMITED with Retry-After on the public submissions, as documented', async () => {
    const { app, t } = await build(1);
    const form = (n: number) => ({
      applicant: { name: 'أحمد محمد علي', phone: `0111000000${n}`, password: 'Pass1234' },
      organization: { name: `منظمة ${n}`, countryId: t.country.id, governorateId: t.gov.id },
    });
    api.conforms(await request(app).post(orgs).send(form(1)));
    const limited = api.conforms(await request(app).post(orgs).send(form(2)));
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBeTruthy();
  });

  it('exercised every documented operation of Module 16', () => {
    expect(api.operationCount('16')).toBe(14);
    api.assertAllExercised('16');
  });
});
