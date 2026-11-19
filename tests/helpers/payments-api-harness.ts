import express from 'express';
import request from 'supertest';
import { registerAllErrorMessages } from '../../src/app/bootstrap/register-error-messages';
import { errorHandler, notFoundHandler } from '../../src/app/middleware/error-handler.middleware';
import { requestContextMiddleware } from '../../src/app/middleware/request-context.middleware';
import { createAuthRouter, createRequireAuthentication } from '../../src/modules/10-sessions-jwt/public';
import { createSubscriptionRouter } from '../../src/modules/33-subscriptions/public';
import { createPaymentRouter } from '../../src/modules/34-payments-collection/public';
import { createPaymentsHarness } from './payments-harness';

export const PAYMENTS = '/api/v1/payments';
export const SUBSCRIPTIONS = '/api/v1/subscriptions';
export const AUTH = '/api/v1/auth';

/** The real Payments, Subscriptions and Auth routers over the in-memory Payments harness (real sessions, real Authorization Engine). */
export async function createPaymentsApi() {
  registerAllErrorMessages();
  const t = await createPaymentsHarness();
  const requireAuthentication = createRequireAuthentication(() => t.h.service);
  const app = express();
  app.use(requestContextMiddleware);
  app.use(express.json());
  app.use(PAYMENTS, createPaymentRouter({ getPayments: () => t.payments, requireAuthentication, requirePermission: t.requirePermission }));
  app.use(SUBSCRIPTIONS, createSubscriptionRouter({ getSubscriptions: () => t.subscriptions, getCollectors: () => t.collectors, getGroups: () => t.groupSummaries, requireAuthentication, requirePermission: t.requirePermission }));
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
