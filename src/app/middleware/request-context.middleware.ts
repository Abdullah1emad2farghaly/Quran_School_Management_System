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

const MAX_USER_AGENT_LENGTH = 255;
/** Header text for the audit trail: control characters removed, trimmed, truncated; undefined when empty. */
export function sanitizeUserAgent(raw: string | undefined): string | undefined {
  // eslint-disable-next-line no-control-regex
  const clean = (raw ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_USER_AGENT_LENGTH);
  return clean === '' ? undefined : clean;
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
  const ipAddress = typeof req.ip === 'string' && req.ip !== '' ? req.ip.slice(0, 64) : undefined;
  const userAgent = sanitizeUserAgent(req.header('user-agent'));
  requestContext.run({ requestId, locale, ...(ipAddress ? { ipAddress } : {}), ...(userAgent ? { userAgent } : {}) }, next);
}
