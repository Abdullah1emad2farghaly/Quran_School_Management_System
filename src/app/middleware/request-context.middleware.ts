import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { env, type Locale } from '../../config/env';
import { requestContext } from '../../modules/05-logging-request-context/infrastructure/services/request-context';
import { resolveLocale } from '../../modules/03-error-localization/public';

const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

/** Reuses a client-provided request ID only if it is safe; otherwise generates one. */
export function resolveRequestId(incoming: string | undefined): string {
  return incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
}

declare module 'express-serve-static-core' {
  interface Request {
    requestId: string;
    locale: Locale;
  }
}

export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = resolveRequestId(req.header('x-request-id') ?? req.header('x-correlation-id'));
  // Explicit user preference is added when the identity modules exist.
  const locale = resolveLocale({
    acceptLanguage: req.header('accept-language'),
    defaultLocale: env.defaultLocale,
  });
  req.requestId = requestId;
  req.locale = locale;
  res.setHeader('X-Request-Id', requestId);
  res.setHeader('Content-Language', locale);
  res.vary('Accept-Language');
  requestContext.run({ requestId, locale }, next);
}
