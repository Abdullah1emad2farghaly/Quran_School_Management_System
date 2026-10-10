# Database

Owned by Module 02 (`src/modules/02-database`). Target: **MariaDB 10.4 (XAMPP)** through Sequelize's `mysql` dialect.

## Conventions
- Charset/collation: `utf8mb4` / `utf8mb4_unicode_ci` (Arabic-safe), InnoDB.
- Timestamps: `DATETIME(3)` stored in **UTC**; business timezone (Africa/Cairo) is applied in the app. Avoid `TIMESTAMP` (2038) and `CONVERT_TZ`.
- Column names: snake_case (`underscored: true`); `created_at` / `updated_at`.
- UUIDs: `CHAR(36)` (MariaDB 10.4 has no native UUID type). Internal technical ids are UUIDs unless a module's spec says otherwise.
- JSON: store as `TEXT` and serialize in code (MariaDB's JSON is an alias of LONGTEXT).
- Not available in 10.4: native UUID type, partial/functional indexes. Use generated columns or application logic for such invariants.
- Schema changes only through migrations (`database/migrations`), never `sync({ alter: true })`.
- Migration helpers: `database/helpers.cjs` (`TABLE_OPTIONS`, `uuidPrimaryKey`, `auditTimestamps`).

## Transactions
Application code depends on the `UnitOfWork` port (Shared Kernel), never on Sequelize.

```ts
await unitOfWork.run(async (tx) => {
  await repo.save(entity, tx);       // repository unwraps with sequelizeTransactionOf(tx)
  await outbox.add(event, tx);       // business change + outbox event commit atomically
});
```
- Commit on success, rollback on any thrown error (error is rethrown unchanged).
- Nested `run` joins the active transaction; only the outermost call commits/rolls back.
- Repositories (infrastructure layer only) call `sequelizeTransactionOf(tx)` from `modules/02-database/public` and pass the result as Sequelize's `transaction` option.
- Composition root: `getUnitOfWork()` in `src/config/database.ts`.

## Tests
- `npm test` — unit tests (no database needed).
- `npm run test:db` — real MariaDB checks (connect, utf8mb4, commit, rollback, nested rollback, Arabic round-trip). Uses a TEMPORARY table; needs the database from `.env` to exist (create it first in phpMyAdmin).

## Timestamps are UTC on every machine
All `DATETIME(3)` values are stored in UTC and the connection is configured with `timezone: '+00:00'`. Sequelize, however, formats a `Date` passed in `replacements` in the **Node process' local time zone** (and drops the milliseconds), while reading values back as UTC. On a server that is not in UTC (for example `Africa/Cairo`) every timestamp would have come back shifted by the local offset (2 or 3 hours, changing with daylight saving). `createSequelize` therefore wraps `query` so that every `Date` in `replacements` is formatted as a UTC string with milliseconds (`toUtcSqlDate`). Repositories keep passing `Date` objects as before. Covered by `tests/unit/database/utc-replacements.test.ts` (run under several time zones) and `tests/db/datetime.test.ts`.
Rows written before this fix by a non-UTC machine (test data only, in this project) are shifted; delete them or ignore them.

## Authorization (Module 12)
`authorization_bootstrap_lock`: a single row (`id = 1`, enforced by a CHECK) locked with `SELECT ... FOR UPDATE` by the first-Main-Admin bootstrap so concurrent runs are serialized; it also records the last bootstrap's user id and time. It is never used for authorization decisions (roles stay in `user_roles`).

## Main Organization (Module 13)
`organizations` (`id` CHAR(36) PK, `code` unique `ORG-000001` format, `name` VARCHAR(200) utf8mb4, `status` ACTIVE/INACTIVE, `v1_single_guard`, timestamps). CHECKs on status, code format, non-blank name; `v1_single_guard = 1` with a UNIQUE index enforces exactly one organization in V1 (drop the index in a future migration for multi-organization). No foreign keys from this table; later modules reference `organizations.id` with `ON DELETE RESTRICT`. See `docs/ORGANIZATION.md`.

Note (Module 13): the `ck_organizations_code_format` CHECK was corrected by migration `20261010140000-fix-organizations-code-check` to be case-sensitive (see changelog 0.15.1).
