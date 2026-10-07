# Module 07 — File Infrastructure (delta over Module 06)

Extract at the project root. Replace the files listed under "Replace".

## New
- src/modules/07-file-infrastructure/**
- database/migrations/20261007130000-create-stored-files.js
- src/config/files.ts
- tests/helpers/zip-builder.ts
- tests/unit/files/file-name.test.ts
- tests/unit/files/excel-validator.test.ts
- tests/unit/files/file-service.test.ts
- tests/unit/files/local-file-storage.test.ts
- tests/db/files.test.ts          (real DB checks, NOT run by `npm test`)
- docs/FILES.md

## Replace (existing files changed)
- src/app/bootstrap/register-error-messages.ts   (registers file error messages)
- docs/IMPLEMENTATION-STATUS.md, docs/PROJECT-CHANGELOG.md

## Also replace (from the earlier fix, if you have not yet)
- tests/db/outbox.test.ts

## Packages
No new dependencies. Do not run npm install again.

## Database step (required for the DB test)
  npm run db:migrate        (creates the `stored_files` table)

## Verify
npm run typecheck
npm test
npm run test:db

## Notes
- FILE_STORAGE_PATH (default ./storage, already git-ignored) is created on first upload.
- Upload over HTTP (multipart) arrives with Module 36, which will add the upload library.
