import type { RequestHandler } from 'express';
import type { Logger } from '../../application/ports/logger';
import { requestContext } from '../../infrastructure/services/request-context';

/**
 * Access log: one entry per completed request with method, path (no query
 * string), status and duration. Headers, query values and bodies are never logged.
 */
export function createRequestLogger(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const startedAt = process.hrtime.bigint();
    const context = requestContext.get();

    res.on('finish', () => {
      const durationMs = Math.round(Number(process.hrtime.bigint() - startedAt) / 1e5) / 10;
      const status = res.statusCode;
      const write = (): void => {
        const fields = { method: req.method, path: req.originalUrl.split('?')[0], status, durationMs };
        if (status >= 500) logger.error('request completed', fields);
        else if (status >= 400) logger.warn('request completed', fields);
        else logger.info('request completed', fields);
      };
      // 'finish' may fire outside the request's async context; restore it explicitly.
      if (context) requestContext.run(context, write);
      else write();
    });
    next();
  };
}
