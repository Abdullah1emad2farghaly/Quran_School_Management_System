import type { NextFunction, Request, Response } from 'express';
import { env, type Locale } from '../../config/env';
import { resolveLocale } from '../../modules/03-error-localization/public';
import { requestContext, resolveRequestId } from '../../modules/05-logging-request-context/public';

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
