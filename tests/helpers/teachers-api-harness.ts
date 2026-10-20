import express from 'express';
import request from 'supertest';
import { registerAllErrorMessages } from '../../src/app/bootstrap/register-error-messages';
import { errorHandler, notFoundHandler } from '../../src/app/middleware/error-handler.middleware';
import { requestContextMiddleware } from '../../src/app/middleware/request-context.middleware';
import { createAuthRouter, createRequireAuthentication } from '../../src/modules/10-sessions-jwt/public';
import { createParentRouter } from '../../src/modules/17-parents/public';
import { createTeacherRouter } from '../../src/modules/18-teachers/public';
import { createTeachersHarness } from './teachers-harness';

export const TEACHERS = '/api/v1/teachers';
export const PARENTS = '/api/v1/parents';
export const AUTH = '/api/v1/auth';

/** The real Teacher, Parent and Auth routers over the in-memory Teachers harness (real sessions, real Authorization Engine). */
export async function createTeachersApi() {
  registerAllErrorMessages();
  const t = await createTeachersHarness();
  const requireAuthentication = createRequireAuthentication(() => t.h.service);
  const app = express();
  app.use(requestContextMiddleware);
  app.use(express.json());
  app.use(TEACHERS, createTeacherRouter({ getService: () => t.teachers, requireAuthentication, requirePermission: t.requirePermission }));
  app.use(PARENTS, createParentRouter({ getService: () => t.parents, requireAuthentication, requirePermission: t.requirePermission }));
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
  return { app, t, login };
}
