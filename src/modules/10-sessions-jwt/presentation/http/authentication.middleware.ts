import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { requestContext } from '../../../05-logging-request-context/public';
import type { AuthPrincipal } from '../../application/dto/auth-result';
import type { SessionService } from '../../application/services/session-service';
import { sessionError } from '../../domain/errors/session-errors';

declare module 'express-serve-static-core' {
  interface Request {
    /** Set by `requireAuthentication` on protected routes. */
    auth?: AuthPrincipal;
  }
}

const BEARER = /^Bearer\s+(\S+)$/i;

export interface RequireAuthenticationOptions {
  /**
   * When true the route stays reachable while the account still has to change its initial password. ONLY the password change and the
   * logouts may set it; every other protected route keeps the default (blocked with 403 PASSWORD_CHANGE_REQUIRED).
   */
  readonly allowPasswordChangePending?: boolean;
}

/**
 * Authentication only ("who is calling"): a valid, unexpired access token whose session is still active and
 * whose user is active, and (unless the route explicitly allows it) whose account has no pending mandatory password change. Authorization (roles, permissions, scope, ownership, business rules) is separate (Module 12).
 * The access token is accepted only from the Authorization header, never from the URL or the body.
 */
export function createRequireAuthentication(
  getService: () => Pick<SessionService, 'authenticate'>,
  options: RequireAuthenticationOptions = {},
): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const header = req.header('authorization');
      const match = header ? BEARER.exec(header.trim()) : null;
      if (!match) throw sessionError('AUTHENTICATION_REQUIRED');

      const principal = await getService().authenticate(match[1]);
      // Backend enforcement of the mandatory first-login password change (account-level, not role-level).
      if (principal.mustChangePassword && options.allowPasswordChangePending !== true) throw sessionError('PASSWORD_CHANGE_REQUIRED');
      req.auth = principal;
      requestContext.update({ actorUserId: principal.userId });
      next();
    } catch (error) {
      next(error);
    }
  };
}
