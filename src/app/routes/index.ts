import { Router } from 'express';
import { requireAuthentication, getSessionService } from '../../config/sessions';
import { getOrganizationRegistrationService, getSchoolService, PUBLIC_SUBMISSION_RATE_LIMIT } from '../../config/schools';
import { getPasswordRecoveryService } from '../../config/password-recovery';
import { createAuthRouter } from '../../modules/10-sessions-jwt/public';
import { createRecoveryRouter } from '../../modules/11-otp-password-recovery/public';
import { createOrganizationRouter, createPublicSubmissionRateLimiter, createSchoolRouter } from '../../modules/16-schools/public';
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
      publicSubmissionLimit: createPublicSubmissionRateLimiter(PUBLIC_SUBMISSION_RATE_LIMIT),
    }),
  );
  router.use(
    '/schools',
    createSchoolRouter({
      getService: getSchoolService,
      requireAuthentication,
      publicSubmissionLimit: createPublicSubmissionRateLimiter(PUBLIC_SUBMISSION_RATE_LIMIT),
    }),
  );
  router.use('/auth', createAuthRouter({ getService: getSessionService, requireAuthentication }));
  return router;
}
