import type { DomainEvent } from '../../../00-shared-kernel/public';
import type { EventHandler } from '../../../06-domain-events-outbox/public';
import { SessionEventTypes } from '../../../10-sessions-jwt/public';
import type { RealtimeConnectionControl } from '../ports/realtime-gateway';

/**
 * When an authentication session ends for ANY reason, the live connections opened with that session are closed at once, so a revoked device stops receiving notifications
 * without waiting for its connection to drop. Idempotent (nothing to close is fine). Only that session's connections are touched.
 */
export function createDisconnectSocketsOnSessionRevokedHandler(control: RealtimeConnectionControl): EventHandler {
  return {
    name: 'notifications.disconnect-sockets-on-session-revoked',
    eventTypes: [SessionEventTypes.AUTH_SESSION_REVOKED],
    async handle(event: DomainEvent): Promise<void> {
      const sessionId = (event.payload as { sessionId?: unknown } | null)?.sessionId;
      if (typeof sessionId !== 'string' || sessionId === '') return;
      control.disconnectSession(sessionId);
    },
  };
}
