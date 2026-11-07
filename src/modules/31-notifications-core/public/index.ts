// Public contract of Module 31 (Notifications Core): account-level in-app notifications and Web Push. Other modules import ONLY from here.
// Producing modules (Module 32 and later) call `NotificationService.notify` and register their templates; Module 31 knows no business events.
export { NotificationService, toNotificationDto, type NotificationServiceDeps } from '../application/services/notification-service';
export { PushSubscriptionService, type PushSubscriptionServiceDeps } from '../application/services/push-subscription-service';
export { PushDeliveryProcessor, type PushDeliveryProcessorDeps, type PushPassResult } from '../application/services/push-delivery-processor';
export { NotificationTemplateRegistry, type NotificationTemplate } from '../application/services/template-registry';
export { NOTIFICATION_ERROR_MESSAGES } from '../application/services/notification-error-messages';
export { createDeletePushSubscriptionsOnSessionRevokedHandler } from '../application/handlers/delete-push-subscriptions-on-session-revoked';
export { type AccountLanguageResolver, noAccountLanguage } from '../application/ports/account-language-resolver';
export type { NotificationRepository, NotificationRecord, PushSubscriptionRecord } from '../application/ports/notification-repository';
export type { PushSender, PushSendOutcome, PushTarget } from '../application/ports/push-sender';
export type { NotificationDto, NotifyInput, NotifyResult, PushSubscriptionDto, PushSubscriptionInput } from '../application/dto/notification-dto';
export { NotificationErrorCodes, NotificationDefinitionError, notificationError } from '../domain/errors/notification-errors';
export { DEFAULT_NOTIFICATION_LOCALE, NOTIFICATION_LIMITS, PUSH_LIMITS, pushRetryDelayMs, pushPreview } from '../domain/value-objects/notification-rules';
export { isSafePushEndpoint, isPushKey } from '../domain/value-objects/push-endpoint';
export { PushDeliveryScheduler, type PushDeliveryJob, type PushDeliverySchedulerOptions } from '../infrastructure/jobs/push-delivery-scheduler';
export { InMemoryNotificationRepository } from '../infrastructure/services/in-memory-notification-repository';
export { SequelizeNotificationRepository } from '../infrastructure/persistence/sequelize/repositories/sequelize-notification-repository';
export { WebPushSender, type VapidDetails } from '../infrastructure/security/web-push-sender';
export { createNotificationRouter, NOTIFICATION_LIST_SPEC, type NotificationRouterDeps } from '../presentation/http/notification-routes';
export { notificationApiDoc } from '../presentation/http/notification.openapi';
