import { SystemClock, type Clock, type DomainEvent, type TransactionContext } from '../../../00-shared-kernel/public';
import { assertValidDomainEvent } from '../../domain/services/domain-event-factory';
import type { NewOutboxRecord, OutboxStore } from '../ports/outbox-store';

const MAX_PAYLOAD_BYTES = 256 * 1024;

/**
 * Writes domain events to the outbox INSIDE the caller's transaction, so the
 * business change and its events commit or roll back together.
 *
 *   await unitOfWork.run(async (tx) => {
 *     await repo.save(entity, tx);
 *     await outbox.publishFrom(entity, tx);   // or outbox.publish([event], tx)
 *   });
 */
export class OutboxService {
  constructor(
    private readonly store: OutboxStore,
    private readonly clock: Clock = new SystemClock(),
  ) {}

  async publish(events: readonly DomainEvent[], tx: TransactionContext): Promise<void> {
    if (events.length === 0) return;
    const now = this.clock.now();
    const records = events.map((event): NewOutboxRecord => {
      assertValidDomainEvent(event);
      const payload = JSON.stringify(event.payload ?? null);
      if (Buffer.byteLength(payload, 'utf8') > MAX_PAYLOAD_BYTES) {
        throw new Error(`Domain event "${event.eventType}": payload exceeds ${MAX_PAYLOAD_BYTES} bytes`);
      }
      return {
        eventId: event.eventId,
        eventType: event.eventType,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        payload,
        metadata: event.metadata ? JSON.stringify(event.metadata) : null,
        occurredAt: event.occurredAt,
        nextAttemptAt: now,
      };
    });
    await this.store.append(records, tx);
  }

  /** Publishes (and clears) the events recorded by an aggregate root. */
  async publishFrom(source: { pullDomainEvents(): DomainEvent[] }, tx: TransactionContext): Promise<void> {
    await this.publish(source.pullDomainEvents(), tx);
  }
}
