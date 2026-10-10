import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { body } from 'express-validator';
import { sendNoContent, sendSuccess, validate } from '../../../04-validation-api/public';
import type { AuthResult } from '../../application/dto/auth-result';
import type { SessionService } from '../../application/services/session-service';
import { sessionError } from '../../domain/errors/session-errors';

export interface AuthRouterDeps {
  readonly getService: () => Pick<SessionService, 'login' | 'refresh' | 'logout' | 'logoutAll'>;
  /** Middleware that authenticates the access token (see `createRequireAuthentication`). */
  readonly requireAuthentication: RequestHandler;
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
    roles: result.roles,
  };
}

/**
 * /auth: login, refresh, logout, logout-all.
 * Login and refresh are public (they ARE the authentication); logout and logout-all need a valid access token.
 */
export function createAuthRouter(deps: AuthRouterDeps): Router {
  const router = Router();

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
    deps.requireAuthentication,
    handle(async (req, res) => {
      if (!req.auth) throw sessionError('AUTHENTICATION_REQUIRED');
      await deps.getService().logout(req.auth.sessionId);
      noStore(res);
      sendNoContent(res);
    }),
  );

  router.post(
    '/logout-all',
    deps.requireAuthentication,
    handle(async (req, res) => {
      if (!req.auth) throw sessionError('AUTHENTICATION_REQUIRED');
      await deps.getService().logoutAll(req.auth.userId);
      noStore(res);
      sendNoContent(res);
    }),
  );

  return router;
}
