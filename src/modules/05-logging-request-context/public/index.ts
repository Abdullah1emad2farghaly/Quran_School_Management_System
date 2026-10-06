// Public contract of Module 05 (Logging & Request Context).
export type { Logger, LogFields } from '../application/ports/logger';
export { requestContext, type RequestContext } from '../infrastructure/services/request-context';
export {
  createLogger,
  consoleSink,
  type CreateLoggerOptions,
  type LogSink,
  type EmittedLevel,
} from '../infrastructure/services/structured-logger';
export { resolveRequestId } from '../domain/services/request-id';
export { redact, sanitizeString, isSensitiveKey, REDACTED, type RedactOptions } from '../domain/services/redact';
export { createRequestLogger } from '../presentation/http/request-logger.middleware';
