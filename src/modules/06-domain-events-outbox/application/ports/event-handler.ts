import type { DomainEvent } from '../../../00-shared-kernel/public';

/**
 * Subscribes to domain events. Delivery is AT LEAST ONCE: a handler may see the
 * same event more than once (retries), so it must be idempotent — use
 * `event.eventId` to de-duplicate. Throwing means "retry later"; it never
 * affects the business transaction that produced the event.
 */
export interface EventHandler {
  /** Unique, stable name (used in logs and error reports). */
  readonly name: string;
  /** Event types handled; "*" receives every event. */
  readonly eventTypes: readonly string[];
  handle(event: DomainEvent): Promise<void>;
}
