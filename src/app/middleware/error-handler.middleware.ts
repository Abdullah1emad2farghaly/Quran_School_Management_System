import type { NextFunction, Request, Response } from 'express';
import { AppError, ErrorCodes } from '../../modules/00-shared-kernel/public';
import { toErrorResponse } from '../../modules/03-error-localization/public';
import { env } from '../../config/env';

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
  if (status >= 500 && env.nodeEnv !== 'test') {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ level: 'error', requestId: req.requestId, err: String(err) }));
  }
  res.status(status).json(body);
}
