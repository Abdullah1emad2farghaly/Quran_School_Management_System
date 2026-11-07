/**
 * Public contract of Module 32 (Notification Rules). Module 32 publishes no events and exposes no HTTP API: it consumes the public events of other modules and the time-driven
 * reminders, and creates notifications ONLY through Module 31's `NotificationService`. The composition root (`src/config/notification-rules.ts`) wires the adapters.
 */
export { createSchoolRequestHandlers } from '../application/handlers/school-request-handlers';
export { createGroupChangeHandlers } from '../application/handlers/group-change-handlers';
export { createAssignmentChangeHandler } from '../application/handlers/assignment-change-handlers';
export { createExamEventHandlers } from '../application/handlers/exam-event-handlers';
export { createEvaluationHandler } from '../application/handlers/evaluation-handler';
export { createSessionReminderHandlers } from '../application/handlers/session-reminder-handlers';
export { ReminderProcessor, type ReminderPassResult } from '../application/services/reminder-processor';
export { registerRuleTemplates, TEMPLATE_KEYS, RULE_TEMPLATES } from '../application/services/rule-templates';
export type { RuleDeps } from '../application/services/rule-support';
export type {
  AssignmentDirectory,
  AssignmentKind,
  AssignmentTexts,
  AyahLocation,
  QuranDirectory,
  RangeSnapshot,
  ExamDirectory,
  ExamInfo,
  GroupDirectory,
  GroupInfo,
  SchoolDirectory,
  SchoolInfo,
  SessionActivityView,
  SessionEvaluationView,
  SessionReads,
  StudentDirectory,
  StudentInfo,
  TeacherDirectory,
} from '../application/ports/directories';
export type { ReminderRecord, RuleStateRepository, ExamAudienceRole } from '../application/ports/rule-state-repository';
export { REMINDER_KINDS, type ReminderKind, type ReminderState } from '../domain/value-objects/reminder-rules';
export { ReminderScheduler } from '../infrastructure/jobs/reminder-scheduler';
export { InMemoryRuleStateRepository } from '../infrastructure/services/in-memory-rule-state-repository';
export { SequelizeRuleStateRepository } from '../infrastructure/persistence/sequelize/repositories/sequelize-rule-state-repository';
export { describeRange, spanOf, type RangeDescription, type RangeShape } from '../application/services/assignment-description';
export {
  PublicAssignmentDirectory,
  PublicQuranDirectory,
  PublicExamDirectory,
  PublicGroupDirectory,
  PublicSchoolDirectory,
  PublicSessionReads,
  PublicStudentDirectory,
  PublicTeacherDirectory,
} from '../infrastructure/adapters/directory-adapters';
