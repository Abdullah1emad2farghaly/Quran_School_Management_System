import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { rateLimitedError } from '../../../11-otp-password-recovery/public';
import { FixedWindowCounter, type FixedWindowCounterOptions } from './fixed-window-counter';

/**
 * Per-client-IP limit for the PUBLIC school submissions (answers 429 RATE_LIMITED with a Retry-After header, like the
 * password-recovery endpoints). `req.ip` ignores X-Forwarded-For unless the proxy is listed in TRUSTED_PROXIES.
 */
export function createPublicSubmissionRateLimiter(options: FixedWindowCounterOptions): RequestHandler {
  const counter = new FixedWindowCounter(options);
  return (req: Request, _res: Response, next: NextFunction): void => {
    const decision = counter.hit(req.ip ?? 'unknown');
    if (!decision.allowed) {
      next(rateLimitedError(decision.retryAfterSeconds));
      return;
    }
    next();
  };
}
