# API Documentation (OpenAPI / Swagger UI)

**Project-wide requirement:** every API endpoint of every module is documented in the OpenAPI document served by the application and
verified against the real implementation. A module cannot be COMPLETED while one of its endpoints is undocumented or its
documentation is outdated.

## Where to find it
| What | URL (local default, `PORT` from `.env`, default 3000) |
|---|---|
| Swagger UI | `http://localhost:3000/api-docs` |
| Raw OpenAPI 3.0 document (JSON) | `http://localhost:3000/api-docs.json` |

Both live OUTSIDE `/api/v1`, so no API route is affected. The document's server is the relative URL `/api/v1`, so "Try it out" works
on any host and port. To call a protected endpoint: run `POST /auth/login`, copy `data.accessToken`, press **Authorize** and paste it
(Swagger UI remembers it across page reloads).

**Exposure rule (approved):** enabled by default outside production, disabled by default in production unless `API_DOCS_ENABLED=true`
(`docs/CONFIGURATION.md`). When disabled both URLs answer the standard `404 NOT_FOUND` envelope. If the document cannot be built the
application logs the error and still starts (docs off); the tests fail instead.

## One source of truth
The contract is written ONCE, as typed TypeScript next to the routes it describes, and everything else is generated or verified:

| Piece | Location |
|---|---|
| Builder kit (types, schema helpers, standard envelopes, standard errors, `listQueryParameters(spec)`, document assembly) | `src/modules/04-validation-api/presentation/openapi/` (exported by Module 04's `public/`) |
| One contract per module (operations, schemas, examples) | `src/modules/NN-name/presentation/http/*.openapi.ts` (health: `src/app/routes/health.openapi.ts`) |
| Registry of all contracts | `src/app/openapi/api-documents.ts` |
| Serving (Swagger UI, `/api-docs.json`) | `src/app/openapi/serve-api-docs.ts`, mounted by `createApp()` |
| Error messages in the examples | taken from the real message catalog, never retyped |
| Query parameters of list endpoints | generated from the same `ListQuerySpec` the route parses with |
| Enumerations (statuses, types, roles) | imported from the domain constants |

No generated `openapi.json` is committed. `npm run api:export` writes an optional copy to `dist/openapi.json` (git-ignored).

## What every operation documents
Method and full path (`x-full-path`, `/api/v1/...`), summary and description, the `**Authorization**` block (authentication
none/optional/required, roles, scope, how it is enforced, the permission id, the decision status and the reference to
`docs/AUTHORIZATION-MATRIX.md`), path/query/header parameters, request body schema with validation constraints and examples, the
success response with schema and example, and the error responses that apply with one example per error code. The builder adds the
standard ones: 400 `VALIDATION_FAILED` (+ `INVALID_JSON`) for input, 413 `PAYLOAD_TOO_LARGE` for bodies, 401/403 for protected
operations, 429 with `Retry-After` for rate-limited ones, and 500 `INTERNAL_ERROR`.

Rules that keep the documentation honest:
- **Never invent.** Roles, scope and permission ids are copied from `docs/AUTHORIZATION-MATRIX.md` and the Master Specification. A
  decision that is not made yet is labelled `PROVISIONAL` / permission id `null (deferred)` and the enforcement text says what the
  service really does today.
- Constraints that the **validators** enforce (`required`, `maxLength`, `format: uuid`) are written as schema keywords and are
  PROBED by the tests. Constraints answered by the **service** (value ranges, business rules, password policy) are written in the
  description and in the error responses.
- Documented behavior is the actual behavior: for example the organization list validates `sort` but applies no client ordering, and
  the school list applies only the first sort field.

### Common conventions (also in the Swagger UI introduction)
Success envelope `{ success, data, meta?, requestId }`; error envelope `{ success:false, error:{ code, message, locale, requestId?,
details? } }`; `error.details` is `{ fields:[{field, code, message}] }` for validation errors and, for a few business errors
(address validation), a plain array of `{ field, code }` (not localized). Pagination (`page`, `pageSize`, capped at 100,
`meta.{page,pageSize,total,totalPages}`), sorting (`sort=name,-createdAt`, whitelist), filtering (`filter[x]=a,b`), `Accept-Language`
(`ar` default, `en`), `X-Request-Id`, `Content-Language`, `Cache-Control: no-store` on token endpoints. Rules: `docs/API-STANDARDS.md`.

## Adding or changing an endpoint (module completion criteria)
1. Write or update the module's `*.openapi.ts` (operation, schemas, examples) and register new contracts in `api-documents.ts`.
2. Add real calls for the new operation to the module's conformance test in `tests/api-docs/conformance/` and keep its
   `assertAllExercised('<moduleId>')` call.
3. Run `npm run api:verify` (and the full `npm test`). A module is COMPLETED only when it passes.
4. Do not change a validator, handler, envelope or error code to make documentation pass: fix the documentation.

## Verification (`npm run api:verify`, part of `npm test`)
| Test (`tests/api-docs/`) | Fails when |
|---|---|
| `route-inventory.test.ts` | a route served by the REAL router (nested routers, every HTTP method) is not documented, or a documented operation is not served; a route that cannot be mapped fails clearly instead of being skipped (`support/route-discovery.ts`) |
| `completion-gate.test.ts` | a module that declares a Router has no registered contract, or a contract has no conformance test calling `assertAllExercised` |
| `conformance/*.test.ts` | a REAL response (existing in-memory HTTP harnesses) has an undocumented status, a body that does not match the documented schema, an undocumented error code, or a missing required header; or a documented operation was never exercised with its success response |
| `request-validation.test.ts` | a documented request example, path example or query example is rejected by the real validators; a documented `required`/`maxLength`/`uuid` constraint is not enforced; a value exactly at `maxLength` is rejected |
| `security-drift.test.ts` | the documented authentication differs from the REAL middleware (protected operations must answer 401 without a token; public ones must not) |
| `error-kinds.test.ts` | a documented error code is not in the message catalog (ar and en) or is documented with a status other than the one its real error kind answers |
| `document-builder.test.ts`, `api-docs-endpoint.test.ts` | the document is not valid OpenAPI 3.0, a `$ref` does not resolve, an operation lacks a required part, an example does not match its own schema, or Swagger UI / the exposure rule misbehave |

## Known limits
- Value ranges and business rules are not probed by the request test (they live in the service and are covered by the module tests).
- Real responses are verified through the in-memory harnesses; the MariaDB suite (`npm run test:db`) is separate.
- The route inventory reads Express 4's router stack; a route registered in a way it cannot decode fails the test (extend
  `support/route-discovery.ts`) instead of passing silently.
