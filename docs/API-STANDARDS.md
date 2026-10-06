# API Standards

Owned by Module 04 (`src/modules/04-validation-api`). Base path: `/api/v1`.

## Success envelope
```json
{ "success": true, "data": { }, "meta": { }, "requestId": "…" }
```
Use `sendSuccess`, `sendCreated` (201), `sendPaginated`, `sendNoContent` (204).
Paginated: `data` is the item array and `meta` is `{ page, pageSize, total, totalPages }`.

## Errors
See `docs/LOCALIZATION.md`. Validation failures are `400 VALIDATION_FAILED` with every problem listed:
```json
{ "success": false, "error": { "code": "VALIDATION_FAILED", "message": "…", "locale": "ar", "requestId": "…",
  "details": { "fields": [ { "field": "sort", "code": "UNKNOWN_SORT_FIELD", "message": "…" } ] } } }
```
Field `code` is stable and language-independent; `message` is localized. Submitted values are never echoed.

## List endpoints
Each list endpoint declares a `ListQuerySpec` and calls `parseListQuery(req.query, spec)`:

```ts
const spec: ListQuerySpec = {
  sortable: { name: 'name', createdAt: 'created_at' },        // public name -> internal key
  defaultSort: [{ key: 'created_at', direction: 'desc' }],
  filters: {
    status:   { type: 'enum', values: ['active', 'inactive'], multiple: true },
    schoolId: { type: 'uuid' },
    from:     { type: 'date' },
  },
  search: { maxLength: 100 },
};
const q = parseListQuery(req.query, spec); // q.page, q.sort, q.filters, q.search
```

| Query | Rule |
|---|---|
| `page`, `pageSize` | positive integers; default 1 / 20; `pageSize` above 100 is capped at 100; malformed values are rejected |
| `sort=name,-createdAt` | whitelist only; `-` = descending; max 3 fields (configurable); duplicates ignored |
| `filter[status]=a,b` | whitelist only; types: string, integer, boolean, uuid, date (YYYY-MM-DD), enum; `multiple` allows comma lists (max 50) |
| `search` | only if the spec declares it; trimmed; empty is ignored |
| anything else | rejected as `UNKNOWN_QUERY_PARAMETER` |

Clients can never supply column names: sort keys come from the whitelist, and filter values are typed before reaching a repository.

## Body / params validation (express-validator)
```ts
router.post('/schools',
  validate(body('name').trim().notEmpty().withMessage('REQUIRED_FIELD')),
  controller.create);
```
Use a stable error code as the chain message (`REQUIRED_FIELD`, `INVALID_VALUE`, or a module code registered in the message catalog). Any other message becomes `INVALID_VALUE`.

## Registering messages
Validation messages are in `VALIDATION_ERROR_MESSAGES` and registered once by `src/app/bootstrap/register-error-messages.ts`. Add each new module's messages there.
