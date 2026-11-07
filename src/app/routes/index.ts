import { Router } from 'express';
import { requirePermission } from '../../config/authorization';
import { requireAuthentication, requireAuthenticationAllowingPasswordChange, getSessionService } from '../../config/sessions';
import { getOrganizationRegistrationService, getSchoolService, PUBLIC_SUBMISSION_RATE_LIMIT } from '../../config/schools';
import { getParentService } from '../../config/parents';
import { getTeacherService } from '../../config/teachers';
import { getStudentService } from '../../config/students';
import { getGroupService } from '../../config/groups';
import { getAttendanceService } from '../../config/attendance';
import { getEvaluationService } from '../../config/evaluations';
import { getExamService } from '../../config/exams';
import { getNotificationService, getPushSubscriptionService } from '../../config/notifications';
import { getMemorizationService } from '../../config/memorization';
import { getRevisionService } from '../../config/revision';
import { getClassSessionService } from '../../config/class-sessions';
import { getGroupScheduleService } from '../../config/schedules';
import { getQuranStructureService } from '../../config/quran';
import { getPasswordRecoveryService } from '../../config/password-recovery';
import { createAuthRouter } from '../../modules/10-sessions-jwt/public';
import { createRecoveryRouter } from '../../modules/11-otp-password-recovery/public';
import { createOrganizationRouter, createPublicSubmissionRateLimiter, createSchoolRouter } from '../../modules/16-schools/public';
import { createParentRouter } from '../../modules/17-parents/public';
import { createTeacherRouter } from '../../modules/18-teachers/public';
import { createStudentRouter } from '../../modules/19-students/public';
import { createGroupRouter } from '../../modules/20-groups/public';
import { createScheduleRouter } from '../../modules/23-group-schedules/public';
import { createSessionRouter } from '../../modules/24-sessions/public';
import { createAttendanceRouter } from '../../modules/26-attendance/public';
import { createEvaluationRouter } from '../../modules/29-evaluations/public';
import { createExamRouter } from '../../modules/30-exams/public';
import { createNotificationRouter } from '../../modules/31-notifications-core/public';
import { createMemorizationRouter } from '../../modules/27-memorization/public';
import { createRevisionRouter } from '../../modules/28-revision/public';
import { createQuranRouter } from '../../modules/21-quran-structure/public';
import { healthRouter } from './health.routes';

export const API_BASE_PATH = '/api/v1';

/** Module routers are mounted here as their phases are implemented. */
export function buildApiRouter(): Router {
  const router = Router();
  router.use('/health', healthRouter);
  router.use('/auth/password-recovery', createRecoveryRouter({ getService: getPasswordRecoveryService }));
  router.use(
    '/organizations',
    createOrganizationRouter({
      getService: getOrganizationRegistrationService,
      requireAuthentication,
      requirePermission,
      publicSubmissionLimit: createPublicSubmissionRateLimiter(PUBLIC_SUBMISSION_RATE_LIMIT),
    }),
  );
  router.use(
    '/schools',
    createSchoolRouter({
      getService: getSchoolService,
      requireAuthentication,
      requirePermission,
      publicSubmissionLimit: createPublicSubmissionRateLimiter(PUBLIC_SUBMISSION_RATE_LIMIT),
    }),
  );
  router.use('/parents', createParentRouter({ getService: getParentService, requireAuthentication, requirePermission }));
  router.use('/teachers', createTeacherRouter({ getService: getTeacherService, requireAuthentication, requirePermission }));
  router.use('/students', createStudentRouter({ getService: getStudentService, requireAuthentication, requirePermission }));
  router.use('/groups', createGroupRouter({ getService: getGroupService, requireAuthentication, requirePermission }));
  router.use('/group-schedules', createScheduleRouter({ getService: getGroupScheduleService, requireAuthentication, requirePermission }));
  router.use('/sessions', createSessionRouter({ getService: getClassSessionService, requireAuthentication, requirePermission }));
  router.use('/attendance', createAttendanceRouter({ getService: getAttendanceService, requireAuthentication, requirePermission }));
  router.use('/memorization', createMemorizationRouter({ getService: getMemorizationService, requireAuthentication, requirePermission }));
  router.use('/revision', createRevisionRouter({ getService: getRevisionService, requireAuthentication, requirePermission }));
  router.use('/evaluations', createEvaluationRouter({ getService: getEvaluationService, requireAuthentication, requirePermission }));
  router.use('/exams', createExamRouter({ getService: getExamService, requireAuthentication, requirePermission }));
  router.use('/notifications', createNotificationRouter({ getNotifications: getNotificationService, getPush: getPushSubscriptionService, requireAuthentication }));
  router.use('/quran', createQuranRouter({ getService: getQuranStructureService, requireAuthentication, requirePermission }));
  router.use('/auth', createAuthRouter({ getService: getSessionService, requireAuthentication, requireAuthenticationAllowingPasswordChange }));
  return router;
}
