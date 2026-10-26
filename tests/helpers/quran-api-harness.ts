import express from 'express';
import request from 'supertest';
import { registerAllErrorMessages } from '../../src/app/bootstrap/register-error-messages';
import { errorHandler, notFoundHandler } from '../../src/app/middleware/error-handler.middleware';
import { requestContextMiddleware } from '../../src/app/middleware/request-context.middleware';
import { ASSIGNABLE_ROLE_CODES, type RoleCode } from '../../src/modules/09-roles-permissions/public';
import { createRequireAuthentication } from '../../src/modules/10-sessions-jwt/public';
import { createRequirePermission } from '../../src/modules/12-authorization-engine/public';
import { createQuranRouter, registerQuranAuthorization } from '../../src/modules/21-quran-structure/public';
import { createAuthorizationHarness } from './authorization-harness';
import { createQuranHarness } from './quran-service-harness';

export const QURAN = '/api/v1/quran';

/** The REAL Quran router over the in-memory repository (SYNTHETIC data), with real sessions and the real Authorization Engine. */
export async function createQuranApi(options: { imported?: boolean } = {}) {
  registerAllErrorMessages();
  const h = createAuthorizationHarness();
  registerQuranAuthorization({ policies: h.policies });
  const q = createQuranHarness();
  if (options.imported !== false) await q.importSynthetic();

  const app = express();
  app.use(requestContextMiddleware);
  app.use(express.json());
  app.use(QURAN, createQuranRouter({ getService: () => q.service, requireAuthentication: createRequireAuthentication(() => h.sessions), requirePermission: createRequirePermission(() => h.engine) }));
  app.use(notFoundHandler);
  app.use(errorHandler);

  /** Authorization header of a new user holding the given roles (none = an authenticated user without any role). */
  const as = async (...roles: RoleCode[]) => {
    const user = await h.createUser(...roles);
    const login = await h.sessions.login({ phone: user.phone, password: user.password });
    return { Authorization: `Bearer ${login.accessToken}` };
  };
  return { app, h, q, as, request, assignableRoles: ASSIGNABLE_ROLE_CODES };
}
