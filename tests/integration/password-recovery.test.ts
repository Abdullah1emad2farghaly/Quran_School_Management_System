import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { registerAllErrorMessages } from '../../src/app/bootstrap/register-error-messages';
import { applyTrustedProxies } from '../../src/app/bootstrap/trusted-proxies';
import { errorHandler, notFoundHandler } from '../../src/app/middleware/error-handler.middleware';
import { requestContextMiddleware } from '../../src/app/middleware/request-context.middleware';
import { createRecoveryRouter } from '../../src/modules/11-otp-password-recovery/public';
import { createAuthRouter, createRequireAuthentication } from '../../src/modules/10-sessions-jwt/public';
import { createRecoveryHarness, e164 } from '../helpers/recovery-harness';

function build(trustedProxies: string[] = []) {
  registerAllErrorMessages();
  const h = createRecoveryHarness();
  const app = express();
  applyTrustedProxies(app, trustedProxies);
  app.use(requestContextMiddleware);
  app.use(express.json());
  app.use('/api/v1/auth/password-recovery', createRecoveryRouter({ getService: () => h.recovery }));
  app.use('/api/v1/auth', createAuthRouter({ getService: () => h.service, requireAuthentication: createRequireAuthentication(() => h.service) }));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return { app, h };
}
const base = '/api/v1/auth/password-recovery';

async function otpFor(h: ReturnType<typeof build>['h'], localPhone: string): Promise<string> {
  await h.flush();
  return h.sender.lastFor(e164(localPhone))!.otp;
}

describe('the full recovery flow over HTTP', () => {
  it('request -> verify -> reset, then the new password logs in and old sessions are dead', async () => {
    const { app, h } = build();
    const u = await h.createUser();
    const login = await request(app).post('/api/v1/auth/login').send({ phone: u.phone, password: u.password });

    const req = await request(app).post(`${base}/request`).send({ phone: u.phone });
    expect(req.status).toBe(200);
    expect(req.headers['cache-control']).toBe('no-store');
    expect(req.body).toMatchObject({ success: true, data: { expiresInSeconds: 300 } });
    expect(JSON.stringify(req.body)).not.toMatch(/otp/i); // the OTP is never in the response

    const otp = await otpFor(h, u.phone);
    const verify = await request(app).post(`${base}/verify`).send({ phone: u.phone, otp });
    expect(verify.status).toBe(200);
    expect(verify.headers['cache-control']).toBe('no-store');
    const { resetToken, resetTokenExpiresAt } = verify.body.data;
    expect(typeof resetToken).toBe('string');
    expect(new Date(resetTokenExpiresAt).getTime() - h.clock.now().getTime()).toBe(10 * 60_000);

    const reset = await request(app).post(`${base}/reset`).send({ resetToken, newPassword: 'newpass9' });
    expect(reset.status).toBe(204);

    const again = await request(app).post(`${base}/reset`).send({ resetToken, newPassword: 'another1' });
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('RESET_TOKEN_INVALID');

    expect((await request(app).post('/api/v1/auth/login').send({ phone: u.phone, password: 'newpass9' })).status).toBe(200);
    expect((await request(app).post('/api/v1/auth/login').send({ phone: u.phone, password: u.password })).status).toBe(401);
    const refreshed = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: login.body.data.refreshToken });
    expect(refreshed.status).toBe(401); // the old session was revoked by the reset
  });
});

describe('no account enumeration', () => {
  it('answers /request identically for an active, an unknown and an inactive account', async () => {
    const { app, h } = build();
    const active = await h.createUser();
    const inactive = await h.createUser();
    await h.identity.deactivateUser(inactive.id);

    const a = await request(app).post(`${base}/request`).send({ phone: active.phone });
    const b = await request(app).post(`${base}/request`).send({ phone: '01099999999' });
    const c = await request(app).post(`${base}/request`).send({ phone: inactive.phone });
    for (const r of [b, c]) {
      expect(r.status).toBe(a.status);
      expect(r.body.success).toBe(a.body.success);
      expect(r.body.data).toEqual(a.body.data); // (the body also carries a per-request id, which naturally differs)
      expect(r.headers['cache-control']).toBe(a.headers['cache-control']);
    }
  });

  it('answers /verify with the same localized error whatever the reason', async () => {
    const { app, h } = build();
    const u = await h.createUser();
    await request(app).post(`${base}/request`).send({ phone: u.phone });
    const wrong = await request(app).post(`${base}/verify`).send({ phone: u.phone, otp: '000000' });
    const unknown = await request(app).post(`${base}/verify`).send({ phone: '01099999999', otp: '000000' });
    const malformed = await request(app).post(`${base}/verify`).send({ phone: u.phone, otp: '12ab' });
    for (const r of [wrong, unknown, malformed]) {
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('OTP_INVALID');
      expect(r.body.error.message).toBe(wrong.body.error.message);
    }
    const en = await request(app).post(`${base}/verify`).set('Accept-Language', 'en').send({ phone: '01099999999', otp: '000000' });
    expect(en.body.error.message).toBe('The verification code is incorrect or has expired.');
  });

  it('limits unknown and active phones the same way: 429 with Retry-After', async () => {
    const { app, h } = build();
    const u = await h.createUser();
    for (const phone of [u.phone, '01099999999']) {
      const statuses: number[] = [];
      let last: request.Response | undefined;
      for (let i = 0; i < 5; i += 1) {
        last = await request(app).post(`${base}/request`).send({ phone });
        statuses.push(last.status);
      }
      expect(statuses).toEqual([200, 200, 200, 200, 429]);
      expect(last!.body.error.code).toBe('RATE_LIMITED');
      expect(last!.headers['retry-after']).toBe('3600');
      expect(last!.body.error.details.retryAfterSeconds).toBe(3600);
    }
  });
});

describe('rate limiting', () => {
  it('counts down Retry-After as time passes', async () => {
    const { app, h } = build();
    const u = await h.createUser();
    for (let i = 0; i < 4; i += 1) await request(app).post(`${base}/request`).send({ phone: u.phone });
    h.advance(10 * 60_000);
    const limited = await request(app).post(`${base}/request`).send({ phone: u.phone });
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBe('3000');
  });

  it('cannot be bypassed with forged X-Forwarded-For headers (not trusted by default)', async () => {
    const { app, h } = build();
    const u = await h.createUser();
    const statuses: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const r = await request(app).post(`${base}/request`).set('X-Forwarded-For', `203.0.113.${i}`).send({ phone: u.phone });
      statuses.push(r.status);
    }
    expect(statuses).toEqual([200, 200, 200, 200, 429]);
    expect(new Set(h.repository.requests.map((r) => r.ipKey)).size).toBe(1); // every request came from the same (real) address
  });
});

describe('input validation', () => {
  it('rejects bad bodies with 400 before doing any work', async () => {
    const { app, h } = build();
    const cases: Array<[string, object]> = [
      ['request', {}],
      ['request', { phone: 5 }],
      ['request', { phone: 'x'.repeat(41) }],
      ['verify', { phone: '0101' }],
      ['verify', { otp: '123456' }],
      ['reset', { resetToken: 'x' }],
      ['reset', { newPassword: 'abcd' }],
      ['reset', { resetToken: 'x'.repeat(201), newPassword: 'abcd' }],
    ];
    for (const [path, body] of cases) {
      const r = await request(app).post(`${base}/${path}`).send(body);
      expect(r.status, `${path} ${JSON.stringify(body)}`).toBe(400);
    }
    expect(h.repository.requests).toHaveLength(0);
  });

  it('answers a malformed phone with a validation error (the format is not account information)', async () => {
    const { app } = build();
    const r = await request(app).post(`${base}/request`).send({ phone: 'not a phone' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('INVALID_PHONE_NUMBER');
  });

  it('answers a weak new password with INVALID_PASSWORD and keeps the token usable', async () => {
    const { app, h } = build();
    const u = await h.createUser();
    await request(app).post(`${base}/request`).send({ phone: u.phone });
    const verify = await request(app).post(`${base}/verify`).send({ phone: u.phone, otp: await otpFor(h, u.phone) });
    const { resetToken } = verify.body.data;
    const weak = await request(app).post(`${base}/reset`).send({ resetToken, newPassword: '123' });
    expect(weak.status).toBe(400);
    expect(weak.body.error.code).toBe('INVALID_PASSWORD');
    expect((await request(app).post(`${base}/reset`).send({ resetToken, newPassword: 'abcd' })).status).toBe(204);
  });
});
