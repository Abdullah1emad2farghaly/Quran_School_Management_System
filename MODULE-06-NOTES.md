# Module 06 — Domain Events & Transactional Outbox (delta over Module 05)

Extract at the project root. Replace the files listed under "Replace".

## New
- src/modules/06-domain-events-outbox/**   (domain, application, infrastructure, public)
- database/migrations/20261007120000-create-outbox-messages.js
- src/config/outbox.ts
- tests/unit/outbox/retry-and-events.test.ts
- tests/unit/outbox/outbox-service.test.ts
- tests/unit/outbox/outbox-processor.test.ts
- tests/unit/outbox/outbox-scheduler.test.ts
- tests/db/outbox.test.ts          (real DB checks, NOT run by `npm test`)
- docs/EVENTS-OUTBOX.md

## Replace (existing files changed)
- src/app/server.ts                 (starts/stops the outbox processor)
- docs/ARCHITECTURE.md, docs/IMPLEMENTATION-STATUS.md, docs/PROJECT-CHANGELOG.md

## Packages
No new dependencies (no Redis/BullMQ needed yet). Do not run npm install again.

## Database step (required)
With XAMPP MariaDB running and the database from your .env created:
  npm run db:migrate
This creates the `outbox_messages` table (and sequelize-cli's `SequelizeMeta` bookkeeping table).
Until you migrate, `npm run dev` logs one "outbox processing failed" error per minute; that is expected.

## Verify
npm run typecheck
npm test
npm run test:db        (after migrating; uses rows with event type "Test.*" and year-2001 timestamps, then deletes them)
