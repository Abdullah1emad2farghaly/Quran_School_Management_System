import { newUuid, type Clock, type DomainEvent, type DomainEventMetadata } from '../../../00-shared-kernel/public';
import type { Locale } from '../../../01-configuration/public';
import { requestContext, sanitizeString, type Logger } from '../../../05-logging-request-context/public';
import { DEFAULT_RETRY_POLICY, computeRetryDelayMs, type RetryPolicy } from '../../domain/services/retry-policy';
import type { OutboxRecord, OutboxStore } from '../ports/outbox-store';
import type { EventHandlerRegistry } from './event-handler-registry';

export interface OutboxProcessorOptions {
  readonly batchSize?: number;
  /** How long a claimed message stays locked if the worker dies. */
  readonly lockMs?: number;
  readonly retry?: RetryPolicy;
  /** Locale placed in the request context while handlers run. */
  readonly defaultLocale?: Locale;
}

export interface ProcessResult {
  readonly claimed: number;
  readonly processed: number;
  readonly retried: number;
  readonly dead: number;
}

const MAX_ERROR_LENGTH = 1000;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Delivers pending outbox messages to registered handlers.
 * - At-least-once: failures are retried with exponential backoff, then marked dead.
 * - A failing handler never blocks the others and never touches the business transaction.
 * - Messages with no subscribers are marked processed (they stay stored as history).
 */
export class OutboxProcessor {
  private readonly batchSize: number;
  private readonly lockMs: number;
  private readonly retry: RetryPolicy;
  private readonly defaultLocale: Locale;
  private readonly logger: Logger;

  constructor(
    private readonly deps: { store: OutboxStore; registry: EventHandlerRegistry; clock: Clock; logger: Logger },
    options: OutboxProcessorOptions = {},
  ) {
    this.batchSize = options.batchSize ?? 20;
    this.lockMs = options.lockMs ?? 60_000;
    this.retry = options.retry ?? DEFAULT_RETRY_POLICY;
    this.defaultLocale = options.defaultLocale ?? 'ar';
    this.logger = deps.logger.child({ module: 'outbox' });
  }

  async processBatch(): Promise<ProcessResult> {
    const { store, clock } = this.deps;
    const now = clock.now();
    const records = await store.claim({
      claimId: newUuid(),
      now,
      lockUntil: new Date(now.getTime() + this.lockMs),
      limit: this.batchSize,
    });

    let processed = 0;
    let retried = 0;
    let dead = 0;
    for (const record of records) {
      const outcome = await this.deliver(record);
      if (outcome === 'processed') processed++;
      else if (outcome === 'retry') retried++;
      else dead++;
    }
    return { claimed: records.length, processed, retried, dead };
  }

  private async deliver(record: OutboxRecord): Promise<'processed' | 'retry' | 'dead'> {
    const { store, clock } = this.deps;
    const failures: string[] = [];
    let metadata: DomainEventMetadata | undefined;

    try {
      const event = this.toEvent(record);
      metadata = event.metadata;
      const handlers = this.deps.registry.handlersFor(event.eventType);
      const context = {
        requestId: metadata?.requestId ?? newUuid(),
        locale: this.defaultLocale,
        ...(metadata?.actorUserId ? { actorUserId: metadata.actorUserId } : {}),
      };
      await requestContext.run(context, async () => {
        for (const handler of handlers) {
          try {
            await handler.handle(event);
          } catch (error) {
            failures.push(`${handler.name}: ${describeError(error)}`);
            this.logger.warn('event handler failed', { handler: handler.name, eventId: event.eventId, eventType: event.eventType, err: error });
          }
        }
      });
    } catch (error) {
      failures.push(`dispatch: ${describeError(error)}`);
      this.logger.error('could not dispatch outbox message', { outboxId: record.id, err: error });
    }

    const at = clock.now();
    if (failures.length === 0) {
      await store.markProcessed(record.id, at);
      return 'processed';
    }

    const attempts = record.attempts + 1;
    const error = sanitizeString(failures.join('; '), MAX_ERROR_LENGTH);
    if (attempts >= this.retry.maxAttempts) {
      await store.markDead(record.id, { attempts, error, at });
      this.logger.error('outbox message is dead', { outboxId: record.id, eventId: record.eventId, eventType: record.eventType, attempts });
      return 'dead';
    }
    const nextAttemptAt = new Date(at.getTime() + computeRetryDelayMs(attempts, this.retry));
    await store.markRetry(record.id, { attempts, nextAttemptAt, error, at });
    return 'retry';
  }

  private toEvent(record: OutboxRecord): DomainEvent {
    return {
      eventId: record.eventId,
      eventType: record.eventType,
      occurredAt: record.occurredAt,
      aggregateType: record.aggregateType,
      aggregateId: record.aggregateId,
      payload: JSON.parse(record.payload) as unknown,
      ...(record.metadata ? { metadata: JSON.parse(record.metadata) as DomainEventMetadata } : {}),
    };
  }
}
