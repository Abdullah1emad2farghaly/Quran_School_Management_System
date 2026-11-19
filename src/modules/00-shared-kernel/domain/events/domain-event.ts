/**
 * Contract for domain events raised by aggregates. Persistence (transactional
 * outbox) and delivery are owned by Module 06; this is only the shared shape.
 */
export interface DomainEventMetadata {
  readonly requestId?: string;
  readonly actorUserId?: string;
  /** Client address of the request that caused the event (additive; used by History & Audit, Module 35). Absent for system-originated events. */
  readonly ipAddress?: string;
  /** User agent of that request, sanitized and truncated (additive; used by Module 35). */
  readonly userAgent?: string;
}

export interface DomainEvent<TPayload = unknown> {
  readonly eventId: string;
  readonly eventType: string;
  readonly occurredAt: Date;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payload: TPayload;
  readonly metadata?: DomainEventMetadata;
}
