import express from 'express';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { registerAllErrorMessages } from '../../../src/app/bootstrap/register-error-messages';
import { errorHandler, notFoundHandler } from '../../../src/app/middleware/error-handler.middleware';
import { requestContextMiddleware } from '../../../src/app/middleware/request-context.middleware';
import { createGeographyRouter } from '../../../src/modules/14-geography/public';
import { createSchoolsHarness } from '../../helpers/schools-harness';
import { ApiConformance } from '../support/conformance';

const GEO = '/api/v1/geography';
const UNKNOWN = '00000000-0000-4000-8000-000000000000';

describe('Module 14 endpoints conform to their OpenAPI documentation (real responses)', () => {
  let api: ApiConformance;
  beforeAll(async () => {
    api = await ApiConformance.create();
  });

  it('countries and governorates, anonymous, with every documented success and error response', async () => {
    registerAllErrorMessages();
    const t = await createSchoolsHarness();
    const app = express();
    app.use(requestContextMiddleware);
    app.use(express.json());
    app.use(GEO, createGeographyRouter({ getGeography: () => t.geography, getOrganizations: () => t.organizations }));
    app.use(notFoundHandler);
    app.use(errorHandler);

    expect(api.conforms(await request(app).get(`${GEO}/countries`)).status).toBe(200);
    expect(api.conforms(await request(app).get(`${GEO}/governorates`).query({ countryId: t.country.id })).status).toBe(200);
    const org = await t.newOrganization('Al-Huda');
    expect(api.conforms(await request(app).get(`${GEO}/governorates`).query({ organizationId: org.id })).status).toBe(200);
    expect(api.conforms(await request(app).get(`${GEO}/governorates`)).status).toBe(400); // neither
    expect(api.conforms(await request(app).get(`${GEO}/governorates`).query({ countryId: t.country.id, organizationId: org.id })).status).toBe(400); // both
    expect(api.conforms(await request(app).get(`${GEO}/governorates`).query({ countryId: 'abc' })).status).toBe(400);
    expect(api.conforms(await request(app).get(`${GEO}/governorates`).query({ countryId: UNKNOWN })).status).toBe(404);
    expect(api.conforms(await request(app).get(`${GEO}/governorates`).query({ organizationId: UNKNOWN })).status).toBe(404);
    t.geoRepo.setStatus(t.france.id, 'INACTIVE');
    expect(api.conforms(await request(app).get(`${GEO}/governorates`).query({ countryId: t.france.id })).status).toBe(400); // GEOGRAPHY_NODE_INACTIVE
  });

  it('exercised every documented operation of Module 14', () => {
    expect(api.operationCount('14')).toBe(2);
    api.assertAllExercised('14');
  });
});
