import type { NextFunction, Request, Response } from 'express';
import { AppError, ErrorCodes } from '../../modules/00-shared-kernel/public';
import { toErrorResponse } from '../../modules/03-error-localization/public';
import { logger } from '../../config/logger';

export function notFoundHandler(_req: Request, _res: Response, next: NextFunction): void {
  next(new AppError(ErrorCodes.NOT_FOUND, 'NOT_FOUND'));
}

/** Centralized error handler (thin wrapper over Module 03). Never leaks internals. */
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(err);
    return;
  }
  const { status, body } = toErrorResponse(err, { locale: req.locale, requestId: req.requestId });
  // Rate-limited requests tell the client when to retry (seconds, as HTTP requires).
  if (err instanceof AppError && err.kind === 'RATE_LIMITED') {
    const seconds = (err.details as { retryAfterSeconds?: unknown } | undefined)?.retryAfterSeconds;
    if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0) res.setHeader('Retry-After', String(Math.ceil(seconds)));
  }
  // Full details (stack, cause) go to the log only; the client never sees them.
  if (status >= 500) logger.error('unhandled error', { requestId: req.requestId, err });
  res.status(status).json(body);
}
