import type { DomainEvent } from '../events/domain-event';
import { Entity } from './entity';

/** Aggregate root that records domain events until they are pulled for the outbox. */
export abstract class AggregateRoot<TId extends string | number = string> extends Entity<TId> {
  private pendingEvents: DomainEvent[] = [];

  protected addDomainEvent(event: DomainEvent): void {
    this.pendingEvents.push(event);
  }

  /** Returns and clears recorded events. */
  pullDomainEvents(): DomainEvent[] {
    const events = this.pendingEvents;
    this.pendingEvents = [];
    return events;
  }
}
