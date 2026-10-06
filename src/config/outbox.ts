import { SystemClock } from '../modules/00-shared-kernel/public';
import {
  EventHandlerRegistry,
  OutboxProcessor,
  OutboxScheduler,
  OutboxService,
  SequelizeOutboxStore,
} from '../modules/06-domain-events-outbox/public';
import { getSequelize } from './database';
import { env } from './env';
import { logger } from './logger';

/** Modules register their event handlers here during bootstrap, before startOutbox(). */
const registry = new EventHandlerRegistry();
let service: OutboxService | undefined;
let scheduler: OutboxScheduler | undefined;

export function getEventHandlerRegistry(): EventHandlerRegistry {
  return registry;
}

/** Inject into use cases that publish domain events inside a UnitOfWork. */
export function getOutboxService(): OutboxService {
  if (!service) service = new OutboxService(new SequelizeOutboxStore(getSequelize()), new SystemClock());
  return service;
}

/** Starts background delivery (polls the outbox table; no Redis needed). */
export function startOutbox(): void {
  if (scheduler) return;
  const processor = new OutboxProcessor(
    { store: new SequelizeOutboxStore(getSequelize()), registry, clock: new SystemClock(), logger },
    { defaultLocale: env.defaultLocale },
  );
  scheduler = new OutboxScheduler(processor, logger);
  scheduler.start();
}

export async function stopOutbox(): Promise<void> {
  if (!scheduler) return;
  await scheduler.stop();
  scheduler = undefined;
}
