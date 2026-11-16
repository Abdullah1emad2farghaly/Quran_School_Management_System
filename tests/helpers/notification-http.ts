import express from 'express';
import { registerAllErrorMessages } from '../../src/app/bootstrap/register-error-messages';
import { errorHandler, notFoundHandler } from '../../src/app/middleware/error-handler.middleware';
import { requestContextMiddleware } from '../../src/app/middleware/request-context.middleware';
import { createRequireAuthentication } from '../../src/modules/10-sessions-jwt/public';
import { createNotificationRouter } from '../../src/modules/31-notifications-core/public';
import { createNotificationHarness } from './notification-harness';
import { createSessionHarness } from './session-harness';

export const NOTIFICATIONS_BASE = '/api/v1/notifications';

/** The notification router over in-memory services, behind the REAL authentication (Module 10) of the session harness. */
export function buildNotificationApp(options: { pushEnabled?: boolean } = {}) {
  registerAllErrorMessages();
  const sessions = createSessionHarness();
  const notifications = createNotificationHarness({ pushEnabled: options.pushEnabled });
  const app = express();
  app.use(requestContextMiddleware);
  app.use(express.json());
  app.use(
    NOTIFICATIONS_BASE,
    createNotificationRouter({
      getNotifications: () => notifications.service,
      getPush: () => notifications.push,
      requireAuthentication: createRequireAuthentication(() => sessions.service),
    }),
  );
  app.use(notFoundHandler);
  app.use(errorHandler);

  /** A user with N logged-in devices (sessions). */
  async function userWithDevices(count = 1) {
    const user = await sessions.createUser();
    const tokens: string[] = [];
    for (let i = 0; i < count; i += 1) tokens.push((await sessions.service.login({ phone: user.phone, password: user.password })).accessToken);
    return { user, tokens, bearer: (i = 0) => ({ Authorization: `Bearer ${tokens[i]}` }) };
  }
  return { app, sessions, notifications, userWithDevices };
}
