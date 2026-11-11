# Module 36 (Excel Import): implementation notes (release 0.44.0)

## State: IMPLEMENTED, NOT verified, NOT COMPLETED
The implementation environment had **no network access**: `npm install` could not run, so **none of the project's verification commands were executed for Module 36** (no `typecheck`, no `npm test`, no `api:verify`, no `test:db`, no `build`, no migration). The module must not be considered verified or completed until the owner's local run passes.

What WAS checked here: a TypeScript compiler pass over `src/` with the external packages missing (it can only flag errors that are not caused by the missing packages; none were reported in the Module 36 domain and application code or in the changes to Modules 04, 19 and 20), and a smoke run of the pure parsing logic (see the report). Nothing else.

## Commands to run locally
```
npm install                      # installs exceljs, multer, @types/multer and UPDATES package-lock.json (it was not regenerated here)
npm run db:migrate               # applies 20261110100000-create-excel-import-previews.js
npm run typecheck
npm test
npm run api:verify
npm run test:db
npm run build
```
(Use the exact script names in `package.json`; these are the ones the project already defines.)

## Decisions taken without asking (please review)
1. **School selection:** the school is derived from the caller's manager links; for a manager of several schools `?schoolId=` selects ONE of them and the engine verifies it. This is the only client-supplied school value, it never comes from the file, and a school the caller does not manage is a 403.
2. **Arabic vocabulary** for learning mode (`جماعي`/`فردي`) and progression (`للأمام`/`للخلف`) and the Arabic column headers are localization choices, not business rules; the English codes are always accepted. Review the wording.
3. **Existing student without a group, same parent:** assigned to the group (a new membership, nothing existing is changed). Existing group / account data is never modified.
4. **Existing parent with a different stored address:** the stored address is kept; the file's address is still validated.
5. **Retention:** the uploaded file of a confirmed import is kept in Module 07 storage (no audit exists yet). Cancelled and expired previews delete theirs.
6. **Header row detection** searches the first 10 non-empty rows; the templates carry no example row.

## Known issues / risks
- `package-lock.json` is not updated. Versions `multer ^2.0.2`, `exceljs ^4.4.0`, `@types/multer ^2.0.0` were chosen without being able to resolve them; adjust if `npm install` reports a conflict.
- The OpenAPI conformance gates (`lint`, `request-validation`, `error-kinds`, `route-inventory`, `security-drift`) were extended for multipart/binary and **have not been run**; one of them may need a small adjustment.
- Per-row directory queries are cached by phone, National ID, group name and address text; a 10,000-row file still performs many queries and may take noticeable time. It runs inside one HTTP request.
- Memory: ExcelJS loads the whole workbook (at most 10 MB compressed; Module 07 already rejects zip bombs by declared size).
- Module 35 (audit) is not built: imports are not audited yet.
