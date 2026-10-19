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

## Organizations (Module 13)
`organizations` (`id` CHAR(36) PK, `code` unique `ORG-000001` format, `name` VARCHAR(200) utf8mb4, `status` ACTIVE/INACTIVE, `v1_single_guard`, timestamps). CHECKs on status, code format, non-blank name; `v1_single_guard = 1` with a UNIQUE index enforces exactly one organization in V1 (drop the index in a future migration for multi-organization). Plus `country_id` (`CHAR(36)` NULL, the primary key of a `countries` row; foreign key `fk_organizations_country` → `countries.id`, `ON DELETE RESTRICT` / `ON UPDATE RESTRICT`; migration `20261011100000-add-organizations-country`; immutable once assigned, enforced by the application, not by a trigger). Later modules reference `organizations.id` with `ON DELETE RESTRICT`. See `docs/ORGANIZATION.md`.

Note (Module 13): the `ck_organizations_code_format` CHECK was corrected by migration `20261010140000-fix-organizations-code-check` to be case-sensitive (see changelog 0.15.1).

## Geography (Module 14)
Global reference data (no `organization_id`): `countries` -> `governorates` -> `centers` (Center/City, `kind` CENTER|CITY) -> `villages`. Each level has `id` CHAR(36), `code` (`CNT-`/`GOV-`/`CTR-`/`VIL-` + 6 digits, case-sensitive CHECK, unique), `name` VARCHAR(200) utf8mb4, `status` ACTIVE/INACTIVE, timestamps, and a real foreign key to its parent with `ON DELETE RESTRICT` / `ON UPDATE RESTRICT`. Unique names: country; per country; per governorate and kind; per center. See `docs/GEOGRAPHY.md`.

## Unified Address (Module 15)
No tables and no migration: Module 15 only normalizes and validates a Parent Address. Persistence and history of a Parent's address belong to the Parents module (17); the contract it must follow (columns, history table, name snapshot, constraints) is in `docs/UNIFIED-ADDRESS.md`.

## Schools (Module 16)
Migrations `20261012100000-create-schools`, `20261013100000-add-schools-applicant-name` and `20261013110000-fix-schools-holds-name-check` (nullable `applicant_name`): `schools`, `school_managers`, `school_status_history`, `school_gps_history`, `school_code_sequence`. Foreign keys `RESTRICT` to `organizations`, `governorates`, `centers`, `villages` and between school tables; users are referenced without foreign keys (as in `user_roles`). Unique per organization among non-rejected schools (`holds_name`), one active manager per school (`active`), gap-free codes from one locked sequence row, CHECKs for GPS ranges and the 20 m accuracy. See `docs/SCHOOLS.md`.

## Organizations as many, school country invariant (migrations 20261014100000 and 20261014110000)
`organizations`: V1 single-organization index and CHECK dropped; `governorate_id` (FK `RESTRICT`) and free-text `center_name`, `village_name` (village needs center, no blank text; migration `20261015110000`); unique `uq_organizations_name` and `uq_organizations_id_country (id, country_id)`; `organization_code_sequence` (locked row); `organization_admins` (organization manager link of ORGANIZATION_MANAGER, with history; backfilled for V1 MAIN_ADMIN holders). `governorates`: unique `uq_governorates_id_country`. `schools.country_id` NOT NULL with composite foreign keys `fk_schools_org_country` and `fk_schools_gov_country` (RESTRICT), so a school's country always equals its organization's country. `schools` no longer has `type`, `parent_school_id`, `center_id`, `village_id`; it has `center_name`, `village_name`, `applicant_user_id`; `school_classification_archive` and `school_manager_source_archive` preserve the old Main/Sub data; `school_managers.source IN ('APPROVAL','ASSIGNMENT')`; `user_roles` accepts `ORGANIZATION_MANAGER` (migrations `20261015100000`, `20261015110000`, `20261015120000`). Migrations are forward-only additions; the school migration stops with a report if existing rows are inconsistent. See `docs/ORGANIZATION.md` and `docs/SCHOOLS.md`.

## Parents (Module 17) and the password-change flag
Migration `20261018100000-users-must-change-password` (`users.must_change_password`, NOT NULL DEFAULT 0) and `20261018110000-create-parents`: `parents`, `parent_addresses` (history, one current row per Parent), `parent_schools` (link history, one active link per Parent and school). No foreign key to another module's table; the CHECKs use the NULL-safe `<=>`. See `docs/PARENTS.md`.
