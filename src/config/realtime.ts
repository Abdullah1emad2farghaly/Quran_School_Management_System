import type { Server as HttpServer } from 'node:http';
import { SocketIoNotificationGateway } from '../modules/31-notifications-core/public';
import { attachRealtimeGateway } from './notifications';
import { getSessionService } from './sessions';
import { env } from './env';
import { logger } from './logger';

/**
 * Composition root of the real-time channel (Module 31, Socket.IO). It attaches to the SAME HTTP server as the API (no second port, no hosting-specific service) and
 * authenticates every connection with the existing Module 10 check (`SessionService.authenticate`: valid access token, active session, active user).
 * A failure to start is logged and never stops the API: notifications keep working through Web Push and the notification APIs.
 */
let gateway: SocketIoNotificationGateway | undefined;

export async function startRealtime(httpServer: HttpServer): Promise<void> {
  if (gateway) return;
  if (!env.realtime.enabled) {
    logger.info('real-time notifications are disabled (SOCKET_IO_ENABLED=false): Web Push and the notification APIs only');
    return;
  }
  try {
    gateway = await SocketIoNotificationGateway.create({
      httpServer,
      authenticate: async (accessToken) => {
        const principal = await getSessionService().authenticate(accessToken);
        return { userId: principal.userId, sessionId: principal.sessionId, mustChangePassword: principal.mustChangePassword };
      },
      corsOrigins: env.corsOrigins,
      path: env.realtime.path,
      pingIntervalMs: env.realtime.pingIntervalMs,
      pingTimeoutMs: env.realtime.pingTimeoutMs,
      maxConnectionsPerUser: env.realtime.maxConnectionsPerUser,
      onError: (message, error) => logger.warn(message, { error: String(error) }),
    });
    attachRealtimeGateway(gateway);
    logger.info('real-time notifications enabled', { path: env.realtime.path });
  } catch (error) {
    gateway = undefined;
    attachRealtimeGateway(undefined);
    logger.error('real-time notifications could not start; Web Push and the notification APIs keep working', { error: String(error) });
  }
}

/** Detaches the gateway first (new notifications fall back to Web Push at once), then closes every connection. */
export async function stopRealtime(): Promise<void> {
  const current = gateway;
  gateway = undefined;
  attachRealtimeGateway(undefined);
  await current?.close();
}
