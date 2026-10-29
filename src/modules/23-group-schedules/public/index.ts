// Public contract of Module 23 (Group Schedules, Master Specification §35 and §44): the recurring weekly slots of a group (weekday + start + end),
// at most ONE active slot per weekday for a group, and no overlap in a Teacher's slots across their ACTIVE groups in any school (touching boundaries are
// allowed). Slots are immutable: a change replaces the slot, a removal retires it, archiving the group retires them; retired slots stay as history.
// Other modules depend on `GroupScheduleService` (read: `listSlots`); Module 20 reaches it through its own `GroupSchedulePort`
// (`assertTeacherCanTeach`, `retireSlotsOfArchivedGroup`). Permissions go through the Authorization Engine (`registerScheduleAuthorization`).
export { GroupScheduleService, type GroupScheduleServiceDeps, type SlotInput, type SlotChangeInput } from '../application/services/group-schedule-service';
export type { ScheduleRepository } from '../application/ports/schedule-repository';
export type { ScheduleSlotDto, OwnScheduleItemDto } from '../application/dto/schedule-dto';
export { SchedulePermissions, registerScheduleAuthorization, type ScheduleAuthorizationDeps } from '../application/services/schedule-authorization';
export { SCHEDULE_ERROR_MESSAGES } from '../application/services/schedule-error-messages';
export { GroupScheduleSlot, SLOT_RETIRE_REASONS, type GroupScheduleSlotSnapshot, type SlotRetireReason } from '../domain/entities/group-schedule-slot';
export { ScheduleErrorCodes, scheduleError, type ScheduleErrorCode } from '../domain/errors/schedule-errors';
export { ScheduleEventTypes, SCHEDULE_SLOT_AGGREGATE_TYPE, type ScheduleEventPayload } from '../domain/events/schedule-events';
export { DAYS_OF_WEEK, parseDayOfWeek, parseMinutes, formatMinutes, slotsOverlap, weekOrderOf, isoNumberOf, dayOfIsoNumber, type DayOfWeek, type MinuteRange } from '../domain/value-objects/schedule-time';
export { InMemoryScheduleRepository } from '../infrastructure/services/in-memory-schedule-repository';
export { SequelizeScheduleRepository } from '../infrastructure/persistence/sequelize/repositories/sequelize-schedule-repository';
export { createScheduleRouter, type ScheduleRouterDeps } from '../presentation/http/schedule-routes';
export { scheduleApiDoc } from '../presentation/http/schedule.openapi';
