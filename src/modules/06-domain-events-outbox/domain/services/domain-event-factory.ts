import { SystemClock, isUuid, newUuid, type Clock, type DomainEvent, type DomainEventMetadata } from '../../../00-shared-kernel/public';
import { requestContext } from '../../../05-logging-request-context/public';

const EVENT_TYPE = /^[A-Za-z][A-Za-z0-9_.]{0,149}$/;
const AGGREGATE_TYPE = /^[A-Za-z][A-Za-z0-9_.]{0,99}$/;

export interface NewDomainEvent<TPayload> {
  /** e.g. "StudentEnrolled" or "student.enrolled" (letters, digits, "_" and "."). */
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  /** JSON-serializable. Never put passwords, OTPs, or tokens in an event. */
  readonly payload: TPayload;
  readonly occurredAt?: Date;
  readonly metadata?: DomainEventMetadata;
}

/** Programmer-error checks; throws a plain Error describing the problem. */
export function assertValidDomainEvent(event: DomainEvent): void {
  if (!isUuid(event.eventId)) throw new Error('Domain event: eventId must be a UUID');
  if (!EVENT_TYPE.test(event.eventType)) throw new Error(`Domain event: invalid eventType "${event.eventType}"`);
  if (!AGGREGATE_TYPE.test(event.aggregateType)) throw new Error(`Domain event: invalid aggregateType "${event.aggregateType}"`);
  if (typeof event.aggregateId !== 'string' || event.aggregateId.length < 1 || event.aggregateId.length > 64) {
    throw new Error('Domain event: aggregateId must be 1-64 characters');
  }
  if (!(event.occurredAt instanceof Date) || Number.isNaN(event.occurredAt.getTime())) {
    throw new Error('Domain event: occurredAt must be a valid Date');
  }
}

/**
 * Creates a domain event with a new eventId. Metadata (requestId, actorUserId)
 * is taken from the current request context unless provided.
 */
export function createDomainEvent<TPayload>(
  input: NewDomainEvent<TPayload>,
  clock: Clock = new SystemClock(),
): DomainEvent<TPayload> {
  const context = requestContext.get();
  const metadata: DomainEventMetadata = input.metadata ?? {
    ...(context?.requestId ? { requestId: context.requestId } : {}),
    ...(context?.actorUserId ? { actorUserId: context.actorUserId } : {}),
  };
  const event: DomainEvent<TPayload> = {
    eventId: newUuid(),
    eventType: input.eventType,
    occurredAt: input.occurredAt ?? clock.now(),
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    payload: input.payload,
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  };
  assertValidDomainEvent(event);
  return event;
}
