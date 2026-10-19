import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { body } from 'express-validator';
import { sendNoContent, sendSuccess, validate } from '../../../04-validation-api/public';
import type { AuthResult } from '../../application/dto/auth-result';
import type { SessionService } from '../../application/services/session-service';
import { sessionError } from '../../domain/errors/session-errors';

export interface AuthRouterDeps {
  readonly getService: () => Pick<SessionService, 'login' | 'refresh' | 'logout' | 'logoutAll' | 'changePassword'>;
  /** Middleware that authenticates the access token (see `createRequireAuthentication`). */
  readonly requireAuthentication: RequestHandler;
  /**
   * Same authentication but ALSO accepted while the account must still change its initial password (`allowPasswordChangePending`).
   * Used only by `/auth/change-password`, `/auth/logout` and `/auth/logout-all`. Falls back to the strict middleware when omitted.
   */
  readonly requireAuthenticationAllowingPasswordChange?: RequestHandler;
}

type AsyncHandler = (req: Request, res: Response) => Promise<void>;
const handle =
  (fn: AsyncHandler): RequestHandler =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };

/** Token responses must never be cached by browsers or proxies. */
function noStore(res: Response): void {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
}

function serialize(result: AuthResult) {
  return {
    tokenType: result.tokenType,
    accessToken: result.accessToken,
    accessTokenExpiresAt: result.accessTokenExpiresAt.toISOString(),
    refreshToken: result.refreshToken,
    refreshTokenExpiresAt: result.refreshTokenExpiresAt.toISOString(),
    user: result.user,
    mustChangePassword: result.mustChangePassword,
    roles: result.roles,
  };
}

/**
 * /auth: login, refresh, logout, logout-all, change-password.
 * Login and refresh are public (they ARE the authentication); logout, logout-all and change-password need a valid access token and are
 * the ONLY authenticated routes that stay open while the account still has to change its initial password.
 */
export function createAuthRouter(deps: AuthRouterDeps): Router {
  const router = Router();
  const authAllowingPasswordChange = deps.requireAuthenticationAllowingPasswordChange ?? deps.requireAuthentication;

  router.post(
    '/login',
    validate(
      body('phone').isString().withMessage('INVALID_VALUE').bail().trim().notEmpty().withMessage('REQUIRED_FIELD').isLength({ max: 40 }).withMessage('INVALID_VALUE'),
      body('password').isString().withMessage('INVALID_VALUE').bail().notEmpty().withMessage('REQUIRED_FIELD').isLength({ max: 128 }).withMessage('INVALID_VALUE'),
    ),
    handle(async (req, res) => {
      const result = await deps.getService().login({ phone: req.body.phone, password: req.body.password });
      noStore(res);
      sendSuccess(res, serialize(result));
    }),
  );

  router.post(
    '/refresh',
    validate(body('refreshToken').isString().withMessage('INVALID_VALUE').bail().notEmpty().withMessage('REQUIRED_FIELD').isLength({ max: 200 }).withMessage('INVALID_VALUE')),
    handle(async (req, res) => {
      const result = await deps.getService().refresh(req.body.refreshToken);
      noStore(res);
      sendSuccess(res, serialize(result));
    }),
  );

  router.post(
    '/logout',
    authAllowingPasswordChange,
    handle(async (req, res) => {
      if (!req.auth) throw sessionError('AUTHENTICATION_REQUIRED');
      await deps.getService().logout(req.auth.sessionId);
      noStore(res);
      sendNoContent(res);
    }),
  );

  router.post(
    '/logout-all',
    authAllowingPasswordChange,
    handle(async (req, res) => {
      if (!req.auth) throw sessionError('AUTHENTICATION_REQUIRED');
      await deps.getService().logoutAll(req.auth.userId);
      noStore(res);
      sendNoContent(res);
    }),
  );

  router.post(
    '/change-password',
    authAllowingPasswordChange,
    validate(
      body('currentPassword').isString().withMessage('INVALID_VALUE').bail().notEmpty().withMessage('REQUIRED_FIELD').isLength({ max: 128 }).withMessage('INVALID_VALUE'),
      body('newPassword').isString().withMessage('INVALID_VALUE').bail().notEmpty().withMessage('REQUIRED_FIELD').isLength({ max: 128 }).withMessage('INVALID_VALUE'),
    ),
    handle(async (req, res) => {
      if (!req.auth) throw sessionError('AUTHENTICATION_REQUIRED');
      await deps.getService().changePassword(req.auth.userId, { currentPassword: req.body.currentPassword, newPassword: req.body.newPassword });
      noStore(res);
      sendNoContent(res);
    }),
  );

  return router;
}
