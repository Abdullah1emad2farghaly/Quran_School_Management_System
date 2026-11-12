import express from 'express';
import request from 'supertest';
import { registerAllErrorMessages } from '../../src/app/bootstrap/register-error-messages';
import { errorHandler, notFoundHandler } from '../../src/app/middleware/error-handler.middleware';
import { requestContextMiddleware } from '../../src/app/middleware/request-context.middleware';
import { createAuthRouter, createRequireAuthentication } from '../../src/modules/10-sessions-jwt/public';
import { createRevisionRouter } from '../../src/modules/28-revision/public';
import { createRevisionHarness } from './revision-harness';

export const REVISION = '/api/v1/revision';
export const AUTH = '/api/v1/auth';

/** The real revision and Auth routers over the in-memory Revision harness. */
export async function createRevisionApi() {
  registerAllErrorMessages();
  const t = await createRevisionHarness();
  const requireAuthentication = createRequireAuthentication(() => t.h.service);
  const app = express();
  app.use(requestContextMiddleware);
  app.use(express.json());
  app.use(REVISION, createRevisionRouter({ getService: () => t.revision, getQuran: () => t.quran.service, requireAuthentication, requirePermission: t.requirePermission }));
  app.use(
    AUTH,
    createAuthRouter({
      getService: () => t.h.service,
      requireAuthentication,
      requireAuthenticationAllowingPasswordChange: createRequireAuthentication(() => t.h.service, { allowPasswordChangePending: true }),
    }),
  );
  app.use(notFoundHandler);
  app.use(errorHandler);

  const login = async (u: { phone: string; password: string }) => {
    const res = await request(app).post(`${AUTH}/login`).send({ phone: u.phone, password: u.password });
    if (res.status !== 200) throw new Error(`login failed: ${JSON.stringify(res.body)}`);
    return { Authorization: `Bearer ${res.body.data.accessToken}` };
  };
  /** An account registered with the initial password (last four phone digits), after the mandatory password change (Parent or Teacher). */
  const loginInitial = async (phone: string) => {
    const first = await request(app).post(`${AUTH}/login`).send({ phone, password: phone.slice(-4) });
    const auth = { Authorization: `Bearer ${first.body.data.accessToken}` };
    await request(app).post(`${AUTH}/change-password`).set(auth).send({ currentPassword: phone.slice(-4), newPassword: 'my-pass-1' });
    return login({ phone, password: 'my-pass-1' });
  };
  return { app, t, login, loginInitial };
}
