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
  const requireAuthenticationAllowingPasswordChange = createRequireAuthentication(() => h.service, { allowPasswordChangePending: true });
  const app = express();
  app.use(requestContextMiddleware);
  app.use(express.json());
  app.use('/api/v1/auth', createAuthRouter({ getService: () => h.service, requireAuthentication, requireAuthenticationAllowingPasswordChange }));
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

  it('a second login on another device does NOT end the first one (independent sessions)', async () => {
    const { app, h } = build();
    const u = await h.createUser();
    const a = await request(app).post('/api/v1/auth/login').send({ phone: u.phone, password: u.password });
    const b = await request(app).post('/api/v1/auth/login').send({ phone: u.phone, password: u.password });
    expect((await request(app).get('/api/v1/whoami').set(bearer(a.body.data.accessToken))).status).toBe(200);
    expect((await request(app).get('/api/v1/whoami').set(bearer(b.body.data.accessToken))).status).toBe(200);
  });

  it('logout ends only the calling device; the other sessions keep working', async () => {
    const { app, h } = build();
    const u = await h.createUser();
    const a = await request(app).post('/api/v1/auth/login').send({ phone: u.phone, password: u.password });
    const b = await request(app).post('/api/v1/auth/login').send({ phone: u.phone, password: u.password });
    expect((await request(app).post('/api/v1/auth/logout').set(bearer(a.body.data.accessToken))).status).toBe(204);
    expect((await request(app).get('/api/v1/whoami').set(bearer(a.body.data.accessToken))).body.error.code).toBe('SESSION_REVOKED');
    expect((await request(app).get('/api/v1/whoami').set(bearer(b.body.data.accessToken))).status).toBe(200);
  });

  it('logout-all ends every session of the account', async () => {
    const { app, h } = build();
    const u = await h.createUser();
    const a = await request(app).post('/api/v1/auth/login').send({ phone: u.phone, password: u.password });
    const b = await request(app).post('/api/v1/auth/login').send({ phone: u.phone, password: u.password });
    expect((await request(app).post('/api/v1/auth/logout-all').set(bearer(a.body.data.accessToken))).status).toBe(204);
    expect((await request(app).get('/api/v1/whoami').set(bearer(a.body.data.accessToken))).status).toBe(401);
    expect((await request(app).get('/api/v1/whoami').set(bearer(b.body.data.accessToken))).status).toBe(401);
  });
});

describe('three-session limit (POST /auth/login)', () => {
  const login = (app: express.Express, u: { phone: string; password: string }, password = u.password) =>
    request(app).post('/api/v1/auth/login').send({ phone: u.phone, password });

  it('answers the fourth login with a localized 422 SESSION_LIMIT_REACHED and revokes nothing', async () => {
    const { app, h } = build();
    const u = await h.createUser();
    const sessions = [await login(app, u), await login(app, u), await login(app, u)];
    const fourth = await login(app, u);

    expect(fourth.status).toBe(422);
    expect(fourth.body.success).toBe(false);
    expect(fourth.body.error.code).toBe('SESSION_LIMIT_REACHED');
    expect(fourth.body.error.details).toEqual({ maxActiveSessions: 3 });
    expect(typeof fourth.body.error.message).toBe('string');
    expect(fourth.body.error.message.length).toBeGreaterThan(10);
    expect(fourth.body.data).toBeUndefined();
    for (const s of sessions) expect((await request(app).get('/api/v1/whoami').set(bearer(s.body.data.accessToken))).status).toBe(200);
  });

  it('gives the Arabic message when Arabic is requested', async () => {
    const { app, h } = build();
    const u = await h.createUser();
    for (let i = 0; i < 3; i += 1) await login(app, u);
    const res = await request(app).post('/api/v1/auth/login').set('Accept-Language', 'ar').send({ phone: u.phone, password: u.password });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/أجهزة/);
  });

  it('does not reveal the limit to someone who does not know the password', async () => {
    const { app, h } = build();
    const u = await h.createUser();
    for (let i = 0; i < 3; i += 1) await login(app, u);
    const wrong = await login(app, u, 'wrong-pass');
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
  });
});

describe('My devices (GET /auth/sessions, DELETE /auth/sessions/:sessionId)', () => {
  const login = (app: express.Express, u: { phone: string; password: string }, userAgent?: string) => {
    const req = request(app).post('/api/v1/auth/login');
    if (userAgent) req.set('User-Agent', userAgent);
    return req.send({ phone: u.phone, password: u.password });
  };
  const CHROME_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
  const SAFARI_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

  it('requires authentication', async () => {
    const { app } = build();
    expect((await request(app).get('/api/v1/auth/sessions')).status).toBe(401);
    expect((await request(app).delete('/api/v1/auth/sessions/8c1f3d2e-5b6a-4f7c-9d10-3e4a5b6c7d81')).status).toBe(401);
  });

  it('lists the caller\'s sessions with a safe device label and never any token', async () => {
    const { app, h } = build();
    const u = await h.createUser();
    const a = await login(app, u, CHROME_ANDROID);
    const b = await login(app, u, SAFARI_IOS);

    const res = await request(app).get('/api/v1/auth/sessions').set(bearer(b.body.data.accessToken));
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.data.maxActiveSessions).toBe(3);
    expect(res.body.data.items.map((d: { deviceLabel: string }) => d.deviceLabel)).toEqual(['Chrome on Android', 'Safari on iOS']);
    expect(res.body.data.items.map((d: { isCurrent: boolean }) => d.isCurrent)).toEqual([false, true]);
    for (const item of res.body.data.items) {
      expect(Object.keys(item).sort()).toEqual(['createdAt', 'deviceLabel', 'expiresAt', 'id', 'isCurrent', 'lastActiveAt']);
    }
    const text = JSON.stringify(res.body);
    for (const secret of [a.body.data.refreshToken, b.body.data.refreshToken, a.body.data.accessToken, b.body.data.accessToken]) expect(text).not.toContain(secret);
    expect(text).not.toContain(CHROME_ANDROID); // the raw User-Agent is never stored or returned
  });

  it('revokes one selected session (204) and keeps the others active', async () => {
    const { app, h } = build();
    const u = await h.createUser();
    const a = await login(app, u, CHROME_ANDROID);
    const b = await login(app, u, SAFARI_IOS);
    const list = await request(app).get('/api/v1/auth/sessions').set(bearer(a.body.data.accessToken));
    const target = list.body.data.items.find((d: { deviceLabel: string }) => d.deviceLabel === 'Safari on iOS');

    const res = await request(app).delete(`/api/v1/auth/sessions/${target.id}`).set(bearer(a.body.data.accessToken));
    expect(res.status).toBe(204);
    expect((await request(app).get('/api/v1/whoami').set(bearer(b.body.data.accessToken))).body.error.code).toBe('SESSION_REVOKED');
    expect((await request(app).get('/api/v1/whoami').set(bearer(a.body.data.accessToken))).status).toBe(200);
    expect((await request(app).get('/api/v1/auth/sessions').set(bearer(a.body.data.accessToken))).body.data.items).toHaveLength(1);
  });

  it('answers 404 SESSION_NOT_FOUND for another account\'s session and an unknown id, and 400 for a malformed id', async () => {
    const { app, h } = build();
    const u = await h.createUser();
    const other = await h.createUser();
    const mine = await login(app, u);
    const theirs = await login(app, other);
    const theirList = await request(app).get('/api/v1/auth/sessions').set(bearer(theirs.body.data.accessToken));
    const theirId = theirList.body.data.items[0].id;

    const foreign = await request(app).delete(`/api/v1/auth/sessions/${theirId}`).set(bearer(mine.body.data.accessToken));
    expect(foreign.status).toBe(404);
    expect(foreign.body.error.code).toBe('SESSION_NOT_FOUND');
    const unknown = await request(app).delete('/api/v1/auth/sessions/00000000-0000-4000-8000-000000000000').set(bearer(mine.body.data.accessToken));
    expect(unknown.status).toBe(404);
    expect((await request(app).delete('/api/v1/auth/sessions/not-a-uuid').set(bearer(mine.body.data.accessToken))).status).toBe(400);
    expect((await request(app).get('/api/v1/whoami').set(bearer(theirs.body.data.accessToken))).status).toBe(200);
  });
});

describe('change password revokes the other sessions (POST /auth/change-password)', () => {
  it('keeps the calling session and ends every other one', async () => {
    const { app, h } = build();
    const u = await h.createUser();
    const a = await request(app).post('/api/v1/auth/login').send({ phone: u.phone, password: u.password });
    const b = await request(app).post('/api/v1/auth/login').send({ phone: u.phone, password: u.password });
    const res = await request(app)
      .post('/api/v1/auth/change-password')
      .set(bearer(b.body.data.accessToken))
      .send({ currentPassword: u.password, newPassword: 'brand-new1' });
    expect(res.status).toBe(204);
    expect((await request(app).get('/api/v1/whoami').set(bearer(b.body.data.accessToken))).status).toBe(200);
    expect((await request(app).get('/api/v1/whoami').set(bearer(a.body.data.accessToken))).body.error.code).toBe('SESSION_REVOKED');
  });
});

describe('mandatory first-login password change (account-level, enforced by the backend)', () => {
  const login = async (app: express.Express, u: { phone: string; password: string }) =>
    request(app).post('/api/v1/auth/login').send({ phone: u.phone, password: u.password });

  it('reports the requirement at login and blocks every ordinary protected route until the password is changed', async () => {
    const { app, h } = build();
    const u = await h.createUser({ password: '4567', mustChangePassword: true });
    const res = await login(app, u);
    expect(res.status).toBe(200);
    expect(res.body.data.mustChangePassword).toBe(true);
    const blocked = await request(app).get('/api/v1/whoami').set(bearer(res.body.data.accessToken));
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });

  it('lets only change-password and the logouts through while the change is pending, and never returns a password', async () => {
    const { app, h } = build();
    const u = await h.createUser({ password: '4567', mustChangePassword: true });
    const session = (await login(app, u)).body.data;
    const token = bearer(session.accessToken);

    const changed = await request(app).post('/api/v1/auth/change-password').set(token).send({ currentPassword: '4567', newPassword: 'my-new-pass' });
    expect(changed.status).toBe(204);
    expect(changed.text).toBe('');
    // the same session works at once, and a fresh login no longer reports the requirement
    expect((await request(app).get('/api/v1/whoami').set(token)).status).toBe(200);
    const again = await login(app, { phone: u.phone, password: 'my-new-pass' });
    expect(again.body.data.mustChangePassword).toBe(false);
    expect((await login(app, u)).status).toBe(401);
  });

  it('allows logout and logout-all while pending, and refresh keeps reporting the requirement', async () => {
    const { app, h } = build();
    const u = await h.createUser({ password: '4567', mustChangePassword: true });
    const first = (await login(app, u)).body.data;
    const refreshed = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: first.refreshToken });
    expect(refreshed.body.data.mustChangePassword).toBe(true);
    expect((await request(app).post('/api/v1/auth/logout').set(bearer(refreshed.body.data.accessToken))).status).toBe(204);
    const second = (await login(app, u)).body.data;
    expect((await request(app).post('/api/v1/auth/logout-all').set(bearer(second.accessToken))).status).toBe(204);
  });

  it('rejects a wrong current password, an identical new password and a policy-breaking one', async () => {
    const { app, h } = build();
    const u = await h.createUser({ password: '4567', mustChangePassword: true });
    const token = bearer((await login(app, u)).body.data.accessToken);
    const change = (body: object) => request(app).post('/api/v1/auth/change-password').set(token).send(body);
    expect((await change({ currentPassword: 'nope', newPassword: 'abcd1234' })).body.error.code).toBe('CURRENT_PASSWORD_INCORRECT');
    expect((await change({ currentPassword: '4567', newPassword: '4567' })).body.error.code).toBe('NEW_PASSWORD_SAME_AS_CURRENT');
    expect((await change({ currentPassword: '4567', newPassword: 'abc' })).body.error.code).toBe('INVALID_PASSWORD');
    expect((await change({ currentPassword: '4567', newPassword: 'x'.repeat(13) })).body.error.code).toBe('INVALID_PASSWORD');
    // nothing changed: the requirement is still pending
    expect((await request(app).get('/api/v1/whoami').set(token)).body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });

  it('does not affect ordinary accounts, and a password change by an ordinary account needs the right current password', async () => {
    const { app, h } = build();
    const u = await h.createUser();
    const session = (await login(app, u)).body.data;
    expect(session.mustChangePassword).toBe(false);
    expect((await request(app).get('/api/v1/whoami').set(bearer(session.accessToken))).status).toBe(200);
    const wrong = await request(app).post('/api/v1/auth/change-password').set(bearer(session.accessToken)).send({ currentPassword: 'wrong-one', newPassword: 'other-pass1' });
    expect(wrong.status).toBe(400);
  });
});
