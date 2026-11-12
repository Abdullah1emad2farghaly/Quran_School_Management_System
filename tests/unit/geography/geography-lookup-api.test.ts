import express from 'express';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { registerAllErrorMessages } from '../../../src/app/bootstrap/register-error-messages';
import { errorHandler, notFoundHandler } from '../../../src/app/middleware/error-handler.middleware';
import { requestContextMiddleware } from '../../../src/app/middleware/request-context.middleware';
import { createGeographyRouter, geographyApiDoc } from '../../../src/modules/14-geography/public';
import { createSchoolsHarness } from '../../helpers/schools-harness';

const GEO = '/api/v1/geography';
const UNKNOWN = '00000000-0000-4000-8000-000000000000';

async function build() {
  registerAllErrorMessages();
  const t = await createSchoolsHarness();
  const app = express();
  app.use(requestContextMiddleware);
  app.use(express.json());
  app.use(GEO, createGeographyRouter({ getGeography: () => t.geography, getOrganizations: () => t.organizations }));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return { app, t };
}

describe('GET /geography/countries and /geography/governorates (public registration lookups)', () => {
  beforeAll(() => registerAllErrorMessages());

  it('countries: anonymous (no Authorization header), real records, only { id, name }', async () => {
    const { app, t } = await build();
    const res = await request(app).get(`${GEO}/countries`); // no token at all
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([
      { id: t.country.id, name: t.country.name },
      { id: t.france.id, name: t.france.name },
    ]);
    for (const item of res.body.data) expect(Object.keys(item).sort()).toEqual(['id', 'name']); // no code, status, level, parentId
  });

  it('countries: only ACTIVE countries are offered (the existing Geography status rule)', async () => {
    const { app, t } = await build();
    t.geoRepo.setStatus(t.france.id, 'INACTIVE');
    const res = await request(app).get(`${GEO}/countries`);
    expect(res.body.data.map((c: { id: string }) => c.id)).toEqual([t.country.id]);
  });

  it('governorates by countryId: only that country\'s governorates, only { id, name }, anonymous', async () => {
    const { app, t } = await build();
    const egypt = await request(app).get(`${GEO}/governorates`).query({ countryId: t.country.id });
    expect(egypt.status).toBe(200);
    expect(egypt.body.data).toEqual([
      { id: t.gov.id, name: t.gov.name },
      { id: t.gov2.id, name: t.gov2.name },
    ]);
    const france = await request(app).get(`${GEO}/governorates`).query({ countryId: t.france.id });
    expect(france.body.data).toEqual([{ id: t.paris.id, name: t.paris.name }]);
    for (const item of [...egypt.body.data, ...france.body.data]) expect(Object.keys(item).sort()).toEqual(['id', 'name']);
  });

  it('governorates by organizationId: the country is DERIVED from the organization (never from the client)', async () => {
    const { app, t } = await build();
    const french = await t.newOrganization('Maison du Coran', t.france.id, t.paris.id);
    const res = await request(app).get(`${GEO}/governorates`).query({ organizationId: french.id });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ id: t.paris.id, name: t.paris.name }]);
    const egyptian = await t.newOrganization('Al-Huda');
    const other = await request(app).get(`${GEO}/governorates`).query({ organizationId: egyptian.id });
    expect(other.body.data.map((g: { id: string }) => g.id)).toEqual([t.gov.id, t.gov2.id]);
  });

  it('rejects both parameters, neither parameter, invalid ids and repeated parameters (VALIDATION_FAILED, 400)', async () => {
    const { app, t } = await build();
    const org = await t.newOrganization('Al-Noor 2');
    const both = await request(app).get(`${GEO}/governorates`).query({ countryId: t.country.id, organizationId: org.id });
    expect(both.status).toBe(400);
    expect(both.body.error.code).toBe('VALIDATION_FAILED');
    const neither = await request(app).get(`${GEO}/governorates`);
    expect(neither.status).toBe(400);
    expect(neither.body.error.details.fields.map((f: { code: string }) => f.code)).toContain('REQUIRED_FIELD');
    for (const q of ['countryId=abc', 'organizationId=abc', 'countryId=', `countryId=${t.country.id}&countryId=${t.france.id}`]) {
      const res = await request(app).get(`${GEO}/governorates?${q}`);
      expect([q, res.status]).toEqual([q, 400]);
    }
  });

  it('unknown or ineligible ids are 404, an inactive country is rejected, an empty country answers an empty list', async () => {
    const { app, t } = await build();
    const unknownCountry = await request(app).get(`${GEO}/governorates`).query({ countryId: UNKNOWN });
    expect([unknownCountry.status, unknownCountry.body.error.code]).toEqual([404, 'GEOGRAPHY_NODE_NOT_FOUND']);
    const unknownOrg = await request(app).get(`${GEO}/governorates`).query({ organizationId: UNKNOWN });
    expect([unknownOrg.status, unknownOrg.body.error.code]).toEqual([404, 'ORGANIZATION_NOT_FOUND']);
    t.geoRepo.setStatus(t.france.id, 'INACTIVE');
    const inactive = await request(app).get(`${GEO}/governorates`).query({ countryId: t.france.id });
    expect([inactive.status, inactive.body.error.code]).toEqual([400, 'GEOGRAPHY_NODE_INACTIVE']);
    t.geoRepo.setStatus(t.paris.id, 'INACTIVE');
    t.geoRepo.setStatus(t.france.id, 'ACTIVE');
    const empty = await request(app).get(`${GEO}/governorates`).query({ countryId: t.france.id });
    expect([empty.status, empty.body.data]).toEqual([200, []]);
  });

  it('an organization that may not receive school submissions is not revealed (INACTIVE, or without a country)', async () => {
    const { app, t } = await build();
    const org = await t.newOrganization('Dormant');
    t.orgRepo.rows.set(org.id, { ...t.orgRepo.rows.get(org.id)!, status: 'INACTIVE' });
    const inactive = await request(app).get(`${GEO}/governorates`).query({ organizationId: org.id });
    expect([inactive.status, inactive.body.error.code]).toEqual([404, 'ORGANIZATION_NOT_FOUND']);
    const noCountry = await t.newOrganization('No country');
    t.orgRepo.rows.set(noCountry.id, { ...t.orgRepo.rows.get(noCountry.id)!, countryId: null });
    const res = await request(app).get(`${GEO}/governorates`).query({ organizationId: noCountry.id });
    expect([res.status, res.body.error.code]).toEqual([404, 'ORGANIZATION_NOT_FOUND']);
  });

  it('error messages follow the request language: Accept-Language en / ar, Arabic by default', async () => {
    const { app } = await build();
    const en = await request(app).get(`${GEO}/governorates`).set('Accept-Language', 'en');
    const ar = await request(app).get(`${GEO}/governorates`).set('Accept-Language', 'ar');
    const dflt = await request(app).get(`${GEO}/governorates`);
    expect(en.body.error.message).not.toBe(ar.body.error.message);
    expect(/[a-z]/i.test(en.body.error.message)).toBe(true);
    expect(/[\u0600-\u06FF]/.test(ar.body.error.message)).toBe(true);
    expect(dflt.body.error.message).toBe(ar.body.error.message);
  });

  it('is read-only: only GET routes exist, and the contract documents them as public', async () => {
    const { app } = await build();
    for (const method of ['post', 'put', 'patch', 'delete'] as const) {
      expect((await request(app)[method](`${GEO}/countries`)).status, method).toBe(404);
    }
    expect(geographyApiDoc.operations.map((o) => `${o.method} ${o.path} ${o.authorization.authentication}`).sort()).toEqual(['get /countries none', 'get /governorates none']);
    expect(geographyApiDoc.operations.map((o) => o.operationId).sort()).toEqual(['getCountries', 'getGovernorates']);
  });
});
