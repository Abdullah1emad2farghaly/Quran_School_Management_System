# Parents (Module 17)

Status: IMPLEMENTED (unit, HTTP, API-conformance and real-database tests pass in the authoring environment). Business rules: Master Specification §24, §28, §32, §34, §37 and the approved Module 17 decisions below.

## What it owns
`User -> PARENT role -> Parent entity` (§32). The Parent record (three-part name, organization), the **Parent Address and its history** (§28), and the **Parent-to-School relationship** with history. It does not own the login account (Module 08), roles (Module 09), schools (Module 16) or address validation (Module 15).

## Approved decisions (project owner, Module 17)
- **Permissions (Module 12 engine only):** `SCHOOL_MANAGER` creates Parents in THEIR school and lists/reads/updates the Parents linked to a school they manage; a Parent linked only to other schools is unreachable. `ORGANIZATION_MANAGER` and `MAIN_ADMIN` get **no** Parent permission from their role (no organization-wide Parent access without an explicitly approved rule). `PARENT` reads **only their own profile** (`GET /parents/me`); in V1 they cannot edit their own address or name.
- **Identity and reuse:** a normalized E.164 phone identifies ONE account, but never proves that two registrations are the same person. Parent National ID is not required. On an existing phone the account is **never merged, overwritten, given a new password or a new role** unless the identity is established:
  - the account already has a Parent record of the SAME organization and the normalized full three-part name is the same -> the Parent is reused and linked to the new school (the stored name and address are not changed);
  - the account has no Parent record (an organization manager, a teacher...) -> it is reused only when a name that its OWNING module vouches for matches (`VerifiedAccountNames` port). No module exposes verified person names yet, so in V1 this answers `PARENT_IDENTITY_CONFLICT`; Module 18 (Teachers) or another module plugs its names in through `src/config/parents.ts`;
  - otherwise `PARENT_IDENTITY_CONFLICT`; a Parent of another organization is `PARENT_ORGANIZATION_CONFLICT`; a deactivated account is `PARENT_ACCOUNT_INACTIVE`.
  Name comparison: Unicode NFC, spaces collapsed, Latin case ignored, **no Arabic letter folding** (أحمد is not احمد).
- **One organization per Parent in V1:** a Parent account is reused across schools of the SAME organization only, with a separate link per school. Removing a link keeps the account, the Parent record, the address history and the other links.
- **Address:** Module 17 stores it (Module 15 only validates). Country = the organization's country (never an input). Input `Governorate / Center or City / Village` (`address`) or structured fields (`addressFields`), exactly one of them. Governorate: registered, ACTIVE, exact name match. Center/City and Village: free text; a village needs a center; missing trailing parts are `null`. A change stores a new CURRENT row and ends the previous one (the governorate name is stored as a snapshot). Students have no address of their own in V1 (they derive it from the Parent).
- **Initial password and first login:** a NEW account gets the last four digits of the phone as its password and the account-level flag `users.must_change_password = 1`. The backend answers every protected request except `POST /auth/change-password`, `/auth/logout` and `/auth/logout-all` with `403 PASSWORD_CHANGE_REQUIRED` until the password is changed. The flag belongs to the ACCOUNT: reusing an existing account (any role) never sets it, never clears it and never touches the password. Password policy is unchanged (4-12 characters). The new password must differ from the current one.
- **Lifecycle:** no global deactivation or deletion of a Parent (decision D-3 is open). Not implemented: `deactivateParent`, `deleteParent`.

## HTTP API (`/api/v1/parents`, OpenAPI in `parent.openapi.ts`, served at `/api-docs`)
| Method and path | Permission | Who |
|---|---|---|
| `POST /parents` | `parents.parent.create` | SCHOOL_MANAGER of `schoolId` |
| `GET /parents/me` | `parents.parent.read-own` | PARENT (own record from the token) |
| `GET /parents/schools/{schoolId}` | `parents.parent.list` | SCHOOL_MANAGER of the school |
| `GET /parents/{id}` | `parents.parent.read` | SCHOOL_MANAGER of a school the Parent is linked to |
| `PATCH /parents/{id}` | `parents.parent.update` | same |
| `DELETE /parents/{id}/schools/{schoolId}` | `parents.school-link.remove` | SCHOOL_MANAGER of that school |

The password is never returned. Scope targets: SCHOOL (resolver of Module 16) for create/list/link removal, PARENT (resolver of Module 17: the Parent's ACTIVE links are loaded server-side and need an active manager link to one of those schools) for read/update.

## Public contract (`src/modules/17-parents/public`)
`ParentService`, `ParentLookup` (read-only: `findById`, `findByUserId`, `listActiveSchoolIds`, `isLinkedToSchool`, `getCurrentAddress`, `listAddressHistory`, `listSchoolLinkHistory`), `registerParentAuthorization`, `ParentPermissions`, DTOs, errors, events, repositories (SQL and in-memory), `createParentRouter`, `parentApiDoc`.

## Events (outbox, identifiers only)
`ParentRegistered`, `ParentUpdated`, `ParentAddressChanged`, `ParentSchoolLinked`, `ParentSchoolLinkRemoved`.

## Database (migration `20261018110000-create-parents`; `20261018100000-users-must-change-password` for the flag)
`parents` (unique `user_id`), `parent_addresses` (history; unique `(parent_id, active)` = exactly one current row; village needs center), `parent_schools` (history; unique `(parent_id, school_id, active)`). `active` is 1 while current, NULL once ended; the CHECKs use the NULL-safe `<=>`. No foreign key to another module's table (§14); `parent_id` keys are RESTRICT.

## Errors (Arabic + English)
`INVALID_PARENT_NAME`, `PARENT_ADDRESS_REQUIRED`, `PARENT_UPDATE_EMPTY`, `PARENT_NOT_FOUND`, `PARENT_IDENTITY_CONFLICT`, `PARENT_ORGANIZATION_CONFLICT`, `PARENT_ALREADY_LINKED_TO_SCHOOL`, `PARENT_SCHOOL_LINK_NOT_FOUND`, `PARENT_SCHOOL_NOT_ACTIVE`, `PARENT_ACCOUNT_INACTIVE`, `PARENT_CONCURRENT_MODIFICATION`; address errors come from Module 15; `PASSWORD_CHANGE_REQUIRED`, `CURRENT_PASSWORD_INCORRECT`, `NEW_PASSWORD_SAME_AS_CURRENT` from Module 10.

## Open items (not decided; nothing was guessed)
- **Verified names for existing non-Parent accounts** (see above): needs the module that owns a person's name (Teachers 18, ...) to expose it.
- **Unlinking a Parent who has children in the school:** Module 19 (Students) must add the guard (a Parent with students in a school cannot be unlinked from it). Until then the link can be removed.
- **D-3** (role assignment / user deactivation) still blocks global Parent deactivation and any role removal.
- A Parent linked to no school keeps their account and can read `GET /parents/me`.
