# Geography (Module 14)

**Global, shared reference data.** Geography is not owned by an organization: several organizations can have schools in the same governorate, center/city or village. There is no `organization_id` and no foreign key to `organizations`. A school (Module 16) keeps its organization relationship and its geographic relationships separately.

Hierarchy (Master Specification §27): **Country → Governorate → Center/City → Village** (School is the last level, Module 16). Center/City is **one** level (`centers`) with `kind = CENTER | CITY`.

## Tables (one per level, each references only its parent)
| Table | Parent FK (real foreign key, `ON DELETE RESTRICT`, `ON UPDATE RESTRICT`) | Name uniqueness |
|---|---|---|
| `countries` | none | name |
| `governorates` | `country_id` → `countries.id` | name per country |
| `centers` | `governorate_id` → `governorates.id` | name per governorate **and kind** (a city and a center may share a name) |
| `villages` | `center_id` → `centers.id` | name per center |

Fields: `id` (UUID), `code` (`CNT-` / `GOV-` / `CTR-` / `VIL-` + 6 digits, unique, checked case-sensitively), `name` (one required field, Arabic or English, utf8mb4, same normalization rules as the organization name, max 200 characters), `status` (`ACTIVE` / `INACTIVE`), timestamps; `centers` also has `kind`. CHECKs on status, code format, non-blank name and kind. The name-uniqueness rules are technical data-integrity guards (not business rules from the specification): a second village with the same name inside the same center would need a disambiguation rule that has not been defined.

**No delete, rename or reactivation operation exists** (none is specified); `INACTIVE` is the only retirement state and nothing sets it yet. No HTTP endpoints, no permissions, no outbox events.

## Seed (reference data only)
`npm run seed:geography` (after `npm run db:migrate`): idempotent; creates **Egypt and its 27 governorates** only, in a fixed order so every fresh environment gets the same codes (`CNT-000001`, `GOV-000001` .. `GOV-000027`). Existing nodes are never renamed, deleted or duplicated; a partial seed is completed. **Centers, cities and villages are NOT seeded and were not invented: this is not a complete geography dataset.** They must be loaded later from a trustworthy source (a future import; creating nodes is intentionally not part of the public read contract).

## Public contract (`src/modules/14-geography/public`)
Downstream modules depend on `GeographyLookup` (read-only); composition root `getGeographyService()` in `src/config/geography.ts`.
- `getCountry / getGovernorate / getCenter / getVillage(id, tx?)` → `GeographyNodeDto | undefined` (`{ id, level, code, name, status, parentId, kind }`).
- `listCountries()`, `listGovernorates(countryId)`, `listCenters(governorateId)`, `listVillages(centerId)`.
- `validateHierarchy({ governorateId, centerId?, villageId? }, { requireActive? }, tx?)` → `{ country, governorate, center | null, village | null }`. Rules (§28): the governorate is required; a village needs a center; the center must belong to the governorate and the village to the center; nodes must exist and, **by default, be ACTIVE** (`requireActive: false` accepts inactive nodes, for example when reading historic addresses). Errors (ar/en): `INVALID_GEOGRAPHY_HIERARCHY`, `GEOGRAPHY_NODE_NOT_FOUND`, `GEOGRAPHY_NODE_INACTIVE`.
- Other error codes: `INVALID_GEOGRAPHY_NAME`, `GEOGRAPHY_NODE_ALREADY_EXISTS`, `GEOGRAPHY_PARENT_NOT_FOUND`.

## Notes for downstream modules
- **Unified Address (15):** call `validateHierarchy` for the governorate/center/village chain (§28); store only the ids you need, as foreign keys with `ON DELETE RESTRICT`. Do not query the geography tables.
- **Schools (16):** reference geography ids (not organization-owned) next to the separate `organizations.id` reference.
- **Authorization:** Module 14 adds no operation that needs a permission, so `docs/AUTHORIZATION-MATRIX.md` is unchanged. The tree is what later geographic scope resolvers (open decision D-2) will use; who is assigned to which governorate is owned by a later module.
- Test note: the DB tests empty the geography tables inside an always-rolled-back transaction; once later tables hold foreign keys into them, that step must be revisited.

## Tests
Unit: `tests/unit/geography` (name/code/node rules, dataset integrity, idempotent seed, hierarchy validation, in-memory repository rules, CLI). MariaDB: `tests/db/geography.test.ts` (schema and columns without `organization_id`, real FKs with RESTRICT, seed and idempotency, Arabic round trip, hierarchy validation, delete restriction, FK/unique/CHECK guards). Always rolled back; safe on a seeded database.
