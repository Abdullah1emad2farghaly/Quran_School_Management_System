import express from 'express';
import request from 'supertest';
import { registerAllErrorMessages } from '../../src/app/bootstrap/register-error-messages';
import { errorHandler, notFoundHandler } from '../../src/app/middleware/error-handler.middleware';
import { requestContextMiddleware } from '../../src/app/middleware/request-context.middleware';
import { createAuthRouter, createRequireAuthentication } from '../../src/modules/10-sessions-jwt/public';
import { createExcelImportRouter } from '../../src/modules/36-excel-import/public';
import { createExcelImportHarness } from './excel-import-harness';

export const IMPORTS = '/api/v1/excel-imports';
export const AUTH = '/api/v1/auth';

/** The real Excel Import and Auth routers over the in-memory Excel Import harness (real sessions, real Authorization Engine, real multer upload). */
export async function createExcelImportApi(options: Parameters<typeof createExcelImportHarness>[0] = {}) {
  registerAllErrorMessages();
  const t = await createExcelImportHarness(options);
  const requireAuthentication = createRequireAuthentication(() => t.h.service);
  const app = express();
  app.use(requestContextMiddleware);
  app.use(express.json());
  app.use(IMPORTS, createExcelImportRouter({ getService: () => t.importer, getSchools: () => t.service, requireAuthentication, requirePermission: t.requirePermission }));
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
