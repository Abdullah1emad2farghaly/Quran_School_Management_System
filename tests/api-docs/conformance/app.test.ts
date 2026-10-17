import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';

// The readiness probe asks the database; here it is scripted so BOTH documented answers (200 and 503) are exercised for real.
const database = vi.hoisted(() => ({ up: true }));
vi.mock('../../../src/config/database', async (importOriginal) => ({ ...(await importOriginal<object>()), checkDatabase: async () => database.up }));

import { createApp } from '../../../src/app/bootstrap/create-app';
import { ApiConformance } from '../support/conformance';

describe('app-level endpoints conform to their OpenAPI documentation', () => {
  let api: ApiConformance;
  beforeAll(async () => {
    api = await ApiConformance.create();
  });

  it('GET /health and GET /health/ready (200 and 503) match the documented responses', async () => {
    const app = createApp({ apiDocsEnabled: false });
    api.conforms(await request(app).get('/api/v1/health'));
    database.up = true;
    api.conforms(await request(app).get('/api/v1/health/ready'));
    database.up = false;
    const down = api.conforms(await request(app).get('/api/v1/health/ready'));
    expect(down.status).toBe(503);
    expect(down.body.data.checks.database).toBe('down');
  });

  it('exercised every documented app-level operation', () => {
    expect(api.operationCount('app')).toBe(2);
    api.assertAllExercised('app');
  });
});
