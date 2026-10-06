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
  // Full details (stack, cause) go to the log only; the client never sees them.
  if (status >= 500) logger.error('unhandled error', { requestId: req.requestId, err });
  res.status(status).json(body);
}
