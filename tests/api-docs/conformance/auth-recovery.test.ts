import express from 'express';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { registerAllErrorMessages } from '../../../src/app/bootstrap/register-error-messages';
import { errorHandler, notFoundHandler } from '../../../src/app/middleware/error-handler.middleware';
import { requestContextMiddleware } from '../../../src/app/middleware/request-context.middleware';
import { createAuthRouter, createRequireAuthentication } from '../../../src/modules/10-sessions-jwt/public';
import { createRecoveryRouter } from '../../../src/modules/11-otp-password-recovery/public';
import { createRecoveryHarness, e164 } from '../../helpers/recovery-harness';
import { ApiConformance } from '../support/conformance';

const base = '/api/v1/auth';

function build() {
  registerAllErrorMessages();
  const h = createRecoveryHarness();
  const app = express();
  app.use(requestContextMiddleware);
  app.use(express.json());
  app.use(`${base}/password-recovery`, createRecoveryRouter({ getService: () => h.recovery }));
  app.use(base, createAuthRouter({ getService: () => h.service, requireAuthentication: createRequireAuthentication(() => h.service) }));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return { app, h };
}

describe('Modules 10 and 11 endpoints conform to their OpenAPI documentation (real responses)', () => {
  let api: ApiConformance;
  beforeAll(async () => {
    api = await ApiConformance.create();
  });

  it('login, refresh, logout and logout-all: success and error responses', async () => {
    const { app, h } = build();
    const u = await h.createUser();
    const login = api.conforms(await request(app).post(`${base}/login`).send({ phone: u.phone, password: u.password }));
    expect(login.status).toBe(200);
    api.conforms(await request(app).post(`${base}/login`).send({ phone: u.phone, password: 'wrong-password' }));
    api.conforms(await request(app).post(`${base}/login`).send({}));
    const inactive = await h.createUser();
    await h.identity.deactivateUser(inactive.id);
    expect(api.conforms(await request(app).post(`${base}/login`).send({ phone: inactive.phone, password: inactive.password })).status).toBe(403);

    const refreshed = api.conforms(await request(app).post(`${base}/refresh`).send({ refreshToken: login.body.data.refreshToken }));
    expect(refreshed.status).toBe(200);
    const reused = api.conforms(await request(app).post(`${base}/refresh`).send({ refreshToken: login.body.data.refreshToken }));
    expect(reused.body.error.code).toBe('REFRESH_TOKEN_REUSED');
    api.conforms(await request(app).post(`${base}/refresh`).send({ refreshToken: 'x'.repeat(201) }));

    const again = await request(app).post(`${base}/login`).send({ phone: u.phone, password: u.password });
    const bearer = { Authorization: `Bearer ${again.body.data.accessToken}` };
    expect(api.conforms(await request(app).post(`${base}/logout`).set(bearer)).status).toBe(204);
    api.conforms(await request(app).post(`${base}/logout`)); // 401 without a token

    const third = await request(app).post(`${base}/login`).send({ phone: u.phone, password: u.password });
    expect(api.conforms(await request(app).post(`${base}/logout-all`).set({ Authorization: `Bearer ${third.body.data.accessToken}` })).status).toBe(204);
    api.conforms(await request(app).post(`${base}/logout-all`).set({ Authorization: 'Bearer not-a-token' })); // 401 invalid token
  });

  it('password recovery: request, verify and reset, with their error responses', async () => {
    const { app, h } = build();
    const u = await h.createUser();
    const rec = `${base}/password-recovery`;

    expect(api.conforms(await request(app).post(`${rec}/request`).send({ phone: u.phone })).status).toBe(200);
    expect(api.conforms(await request(app).post(`${rec}/request`).send({ phone: '01099999999' })).status).toBe(200); // unknown phone: same answer
    api.conforms(await request(app).post(`${rec}/request`).send({}));
    await h.flush();
    const otp = h.sender.lastFor(e164(u.phone))!.otp;

    api.conforms(await request(app).post(`${rec}/verify`).send({ phone: u.phone, otp: '000000' }));
    const verified = api.conforms(await request(app).post(`${rec}/verify`).send({ phone: u.phone, otp }));
    expect(verified.status).toBe(200);
    api.conforms(await request(app).post(`${rec}/reset`).send({ resetToken: verified.body.data.resetToken, newPassword: '123' }));
    expect(api.conforms(await request(app).post(`${rec}/reset`).send({ resetToken: verified.body.data.resetToken, newPassword: 'newpass9' })).status).toBe(204);
    api.conforms(await request(app).post(`${rec}/reset`).send({ resetToken: verified.body.data.resetToken, newPassword: 'another1' })); // token already used

    const limited = await createRateLimited();
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(limited.headers['retry-after']).toBeTruthy();

    async function createRateLimited(): Promise<request.Response> {
      const other = await h.createUser();
      let last!: request.Response;
      for (let i = 0; i < 5; i += 1) last = await request(app).post(`${rec}/request`).send({ phone: other.phone });
      return api.conforms(last);
    }
  });

  it('exercised every documented operation of Modules 10 and 11', () => {
    expect(api.operationCount('10')).toBe(4);
    expect(api.operationCount('11')).toBe(3);
    api.assertAllExercised('10');
    api.assertAllExercised('11');
  });
});
