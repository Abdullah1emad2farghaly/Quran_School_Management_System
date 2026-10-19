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
  const requirePermission = t.requirePermission;
  app.use('/api/v1/organizations', createOrganizationRouter({ getService: () => t.registration, requireAuthentication, requirePermission, publicSubmissionLimit: limit() }));
  app.use('/api/v1/schools', createSchoolRouter({ getService: () => t.service, requireAuthentication, requirePermission, publicSubmissionLimit: limit() }));
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
    applicant: { name: 'أحمد محمد علي', phone: over.phone ?? '01112345678', password: 'Pass1234' },
    organization: { name: over.name ?? 'دار القرآن', countryId: over.countryId ?? t.country.id, governorateId: over.governorateId ?? t.gov.id, centerName: 'مركز غير مسجل' },
  });
  const schoolBody = (organizationId: string, over: { name?: string; governorateId?: string; countryId?: string } = {}) => ({
    organizationId,
    school: { name: over.name ?? 'الرئيسية', governorateId: over.governorateId ?? t.gov.id, ...(over.countryId ? { countryId: over.countryId } : {}), centerName: 'مركز غير مسجل', gps },
  });
  const submitForm = (over: { phone?: string; schoolName?: string; organizationId?: string } = {}) => ({
    applicant: { name: 'سارة أحمد علي', phone: over.phone ?? '01122223333', password: 'Pass1234' },
    organizationId: over.organizationId ?? t.org.id,
    school: { name: over.schoolName ?? 'مدرسة مقدمة', governorateId: t.gov.id, centerName: 'مركز حر', villageName: 'قرية حرة', gps },
  });
  /** A school created by the organization manager (PENDING), optionally approved (ACTIVE). */
  const makeSchool = async (name = 'الرئيسية', approve = false) => {
    const res = await request(app).post('/api/v1/schools').set(adminAuth).send(schoolBody(t.org.id, { name }));
    const school = res.body.data as { id: string; status: string; countryId: string };
    if (approve) await request(app).post(`/api/v1/schools/${school.id}/approve`).set(adminAuth);
    return school;
  };
  return { app, t, admin, adminAuth, login, orgForm, schoolBody, submitForm, makeSchool };
}

const orgs = '/api/v1/organizations';
const schools = '/api/v1/schools';

describe('POST /organizations (public registration)', () => {
  it('creates the applicant account, the organization and the organization-scoped ORGANIZATION_MANAGER (never MAIN_ADMIN), with no login (201, standard envelope)', async () => {
    const { app, t, orgForm } = await build();
    const res = await request(app).post(orgs).send(orgForm());
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      success: true,
      data: { organization: { name: 'دار القرآن', status: 'ACTIVE', countryId: t.country.id, address: { governorateId: t.gov.id, centerName: 'مركز غير مسجل', villageName: null } }, applicant: { accountCreated: true } },
    });
    expect(res.headers['x-request-id']).toBeTruthy();
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
    const user = await t.h.identity.findByPhone('+201112345678');
    expect(res.body.data.applicant.userId).toBe(user!.id);
    expect(await t.h.roles.listActiveRoles(user!.id)).toEqual(['ORGANIZATION_MANAGER']);
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
    const foreignGov = await request(app).post(orgs).send({ ...orgForm({ governorateId: t.paris.id }), organization: { ...orgForm().organization, governorateId: t.paris.id, centerName: null } });
    expect(foreignGov.body.error.code).toBe('ORGANIZATION_ADDRESS_COUNTRY_MISMATCH');
    const badPhone = await request(app).post(orgs).send(orgForm({ phone: '12345' }));
    expect(badPhone.body.error.code).toBe('INVALID_PHONE_NUMBER');
  });

  it('the applicant chooses the password: it is required for a new account (400 INVALID_PASSWORD), and the new manager can log in with it right away', async () => {
    const { app, t, orgForm, login } = await build();
    for (const password of [undefined, '', 'abc', 'x'.repeat(13)]) {
      const body = orgForm({ phone: '01123450000' });
      const res = await request(app).post(orgs).send({ ...body, applicant: { ...body.applicant, password } });
      expect(res.status).toBe(400);
      expect(['INVALID_PASSWORD', 'VALIDATION_FAILED']).toContain(res.body.error.code);
    }
    const ok = await request(app).post(orgs).send(orgForm({ phone: '01123450000', name: 'منظمة بكلمة مرور' }));
    expect(ok.status).toBe(201);
    expect(JSON.stringify(ok.body)).not.toContain('Pass1234');
    const session = await login({ phone: '01123450000', password: 'Pass1234' });
    expect(session.Authorization).toMatch(/^Bearer /);
    expect(t.org).toBeDefined();
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
    expect((await t.h.roles.listActiveRoles(teacher.id)).sort()).toEqual(['ORGANIZATION_MANAGER', 'TEACHER']);
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

  it('GET /organizations lists only the caller\'s organizations; GET /organizations/:id is denied (403) for another organization; both need a login', async () => {
    const { app, t, adminAuth, login } = await build();
    expect((await request(app).get(orgs)).status).toBe(401);
    const mine = await request(app).get(orgs).set(adminAuth);
    expect(mine.status).toBe(200);
    expect(mine.body.meta).toMatchObject({ total: 1 });
    expect(mine.body.data[0].id).toBe(t.org.id);
    expect((await request(app).get(`${orgs}/${t.org.id}`).set(adminAuth)).status).toBe(200);
    const otherAdmin = await login(await t.newOrgAdmin((await t.organizations.createOrganization({ name: 'Elsewhere', countryId: t.country.id, governorateId: t.gov.id })).id));
    const cross = await request(app).get(`${orgs}/${t.org.id}`).set(otherAdmin);
    expect([cross.status, cross.body.error.code]).toEqual([403, 'ACCESS_DENIED']);
    const platformAdmin = await login(await t.h.createUser({ role: 'MAIN_ADMIN' })); // the platform administrator is not an organization manager
    expect((await request(app).get(orgs).set(platformAdmin)).status).toBe(403);
    expect((await request(app).get(`${orgs}/${t.org.id}`).set(platformAdmin)).status).toBe(403);
    const roleOnly = await login(await t.h.createUser({ role: 'ORGANIZATION_MANAGER' })); // role without an organization link
    expect((await request(app).get(orgs).set(roleOnly)).body.meta.total).toBe(0);
    expect((await request(app).get(`${orgs}/${t.org.id}`).set(roleOnly)).status).toBe(403);
    expect((await request(app).get(`${orgs}/not-a-uuid`).set(adminAuth)).status).toBe(400);
  });
});

describe('POST /schools (authenticated, manager of the organization)', () => {
  it('creates a school under the manager\'s organization: PENDING, country from the organization, free-text center/village (201)', async () => {
    const { app, t, adminAuth, schoolBody } = await build();
    const res = await request(app).post(schools).set(adminAuth).send(schoolBody(t.org.id));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'PENDING', organizationId: t.org.id, countryId: t.country.id, centerName: 'مركز غير مسجل', villageName: null, applicantUserId: null });
    for (const removed of ['type', 'parentSchoolId', 'centerId', 'villageId']) expect(res.body.data).not.toHaveProperty(removed);
  });

  it('needs a login (401); another organization\'s manager, a platform administrator, and a user with only the role or only the link get 403 ACCESS_DENIED', async () => {
    const { app, t, schoolBody, login } = await build();
    expect((await request(app).post(schools).send(schoolBody(t.org.id))).status).toBe(401);
    const otherOrg = await t.organizations.createOrganization({ name: 'Elsewhere', countryId: t.country.id, governorateId: t.gov.id });
    const otherAdmin = await login(await t.newOrgAdmin(otherOrg.id));
    const cross = await request(app).post(schools).set(otherAdmin).send(schoolBody(t.org.id));
    expect([cross.status, cross.body.error.code]).toEqual([403, 'ACCESS_DENIED']);
    for (const role of ['MAIN_ADMIN', 'ORGANIZATION_MANAGER', 'SCHOOL_MANAGER'] as const) {
      const who = await login(await t.h.createUser({ role }));
      expect([role, (await request(app).post(schools).set(who).send(schoolBody(t.org.id))).status]).toEqual([role, 403]);
    }
    expect(t.schools.rows.size).toBe(0);
  });

  it('enforces the address rules: another country\'s governorate is refused, a village needs a center, a conflicting client country is refused', async () => {
    const { app, t, adminAuth, schoolBody } = await build();
    const foreign = await request(app).post(schools).set(adminAuth).send(schoolBody(t.org.id, { governorateId: t.paris.id }));
    expect([foreign.status, foreign.body.error.code]).toEqual([400, 'PARENT_ADDRESS_COUNTRY_MISMATCH']);
    const conflicting = await request(app).post(schools).set(adminAuth).send(schoolBody(t.org.id, { countryId: t.france.id, name: 'x' }));
    expect(conflicting.body.error.code).toBe('SCHOOL_COUNTRY_MISMATCH');
    const village = await request(app).post(schools).set(adminAuth).send({ ...schoolBody(t.org.id, { name: 'v' }), school: { ...schoolBody(t.org.id).school, centerName: null, villageName: 'قرية' } });
    expect(village.body.error.code).toBe('INVALID_PARENT_ADDRESS');
    const sameCountry = await request(app).post(schools).set(adminAuth).send(schoolBody(t.org.id, { countryId: t.country.id, name: 'y' }));
    expect(sameCountry.status).toBe(201);
  });

  it('validates the body (400); the obsolete registered ids are not accepted as the address', async () => {
    const { app, adminAuth, t } = await build();
    const res = await request(app).post(schools).set(adminAuth).send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    const wrongType = await request(app).post(schools).set(adminAuth).send({ organizationId: t.org.id, school: { name: 'n', governorateId: t.gov.id, centerName: 12, gps } });
    expect(wrongType.status).toBe(400);
  });
});

describe('POST /schools/submissions (public) and the approval flow', () => {
  it('creates a PENDING school with a new account and no role, then ONLY the owning organization manager approves it', async () => {
    const { app, t, submitForm, adminAuth, login } = await build();
    const submitted = await request(app).post(`${schools}/submissions`).send(submitForm());
    expect(submitted.status).toBe(201);
    expect(submitted.body.data.school).toMatchObject({ status: 'PENDING', organizationId: t.org.id, countryId: t.country.id, centerName: 'مركز حر', villageName: 'قرية حرة' });
    const applicantId = submitted.body.data.applicant.userId as string;
    expect(submitted.body.data.school.applicantUserId).toBe(applicantId);
    expect(await t.h.roles.listActiveRoles(applicantId)).toEqual([]);
    const id = submitted.body.data.school.id as string;

    // the manager of ANOTHER organization cannot approve or reject it
    const otherOrg = await t.organizations.createOrganization({ name: 'Elsewhere', countryId: t.country.id, governorateId: t.gov.id });
    const otherAdmin = await login(await t.newOrgAdmin(otherOrg.id));
    for (const [url, body] of [[`${schools}/${id}/approve`, {}], [`${schools}/${id}/reject`, { reason: 'x' }]] as const) {
      const denied = await request(app).post(url).set(otherAdmin).send(body);
      expect([url, denied.status, denied.body.error.code]).toEqual([url, 403, 'ACCESS_DENIED']);
    }
    expect((await t.service.getById(id)).status).toBe('PENDING');

    const approved = await request(app).post(`${schools}/${id}/approve`).set(adminAuth);
    expect(approved.status).toBe(200);
    expect(approved.body.data.school.status).toBe('ACTIVE');
    expect(approved.body.data.manager).toMatchObject({ userId: applicantId, isActive: true, source: 'APPROVAL' });
    expect(await t.h.roles.listActiveRoles(applicantId)).toEqual(['SCHOOL_MANAGER']);
    const again = await request(app).post(`${schools}/${id}/approve`).set(adminAuth);
    expect([again.status, again.body.error.code]).toEqual([422, 'SCHOOL_INVALID_STATUS_TRANSITION']);
  });

  it('approving a school created by the manager has no applicant: it becomes ACTIVE with manager null', async () => {
    const { app, adminAuth, makeSchool } = await build();
    const school = await makeSchool();
    expect(school.status).toBe('PENDING'); // never ACTIVE before approval
    const approved = await request(app).post(`${schools}/${school.id}/approve`).set(adminAuth);
    expect([approved.status, approved.body.data.school.status, approved.body.data.manager]).toEqual([200, 'ACTIVE', null]);
  });

  it('refuses an unknown organization (404-class) and a malformed organization id (400); the old Sub-School path does not exist', async () => {
    const { app, submitForm } = await build();
    const unknown = await request(app).post(`${schools}/submissions`).send(submitForm({ organizationId: '11111111-1111-4111-8111-111111111111' }));
    expect(unknown.body.error.code).toBe('ORGANIZATION_NOT_FOUND');
    expect((await request(app).post(`${schools}/submissions`).send(submitForm({ organizationId: 'nope' }))).status).toBe(400);
    expect((await request(app).post(`${schools}/sub-submissions`).send(submitForm())).status).toBe(404);
  });

  it('an existing phone is the IAM conflict (409) and creates nothing', async () => {
    const { app, t, submitForm } = await build();
    const owner = await t.h.createUser({ role: 'TEACHER' });
    const res = await request(app).post(`${schools}/submissions`).send(submitForm({ phone: owner.phone }));
    expect([res.status, res.body.error.code]).toEqual([409, 'USER_PHONE_ALREADY_EXISTS']);
    expect(await t.h.roles.listActiveRoles(owner.id)).toEqual(['TEACHER']);
  });

  it('rejection needs a reason (400), then records it and assigns nothing; the account survives', async () => {
    const { app, t, submitForm, adminAuth } = await build();
    const submitted = await request(app).post(`${schools}/submissions`).send(submitForm());
    const id = submitted.body.data.school.id as string;
    expect((await request(app).post(`${schools}/${id}/reject`).set(adminAuth).send({})).status).toBe(400);
    const rejected = await request(app).post(`${schools}/${id}/reject`).set(adminAuth).send({ reason: 'الموقع غير مناسب' });
    expect(rejected.body.data).toMatchObject({ status: 'REJECTED', rejectionReason: 'الموقع غير مناسب' });
    const applicantId = submitted.body.data.applicant.userId as string;
    expect(await t.h.roles.listActiveRoles(applicantId)).toEqual([]);
    expect(await t.h.identity.findById(applicantId)).toBeDefined();
  });

  it('the applicant chooses the password of the school request: required for a new account (400), then they can log in with it', async () => {
    const { app, login, submitForm } = await build();
    for (const password of [undefined, '', 'abc', 'x'.repeat(13)]) {
      const body = submitForm({ phone: '01166660000' });
      const res = await request(app).post(`${schools}/submissions`).send({ ...body, applicant: { ...body.applicant, password } });
      expect(res.status).toBe(400);
      expect(['INVALID_PASSWORD', 'VALIDATION_FAILED']).toContain(res.body.error.code);
    }
    const ok = await request(app).post(`${schools}/submissions`).send(submitForm({ phone: '01166660000', schoolName: 'مدرسة بكلمة مرور' }));
    expect(ok.status).toBe(201);
    expect(JSON.stringify(ok.body)).not.toContain('Pass1234');
    expect((await login({ phone: '01166660000', password: 'Pass1234' })).Authorization).toMatch(/^Bearer /);
  });

  it('limits public submissions per client (429)', async () => {
    const { app, submitForm } = await build({ maxSubmissions: 1 });
    expect((await request(app).post(`${schools}/submissions`).send(submitForm({ phone: '01133330001' }))).status).toBe(201);
    const limited = await request(app).post(`${schools}/submissions`).send(submitForm({ phone: '01133330002', schoolName: 'x' }));
    expect([limited.status, limited.body.error.code]).toEqual([429, 'RATE_LIMITED']);
  });
});

describe('organization scope on the school endpoints (enforced by the Authorization Engine)', () => {
  it('require authentication (401); another organization\'s manager, a teacher and the platform administrator are refused (403 ACCESS_DENIED) and nothing changes', async () => {
    const { app, t, submitForm, login, makeSchool } = await build();
    const active = await makeSchool('active one', true);
    const sub = (await request(app).post(`${schools}/submissions`).send(submitForm())).body.data.school.id as string;
    const otherOrg = await t.organizations.createOrganization({ name: 'Elsewhere', countryId: t.country.id, governorateId: t.gov.id });
    const otherAdmin = await login(await t.newOrgAdmin(otherOrg.id));
    const teacher = await login(await t.h.createUser({ role: 'TEACHER' }));
    const platformAdmin = await login(await t.h.createUser({ role: 'MAIN_ADMIN' }));
    const calls: [string, string, object?][] = [
      ['post', `${schools}/${sub}/approve`],
      ['post', `${schools}/${sub}/reject`, { reason: 'x' }],
      ['post', `${schools}/${active.id}/deactivate`],
      ['post', `${schools}/${active.id}/reactivate`],
      ['patch', `${schools}/${sub}/gps`, { gps }],
      ['put', `${schools}/${active.id}/manager`, { userId: '11111111-1111-4111-8111-111111111111' }],
      ['delete', `${schools}/${active.id}/manager`],
      ['get', schools],
      ['get', `${schools}/${sub}`],
    ];
    const call = (method: string, url: string) => (request(app) as unknown as Record<string, (u: string) => request.Test>)[method]!(url);
    for (const [method, url, body] of calls) expect([method, url, (await call(method, url).send(body ?? {})).status]).toEqual([method, url, 401]);
    for (const [method, url, body] of calls.slice(0, 7)) {
      for (const who of [otherAdmin, teacher, platformAdmin]) {
        const res = await call(method, url).set(who).send(body ?? {});
        expect([method, url, res.status, res.body.error?.code]).toEqual([method, url, 403, 'ACCESS_DENIED']);
      }
    }
    expect((await request(app).get(`${schools}/${sub}`).set(otherAdmin)).status).toBe(403); // not even readable
    expect((await request(app).get(schools).set(otherAdmin)).body.meta.total).toBe(0); // own organization has no schools
    expect((await request(app).get(schools).set(teacher)).status).toBe(403);
    expect((await request(app).get(schools).set(platformAdmin)).status).toBe(403);
    expect((await t.service.getById(sub)).status).toBe('PENDING');
    expect((await t.service.getById(active.id)).status).toBe('ACTIVE');
  });

  it('GET /schools lists what the caller may see (paginated, filtered); the organization manager can correct GPS, change status and assign/revoke a manager', async () => {
    const { app, t, submitForm, adminAuth, makeSchool } = await build();
    const school = await makeSchool('الرئيسية', true);
    const a = (await request(app).post(`${schools}/submissions`).send(submitForm({ phone: '01122226661', schoolName: 'مدرسة أ' }))).body.data;
    await request(app).post(`${schools}/submissions`).send(submitForm({ phone: '01122226662', schoolName: 'مدرسة ب' }));
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
    expect((await request(app).post(`${schools}/${school.id}/deactivate`).set(adminAuth)).body.data.status).toBe('INACTIVE');
    expect((await request(app).post(`${schools}/${school.id}/reactivate`).set(adminAuth)).body.data.status).toBe('ACTIVE');
    const manager = await t.h.createUser();
    const assigned = await request(app).put(`${schools}/${school.id}/manager`).set(adminAuth).send({ userId: manager.id });
    expect(assigned.body.data).toMatchObject({ userId: manager.id, isActive: true, source: 'ASSIGNMENT' });
    expect((await request(app).delete(`${schools}/${school.id}/manager`).set(adminAuth)).body.data.isActive).toBe(false);
  });

  it('a School Manager reads and lists ONLY their own school and cannot perform any management operation', async () => {
    const { app, t, adminAuth, login, makeSchool } = await build();
    const mine = await makeSchool('mine', true);
    const other = await makeSchool('other', true);
    const manager = await t.h.createUser({ role: 'TEACHER' });
    await request(app).put(`${schools}/${mine.id}/manager`).set(adminAuth).send({ userId: manager.id });
    const auth = await login(manager);
    expect((await request(app).get(`${schools}/${mine.id}`).set(auth)).status).toBe(200);
    expect((await request(app).get(`${schools}/${other.id}`).set(auth)).status).toBe(403);
    const list = await request(app).get(schools).set(auth);
    expect(list.body.data.map((s: { id: string }) => s.id)).toEqual([mine.id]);
    for (const [method, url] of [['post', `${schools}/${mine.id}/deactivate`], ['post', `${schools}/${mine.id}/approve`], ['put', `${schools}/${mine.id}/manager`], ['delete', `${schools}/${mine.id}/manager`]] as const) {
      const res = await (request(app) as unknown as Record<string, (u: string) => request.Test>)[method]!(url).set(auth).send({ userId: manager.id });
      expect([method, url, res.status]).toEqual([method, url, 403]);
    }
    expect((await request(app).post(schools).set(auth).send({ organizationId: t.org.id, school: { name: 'n', governorateId: t.gov.id, gps } })).status).toBe(403);
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
