import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app/bootstrap/create-app';
import { defaultMessageCatalog } from '../../src/modules/03-error-localization/public';

const app = createApp();

describe('localization over HTTP', () => {
  it('defaults to Arabic', async () => {
    const res = await request(app).get('/api/v1/nope');
    expect(res.headers['content-language']).toBe('ar');
    expect(res.body.error.locale).toBe('ar');
    expect(res.body.error.message).toBe(defaultMessageCatalog.message('NOT_FOUND', 'ar'));
  });
  it('follows Accept-Language', async () => {
    const res = await request(app).get('/api/v1/nope').set('Accept-Language', 'en-US,en;q=0.9');
    expect(res.headers['content-language']).toBe('en');
    expect(res.body.error.message).toBe(defaultMessageCatalog.message('NOT_FOUND', 'en'));
  });
  it('falls back to the default for unsupported languages', async () => {
    const res = await request(app).get('/api/v1/nope').set('Accept-Language', 'fr-FR');
    expect(res.body.error.locale).toBe('ar');
  });
  it('keeps the error code identical across languages', async () => {
    const ar = await request(app).get('/api/v1/nope').set('Accept-Language', 'ar');
    const en = await request(app).get('/api/v1/nope').set('Accept-Language', 'en');
    expect(ar.body.error.code).toBe(en.body.error.code);
  });
  it('varies on Accept-Language', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(String(res.headers['vary']).toLowerCase().includes('accept-language')).toBe(true);
  });
});
