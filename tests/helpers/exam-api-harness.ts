import express from 'express';
import request from 'supertest';
import { registerAllErrorMessages } from '../../src/app/bootstrap/register-error-messages';
import { errorHandler, notFoundHandler } from '../../src/app/middleware/error-handler.middleware';
import { requestContextMiddleware } from '../../src/app/middleware/request-context.middleware';
import { createAuthRouter, createRequireAuthentication } from '../../src/modules/10-sessions-jwt/public';
import { createExamRouter } from '../../src/modules/30-exams/public';
import { createExamHarness } from './exam-harness';

export const EXAMS = '/api/v1/exams';
export const AUTH = '/api/v1/auth';

/** The real exam and Auth routers over the in-memory Exam harness (real sessions, Authorization Engine, Smart Guard, Modules 16-25). */
export async function createExamApi() {
  registerAllErrorMessages();
  const t = await createExamHarness();
  const requireAuthentication = createRequireAuthentication(() => t.h.service);
  const app = express();
  app.use(requestContextMiddleware);
  app.use(express.json());
  app.use(EXAMS, createExamRouter({ getService: () => t.exams, requireAuthentication, requirePermission: t.requirePermission }));
  app.use(AUTH, createAuthRouter({ getService: () => t.h.service, requireAuthentication, requireAuthenticationAllowingPasswordChange: createRequireAuthentication(() => t.h.service, { allowPasswordChangePending: true }) }));
  app.use(notFoundHandler);
  app.use(errorHandler);
  const login = async (u: { phone: string; password: string }) => {
    const res = await request(app).post(`${AUTH}/login`).send({ phone: u.phone, password: u.password });
    if (res.status !== 200) throw new Error(`login failed: ${JSON.stringify(res.body)}`);
    return { Authorization: `Bearer ${res.body.data.accessToken}` };
  };
  /** An account registered with the initial password (last four phone digits), after the mandatory password change. */
  const loginInitial = async (phone: string) => {
    const first = await request(app).post(`${AUTH}/login`).send({ phone, password: phone.slice(-4) });
    const auth = { Authorization: `Bearer ${first.body.data.accessToken}` };
    await request(app).post(`${AUTH}/change-password`).set(auth).send({ currentPassword: phone.slice(-4), newPassword: 'my-pass-1' });
    return login({ phone, password: 'my-pass-1' });
  };
  const phoneOf = async (userId: string) => (await t.h.identity.findById(userId))!.phone;
  return { app, t, login, loginInitial, phoneOf };
}
