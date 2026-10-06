import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app/bootstrap/create-app';

const app = createApp();

describe('GET /api/v1/health', () => {
  it('returns ok with a request id', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('ok');
    expect(res.headers['x-request-id']).toBeTruthy();
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
  });

  it('echoes a valid client request id', async () => {
    const res = await request(app).get('/api/v1/health').set('X-Request-Id', 'abc-12345-xyz');
    expect(res.headers['x-request-id']).toBe('abc-12345-xyz');
  });
});

describe('error foundation', () => {
  it('returns a localized 404 (default ar) with stable code', async () => {
    const res = await request(app).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.locale).toBe('ar');
    expect(res.body.error.requestId).toBeTruthy();
  });

  it('localizes to en via Accept-Language, same code', async () => {
    const res = await request(app).get('/api/v1/nope').set('Accept-Language', 'en');
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.message).toBe('The requested resource was not found.');
  });

  it('returns INVALID_JSON for malformed bodies', async () => {
    const res = await request(app)
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send('{bad');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });
});
