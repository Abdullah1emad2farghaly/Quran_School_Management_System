import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app/bootstrap/create-app';
import { mountApiDocs } from '../../src/app/openapi/serve-api-docs';
import express from 'express';
import { lintOpenApi } from './support/lint';
import { buildApiDocument } from '../../src/app/openapi/api-documents';
import { registerAllErrorMessages } from '../../src/app/bootstrap/register-error-messages';

describe('Swagger UI and the raw OpenAPI document', () => {
  it('serves Swagger UI at /api-docs and the document at /api-docs.json when enabled', async () => {
    const app = createApp({ apiDocsEnabled: true });
    const ui = await request(app).get('/api-docs/');
    expect(ui.status).toBe(200);
    expect(ui.headers['content-type']).toMatch(/text\/html/);
    expect(ui.text).toMatch(/swagger-ui/i);
    const css = await request(app).get('/api-docs/swagger-ui.css');
    expect(css.status).toBe(200);

    const json = await request(app).get('/api-docs.json');
    expect(json.status).toBe(200);
    expect(json.headers['content-type']).toMatch(/application\/json/);
    expect(json.body.openapi).toBe('3.0.3');
    expect(json.body.servers[0].url).toBe('/api/v1');
    expect(json.body.components.securitySchemes.bearerAuth).toMatchObject({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' });
  });

  it('serves nothing when disabled (the standard 404 envelope)', async () => {
    const app = createApp({ apiDocsEnabled: false });
    for (const path of ['/api-docs/', '/api-docs.json']) {
      const res = await request(app).get(path);
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
  });

  it('does not change the existing API: health and unknown routes behave as before', async () => {
    const app = createApp({ apiDocsEnabled: true });
    const health = await request(app).get('/api/v1/health');
    expect(health.status).toBe(200);
    expect(health.body.data.status).toBe('ok');
    const unknown = await request(app).get('/api/v1/nope');
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('NOT_FOUND');
  });

  it('never blocks startup when the document cannot be built', async () => {
    const app = express();
    const mounted = mountApiDocs(app, {
      enabled: true,
      buildDocument: () => {
        throw new Error('boom');
      },
    });
    expect(mounted).toBe(false);
    app.get('/ok', (_req, res) => void res.json({ ok: true }));
    expect((await request(app).get('/ok')).status).toBe(200);
    expect((await request(app).get('/api-docs.json')).status).toBe(404);
  });

  it('the real served document satisfies every documentation rule', async () => {
    registerAllErrorMessages();
    expect(await lintOpenApi(buildApiDocument())).toEqual([]);
  });
});
