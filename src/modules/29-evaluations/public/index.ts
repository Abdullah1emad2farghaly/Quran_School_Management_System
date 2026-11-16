// Public contract of Module 29 (Evaluations, Master Specification §52 as amended by the approved Module 29 decisions): one evaluation per student per session, recorded ONLY by
// the session's Teacher through Smart Guard (with the narrow 15-minute post-completion grace period for MISSING evaluations), only for a student with a Memorization and/or
// Revision ASSIGNMENT, with an independent 0.00-10.00 score per available category and ONE optional immutable note of at most 200 characters. A student marked ABSENT cannot be
// evaluated and an evaluated student cannot be marked ABSENT (enforced with Module 26, under the session row lock). NO history is kept. Other modules depend on
// `EvaluationService` (reads: `getSessionEvaluationStatus` feeds the pre-end warning of the Notifications modules 31-34; `findEvaluatedStudents` is Module 26's veto) and on the
// events (EvaluationRecorded / EvaluationScoresUpdated, the integration data for the Parent notification). Permissions go through the Authorization Engine
// (`registerEvaluationAuthorization`). Nothing is notified inside this module.
export { EvaluationService, type EvaluationServiceDeps, type RecordEvaluationsInput, type EvaluationListInput } from '../application/services/evaluation-service';
export type { EvaluationRepository } from '../application/ports/evaluation-repository';
export type {
  EvaluationDto, EvaluationScoreDto, EvaluationOutcome, EvaluationChangeResultDto, EvaluationBatchResultDto, SessionEvaluationsDto, SessionEvaluationStatusDto, StudentEvaluationStatusDto, AttendanceView,
} from '../application/dto/evaluation-dto';
export { EvaluationPermissions, registerEvaluationAuthorization, type EvaluationAuthorizationDeps } from '../application/services/evaluation-authorization';
export { EVALUATION_ERROR_MESSAGES } from '../application/services/evaluation-error-messages';
export { Evaluation, normalizeNote, type EvaluationSnapshot, type EvaluationScore } from '../domain/entities/evaluation';
export { EvaluationErrorCodes, evaluationError, type EvaluationErrorCode } from '../domain/errors/evaluation-errors';
export { EvaluationEventTypes, EVALUATION_AGGREGATE_TYPE, type EvaluationEventPayload } from '../domain/events/evaluation-events';
export { evaluationPhaseAt, graceEndsAt, warningDueAt, type EvaluationPhase } from '../domain/services/evaluation-window';
export {
  EVALUATION_CATEGORIES, MAX_NOTE_LENGTH, MIN_SCORE, MAX_SCORE, GRACE_MINUTES, PRE_END_WARNING_MINUTES, MAX_BATCH_STUDENTS, availableCategories, assignmentRefsOf, roundScore, isAcceptableScore, sameScore,
  type EvaluationCategory, type AssignmentContext,
} from '../domain/value-objects/evaluation-rules';
export { InMemoryEvaluationRepository } from '../infrastructure/services/in-memory-evaluation-repository';
export { SequelizeEvaluationRepository } from '../infrastructure/persistence/sequelize/repositories/sequelize-evaluation-repository';
export { createEvaluationRouter, EVALUATION_LIST_SPEC, type EvaluationRouterDeps } from '../presentation/http/evaluation-routes';
export { evaluationApiDoc } from '../presentation/http/evaluation.openapi';
