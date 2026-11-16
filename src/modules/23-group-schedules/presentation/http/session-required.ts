import type { Request } from 'express';
import { AppError } from '../../../00-shared-kernel/public';

/** The verified caller of a protected route (`requireAuthentication` always sets `req.auth`; without it the request is refused, never anonymous). */
export function sessionAuthRequired(req: Request): string {
  if (!req.auth) throw new AppError('AUTHENTICATION_REQUIRED', 'UNAUTHENTICATED');
  return req.auth.userId;
}
