// Public contract of Module 06 (Domain Events & Transactional Outbox).
export { createDomainEvent, assertValidDomainEvent, type NewDomainEvent } from '../domain/services/domain-event-factory';
export { DEFAULT_RETRY_POLICY, computeRetryDelayMs, type RetryPolicy } from '../domain/services/retry-policy';
export { OUTBOX_STATUSES, type OutboxStatus } from '../domain/value-objects/outbox-status';
export type { EventHandler } from '../application/ports/event-handler';
export type { OutboxStore, OutboxRecord, NewOutboxRecord, ClaimParams } from '../application/ports/outbox-store';
export { EventHandlerRegistry } from '../application/services/event-handler-registry';
export { OutboxService } from '../application/services/outbox-service';
export {
  OutboxProcessor,
  type OutboxProcessorOptions,
  type ProcessResult,
} from '../application/services/outbox-processor';
export { SequelizeOutboxStore } from '../infrastructure/persistence/sequelize/repositories/sequelize-outbox-store';
export { InMemoryOutboxStore } from '../infrastructure/services/in-memory-outbox-store';
export { OutboxScheduler, type OutboxSchedulerOptions } from '../infrastructure/services/outbox-scheduler';
