// Public contract of Module 27 (Memorization, Master Specification §48 and the approved Module 27 decisions): the assignment of the NEXT session (defined by the session's
// Teacher during the current session, changeable only while it is IN_PROGRESS, one shared assignment for a GROUP-mode group, one per student for an INDIVIDUAL group, carried
// forward unchanged when the target session is cancelled, rescheduled or the Teacher is absent) and the student's memorization records (recorded only by the assigned Teacher
// through Smart Guard, overlapping ranges allowed, corrected only during the same session with the original kept; nothing is ever deleted). The READ interface for the
// half-session reminder is `MemorizationService.getScheduledMemorization(sessionId)` (Notifications modules 31-34 deliver the reminder; nothing is notified here).
// Events: MemorizationAssignmentDefined / Modified / Cancelled, MemorizationRecorded, MemorizationRecordCorrected. Permissions go through `registerMemorizationAuthorization`.
export {
  MemorizationService,
  type MemorizationServiceDeps, type GpsInput, type DefineAssignmentInput, type RecordMemorizationInput, type CorrectRecordInput, type StudentRecordsInput,
} from '../application/services/memorization-service';
export type { MemorizationRepository } from '../application/ports/memorization-repository';
export type { AssignmentDto, RecordDto, SessionMemorizationDto, RecordBatchResultDto, RecordCorrectionResultDto, ScheduledMemorizationDto } from '../application/dto/memorization-dto';
export { MemorizationPermissions, registerMemorizationAuthorization, type MemorizationAuthorizationDeps } from '../application/services/memorization-authorization';
export { MEMORIZATION_ERROR_MESSAGES } from '../application/services/memorization-error-messages';
export { MemorizationAssignment, subjectKeyOf, type MemorizationAssignmentSnapshot, type AssignmentHistoryEntry } from '../domain/entities/memorization-assignment';
export { MemorizationRecord, normalizeOptionalReason, type MemorizationRecordSnapshot, type MemorizationCorrection } from '../domain/entities/memorization-record';
export { MemorizationErrorCodes, memorizationError, type MemorizationErrorCode } from '../domain/errors/memorization-errors';
export {
  MemorizationEventTypes, MEMORIZATION_ASSIGNMENT_AGGREGATE_TYPE, MEMORIZATION_RECORD_AGGREGATE_TYPE, type MemorizationAssignmentEventPayload, type MemorizationRecordEventPayload,
} from '../domain/events/memorization-events';
export {
  ASSIGNMENT_STATUSES, ASSIGNMENT_ACTIONS, MAX_BATCH_RECORDS, MAX_REASON_LENGTH, GROUP_SUBJECT_KEY, sameQuranRange, toMemorizationRange,
  type AssignmentStatus, type AssignmentAction, type MemorizationRange, type AyahRef, type RangeSegment,
} from '../domain/value-objects/memorization-range';
export { InMemoryMemorizationRepository } from '../infrastructure/services/in-memory-memorization-repository';
export { SequelizeMemorizationRepository } from '../infrastructure/persistence/sequelize/repositories/sequelize-memorization-repository';
export { createMemorizationRouter, MEMORIZATION_LIST_SPEC, type MemorizationRouterDeps } from '../presentation/http/memorization-routes';
export { memorizationApiDoc } from '../presentation/http/memorization.openapi';
