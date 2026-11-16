// Public contract of Module 30 (Exams, Master Specification §53-57 as amended by the approved Module 30 decisions; docs/EXAMS.md). The School Manager manages exams
// (DRAFT -> SCHEDULED -> STARTED -> COMPLETED -> ENDED, or CANCELLED before STARTED); the lifecycle is automatic at the start and end times (`ExamScheduler`, driven by stored times,
// so it recovers after downtime); the target list is live before STARTED and frozen at STARTED; assigned examiners record immutable results through Smart Guard (Module 25's
// `checkProtectedAction`). Other modules depend on `ExamService` (reads: `getExamReminderStatus` feeds the 24-hour reminder of the Notifications modules 31-34) and on the events
// (ExamExaminerAssigned, ExamScheduled, ExamResultRecorded, ...). Permissions go through the Authorization Engine (`registerExamAuthorization`). Nothing is notified inside this module.
export {
  ExamService, type ExamServiceDeps, type CreateExamInput, type UpdateExamInput, type SubmitExamResultInput, type ListExamsInput,
} from '../application/services/exam-service';
export type { ExamRepository, ExamStudentRow, ExamStudentStatus, StudentExamOutcomeRow, LockMode } from '../application/ports/exam-repository';
export type {
  ExamDto, ExaminerDto, ExamScheduleDto, ExamResultDto, ExamResultsDto, ExamAbsentDto, StudentExamOutcomeDto, PendingGroupDto, PendingStudentDto, ExamResultReceiptDto, ExamReminderStatusDto,
} from '../application/dto/exam-dto';
export { ExamPermissions, EXAMINER_VISIBLE_STATUSES, registerExamAuthorization, type ExamAuthorizationDeps, type ExamScope } from '../application/services/exam-authorization';
export { EXAM_ERROR_MESSAGES } from '../application/services/exam-error-messages';
export { createExamGroupMembershipHandler } from '../application/handlers/group-membership-handlers';
export { Exam, validateConfig, type ExamSnapshot, type ExaminerAssignment, type ExamConfigInput } from '../domain/entities/exam';
export { ExamResult, type ExamResultSnapshot } from '../domain/entities/exam-result';
export { ExamErrorCodes, examError, type ExamErrorCode } from '../domain/errors/exam-errors';
export { ExamEventTypes, EXAM_AGGREGATE_TYPE, EXAM_RESULT_AGGREGATE_TYPE, type ExamEventPayload, type ExamResultEventPayload } from '../domain/events/exam-events';
export {
  EXAM_STATUSES, EXAM_TARGET_TYPE, EXAM_SMART_GUARD_LEAD_MINUTES, EXAM_REMINDER_HOURS, MAX_QUESTION_COUNT, MAX_SCORE_PER_QUESTION, parseMaxScore, isValidQuestionCount, totalOf, toHundredths, fromHundredths,
  type ExamStatus,
} from '../domain/value-objects/exam-rules';
export { InMemoryExamRepository } from '../infrastructure/services/in-memory-exam-repository';
export { SequelizeExamRepository } from '../infrastructure/persistence/sequelize/repositories/sequelize-exam-repository';
export { ExamScheduler, type ExamLifecycleJob, type ExamSchedulerOptions } from '../infrastructure/jobs/exam-scheduler';
export { createExamRouter, EXAM_LIST_SPEC, type ExamRouterDeps } from '../presentation/http/exam-routes';
export { examApiDoc } from '../presentation/http/exam.openapi';
