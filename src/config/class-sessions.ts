import { SystemClock } from '../modules/00-shared-kernel/public';
import {
  ClassSessionScheduler,
  ClassSessionService,
  SequelizeClassSessionRepository,
  createCancelSessionsOnSlotRetiredHandler,
  registerSessionAuthorization,
} from '../modules/24-sessions/public';
import { getAuthorizationPolicyRegistry } from './authorization';
import { getSequelize, getUnitOfWork } from './database';
import { logger } from './logger';
import { getEventHandlerRegistry, getOutboxService } from './outbox';
import { getGroupScheduleService } from './schedules';
import { getTeacherService } from './teachers';

let service: ClassSessionService | undefined;
let scheduler: ClassSessionScheduler | undefined;

/** Module 24: the sessions of the groups (generated from Module 23's active slots). */
export function getClassSessionService(): ClassSessionService {
  if (!service) {
    service = new ClassSessionService({
      sessions: new SequelizeClassSessionRepository(getSequelize()),
      schedule: getGroupScheduleService(),
      teachers: getTeacherService(),
      unitOfWork: getUnitOfWork(),
      outbox: getOutboxService(),
      clock: new SystemClock(),
    });
  }
  return service;
}

/** The session permissions are registered ONCE, when this module is loaded, through the shared Authorization Engine (the scope resolver is Module 20's). */
registerSessionAuthorization({ policies: getAuthorizationPolicyRegistry() });

let handlersRegistered = false;
/** Call once at startup, before startOutbox(): a retired schedule slot cancels the sessions of that slot that have not started. */
export function registerClassSessionEventHandlers(): void {
  if (handlersRegistered) return;
  handlersRegistered = true;
  getEventHandlerRegistry().register(createCancelSessionsOnSlotRetiredHandler(getClassSessionService));
}

/** Starts the background job (polls the database every 15 seconds; no Redis needed): generates sessions 15 minutes before their start and advances them. */
export function startClassSessionScheduler(): void {
  if (scheduler) return;
  scheduler = new ClassSessionScheduler(getClassSessionService(), logger);
  scheduler.start();
}

export async function stopClassSessionScheduler(): Promise<void> {
  if (!scheduler) return;
  await scheduler.stop();
  scheduler = undefined;
}
