import type { Request } from 'express';
import { AppError } from '../../../00-shared-kernel/public';
import type { ReportRequester } from '../../../37-reports-core/public';

/**
 * The verified requester of a report: the user and the ACTIVE role of the session (a user with several roles reports under the role they are currently using, never the union).
 * `requireAuthentication` always sets `req.auth`; if it is missing the route was mounted without it, which must never end in an anonymous report. No active role means no report
 * (Module 37 refuses the empty role).
 */
export function reportRequesterOf(req: Request): ReportRequester {
  if (!req.auth) throw new AppError('AUTHENTICATION_REQUIRED', 'UNAUTHENTICATED');
  return { userId: req.auth.userId, activeRole: req.auth.activeRole ?? '' };
}
