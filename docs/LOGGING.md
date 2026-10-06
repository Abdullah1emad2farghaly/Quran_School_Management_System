# Logging & Request Context

Owned by Module 05 (`src/modules/05-logging-request-context`). No external logging library: a small structured JSON logger.

## Log entries
One JSON object per line:
```json
{"level":"info","time":"2026-01-01T00:00:00.000Z","msg":"request completed","requestId":"…","service":"qsms","method":"GET","path":"/api/v1/health","status":200,"durationMs":1.4}
```
- Levels: `debug < info < warn < error`; `LOG_LEVEL=silent` disables output (default in tests). `error`/`warn` go to stderr, others to stdout.
- `requestId` (and `actorUserId` once authenticated) are added automatically from the request context.
- `level`, `time`, `msg` cannot be overridden by fields.

## What is never logged
Passwords, plaintext OTPs, tokens (refresh/access), secrets, authorization data. Enforced centrally:
- keys such as `password`, `otp*`, `*token*`, `*secret*`, `authorization`, `cookie`, `apiKey`, `credential`, `jwt`, `privateKey` are replaced with `[REDACTED]` at any depth (any naming style: camelCase, snake_case, kebab-case);
- strings are scanned for JWTs, `Bearer …` values and `scheme://user:password@host` credentials;
- the access log records method, path (**no query string**), status and duration only — never headers or bodies.

Do not bypass the logger (`console.log`) for anything that may contain request data.

## Usage
```ts
import { logger } from '../config/logger';            // composition root
const log = logger.child({ module: 'attendance' });   // fixed fields for a module
log.info('attendance recorded', { sessionId, count });
log.error('unhandled error', { err });                // Error objects are serialized (name, message, code, kind, stack, cause)
```
Application/domain code should depend on the `Logger` port from `modules/05-logging-request-context/public`.

## Request ID / context
- Every request gets an ID: a client-supplied `X-Request-Id` (or `X-Correlation-Id`) is reused only if it matches `[A-Za-z0-9._-]{8,64}`; otherwise a UUID is generated.
- The ID is returned in the `X-Request-Id` header, in error responses and success envelopes, and in every log line of that request.
- `requestContext.get()` / `.requestId()` / `.update({ actorUserId })` read and extend the per-request context (AsyncLocalStorage); concurrent requests are isolated.
