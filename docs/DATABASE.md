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

## Canonical personal name (migrations `20261019100000-users-full-name`, `20261019110000-parents-use-account-name`)
`users.full_name VARCHAR(200) NULL` (exactly three parts, validated by the application; no data is invented for existing accounts). `parents.full_name` was removed: the migration copies exactly-three-part Parent names to accounts that have none and STOPS without dropping anything when any Parent is inconsistent with its account. `npm run person-names:report|apply` fill older accounts from names recorded earlier, only when unambiguous.

## Teachers (Module 18)
Migration `20261019120000-create-teachers`: `teachers` (unique `user_id`, organization; no name column, the name is `users.full_name`) and `teacher_schools` (link history, one active link per Teacher and school, NULL-safe CHECK `<=>`, RESTRICT key to `teachers` only). No foreign key to another module's table. See `docs/TEACHERS.md`.

Migration `20261020100000-create-students`: `students` (GLOBAL unique `national_id`, CHECKs for status / 14-digit National ID / non-blank name, indexes `(school_id, status)`, `(school_id, created_at)`, `(parent_id, school_id)`; `parent_id`, `school_id`, `organization_id` are plain references with no foreign key to other modules' tables) and `student_history` (append-only, `seq` insertion order, `RESTRICT` key to `students` only). No group and no address column. See `docs/STUDENTS.md`.

Migration `20261021100000-create-groups`: `school_groups` (unique `(school_id, name_key, active)`: one ACTIVE group per name in a school, any number of ARCHIVED ones; CHECKs for status/active, mode, progression, surah 1-114, non-blank name; `teacher_id`, `school_id`, `organization_id` are plain references), `group_students` (assignment history; unique `(student_id, active)`: one CURRENT group per student; CHECK for the period shape and end reason) and `group_history` (append-only, `seq` order). RESTRICT keys only to `school_groups`; no foreign key to another module's table. See `docs/GROUPS.md`.

Migration `20261022100000-create-quran-structure` (Module 21, schema only; the data is loaded by `npm run import:quran`): `quran_dataset_imports` (attribution and checksum; unique `active`: one ACTIVE import), `quran_surahs`, `quran_ayahs` (global position 1..6236; first/last page and line; quarter), `quran_pages`, `quran_lines` (global line number; kind TEXT / SURAH_HEADER / BASMALA), `quran_quarters`, `quran_hizb`, `quran_juz` (CHECKs that hizb and juz agree with the quarter). RESTRICT keys only inside the module (`quran_ayahs` to `quran_surahs`, `quran_lines` to `quran_pages`); no foreign key to another module. See `docs/QURAN-STRUCTURE.md`.

Migration `20261023100000-quran-structure-official-package-model` (Module 21, schema only, additive; MariaDB 10.4): `quran_ayahs` gets the required official text, `juz_number` (official `jozz`) and `has_rub_marker` and loses the 1..240 `quarter_number`; `quran_juz` gets `verification` (`MARKER_CONFIRMED`, `SURAH_START_NO_MARKER`, `MARKER_CONFLICT`); new `quran_quarter_marks` (the printed quarter markers of the source package, `mark_number` is an ordinal not a quarter number); `quran_dataset_imports` gets `quarter_mark_count` and `source_files_json` (the SHA-256 of every source file). `quran_hizb` stays empty and reserved for exact boundaries of a future version. The migration refuses to run if a reshaped table holds data.

Migration `20261024100000-quran-structure-quarters` (Module 21, schema only, additive; MariaDB 10.4): `quran_ayahs.quarter_number` (1..240, the quarter containing the ayah, in the table CHECK) and `quran_dataset_imports.quarter_count`; the existing `quran_quarters` table (quarter 1..240, `hizb_number = CEIL(quarter/4)`, unique start, `juz_number` = arithmetic position required by its CHECK, not the juz of `quran_juz`) now holds the 240 records of the approved quarter source. `quran_hizb` stays empty and reserved. Refuses to run if a reshaped table holds data.

Migration `20261026100000-quran-lines-kind-check-not-null` (Module 21, additive, no data touched): `ck_quran_lines_kind` now states `surah_number IS NOT NULL` for banner and basmala lines (a CHECK accepts UNKNOWN, so a NULL surah used to pass). See `docs/QURAN-STRUCTURE.md`.

Migration `20261028100000-create-group-schedules` (Module 23): `group_schedule_slots` (one row per recurring weekly slot of a group; `group_id` and `school_id` are plain references to Module 20 data, no foreign key; `teacher_id` is the group's current Teacher (kept in step by Module 23 so a Teacher's schedule is read from this table only); `day_of_week` ISO 1..7, `start_minute` / `end_minute` local wall-clock minutes with CHECKs (start < end, 00:00..23:59); `active` is 1 while current and NULL once retired, so the unique index `(group_id, day_of_week, active)` allows ONE active slot per weekday for a group whatever the times; CHECK for the retirement consistency (`REPLACED` names its replacement, `REMOVED` and `GROUP_ARCHIVED` do not); slots are never deleted; `seq` is the history order) and `schedule_teacher_locks` (one row per Teacher, taken FOR UPDATE to serialize a Teacher's schedule changes; no business data). See `docs/GROUP-SCHEDULES.md`.

Migration `20261101100000-create-memorization` (Module 27, additive, no foreign keys to other modules' tables): `memorization_assignments` (the next-session assignment; `subject_key` = the student id or `GROUP`; `active_slot` 1 while ACTIVE and NULL when CANCELLED so that UNIQUE `(defined_in_session_id, subject_key, active_slot)` allows one active assignment per session and subject and any number of cancelled ones), `memorization_assignment_history` (append-only, `seq` order), `memorization_records` (NO uniqueness: overlapping ranges are valid; CHECK `(assignment_id IS NULL) = (matches_assignment IS NULL)`), `memorization_correction_history` (append-only, keeps the original range). Nothing is ever deleted. See `docs/MEMORIZATION.md`.

Migration `20261101110000-memorization-assignment-slot-check-null-safe` (Module 27, additive): re-creates `ck_memorization_assignment_slot` so that it is NULL-safe (an ACTIVE assignment must have `active_slot = 1`).

Migration `20261102100000-create-revision` (Module 28, additive, no foreign keys to other modules' tables): `revision_assignments` (same shape as `memorization_assignments`, with the NULL-safe active-slot CHECK from the start), `revision_assignment_history` (append-only), `revision_records` (no uniqueness), `revision_correction_history` (append-only). Nothing is ever deleted. See `docs/REVISION.md`.

Migration `20261103100000-create-evaluations` (Module 29, additive, no foreign keys to other modules' tables): `evaluations` (UNIQUE session + student; optional note CHECKed to 1-200 non-blank characters) and `evaluation_scores` (PK evaluation + category; `DECIMAL(4,2)` CHECK 0..10; NULL-safe assignment CHECK; its only foreign key is to its own parent `evaluations`). No history table. Nothing is ever deleted. See `docs/EVALUATIONS.md`.

Migration `20261104100000-create-exams` (Module 30, additive, no foreign keys to other modules' tables): `exams` (status CHECK, 1-200 questions, `max_score` 0-1000, `end_at IS NULL OR end_at > start_at`, soft-delete `deleted_at`), `exam_groups`, `exam_examiners` (released with a reason or not at all, NULL-safe CHECK; rows kept), `exam_students` (the frozen target list, status PENDING / EXAMINED / ABSENT), `exam_results` (UNIQUE exam + student) and `exam_result_scores` (PK result + question). Foreign keys only to this module's own parent tables (`ON DELETE RESTRICT`). Results are never updated or deleted by any code path. See `docs/EXAMS.md`.

## Server SQL mode (recommended: strict)
Run MariaDB/MySQL with a STRICT `sql_mode` (`STRICT_TRANS_TABLES`; the default of MariaDB 10.2.4+ and MySQL 5.7+). A non-strict server (for example the stock XAMPP configuration) silently TRUNCATES a value that is longer than its column instead of rejecting it, so a database-level length guarantee (such as the 200-character evaluation note) cannot fire there. The application validates lengths itself before they reach the database, so nothing breaks, but strict mode is the safer setting for data integrity. The real-database tests do not depend on the server mode: `tests/db/evaluations.test.ts` pins strict mode for its own session, and the whole `npm run test:db` suite passes on both a strict and a non-strict server.

Migration `20261105100000-auth-sessions-three-session-model` (Module 10, three-session amendment): adds `auth_sessions.slot` (1..3, unique with `user_id`) and `device_label`, replaces the one-active-session unique index with a plain `(user_id, active)` index, and extends the revoke-reason and state CHECKs (`SESSION_EXPIRED`, `DEVICE_REVOKED`, `PASSWORD_CHANGED`). Existing active sessions are backfilled with slot 1; no row is deleted. `down` is refused when it would lose data. See `docs/SESSIONS.md`.

Migration `20261105110000-create-notifications-core` (Module 31): `notifications`, `notification_dedup_keys` (only recipient, key and time; never deleted), `push_subscriptions` (unique endpoint hash, linked to the authentication session) and `push_deliveries` (cascade from notification and subscription). See `docs/NOTIFICATIONS.md`.

Migration `20261107100000-create-notification-rules` (Module 32): `notification_reminders` (one row per kind and subject: EXAM_24H / SESSION_HALF_TIME / SESSION_EVALUATION; `due_at`, `state` PENDING/SENT/SUPPRESSED/FAILED, claim lock, attempts; unique `(kind, subject_id)`, index `(state, due_at)`, CHECKs) and `notification_exam_audience` (`exam_id`, `role` STUDENT/EXAMINER, `subject_id`; primary key on all three; ids only). No foreign keys to other modules. `down` drops both tables.

Migration `20261108100000-create-subscriptions` (Module 33): `subscription_batches` (one row per school and month that had its bulk creation; UNIQUE (school_id, month)), `subscriptions` (Student + Month + Status; UNIQUE (student_id, month); index (school_id, month, status); `batch_id` references `subscription_batches` RESTRICT, the module's only foreign key; CHECKs: status IN (PAID, UNPAID, WAIVED), month format `YYYY-MM`, paid/waived audit columns consistent with the status; no amount column) and `collector_school_links` (Subscription Collector-to-School links with history; `active` = 1 while current, NULL once ended; UNIQUE (user_id, school_id, active); NULL-safe CHECK). No foreign keys to other modules' tables.

Migration `20261108110000-notification-reminders-subscription-kinds` (Module 33 x 32): additive widening of the `notification_reminders` kind CHECK with `SUBSCRIPTION_UNPAID_3D` and `SUBSCRIPTION_UNPAID_MONTH_END` (reversible; the down step deletes only those two kinds).

Release 0.43.1 (Module 33 enhancements) changes NO schema: group statistics read existing tables through public contracts, and `mark-unpaid` writes only the existing `subscriptions` columns (an UNPAID row carries no paid audit, as the existing CHECK requires).
