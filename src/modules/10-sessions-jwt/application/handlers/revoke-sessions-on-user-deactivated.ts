import type { DomainEvent } from '../../../00-shared-kernel/public';
import type { EventHandler } from '../../../06-domain-events-outbox/public';
import { IdentityEventTypes } from '../../../08-identity-core/public';
import type { SessionService } from '../services/session-service';

/**
 * Master Specification §22: deactivating a user invalidates their active sessions.
 * Delivery is at-least-once, so this is idempotent (revoking when nothing is active does nothing).
 * Authentication also rejects inactive users immediately, so there is no gap while the event is delivered.
 */
export function createRevokeSessionsOnUserDeactivatedHandler(service: Pick<SessionService, 'revokeAllForUser'>): EventHandler {
  return {
    name: 'sessions.revoke-on-user-deactivated',
    eventTypes: [IdentityEventTypes.USER_DEACTIVATED],
    async handle(event: DomainEvent): Promise<void> {
      const userId = (event.payload as { userId?: unknown } | null)?.userId;
      if (typeof userId !== 'string' || userId === '') return;
      await service.revokeAllForUser(userId, 'USER_DEACTIVATED');
    },
  };
}
