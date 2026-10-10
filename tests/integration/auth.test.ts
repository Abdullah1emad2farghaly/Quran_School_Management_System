import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { registerAllErrorMessages } from '../../src/app/bootstrap/register-error-messages';
import { errorHandler, notFoundHandler } from '../../src/app/middleware/error-handler.middleware';
import { requestContextMiddleware } from '../../src/app/middleware/request-context.middleware';
import { createAuthRouter, createRequireAuthentication } from '../../src/modules/10-sessions-jwt/public';
import { createSessionHarness } from '../helpers/session-harness';

function build() {
  registerAllErrorMessages();
  const h = createSessionHarness();
  const requireAuthentication = createRequireAuthentication(() => h.service);
  const app = express();
  app.use(requestContextMiddleware);
  app.use(express.json());
  app.use('/api/v1/auth', createAuthRouter({ getService: () => h.service, requireAuthentication }));
  // a protected route owned by "another module": proves req.auth is available to it
  app.get('/api/v1/whoami', requireAuthentication, (req, res) => {
    res.json({ userId: req.auth?.userId, sessionId: req.auth?.sessionId });
  });
  app.use(notFoundHandler);
  app.use(errorHandler);
  return { app, h };
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('POST /auth/login', () => {
  it('returns tokens, user and roles with no-store caching', async () => {
    const { app, h } = build();
    const u = await h.createUser({ role: 'TEACHER' });
    const res = await request(app).post('/api/v1/auth/login').send({ phone: u.phone, password: u.password });

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ tokenType: 'Bearer', user: { id: u.id }, roles: ['TEACHER'] });
    expect(typeof res.body.data.accessToken).toBe('string');
    expect(typeof res.body.data.refreshToken).toBe('string');
    expect(new Date(res.body.data.accessTokenExpiresAt).getTime() - h.clock.now().getTime()).toBe(15 * 60_000);
  });

  it('answers wrong credentials with a localized 401 that does not reveal which part was wrong', async () => {
    const { app, h } = build();
    const u = await h.createUser();
    const wrongPassword = await request(app).post('/api/v1/auth/login').send({ phone: u.phone, password: 'nope-nope' });
    const unknownPhone = await request(app).post('/api/v1/auth/login').send({ phone: '01099999999', password: 'secret1' });
    expect(wrongPassword.status).toBe(401);
    expect(unknownPhone.status).toBe(401);
    expect(wrongPassword.body.error.code).toBe('INVALID_CREDENTIALS');
    // identical code and message (the response also carries a per-request id, which naturally differs)
    expect(unknownPhone.body.error.code).toBe(wrongPassword.body.error.code);
    expect(unknownPhone.body.error.message).toBe(wrongPassword.body.error.message);
    const en = await request(app).post('/api/v1/auth/login').set('Accept-Language', 'en').send({ phone: u.phone, password: 'nope-nope' });
    expect(en.body.error.message).toBe('The phone number or password is incorrect.');
  });

  it('answers an inactive account with 403', async () => {
    const { app, h } = build();
    const u = await h.createUser();
    await h.identity.deactivateUser(u.id);
    const res = await request(app).post('/api/v1/auth/login').send({ phone: u.phone, password: u.password });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_INACTIVE');
  });

  it('validates the body (400) before doing any work', async () => {
    const { app } = build();
    for (const body of [{}, { phone: '0101' }, { password: 'x' }, { phone: 5, password: 'x' }, { phone: '010', password: 'p'.repeat(129) }]) {
      const res = await request(app).post('/api/v1/auth/login').send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it('never echoes passwords or tokens in error responses', async () => {
    const { app, h } = build();
    const u = await h.createUser();
    const res = await request(app).post('/api/v1/auth/login').send({ phone: u.phone, password: 'a-wrong-password' });
    expect(JSON.stringify(res.body)).not.toContain('a-wrong-password');
  });
});

describe('POST /auth/refresh', () => {
  it('rotates the refresh token', async () => {
    const { app, h } = build();
    const u = await h.createUser();
    const login = await request(app).post('/api/v1/auth/login').send({ phone: u.phone, password: u.password });
    const refreshed = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: login.body.data.refreshToken });

    expect(refreshed.status).toBe(200);
    expect(refreshed.headers['cache-control']).toBe('no-store');
    expect(refreshed.body.data.refreshToken).not.toBe(login.body.data.refreshToken);

    const reuse = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: login.body.data.refreshToken });
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe('REFRESH_TOKEN_REUSED');
    const afterReuse = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: refreshed.body.data.refreshToken });
    expect(afterReuse.body.error.code).toBe('SESSION_REVOKED');
  });

  it('rejects a missing or unknown refresh token', async () => {
    const { app } = build();
    expect((await request(app).post('/api/v1/auth/refresh').send({})).status).toBe(400);
    const unknown = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: 'unknown' });
    expect(unknown.status).toBe(401);
    expect(unknown.body.error.code).toBe('REFRESH_TOKEN_INVALID');
  });
});

describe('protected routes', () => {
  it('require a Bearer access token', async () => {
    const { app } = build();
    for (const headers of [{}, { Authorization: 'Basic abc' }, { Authorization: 'Bearer' }, { Authorization: 'Bearer a b' }]) {
      const res = await request(app).get('/api/v1/whoami').set(headers);
      expect(res.status, JSON.stringify(headers)).toBe(401);
      expect(res.body.error.code).toBe('AUTHENTICATION_REQUIRED');
    }
    const bad = await request(app).get('/api/v1/whoami').set(bearer('garbage'));
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe('ACCESS_TOKEN_INVALID');
  });

  it('do not accept the token from the query string or the body', async () => {
    const { app, h } = build();
    const u = await h.createUser();
    const login = await request(app).post('/api/v1/auth/login').send({ phone: u.phone, password: u.password });
    const res = await request(app).get(`/api/v1/whoami?access_token=${login.body.data.accessToken}`);
    expect(res.status).toBe(401);
  });

  it('expose the caller as req.auth', async () => {
    const { app, h } = build();
    const u = await h.createUser();
    const login = await request(app).post('/api/v1/auth/login').send({ phone: u.phone, password: u.password });
    const res = await request(app).get('/api/v1/whoami').set(bearer(login.body.data.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe(u.id);
  });

  it('reject an expired access token with a code the client can use to refresh', async () => {
    const { app, h } = build();
    const u = await h.createUser();
    const login = await request(app).post('/api/v1/auth/login').send({ phone: u.phone, password: u.password });
    h.advance(15 * 60_000);
    const res = await request(app).get('/api/v1/whoami').set(bearer(login.body.data.accessToken));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('ACCESS_TOKEN_EXPIRED');
  });
});

describe('logout', () => {
  it('POST /auth/logout needs authentication and ends the session at once', async () => {
    const { app, h } = build();
    const u = await h.createUser();
    const login = await request(app).post('/api/v1/auth/login').send({ phone: u.phone, password: u.password });
    const { accessToken, refreshToken } = login.body.data;

    expect((await request(app).post('/api/v1/auth/logout')).status).toBe(401);
    const out = await request(app).post('/api/v1/auth/logout').set(bearer(accessToken));
    expect(out.status).toBe(204);
    expect((await request(app).get('/api/v1/whoami').set(bearer(accessToken))).body.error.code).toBe('SESSION_REVOKED');
    expect((await request(app).post('/api/v1/auth/refresh').send({ refreshToken })).body.error.code).toBe('SESSION_REVOKED');
  });

  it('POST /auth/logout-all ends the session', async () => {
    const { app, h } = build();
    const u = await h.createUser();
    const login = await request(app).post('/api/v1/auth/login').send({ phone: u.phone, password: u.password });
    const out = await request(app).post('/api/v1/auth/logout-all').set(bearer(login.body.data.accessToken));
    expect(out.status).toBe(204);
    expect((await request(app).get('/api/v1/whoami').set(bearer(login.body.data.accessToken))).status).toBe(401);
  });

  it('a second login on another device ends the first one (one active session)', async () => {
    const { app, h } = build();
    const u = await h.createUser();
    const a = await request(app).post('/api/v1/auth/login').send({ phone: u.phone, password: u.password });
    const b = await request(app).post('/api/v1/auth/login').send({ phone: u.phone, password: u.password });
    expect((await request(app).get('/api/v1/whoami').set(bearer(a.body.data.accessToken))).body.error.code).toBe('SESSION_REVOKED');
    expect((await request(app).get('/api/v1/whoami').set(bearer(b.body.data.accessToken))).status).toBe(200);
  });
});
