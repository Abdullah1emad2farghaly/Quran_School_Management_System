import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { body } from 'express-validator';
import { sendNoContent, sendSuccess, validate } from '../../../04-validation-api/public';
import type { PasswordRecoveryService } from '../../application/services/password-recovery-service';

export interface RecoveryRouterDeps {
  readonly getService: () => Pick<PasswordRecoveryService, 'requestRecovery' | 'verifyOtp' | 'resetPassword'>;
}

type AsyncHandler = (req: Request, res: Response) => Promise<void>;
const handle =
  (fn: AsyncHandler): RequestHandler =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res).catch(next);
  };

/** OTPs, reset tokens and their answers must never be cached. */
function noStore(res: Response): void {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
}

const text = (field: string, max: number) =>
  body(field).isString().withMessage('INVALID_VALUE').bail().notEmpty().withMessage('REQUIRED_FIELD').isLength({ max }).withMessage('INVALID_VALUE');

/**
 * /auth/password-recovery (all public: the caller is by definition not logged in):
 *   POST /request  { phone }                     -> 200 { expiresInSeconds }   (same answer for every phone)
 *   POST /verify   { phone, otp }                -> 200 { resetToken, resetTokenExpiresAt }
 *   POST /reset    { resetToken, newPassword }   -> 204
 * Rate limiting answers 429 RATE_LIMITED with a Retry-After header (the error handler adds it). The client IP is
 * `req.ip`, which ignores X-Forwarded-For unless the proxy is listed in TRUSTED_PROXIES.
 */
export function createRecoveryRouter(deps: RecoveryRouterDeps): Router {
  const router = Router();

  router.post(
    '/request',
    validate(text('phone', 40)),
    handle(async (req, res) => {
      const result = await deps.getService().requestRecovery({ phone: req.body.phone, clientIp: req.ip });
      noStore(res);
      sendSuccess(res, { expiresInSeconds: result.expiresInSeconds });
    }),
  );

  router.post(
    '/verify',
    validate(text('phone', 40), text('otp', 32)),
    handle(async (req, res) => {
      const result = await deps.getService().verifyOtp({ phone: req.body.phone, otp: req.body.otp });
      noStore(res);
      sendSuccess(res, { resetToken: result.resetToken, resetTokenExpiresAt: result.resetTokenExpiresAt.toISOString() });
    }),
  );

  router.post(
    '/reset',
    validate(text('resetToken', 200), text('newPassword', 128)),
    handle(async (req, res) => {
      await deps.getService().resetPassword({ resetToken: req.body.resetToken, newPassword: req.body.newPassword });
      noStore(res);
      sendNoContent(res);
    }),
  );

  return router;
}
