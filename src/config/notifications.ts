import {
  NotificationService,
  NotificationTemplateRegistry,
  PushDeliveryProcessor,
  PushDeliveryScheduler,
  PushSubscriptionService,
  SequelizeNotificationRepository,
  WebPushSender,
  createDeletePushSubscriptionsOnSessionRevokedHandler,
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

let notificationService: NotificationService | undefined;
export function getNotificationService(): NotificationService {
  return (notificationService ??= new NotificationService({
    repository: getRepository(),
    unitOfWork: getUnitOfWork(),
    clock: new SystemClock(),
    templates: notificationTemplates,
    language: noAccountLanguage, // no account language setting exists yet: every notification is rendered in Arabic (approved decision Q2/Q6)
    pushEnabled: env.push.enabled,
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
  });
  scheduler = new PushDeliveryScheduler({
    job: { processDue: () => processor.processDue() },
    onError: (error) => logger.error('push delivery pass failed', { error: String(error) }),
    onResult: (r) => logger.info('push deliveries processed', { ...r }),
  });
  scheduler.start();
}

export function stopPushDeliveryScheduler(): void {
  scheduler?.stop();
  scheduler = undefined;
}
