// Public contract of Module 24 (Class Sessions, Master Specification §45): the sessions of a group, one per occurrence of a schedule slot (NO GROUP SCHEDULE = NO SESSION).
// The system creates each session 15 minutes before its scheduled start, moves it IN_PROGRESS at its start and COMPLETED at its end, and cancels it automatically when its
// slot is retired before the start; the assigned Teacher may cancel with a mandatory reason. Sessions are never deleted. Other modules depend on `ClassSessionService`
// (reads) and on the events (ClassSessionCreated / Started / Completed / Cancelled); permissions go through the Authorization Engine (`registerSessionAuthorization`).
export { ClassSessionService, type ClassSessionServiceDeps, type SessionListInput, type CycleResult } from '../application/services/class-session-service';
export type { ClassSessionRepository, SessionListFilter } from '../application/ports/session-repository';
export type { ClassSessionDto } from '../application/dto/session-dto';
export { SessionPermissions, registerSessionAuthorization, type SessionAuthorizationDeps } from '../application/services/session-authorization';
export { CLASS_SESSION_ERROR_MESSAGES } from '../application/services/session-error-messages';
export { createCancelSessionsOnSlotRetiredHandler } from '../application/handlers/cancel-sessions-on-slot-retired';
export { ClassSession, type ClassSessionSnapshot, type SessionTransition } from '../domain/entities/class-session';
export { ClassSessionErrorCodes, classSessionError, type ClassSessionErrorCode } from '../domain/errors/session-errors';
export { SessionEventTypes, CLASS_SESSION_AGGREGATE_TYPE, type SessionEventPayload } from '../domain/events/session-events';
export { SESSION_STATUSES, CANCEL_SOURCES, SLOT_RETIREMENT_REASONS, SESSION_LEAD_MINUTES, MAX_CANCEL_REASON_LENGTH, type SessionStatus, type CancelSource, type SlotRetirementReason } from '../domain/value-objects/session-status';
export { cairoWallClockToUtc, cairoOffsetMs, addDays, isoWeekdayOfDate } from '../domain/value-objects/cairo-time';
export { InMemoryClassSessionRepository } from '../infrastructure/services/in-memory-session-repository';
export { SequelizeClassSessionRepository } from '../infrastructure/persistence/sequelize/repositories/sequelize-session-repository';
export { ClassSessionScheduler, type ClassSessionSchedulerOptions } from '../infrastructure/jobs/class-session-scheduler';
export { createSessionRouter, SESSION_LIST_SPEC, type SessionRouterDeps } from '../presentation/http/session-routes';
export { classSessionApiDoc } from '../presentation/http/class-session.openapi';
