import type { DomainEvent } from '../../../00-shared-kernel/public';
import type { EventHandler } from '../../../06-domain-events-outbox/public';
import { SessionEventTypes } from '../../../10-sessions-jwt/public';
import type { PushSubscriptionService } from '../services/push-subscription-service';

/**
 * Approved Module 31 decision (Q3 and Q5): when an authentication session ends for ANY reason (logout, logout-all, device revoked, password change on another device,
 * password reset, deactivation, refresh-token reuse, expiry), the push subscriptions created by THAT session are deleted. Subscriptions of other sessions and the account's
 * notifications are never touched. Delivery is at-least-once, so this is idempotent (deleting when nothing matches does nothing).
 */
export function createDeletePushSubscriptionsOnSessionRevokedHandler(service: Pick<PushSubscriptionService, 'deleteForSession'>): EventHandler {
  return {
    name: 'notifications.delete-push-subscriptions-on-session-revoked',
    eventTypes: [SessionEventTypes.AUTH_SESSION_REVOKED],
    async handle(event: DomainEvent): Promise<void> {
      const sessionId = (event.payload as { sessionId?: unknown } | null)?.sessionId;
      if (typeof sessionId !== 'string' || sessionId === '') return;
      await service.deleteForSession(sessionId);
    },
  };
}
