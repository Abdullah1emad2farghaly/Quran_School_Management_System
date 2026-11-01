// Public contract of Module 28 (Revision, Master Specification §49 and the approved Module 28 decisions): the assignment of the NEXT session (defined by the session's
// Teacher during the current session, changeable only while it is IN_PROGRESS, one shared assignment for a GROUP-mode group, one per student for an INDIVIDUAL group, carried
// forward unchanged when the target session is cancelled, rescheduled or the Teacher is absent) and the student's revision records (recorded only by the assigned Teacher
// through Smart Guard, overlapping ranges allowed, corrected only during the same session with the original kept; nothing is ever deleted). The READ interface for the
// half-session reminder is `RevisionService.getScheduledRevision(sessionId)` (Notifications modules 31-34 deliver the reminder; nothing is notified here).
// Events: RevisionAssignmentDefined / Modified / Cancelled, RevisionRecorded, RevisionRecordCorrected. Permissions go through `registerRevisionAuthorization`.
export {
  RevisionService,
  type RevisionServiceDeps, type GpsInput, type DefineAssignmentInput, type RecordRevisionInput, type CorrectRecordInput, type StudentRecordsInput,
} from '../application/services/revision-service';
export type { RevisionRepository } from '../application/ports/revision-repository';
export type { AssignmentDto, RecordDto, SessionRevisionDto, RecordBatchResultDto, RecordCorrectionResultDto, ScheduledRevisionDto } from '../application/dto/revision-dto';
export { RevisionPermissions, registerRevisionAuthorization, type RevisionAuthorizationDeps } from '../application/services/revision-authorization';
export { REVISION_ERROR_MESSAGES } from '../application/services/revision-error-messages';
export { RevisionAssignment, subjectKeyOf, type RevisionAssignmentSnapshot, type AssignmentHistoryEntry } from '../domain/entities/revision-assignment';
export { RevisionRecord, normalizeOptionalReason, type RevisionRecordSnapshot, type RevisionCorrection } from '../domain/entities/revision-record';
export { RevisionRangeResolver, type RevisionRangeResolverDeps } from '../application/services/revision-range-resolver';
export { RevisionErrorCodes, revisionError, type RevisionErrorCode } from '../domain/errors/revision-errors';
export {
  RevisionEventTypes, REVISION_ASSIGNMENT_AGGREGATE_TYPE, REVISION_RECORD_AGGREGATE_TYPE, type RevisionAssignmentEventPayload, type RevisionRecordEventPayload,
} from '../domain/events/revision-events';
export {
  ASSIGNMENT_STATUSES, ASSIGNMENT_ACTIONS, REVISION_UNITS, MAX_BATCH_RECORDS, MAX_REASON_LENGTH, GROUP_SUBJECT_KEY, sameQuranRange, toRevisionRange,
  type AssignmentStatus, type AssignmentAction, type RevisionRange, type RevisionRangeInput, type RevisionUnit, type AyahRef, type RangeSegment,
} from '../domain/value-objects/revision-range';
export { InMemoryRevisionRepository } from '../infrastructure/services/in-memory-revision-repository';
export { SequelizeRevisionRepository } from '../infrastructure/persistence/sequelize/repositories/sequelize-revision-repository';
export { createRevisionRouter, REVISION_LIST_SPEC, type RevisionRouterDeps } from '../presentation/http/revision-routes';
export { revisionApiDoc } from '../presentation/http/revision.openapi';
