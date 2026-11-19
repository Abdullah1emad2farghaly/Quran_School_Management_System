import express from 'express';
import request from 'supertest';
import { registerAllErrorMessages } from '../../src/app/bootstrap/register-error-messages';
import { errorHandler, notFoundHandler } from '../../src/app/middleware/error-handler.middleware';
import { requestContextMiddleware } from '../../src/app/middleware/request-context.middleware';
import { createAuthRouter, createRequireAuthentication } from '../../src/modules/10-sessions-jwt/public';
import { AuditQueryService, AuditRecorder, InMemoryAuditRepository, createAuditRouter, registerAuditAuthorization } from '../../src/modules/35-history-audit/public';
import { createPaymentsHarness } from './payments-harness';

export const AUDIT_LOGS = '/api/v1/audit-logs';
export const AUTH = '/api/v1/auth';

/**
 * The real Audit router over the real sessions and the real Authorization Engine (permissions registered through `registerAuditAuthorization`) and an in-memory audit store.
 * `scopes` is a small stand-in for the composition root's directory: who administers which organization / manages which school is declared by the test.
 */
export async function createAuditApi() {
  registerAllErrorMessages();
  const t = await createPaymentsHarness();
  registerAuditAuthorization({ policies: t.policies });
  const repository = new InMemoryAuditRepository();
  const organizations = new Map<string, string[]>();
  const schools = new Map<string, string[]>();
  const scopes = {
    organizationIdsOf: async (userId: string) => organizations.get(userId) ?? [],
    schoolIdsOf: async (userId: string) => schools.get(userId) ?? [],
    organizationOfSchool: async () => t.org.id as string | null,
  };
  const recorder = new AuditRecorder({ repository, scopes, clock: { now: () => new Date('2026-11-16T10:00:00Z') } });
  const requireAuthentication = createRequireAuthentication(() => t.h.service);
  const app = express();
  app.use(requestContextMiddleware);
  app.use(express.json());
  app.use(AUDIT_LOGS, createAuditRouter({ getService: () => new AuditQueryService({ repository, scopes }), requireAuthentication, requirePermission: t.requirePermission }));
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
  return { app, t, login, recorder, repository, organizations, schools };
}
