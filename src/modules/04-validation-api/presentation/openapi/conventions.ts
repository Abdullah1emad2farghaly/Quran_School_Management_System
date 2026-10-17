import { HTTP_STATUS_BY_KIND } from '../../../03-error-localization/public';

const KIND_MEANING: Readonly<Record<string, string>> = {
  VALIDATION: 'Invalid input (field errors are listed in `error.details.fields`) or an invalid state of the submitted data.',
  UNAUTHENTICATED: 'No valid access token, wrong credentials, or an expired/revoked session.',
  FORBIDDEN: 'Authenticated, but not allowed to perform this operation.',
  NOT_FOUND: 'The resource does not exist (or the caller may not know it exists).',
  CONFLICT: 'The request conflicts with the current state (duplicate, concurrent change).',
  BUSINESS_RULE: 'The request is well formed but a business rule forbids it.',
  PAYLOAD_TOO_LARGE: 'The request body is too large.',
  RATE_LIMITED: 'Too many requests; wait for `Retry-After` seconds.',
  INTERNAL: 'Unexpected server error; nothing internal is ever exposed.',
};

/** HTTP status table, generated from the real mapping so the documentation cannot drift from `HTTP_STATUS_BY_KIND`. */
function statusTable(): string {
  const rows = Object.entries(HTTP_STATUS_BY_KIND)
    .sort(([, a], [, b]) => a - b)
    .map(([kind, status]) => `| ${status} | ${kind} | ${KIND_MEANING[kind] ?? ''} |`);
  return ['| HTTP | Error kind | Meaning |', '|---|---|---|', ...rows].join('\n');
}

/** The cross-cutting API conventions shown at the top of Swagger UI (docs/API-STANDARDS.md has the rationale). */
export function apiConventionsMarkdown(basePath: string): string {
  return `QSMS REST API. All endpoints live under \`${basePath}\`. This page is generated from the typed contracts in the source tree and is checked against the real routes by the test suite.

## Authentication
1. Call \`POST ${basePath}/auth/login\` with a phone number and password.
2. Copy \`data.accessToken\` from the answer, click **Authorize** and paste the token (Swagger UI adds the \`Bearer\` prefix).
3. Protected operations now send \`Authorization: Bearer <token>\`. The token is accepted **only** in this header. When it expires, use \`POST ${basePath}/auth/refresh\`.

Every operation states its own authentication mode, roles, scope and enforcement. Where the permission-registry entry or scope resolver is not defined yet, the operation says so ("deferred"); nothing is assumed.

## Response envelopes
- Success: \`{ "success": true, "data": ..., "meta"?: ..., "requestId": "..." }\` (204 answers have no body).
- Error: \`{ "success": false, "error": { "code", "message", "locale", "requestId", "details"? } }\`. The \`code\` is stable and language independent; the \`message\` is localized.
- Field errors travel as \`error.details.fields[] = { field, code, message }\`.

## HTTP status mapping
${statusTable()}

## Pagination, sorting, filtering
- \`page\` (default 1) and \`pageSize\` (default 20; values above 100 are capped at 100).
- Paginated answers return \`data\` as an array and \`meta = { page, pageSize, total, totalPages }\`.
- \`sort=name,-createdAt\`: comma-separated whitelisted fields, a leading \`-\` is descending (at most 3 fields). Each list endpoint documents its own fields.
- \`filter[field]=value\`: only the filters documented on the endpoint; some accept comma-separated lists.
- Unknown query parameters, sort fields or filters are rejected with 400 \`VALIDATION_FAILED\` (field codes such as \`UNKNOWN_QUERY_PARAMETER\`).

## Localization
- Send \`Accept-Language\` (\`ar\` or \`en\`). Messages are returned in that language; otherwise the server default applies. The answer carries \`Content-Language\`.
- Error and field-error \`code\` values never change with the language.

## Request tracing
Send \`X-Request-Id\` (or \`X-Correlation-Id\`) to correlate a call; it is echoed in the \`X-Request-Id\` header and in \`requestId\`. A valid id is generated when it is missing or malformed.

## Rate limiting
Public submission and password-recovery endpoints can answer 429 \`RATE_LIMITED\` with a \`Retry-After\` header (seconds).
`;
}
