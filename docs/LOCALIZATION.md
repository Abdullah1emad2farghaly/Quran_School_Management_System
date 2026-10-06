# Localization & Errors

Owned by Module 03 (`src/modules/03-error-localization`).

## Locales
Supported: `ar`, `en`. System default: `ar`. Fallback: `en`.
Resolution priority: explicit user preference → `Accept-Language` → system default. (User preference is wired in when the identity modules exist.)
Every response carries `Content-Language` and `Vary: Accept-Language`.

## Error response
```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "المورد المطلوب غير موجود.",
    "locale": "ar",
    "requestId": "…",
    "details": { }
  }
}
```
- `code` is stable and never depends on language.
- `details` is only sent for non-internal errors. Internal errors never expose stack traces, SQL, or the original message.
- HTTP status comes from the error `kind` (VALIDATION 400, UNAUTHENTICATED 401, FORBIDDEN 403, NOT_FOUND 404, CONFLICT 409, PAYLOAD_TOO_LARGE 413, BUSINESS_RULE 422, INTERNAL 500).

## Adding errors in a module
1. Add the code (UPPER_SNAKE_CASE) in your module and throw it:
   `throw new AppError('ATTENDANCE_ALREADY_RECORDED', 'CONFLICT', undefined, { date })`
2. Register Arabic **and** English messages at startup (both are mandatory; registration fails otherwise, and duplicate codes are rejected):
   ```ts
   registerErrorMessages([
     { code: 'ATTENDANCE_ALREADY_RECORDED',
       message: { ar: 'تم تسجيل الحضور مسبقًا بتاريخ {date}.', en: 'Attendance was already recorded on {date}.' } },
   ]);
   ```
3. `{name}` placeholders are filled from the error's `params`; missing params stay visible as `{name}`.

## Reuse
`LocalizedText`, `localize`, `interpolate` and `resolveLocale` are exported for reuse by other localized content (e.g. notification templates).

## Field-level errors
Validation errors carry `details.fields[]` of `{ field, code, params? }`. Module 03 adds a localized `message` to each entry; codes missing from the catalog fall back to the generic validation message. See `docs/API-STANDARDS.md`.
