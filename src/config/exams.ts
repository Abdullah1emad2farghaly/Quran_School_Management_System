import { SystemClock } from '../modules/00-shared-kernel/public';
import { ExamScheduler, ExamService, SequelizeExamRepository, createExamGroupMembershipHandler, registerExamAuthorization } from '../modules/30-exams/public';
import { getAuthorizationPolicyRegistry, getAuthorizationResolvers } from './authorization';
import { getSequelize, getUnitOfWork } from './database';
import { getGroupService } from './groups';
import { logger } from './logger';
import { getEventHandlerRegistry, getOutboxService } from './outbox';
import { getParentService } from './parents';
import { getSchoolService } from './schools';
import { getSmartGuard } from './smart-guard';
import { getTeacherService } from './teachers';

let service: ExamService | undefined;
let scheduler: ExamScheduler | undefined;

/**
 * Module 30: exams of a school. It reads teachers (Module 18), groups and their current students (Module 20) and parents (Module 17) only through their public services;
 * result recording goes through Smart Guard's exam-compatible entry point (Module 25).
 */
export function getExamService(): ExamService {
  if (!service) {
    service = new ExamService({
      exams: new SequelizeExamRepository(getSequelize()),
      smartGuard: getSmartGuard(),
      teachers: getTeacherService(),
      groups: getGroupService(),
      parents: getParentService(),
      unitOfWork: getUnitOfWork(),
      outbox: getOutboxService(),
      clock: new SystemClock(),
    });
  }
  return service;
}

/** The exam permissions and the exam-scoped examiner resolver are registered ONCE, when this module is loaded, through the shared Authorization Engine. */
registerExamAuthorization({
  policies: getAuthorizationPolicyRegistry(),
  resolvers: getAuthorizationResolvers(),
  exams: { findScopeById: (examId) => getExamService().findScopeById(examId) },
  schools: getSchoolService(),
  teachers: getTeacherService(),
});

let handlersRegistered = false;
/** Call once at startup, before startOutbox(): group membership changes feed the targeted/untargeted events of scheduled exams. */
export function registerExamEventHandlers(): void {
  if (handlersRegistered) return;
  handlersRegistered = true;
  getEventHandlerRegistry().register(createExamGroupMembershipHandler(getExamService));
}

/** Starts the lifecycle job (polls the database every 15 seconds; no Redis needed): starts exams at their start time and completes them at their end time, catching up after downtime. */
export function startExamScheduler(): void {
  if (scheduler) return;
  scheduler = new ExamScheduler({ job: getExamService(), onError: (error) => logger.error('exam scheduler pass failed', { error: String(error) }) });
  scheduler.start();
}

export function stopExamScheduler(): void {
  scheduler?.stop();
  scheduler = undefined;
}
