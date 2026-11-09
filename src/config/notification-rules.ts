import { SystemClock } from '../modules/00-shared-kernel/public';
import {
  PublicAssignmentDirectory,
  PublicQuranDirectory,
  PublicExamDirectory,
  PublicGroupDirectory,
  PublicSchoolDirectory,
  PublicSessionReads,
  PublicStudentDirectory,
  PublicSubscriptionDirectory,
  PublicTeacherDirectory,
  ReminderProcessor,
  ReminderScheduler,
  SequelizeRuleStateRepository,
  createAssignmentChangeHandler,
  createEvaluationHandler,
  createExamEventHandlers,
  createGroupChangeHandlers,
  createSchoolRequestHandlers,
  createSessionReminderHandlers,
  createSubscriptionRuleHandlers,
  registerRuleTemplates,
  type RuleDeps,
} from '../modules/32-notification-rules/public';
import { getEvaluationService } from './evaluations';
import { getExamService } from './exams';
import { getGroupService } from './groups';
import { getMemorizationService } from './memorization';
import { getOrganizationService } from './organization';
import { getParentService } from './parents';
import { getQuranStructureService } from './quran';
import { getRevisionService } from './revision';
import { getSchoolService } from './schools';
import { getStudentService } from './students';
import { getCollectorService, getSubscriptionService } from './subscriptions';
import { getTeacherService } from './teachers';
import { getNotificationService, notificationTemplates } from './notifications';
import { getEventHandlerRegistry } from './outbox';
import { getSequelize, getUnitOfWork } from './database';
import { logger } from './logger';

/**
 * Composition root of Module 32 (Notification Rules). It only reads other modules through their PUBLIC services and creates notifications through Module 31's NotificationService:
 * a failure here is retried by the outbox / the reminder worker and can never roll back the business transaction that produced the event.
 */
let deps: RuleDeps | undefined;
function getDeps(): RuleDeps {
  const quran = new PublicQuranDirectory(getQuranStructureService());
  return (deps ??= {
    notifications: getNotificationService(),
    templates: notificationTemplates,
    students: new PublicStudentDirectory({ students: getStudentService(), parents: getParentService() }),
    teachers: new PublicTeacherDirectory(getTeacherService()),
    groups: new PublicGroupDirectory(getGroupService()),
    schools: new PublicSchoolDirectory({ schools: getSchoolService(), organizations: getOrganizationService() }),
    exams: new PublicExamDirectory(getExamService()),
    sessions: new PublicSessionReads({ evaluations: getEvaluationService(), memorization: getMemorizationService(), revision: getRevisionService(), quran }),
    assignments: new PublicAssignmentDirectory({ memorization: getMemorizationService(), revision: getRevisionService() }),
    quran,
    subscriptions: new PublicSubscriptionDirectory({ subscriptions: getSubscriptionService(), collectors: getCollectorService(), schools: getSchoolService() }),
    state: new SequelizeRuleStateRepository(getSequelize()),
    unitOfWork: getUnitOfWork(),
    clock: new SystemClock(),
  });
}

let registered = false;
/** Call once at startup, before startOutbox(): registers the templates and the event consumers of every notification rule. */
export function registerNotificationRuleHandlers(): void {
  if (registered) return;
  registered = true;
  registerRuleTemplates(notificationTemplates);
  const d = getDeps();
  const registry = getEventHandlerRegistry();
  for (const handler of [
    ...createSchoolRequestHandlers(d),
    ...createGroupChangeHandlers(d),
    createAssignmentChangeHandler(d),
    ...createExamEventHandlers(d),
    createEvaluationHandler(d),
    ...createSessionReminderHandlers(d),
    ...createSubscriptionRuleHandlers(d),
  ]) {
    registry.register(handler);
  }
}

let scheduler: ReminderScheduler | undefined;
/** Starts the time-driven reminder worker (polls every 10 seconds; the work is in the database, so a restart or an outage loses nothing). */
export function startReminderScheduler(): void {
  if (scheduler) return;
  const processor = new ReminderProcessor(getDeps());
  scheduler = new ReminderScheduler({
    job: { processDue: () => processor.processDue() },
    onError: (error) => logger.error('notification reminder pass failed', { error: String(error) }),
    onResult: (r) => logger.info('notification reminders processed', { ...r }),
  });
  scheduler.start();
}

export function stopReminderScheduler(): void {
  scheduler?.stop();
  scheduler = undefined;
}
