import express from 'express';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { registerAllErrorMessages } from '../../../src/app/bootstrap/register-error-messages';
import { errorHandler, notFoundHandler } from '../../../src/app/middleware/error-handler.middleware';
import { requestContextMiddleware } from '../../../src/app/middleware/request-context.middleware';
import { createAuthRouter, createRequireAuthentication } from '../../../src/modules/10-sessions-jwt/public';
import { createOrganizationRouter, createPublicSubmissionRateLimiter } from '../../../src/modules/16-schools/public';
import { createSchoolsApiHarness } from '../../helpers/schools-api-harness';

const ORGS = '/api/v1/organizations';

async function build() {
  registerAllErrorMessages();
  const t = await createSchoolsApiHarness();
  const requireAuthentication = createRequireAuthentication(() => t.h.service);
  const app = express();
  app.use(requestContextMiddleware);
  app.use(express.json());
  app.use(ORGS, createOrganizationRouter({ getService: () => t.registration, requireAuthentication, requirePermission: t.requirePermission, publicSubmissionLimit: createPublicSubmissionRateLimiter({ maxRequests: 1000, windowMs: 60_000 }) }));
  app.use('/api/v1/auth', createAuthRouter({ getService: () => t.h.service, requireAuthentication }));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return { app, t };
}

describe('GET /organizations/lookup (public registration lookup)', () => {
  beforeAll(() => registerAllErrorMessages());

  it('is anonymous and returns only { id, name } of real organizations that may receive school submissions', async () => {
    const { app, t } = await build();
    const second = await t.organizations.createOrganization({ name: 'Al-Huda', countryId: t.country.id, governorateId: t.gov.id });
    const res = await request(app).get(`${ORGS}/lookup`); // no Authorization header
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      { id: t.org.id, name: 'Al-Noor' },
      { id: second.id, name: 'Al-Huda' },
    ].sort((a, b) => (a.name < b.name ? -1 : 1)));
    for (const item of res.body.data) expect(Object.keys(item).sort()).toEqual(['id', 'name']);
    expect(res.body.meta).toMatchObject({ page: 1, total: 2 });
  });

  it('exposes no private organization data: no code, status, country, address, administrator or timestamps anywhere in the body', async () => {
    const { app, t } = await build();
    const text = JSON.stringify((await request(app).get(`${ORGS}/lookup`)).body);
    const row = (await t.organizations.requireById(t.org.id));
    for (const secret of [row.code, row.countryId, row.governorateId, 'ACTIVE', 'countryId', 'governorateId', 'centerName', 'villageName', 'createdAt', 'code', 'status']) {
      expect(text, String(secret)).not.toContain(String(secret));
    }
  });

  it('excludes organizations that may not receive school submissions (INACTIVE, or without a country)', async () => {
    const { app, t } = await build();
    const inactive = await t.organizations.createOrganization({ name: 'Dormant', countryId: t.country.id, governorateId: t.gov.id });
    const noCountry = await t.organizations.createOrganization({ name: 'Countryless', countryId: t.country.id, governorateId: t.gov.id });
    t.orgRepo.rows.set(inactive.id, { ...t.orgRepo.rows.get(inactive.id)!, status: 'INACTIVE' });
    t.orgRepo.rows.set(noCountry.id, { ...t.orgRepo.rows.get(noCountry.id)!, countryId: null });
    const res = await request(app).get(`${ORGS}/lookup`);
    expect(res.body.data).toEqual([{ id: t.org.id, name: 'Al-Noor' }]);
  });

  it('is paginated like every list and rejects unknown parameters', async () => {
    const { app, t } = await build();
    for (const name of ['B org', 'C org', 'A org']) await t.organizations.createOrganization({ name, countryId: t.country.id, governorateId: t.gov.id });
    const page = await request(app).get(`${ORGS}/lookup`).query({ page: 2, pageSize: 2 });
    expect(page.status).toBe(200);
    expect(page.body.data.map((o: { name: string }) => o.name)).toEqual(['B org', 'C org']);
    expect(page.body.meta).toMatchObject({ page: 2, pageSize: 2, total: 4, totalPages: 2 });
    expect((await request(app).get(`${ORGS}/lookup?filter[code]=x`)).status).toBe(400);
    expect((await request(app).get(`${ORGS}/lookup?foo=1`)).status).toBe(400);
  });

  it('"lookup" is never read as an organization id, and the protected endpoints are unchanged (401 without a token)', async () => {
    const { app, t } = await build();
    expect((await request(app).get(`${ORGS}/lookup`)).status).toBe(200);
    const list = await request(app).get(ORGS);
    expect([list.status, list.body.error.code]).toEqual([401, 'AUTHENTICATION_REQUIRED']);
    const one = await request(app).get(`${ORGS}/${t.org.id}`);
    expect([one.status, one.body.error.code]).toEqual([401, 'AUTHENTICATION_REQUIRED']);
  });

  it('the authenticated list keeps its full contract (only the organizations the caller administers, full organization shape)', async () => {
    const { app, t } = await build();
    const admin = await t.newOrgAdmin(t.org.id);
    const login = await request(app).post('/api/v1/auth/login').send({ phone: admin.phone, password: admin.password });
    const list = await request(app).get(ORGS).set({ Authorization: `Bearer ${login.body.data.accessToken}` });
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(Object.keys(list.body.data[0]).length).toBeGreaterThan(2);
    expect(list.body.data[0]).toMatchObject({ id: t.org.id, name: 'Al-Noor', status: 'ACTIVE' });
  });
});
