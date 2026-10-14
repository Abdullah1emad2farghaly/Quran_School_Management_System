import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { registerAllErrorMessages } from '../../src/app/bootstrap/register-error-messages';
import { errorHandler, notFoundHandler } from '../../src/app/middleware/error-handler.middleware';
import { requestContextMiddleware } from '../../src/app/middleware/request-context.middleware';
import { createAuthRouter, createRequireAuthentication } from '../../src/modules/10-sessions-jwt/public';
import { createOrganizationRouter, createPublicSubmissionRateLimiter, createSchoolRouter } from '../../src/modules/16-schools/public';
import { createSchoolsApiHarness } from '../helpers/schools-api-harness';

const gps = { latitude: 30.0444, longitude: 31.2357, accuracyMeters: 12 };

async function build(options: { maxSubmissions?: number } = {}) {
  registerAllErrorMessages();
  const t = await createSchoolsApiHarness();
  const requireAuthentication = createRequireAuthentication(() => t.h.service);
  const limit = () => createPublicSubmissionRateLimiter({ maxRequests: options.maxSubmissions ?? 1000, windowMs: 60_000 });
  const app = express();
  app.use(requestContextMiddleware);
  app.use(express.json());
  app.use('/api/v1/organizations', createOrganizationRouter({ getService: () => t.registration, requireAuthentication, publicSubmissionLimit: limit() }));
  app.use('/api/v1/schools', createSchoolRouter({ getService: () => t.service, requireAuthentication, publicSubmissionLimit: limit() }));
  app.use('/api/v1/auth', createAuthRouter({ getService: () => t.h.service, requireAuthentication }));
  app.use(notFoundHandler);
  app.use(errorHandler);

  const login = async (u: { phone: string; password: string }) => {
    const res = await request(app).post('/api/v1/auth/login').send({ phone: u.phone, password: u.password });
    return { Authorization: `Bearer ${res.body.data.accessToken}` };
  };
  const admin = await t.newOrgAdmin(t.org.id);
  const adminAuth = await login(admin);
  const orgForm = (over: { phone?: string; name?: string; countryId?: string; governorateId?: string } = {}) => ({
    applicant: { name: 'أحمد محمد', phone: over.phone ?? '01112345678' },
    organization: { name: over.name ?? 'دار القرآن', countryId: over.countryId ?? t.country.id, governorateId: over.governorateId ?? t.gov.id, centerId: t.center.id },
  });
  const schoolBody = (organizationId: string, over: { name?: string; governorateId?: string; countryId?: string } = {}) => ({
    organizationId,
    school: { name: over.name ?? 'الرئيسية', governorateId: over.governorateId ?? t.gov.id, ...(over.countryId ? { countryId: over.countryId } : {}), gps },
  });
  const subForm = (parentSchoolId: string, over: { phone?: string; schoolName?: string } = {}) => ({
    applicant: { name: 'سارة', phone: over.phone ?? '01122223333' },
    parentSchoolId,
    school: { name: over.schoolName ?? 'الفرع', governorateId: t.gov.id, gps },
  });
  const mainSchool = async (name = 'الرئيسية') => {
    const res = await request(app).post('/api/v1/schools').set(adminAuth).send(schoolBody(t.org.id, { name }));
    return res.body.data as { id: string; status: string; countryId: string };
  };
  return { app, t, admin, adminAuth, login, orgForm, schoolBody, subForm, mainSchool };
}

const orgs = '/api/v1/organizations';
const schools = '/api/v1/schools';

describe('POST /organizations (public registration)', () => {
  it('creates the applicant account, the organization and the organization-scoped MAIN_ADMIN, with no login (201, standard envelope)', async () => {
    const { app, t, orgForm } = await build();
    const res = await request(app).post(orgs).send(orgForm());
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      success: true,
      data: { organization: { name: 'دار القرآن', status: 'ACTIVE', countryId: t.country.id, address: { governorateId: t.gov.id, centerId: t.center.id, villageId: null } }, applicant: { accountCreated: true } },
    });
    expect(res.headers['x-request-id']).toBeTruthy();
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
    const user = await t.h.identity.findByPhone('+201112345678');
    expect(res.body.data.applicant.userId).toBe(user!.id);
    expect(await t.h.roles.listActiveRoles(user!.id)).toEqual(['MAIN_ADMIN']);
    expect(await t.organizations.isOrganizationAdmin(user!.id, res.body.data.organization.id)).toBe(true);
    expect(await t.organizations.isOrganizationAdmin(user!.id, t.org.id)).toBe(false); // the other organization is out of scope
    expect(JSON.stringify(res.body)).not.toMatch(/password|token/i);
  });

  it('validates the body (400 with field errors) and the geography on the server', async () => {
    const { app, t, orgForm } = await build();
    const empty = await request(app).post(orgs).send({});
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe('VALIDATION_FAILED');
    const fields = (empty.body.error.details.fields as { field: string }[]).map((d) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['applicant.name', 'applicant.phone', 'organization.name', 'organization.countryId', 'organization.governorateId']));
    const mismatch = await request(app).post(orgs).send(orgForm({ countryId: t.france.id }));
    expect(mismatch.body.error.code).toBe('ORGANIZATION_ADDRESS_COUNTRY_MISMATCH');
    const foreignGov = await request(app).post(orgs).send({ ...orgForm({ governorateId: t.paris.id }), organization: { ...orgForm().organization, governorateId: t.paris.id, centerId: null } });
    expect(foreignGov.body.error.code).toBe('ORGANIZATION_ADDRESS_COUNTRY_MISMATCH');
    const badPhone = await request(app).post(orgs).send(orgForm({ phone: '12345' }));
    expect(badPhone.body.error.code).toBe('INVALID_PHONE_NUMBER');
  });

  it('answers a duplicate organization name with 409 (system-wide, case-insensitive) and an existing phone with the IAM conflict', async () => {
    const { app, t, orgForm } = await build();
    expect((await request(app).post(orgs).send(orgForm({ name: 'Dar Al-Quran' }))).status).toBe(201);
    const dup = await request(app).post(orgs).send(orgForm({ name: 'dar al-quran', phone: '01199990001' }));
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('ORGANIZATION_NAME_ALREADY_EXISTS');
    expect(await t.h.identity.findByPhone('+201199990001')).toBeUndefined(); // the account was rolled back
    const owner = await t.h.createUser({ role: 'TEACHER' });
    const phone = await request(app).post(orgs).send(orgForm({ name: 'Another', phone: owner.phone }));
    expect(phone.status).toBe(409);
    expect(phone.body.error.code).toBe('USER_PHONE_ALREADY_EXISTS');
    expect(await t.h.roles.listActiveRoles(owner.id)).toEqual(['TEACHER']);
  });

  it('lets a logged-in user register as themselves; an invalid token is a 401; a different phone is refused', async () => {
    const { app, t, orgForm, login } = await build();
    const teacher = await t.h.createUser({ role: 'TEACHER' });
    const auth = await login(teacher);
    const ok = await request(app).post(orgs).set(auth).send(orgForm({ phone: teacher.phone }));
    expect(ok.status).toBe(201);
    expect(ok.body.data.applicant).toEqual({ userId: teacher.id, accountCreated: false });
    expect((await t.h.roles.listActiveRoles(teacher.id)).sort()).toEqual(['MAIN_ADMIN', 'TEACHER']);
    const mismatch = await request(app).post(orgs).set(auth).send(orgForm({ phone: '01155550000', name: 'Other' }));
    expect(mismatch.body.error.code).toBe('SCHOOL_APPLICANT_IDENTITY_MISMATCH');
    expect((await request(app).post(orgs).set('Authorization', 'Bearer nope').send(orgForm({ name: 'Third' }))).status).toBe(401);
  });

  it('limits public registrations per client (429 with Retry-After)', async () => {
    const { app, orgForm } = await build({ maxSubmissions: 2 });
    for (let i = 0; i < 2; i += 1) expect((await request(app).post(orgs).send(orgForm({ phone: `0111000000${i}`, name: `o${i}` }))).status).toBe(201);
    const limited = await request(app).post(orgs).send(orgForm());
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('GET /organizations lists only the caller\'s organizations; GET /organizations/:id hides the others (404); both need a login', async () => {
    const { app, t, adminAuth, login } = await build();
    expect((await request(app).get(orgs)).status).toBe(401);
    const mine = await request(app).get(orgs).set(adminAuth);
    expect(mine.status).toBe(200);
    expect(mine.body.meta).toMatchObject({ total: 1 });
    expect(mine.body.data[0].id).toBe(t.org.id);
    expect((await request(app).get(`${orgs}/${t.org.id}`).set(adminAuth)).status).toBe(200);
    const otherAdmin = await login(await t.newOrgAdmin((await t.organizations.createOrganization({ name: 'Elsewhere', countryId: t.country.id, governorateId: t.gov.id })).id));
    expect((await request(app).get(`${orgs}/${t.org.id}`).set(otherAdmin)).status).toBe(404);
    const roleOnly = await login(await t.h.createUser({ role: 'MAIN_ADMIN' })); // MAIN_ADMIN role without an organization link
    expect((await request(app).get(orgs).set(roleOnly)).body.meta.total).toBe(0);
    expect((await request(app).get(`${orgs}/not-a-uuid`).set(adminAuth)).status).toBe(400);
  });
});

describe('POST /schools (authenticated, administrator of the organization)', () => {
  it('creates a Main School under an existing organization, deriving the country from it (201)', async () => {
    const { app, t, adminAuth, schoolBody } = await build();
    const res = await request(app).post(schools).set(adminAuth).send(schoolBody(t.org.id));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ type: 'MAIN', status: 'ACTIVE', organizationId: t.org.id, countryId: t.country.id });
  });

  it('needs a login (401); another organization\'s administrator and a user with only the role or only the link get 403', async () => {
    const { app, t, schoolBody, login } = await build();
    expect((await request(app).post(schools).send(schoolBody(t.org.id))).status).toBe(401);
    const otherOrg = await t.organizations.createOrganization({ name: 'Elsewhere', countryId: t.country.id, governorateId: t.gov.id });
    const otherAdmin = await login(await t.newOrgAdmin(otherOrg.id));
    const cross = await request(app).post(schools).set(otherAdmin).send(schoolBody(t.org.id));
    expect([cross.status, cross.body.error.code]).toEqual([403, 'SCHOOL_ACTION_NOT_ALLOWED']);
    const roleOnly = await login(await t.h.createUser({ role: 'MAIN_ADMIN' }));
    expect((await request(app).post(schools).set(roleOnly).send(schoolBody(t.org.id))).status).toBe(403);
  });

  it('enforces the country invariant: another country\'s governorate or a conflicting client country is refused', async () => {
    const { app, t, adminAuth, schoolBody } = await build();
    const foreign = await request(app).post(schools).set(adminAuth).send(schoolBody(t.org.id, { governorateId: t.paris.id }));
    expect([foreign.status, foreign.body.error.code]).toEqual([400, 'SCHOOL_COUNTRY_MISMATCH']);
    const conflicting = await request(app).post(schools).set(adminAuth).send(schoolBody(t.org.id, { countryId: t.france.id, name: 'x' }));
    expect(conflicting.body.error.code).toBe('SCHOOL_COUNTRY_MISMATCH');
    const sameCountry = await request(app).post(schools).set(adminAuth).send(schoolBody(t.org.id, { countryId: t.country.id, name: 'y' }));
    expect(sameCountry.status).toBe(201);
  });

  it('validates the body (400)', async () => {
    const { app, adminAuth } = await build();
    const res = await request(app).post(schools).set(adminAuth).send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('POST /schools/sub-submissions (public) and the approval flow', () => {
  it('creates a PENDING request with a new account and no role, then the organization administrator approves it', async () => {
    const { app, t, subForm, adminAuth, mainSchool } = await build();
    const parent = await mainSchool();
    const submitted = await request(app).post(`${schools}/sub-submissions`).send(subForm(parent.id));
    expect(submitted.status).toBe(201);
    expect(submitted.body.data.school).toMatchObject({ type: 'SUB', status: 'PENDING', parentSchoolId: parent.id, organizationId: t.org.id, countryId: t.country.id });
    const applicantId = submitted.body.data.applicant.userId as string;
    expect(await t.h.roles.listActiveRoles(applicantId)).toEqual([]);

    const approved = await request(app).post(`${schools}/${submitted.body.data.school.id}/approve`).set(adminAuth);
    expect(approved.status).toBe(200);
    expect(approved.body.data.manager).toMatchObject({ userId: applicantId, isActive: true });
    expect(await t.h.roles.listActiveRoles(applicantId)).toEqual(['SCHOOL_MANAGER']);
    const again = await request(app).post(`${schools}/${submitted.body.data.school.id}/approve`).set(adminAuth);
    expect([again.status, again.body.error.code]).toEqual([422, 'SCHOOL_INVALID_STATUS_TRANSITION']);
  });

  it('refuses an unknown parent (422) and a malformed parent id (400)', async () => {
    const { app, subForm } = await build();
    const unknown = await request(app).post(`${schools}/sub-submissions`).send(subForm('11111111-1111-4111-8111-111111111111'));
    expect([unknown.status, unknown.body.error.code]).toEqual([422, 'SCHOOL_PARENT_INVALID']);
    expect((await request(app).post(`${schools}/sub-submissions`).send(subForm('nope'))).status).toBe(400);
  });

  it('an existing phone is the IAM conflict (409) and creates nothing', async () => {
    const { app, t, subForm, mainSchool } = await build();
    const parent = await mainSchool();
    const owner = await t.h.createUser({ role: 'TEACHER' });
    const res = await request(app).post(`${schools}/sub-submissions`).send(subForm(parent.id, { phone: owner.phone }));
    expect([res.status, res.body.error.code]).toEqual([409, 'USER_PHONE_ALREADY_EXISTS']);
    expect(await t.h.roles.listActiveRoles(owner.id)).toEqual(['TEACHER']);
  });

  it('rejection needs a reason (400), then records it and assigns nothing; the account survives', async () => {
    const { app, t, subForm, adminAuth, mainSchool } = await build();
    const parent = await mainSchool();
    const submitted = await request(app).post(`${schools}/sub-submissions`).send(subForm(parent.id));
    const id = submitted.body.data.school.id as string;
    expect((await request(app).post(`${schools}/${id}/reject`).set(adminAuth).send({})).status).toBe(400);
    const rejected = await request(app).post(`${schools}/${id}/reject`).set(adminAuth).send({ reason: 'الموقع غير مناسب' });
    expect(rejected.body.data).toMatchObject({ status: 'REJECTED', rejectionReason: 'الموقع غير مناسب' });
    const applicantId = submitted.body.data.applicant.userId as string;
    expect(await t.h.roles.listActiveRoles(applicantId)).toEqual([]);
    expect(await t.h.identity.findById(applicantId)).toBeDefined();
  });

  it('limits public submissions per client (429)', async () => {
    const { app, subForm, mainSchool } = await build({ maxSubmissions: 1 });
    const parent = await mainSchool();
    expect((await request(app).post(`${schools}/sub-submissions`).send(subForm(parent.id, { phone: '01133330001' }))).status).toBe(201);
    const limited = await request(app).post(`${schools}/sub-submissions`).send(subForm(parent.id, { phone: '01133330002', schoolName: 'x' }));
    expect([limited.status, limited.body.error.code]).toEqual([429, 'RATE_LIMITED']);
  });
});

describe('organization scope on the school endpoints', () => {
  it('require authentication (401), and another organization\'s administrator is refused (403) or told "not found" (404)', async () => {
    const { app, t, subForm, login, mainSchool } = await build();
    const parent = await mainSchool();
    const sub = (await request(app).post(`${schools}/sub-submissions`).send(subForm(parent.id))).body.data.school.id as string;
    const otherOrg = await t.organizations.createOrganization({ name: 'Elsewhere', countryId: t.country.id, governorateId: t.gov.id });
    const otherAdmin = await login(await t.newOrgAdmin(otherOrg.id));
    const teacher = await login(await t.h.createUser({ role: 'TEACHER' }));
    const calls: [string, string, object?][] = [
      ['post', `${schools}/${sub}/approve`],
      ['post', `${schools}/${sub}/reject`, { reason: 'x' }],
      ['post', `${schools}/${parent.id}/deactivate`],
      ['post', `${schools}/${parent.id}/reactivate`],
      ['patch', `${schools}/${sub}/gps`, { gps }],
      ['put', `${schools}/${parent.id}/manager`, { userId: '11111111-1111-4111-8111-111111111111' }],
      ['delete', `${schools}/${parent.id}/manager`],
      ['get', schools],
      ['get', `${schools}/${sub}`],
    ];
    const call = (method: string, url: string) => (request(app) as unknown as Record<string, (u: string) => request.Test>)[method]!(url);
    for (const [method, url, body] of calls) expect([method, url, (await call(method, url).send(body ?? {})).status]).toEqual([method, url, 401]);
    for (const [method, url, body] of calls.slice(0, 7)) {
      for (const who of [otherAdmin, teacher]) {
        const res = await call(method, url).set(who).send(body ?? {});
        expect([method, url, res.status, res.body.error?.code]).toEqual([method, url, 403, 'SCHOOL_ACTION_NOT_ALLOWED']);
      }
    }
    expect((await request(app).get(`${schools}/${sub}`).set(otherAdmin)).status).toBe(404);
    expect((await request(app).get(schools).set(otherAdmin)).body.meta.total).toBe(0);
    expect((await t.service.getById(sub)).status).toBe('PENDING');
  });

  it('GET /schools lists what the caller may see (paginated, filtered); the organization administrator can correct GPS, change status and assign/revoke a manager', async () => {
    const { app, t, subForm, adminAuth, mainSchool } = await build();
    const parent = await mainSchool();
    const a = (await request(app).post(`${schools}/sub-submissions`).send(subForm(parent.id, { phone: '01122226661', schoolName: 'فرع أ' }))).body.data;
    await request(app).post(`${schools}/sub-submissions`).send(subForm(parent.id, { phone: '01122226662', schoolName: 'فرع ب' }));
    const all = await request(app).get(schools).set(adminAuth).query({ pageSize: 2, sort: 'code' });
    expect(all.status).toBe(200);
    expect(all.body.meta).toMatchObject({ page: 1, pageSize: 2, total: 3, totalPages: 2 });
    expect((await request(app).get(schools).set(adminAuth).query({ 'filter[status]': 'PENDING' })).body.meta.total).toBe(2);
    expect((await request(app).get(schools).set(adminAuth).query({ bogus: '1' })).status).toBe(400);
    expect((await request(app).get(`${schools}/not-a-uuid`).set(adminAuth)).status).toBe(400);

    const fix = { latitude: 30.05, longitude: 31.24, accuracyMeters: 8 };
    expect((await request(app).patch(`${schools}/${a.school.id}/gps`).set(adminAuth).send({ gps: fix })).body.data.gps).toEqual(fix);
    await request(app).post(`${schools}/${a.school.id}/approve`).set(adminAuth);
    expect((await request(app).patch(`${schools}/${a.school.id}/gps`).set(adminAuth).send({ gps })).body.error.code).toBe('SCHOOL_GPS_LOCKED');
    expect((await request(app).post(`${schools}/${parent.id}/deactivate`).set(adminAuth)).body.data.status).toBe('INACTIVE');
    expect((await request(app).post(`${schools}/${parent.id}/reactivate`).set(adminAuth)).body.data.status).toBe('ACTIVE');
    const manager = await t.h.createUser();
    const assigned = await request(app).put(`${schools}/${parent.id}/manager`).set(adminAuth).send({ userId: manager.id });
    expect(assigned.body.data).toMatchObject({ userId: manager.id, isActive: true, source: 'MAIN_ADMIN_ASSIGNMENT' });
    expect((await request(app).delete(`${schools}/${parent.id}/manager`).set(adminAuth)).body.data.isActive).toBe(false);
  });
});

describe('no account takeover through a phone number', () => {
  it('a known phone neither logs in nor returns the account: the registration conflicts, and the new account has no phone-derived password', async () => {
    const { app, t, orgForm } = await build();
    expect((await request(app).post(orgs).send(orgForm({ phone: '01166667777', name: 'First' }))).status).toBe(201);
    for (const password of ['7777', '01166667777', '+201166667777']) {
      const login = await request(app).post('/api/v1/auth/login').send({ phone: '01166667777', password });
      expect([password, login.status]).toEqual([password, 401]);
    }
    const second = await request(app).post(orgs).send(orgForm({ phone: '+20 116 666 7777', name: 'Second' }));
    expect(second.status).toBe(409);
    expect(second.body.data).toBeUndefined();
    expect((await t.organizations.listAdministeredOrganizationIds((await t.h.identity.findByPhone('+201166667777'))!.id)).length).toBe(1);
  });
});
