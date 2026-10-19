import type { Request } from 'express';
import { AppError } from '../../../00-shared-kernel/public';

/**
 * The verified caller of a protected route. `requireAuthentication` always sets `req.auth`; if it is missing the route
 * was mounted without it, which must never end in an anonymous action, so the request is refused.
 */
export function sessionAuthRequired(req: Request): string {
  if (!req.auth) throw new AppError('AUTHENTICATION_REQUIRED', 'UNAUTHENTICATED');
  return req.auth.userId;
}
