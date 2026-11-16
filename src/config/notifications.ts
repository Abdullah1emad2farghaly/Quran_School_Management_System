import {
  NotificationService,
  NotificationTemplateRegistry,
  PushDeliveryProcessor,
  PushDeliveryScheduler,
  PushSubscriptionService,
  SequelizeNotificationRepository,
  WebPushSender,
  createDeletePushSubscriptionsOnSessionRevokedHandler,
<<<<<<< HEAD
  createDisconnectSocketsOnSessionRevokedHandler,
  noRealtimeGateway,
  type RealtimeConnectionControl,
  type RealtimeNotificationGateway,
=======
>>>>>>> a54dc5556dea92ae5f6404ebe5d964eb0b936ccc
  noAccountLanguage,
} from '../modules/31-notifications-core/public';
import { SystemClock } from '../modules/00-shared-kernel/public';
import { getEventHandlerRegistry } from './outbox';
import { getSequelize, getUnitOfWork } from './database';
import { env } from './env';
import { logger } from './logger';

/**
 * Composition root of Module 31 (Notifications Core). Web Push is enabled only when the three VAPID settings are present (`env.push.enabled`); without them
 * notifications are still created and read in-app, and no push is queued. The VAPID private key is used only to sign pushes: it is never logged or returned.
 */
let repository: SequelizeNotificationRepository | undefined;
const getRepository = () => (repository ??= new SequelizeNotificationRepository(getSequelize()));

/** The templates producing modules register (Module 32 and later). Every template needs an Arabic and an English text. */
export const notificationTemplates = new NotificationTemplateRegistry();

<<<<<<< HEAD
/**
 * The real-time gateway is created AFTER the HTTP server exists (`src/config/realtime.ts`), but the services below are built earlier, so they hold this stable proxy.
 * Until a gateway is attached (or when real-time is disabled) nobody is online and every code path behaves exactly like Web Push alone.
 */
let attachedGateway: (RealtimeNotificationGateway & RealtimeConnectionControl) | undefined;
export function attachRealtimeGateway(gateway: (RealtimeNotificationGateway & RealtimeConnectionControl) | undefined): void {
  attachedGateway = gateway;
}
const realtimeProxy: RealtimeNotificationGateway = {
  isUserOnline: (userId) => (attachedGateway ?? noRealtimeGateway).isUserOnline(userId),
  isSessionOnline: (sessionId) => (attachedGateway ?? noRealtimeGateway).isSessionOnline(sessionId),
  publishNotification: (userId, notification) => (attachedGateway ?? noRealtimeGateway).publishNotification(userId, notification),
  wasDeliveredToSession: (sessionId, notificationId) => (attachedGateway ?? noRealtimeGateway).wasDeliveredToSession(sessionId, notificationId),
};

=======
>>>>>>> a54dc5556dea92ae5f6404ebe5d964eb0b936ccc
let notificationService: NotificationService | undefined;
export function getNotificationService(): NotificationService {
  return (notificationService ??= new NotificationService({
    repository: getRepository(),
    unitOfWork: getUnitOfWork(),
    clock: new SystemClock(),
    templates: notificationTemplates,
    language: noAccountLanguage, // no account language setting exists yet: every notification is rendered in Arabic (approved decision Q2/Q6)
    pushEnabled: env.push.enabled,
<<<<<<< HEAD
    realtime: realtimeProxy,
    onRealtimeError: (error) => logger.warn('real-time notification emission failed', { error: String(error) }),
=======
>>>>>>> a54dc5556dea92ae5f6404ebe5d964eb0b936ccc
  }));
}

let pushService: PushSubscriptionService | undefined;
export function getPushSubscriptionService(): PushSubscriptionService {
  return (pushService ??= new PushSubscriptionService({
    repository: getRepository(),
    unitOfWork: getUnitOfWork(),
    clock: new SystemClock(),
    pushEnabled: env.push.enabled,
    vapidPublicKey: env.push.vapidPublicKey,
  }));
}

let handlersRegistered = false;
/** Call once at startup, before startOutbox(): deletes a session's push subscriptions when Module 10 reports the session revoked. */
export function registerNotificationEventHandlers(): void {
  if (handlersRegistered) return;
  handlersRegistered = true;
  getEventHandlerRegistry().register(createDeletePushSubscriptionsOnSessionRevokedHandler(getPushSubscriptionService()));
<<<<<<< HEAD
  // Closes the live connections of a session that ended (no-op while no gateway is attached).
  getEventHandlerRegistry().register(createDisconnectSocketsOnSessionRevokedHandler({ disconnectSession: (sessionId) => attachedGateway?.disconnectSession(sessionId) }));
=======
>>>>>>> a54dc5556dea92ae5f6404ebe5d964eb0b936ccc
}

let scheduler: PushDeliveryScheduler | undefined;
/** Starts the Web Push queue runner (polls every 5 seconds; no Redis needed). Does nothing when Web Push is not configured. */
export function startPushDeliveryScheduler(): void {
  if (scheduler) return;
  if (!env.push.enabled) {
    logger.info('web push is disabled (no VAPID configuration): in-app notifications only');
    return;
  }
  const processor = new PushDeliveryProcessor({
    repository: getRepository(),
    sender: new WebPushSender({ subject: env.push.vapidSubject, publicKey: env.push.vapidPublicKey, privateKey: env.push.vapidPrivateKey }),
    unitOfWork: getUnitOfWork(),
    clock: new SystemClock(),
<<<<<<< HEAD
    realtime: realtimeProxy,
=======
>>>>>>> a54dc5556dea92ae5f6404ebe5d964eb0b936ccc
  });
  scheduler = new PushDeliveryScheduler({
    job: { processDue: () => processor.processDue() },
    onError: (error) => logger.error('push delivery pass failed', { error: String(error) }),
<<<<<<< HEAD
    onResult: (r) => logger.info('push deliveries processed', { ...r, ...processor.stats }),
=======
    onResult: (r) => logger.info('push deliveries processed', { ...r }),
>>>>>>> a54dc5556dea92ae5f6404ebe5d964eb0b936ccc
  });
  scheduler.start();
}

export function stopPushDeliveryScheduler(): void {
  scheduler?.stop();
  scheduler = undefined;
}
