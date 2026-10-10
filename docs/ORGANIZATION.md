# Main Organization (Module 13)

Owns the Main Organization entity, its table `organizations`, its migration and its rules. V1 has **exactly one** organization. No HTTP endpoints, no permissions, no deletion.

## Model (approved fields only)
| Field | Rule |
|---|---|
| `id` | UUID (technical identifier) |
| `code` | unique, `ORG-000001` format (CHECK + unique index); generated as the next free sequence |
| `name` | one required field, Arabic **or** English. Normalized (Unicode NFC, trimmed, whitespace runs collapsed). Rejected: empty/whitespace-only, control characters, more than 200 characters. Column `VARCHAR(200)` in a `utf8mb4` / `utf8mb4_unicode_ci` table |
| `status` | `ACTIVE` or `INACTIVE` (CHECK). Created ACTIVE. **No transition operation exists** (none is specified) |
| `created_at`, `updated_at` | `DATETIME(3)`, UTC (project convention) |

Plus `v1_single_guard` (technical column, always 1).

## Single-organization rule (enforced by the database)
`v1_single_guard` has `CHECK (v1_single_guard = 1)` and a UNIQUE index, so a second row is impossible, even inactive and even with a different code. The repository maps the violation to `ORGANIZATION_ALREADY_EXISTS`. For a future multi-organization version: a new migration drops `uq_organizations_v1_single` (and the column); nothing else assumes one row. The code sequence is already generated per row (`MAX + 1`), and `findById` exists next to `getMainOrganization`.

## Creation: bootstrap only, idempotent
- `npm run bootstrap:organization`: asks the name (only if no organization exists) and creates it. Re-running only reports the existing one (exit 0, no prompt, nothing changed, no event). Use it on an installation whose Main Admin already exists.
- `npm run bootstrap:main-admin`: runs the **same step first**, then creates the Main Admin (Module 12). If the organization step fails, no Main Admin is created.
- Order for a fresh install: `npm run db:migrate`, then `npm run bootstrap:main-admin`.
- `OrganizationService.ensureMainOrganization(name)`: existing organization returned **unchanged** (a different name is ignored: never renamed); otherwise one transaction inserts the row and writes the `OrganizationCreated` event. A concurrent creator that loses the database race is rolled back (row and event) and receives the winner's row (`created: false`). An invalid name is rejected even when an organization exists.

## Event
`OrganizationCreated` (aggregate `Organization`), payload `{ organizationId, code }` (identifiers only), written through the existing outbox in the same transaction as the row. Emitted once, never on re-runs.

## Public contract (`src/modules/13-organization-core/public`)
Downstream modules depend on `OrganizationLookup` (read-only): `getMainOrganization(tx?) -> OrganizationDto | undefined`, `requireMainOrganization(tx?)` (throws `ORGANIZATION_NOT_FOUND`), `findById(id, tx?)`. `OrganizationDto = { id, code, name, status, createdAt, updatedAt }`. Composition root: `getOrganizationService()` in `src/config/organization.ts`. Errors (ar/en): `INVALID_ORGANIZATION_NAME`, `ORGANIZATION_ALREADY_EXISTS`, `ORGANIZATION_NOT_FOUND`.

## Notes for downstream modules
- **Foreign keys:** a later table may reference `organizations.id` (CHAR(36)) with `ON DELETE RESTRICT` (approved default). That does not allow importing this module's internals or querying its table from application code: use `OrganizationLookup`.
- **Geography (14):** the specification defines Country → Governorate → Center/City → Village → School as master data and does not make it organization-owned, so geography is treated as global and Country is **not** a child of the organization. The module map still lists 13 as a dependency of 14; Module 14's review must confirm what it actually needs from 13 (probably nothing beyond the lookup).
- **Schools (16):** the specification lists "organization" among school-creation fields, so a school references the Main Organization (`organizations.id`). It must decide whether an INACTIVE organization blocks creating schools (not specified).
- **Open, needed only by Module 16:** the "Main Admin relationship" in school creation is not defined. It could be the creating user, an audit/creator reference, or a business relationship. It is **not** modeled here; one focused question will be asked when Module 16 is reviewed.
- Status changes (activate/deactivate) and any organization-management endpoint or permission are not implemented; they need their requirements first. `docs/AUTHORIZATION-MATRIX.md` is unchanged: Module 13 adds no operation that needs authorization.

## Tests
Unit: `tests/unit/organization` (name/code/status rules, idempotent bootstrap, race recovery, event, in-memory V1 rule, CLI step and integration with the Main Admin CLI). MariaDB: `tests/db/organizations.test.ts` (schema, Arabic round trip, atomic row + event, rollback, idempotency, race via the DB guard, CHECK/unique guards). The DB tests run in one always-rolled-back transaction, so they are safe on a database that already has an organization.
