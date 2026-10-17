# Unified Address (Module 15): Parent Address

Pure application logic: **no tables, no migration, no endpoints, no permissions, no events**. It normalizes, parses and validates a **Parent Address** (Master Specification §28). The Parents module (17) owns the persistence and history of a Parent's address and calls this module. School addresses are **not** handled here.

## Parent Address
`Governorate / Center or City / Village`, stored by the Parents module in three separate fields (never one combined string).

| Part | Rule |
|---|---|
| Governorate | required; the id of a registered Governorate of the **country of the parent's organization**; must be ACTIVE when a Parent Address is created or changed |
| Center / City | optional **free text**; need not exist in the geography tables |
| Village | optional **free text**; need not exist in the geography tables; **cannot be given without a nonblank Center / City** |

- **Country:** never entered. It is the country of the parent's organization (`OrganizationLookup.requireOrganizationCountryId(organizationId)`; every call carries an `organizationId`); until it is assigned every validation fails closed with `ORGANIZATION_COUNTRY_NOT_SET`. The Governorate must belong to it (`PARENT_ADDRESS_COUNTRY_MISMATCH` otherwise).
- **Normalization of the free text:** Unicode NFC, runs of whitespace collapsed to one space, trimmed; maximum **200 characters** each (same as geography and organization names); control characters rejected. `null`, an omitted field and whitespace-only all become **NULL**. Arabic letter variants (`أ/ا`, `ة/ه`, `ى/ي`) are never folded.
- **Never rejected** because the Center / City or Village is not registered.
- **Inactive Governorate:** rejected for a new or changed address (`PARENT_ADDRESS_GOVERNORATE_INACTIVE`); a stored address stays readable (`describeStoredParentAddress` does not re-validate).

## Raw text (Excel Parent Address cell, or any raw input)
`validateRawParentAddress(raw)` uses the **same validation** as structured input after parsing:
- `/` is the only separator; each component is trimmed and whitespace-collapsed (NFC).
- `A`, `A/B` and `A/B/C` are valid (subject to the registered-Governorate rule). `A//C`, `A/B/`, `/A`, `A/ /C`, empty text and more than three components are rejected (`INVALID_PARENT_ADDRESS`).
- The first component must **match a registered Governorate name of the organization's country exactly** (after NFC and whitespace normalization): no case-insensitive or Arabic-variant matching (`PARENT_ADDRESS_GOVERNORATE_NOT_FOUND` otherwise).

## Public contract (`src/modules/15-unified-address/public`)
Depend on `UnifiedAddressLookup` (composition root `getUnifiedAddressService()` in `src/config/unified-address.ts`):
- `validateParentAddress({ governorateId, centerName?, villageName? }, tx?)` → `ParentAddress`
- `validateRawParentAddress(raw, tx?)` → `ParentAddress`
- `describeStoredParentAddress({ governorateId, governorateName?, centerName?, villageName? }, tx?)` → `ParentAddress` (no validation; a `governorateName` snapshot is used as is, otherwise the current name is read)
- `ParentAddress = { governorateId, governorateName, centerName | null, villageName | null }`. `governorateName` is the name **at validation time**, to be stored in history.
- Pure helpers: `normalizeAddressText`, `parseRawParentAddress`, `PARENT_ADDRESS_TEXT_MAX_LENGTH` (200).
- Errors (ar/en): `INVALID_PARENT_ADDRESS`, `PARENT_ADDRESS_GOVERNORATE_NOT_FOUND`, `PARENT_ADDRESS_GOVERNORATE_INACTIVE`, `PARENT_ADDRESS_COUNTRY_MISMATCH`; plus `ORGANIZATION_COUNTRY_NOT_SET` from Module 13. Field errors name `address`, `governorate`, `center` or `village`.

## School Address (unchanged)
Schools keep the structured, id-based rules (`GeographyLookup.validateHierarchy`, Module 14) and Module 16 calls it directly. Module 15 neither wraps nor weakens it; Geography validation is not changed. No institution-country check exists for schools yet (Module 16 is not built); any such rule belongs to Module 16 and must not be duplicated here.

## Persistence contract for the Parents module (17) — not created now
Module 17 owns these tables (it depends on 15, which is allowed: higher module depends on lower). This is the agreed contract; Module 17's own plan confirms the details.

`parents` (current address):
| Column | Type | Rules |
|---|---|---|
| `governorate_id` | `CHAR(36)` | foreign key → `governorates.id`, `ON DELETE RESTRICT` / `ON UPDATE RESTRICT` |
| `address_center` | `VARCHAR(200)` | NULL allowed |
| `address_village` | `VARCHAR(200)` | NULL allowed |

CHECKs: `address_village IS NULL OR address_center IS NOT NULL`; names not blank (`CHAR_LENGTH(TRIM(x)) > 0` when not NULL); `CHAR_LENGTH(x) <= 200` (enforces the limit even when the database is not in strict mode). utf8mb4 / `utf8mb4_unicode_ci`.

`parent_address_history` (append-only):
| Column | Type | Rules |
|---|---|---|
| `id` | `CHAR(36)` | primary key |
| `parent_id` | `CHAR(36)` | foreign key → `parents`, `RESTRICT` |
| `governorate_id` | `CHAR(36)` | foreign key → `governorates.id`, `RESTRICT` |
| `governorate_name` | `VARCHAR(200)` | NOT NULL; **snapshot** of the Governorate name when the address was recorded |
| `center_name`, `village_name` | `VARCHAR(200)` | NULL allowed; same CHECKs as above |
| `valid_from` | `DATETIME(3)` | NOT NULL (UTC) |
| `valid_to` | `DATETIME(3)` | NULL = the current address |
| `changed_by` | `CHAR(36)` | foreign key → `users.id` |

**Why the name snapshot:** the history keeps `governorate_id` (traceability) and the name at the time, so an old address still reads the same if the Governorate is ever renamed (Geography has no rename operation today; this protects against future changes). The current `parents` row follows the live Governorate record. The country name is not snapshotted (the country comes from the Main Organization and is derivable).

**Changing an address** (one transaction): validate with `validateParentAddress` / `validateRawParentAddress`, close the current history row (`valid_to`), insert the new history row with the returned `governorateName`, update the `parents` columns, and write a `ParentAddressChanged` event (ids only). History rows are never updated or deleted other than setting `valid_to`. Foreign keys with `RESTRICT` and the absence of a delete operation block hard deletes. Reading history uses `describeStoredParentAddress` with the stored snapshot. A Student's address is the Parent's current address (§36).

The authorization for creating or changing a Parent Address belongs to Module 17's operations (Master Specification §32) and to `docs/AUTHORIZATION-MATRIX.md` when that module is approved; Module 15 defines no permission.

## Tests
Unit: `tests/unit/unified-address` (`address-text-and-parser`, `unified-address-service`, `unified-address-boundaries` including the message catalog and the module boundary rules). The country part is tested in `tests/unit/organization/organization-country*.test.ts` and `tests/db/organization-country.test.ts`.

## Organization address (separate from school and parent addresses)
`validateOrganizationAddress({ countryId, governorateId, centerName?, villageName? })` validates the ORGANIZATION's own address: country and governorate required; the governorate must be a registered, ACTIVE governorate of `countryId` (Geography `validateHierarchy`; `ORGANIZATION_ADDRESS_COUNTRY_MISMATCH`); **`centerName` and `villageName` are free text** with the Parent normalization (NFC, whitespace, at most 200 characters, a village only with a center) and are never looked up. It returns the validated ids and the normalized text. `validateSchoolAddress({ organizationId, governorateId, centerName?, villageName? })` is the **same contract as the Parent address** (the country comes from the organization); Module 16 uses it. All three addresses therefore share one rule set and no registered center or village is ever required. `validateParentAddress` / `validateRawParentAddress` now take the `organizationId` of the parent (Module 17 will pass the parent's organization).
