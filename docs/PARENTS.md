# Parents (Module 17)

Status: IMPLEMENTED (unit, HTTP, API-conformance and real-database tests pass in the authoring environment). Business rules: Master Specification §24, §28, §32, §34, §37 and the approved Module 17 decisions below.

## What it owns
`User -> PARENT role -> Parent entity` (§32). The Parent record (three-part name, organization), the **Parent Address and its history** (§28), and the **Parent-to-School relationship** with history. It does not own the login account (Module 08), roles (Module 09), schools (Module 16) or address validation (Module 15).

## Approved decisions (project owner, Module 17)
- **Permissions (Module 12 engine only):** `SCHOOL_MANAGER` creates Parents in THEIR school and lists/reads/updates the Parents linked to a school they manage; a Parent linked only to other schools is unreachable. `ORGANIZATION_MANAGER` and `MAIN_ADMIN` get **no** Parent permission from their role (no organization-wide Parent access without an explicitly approved rule). `PARENT` reads **only their own profile** (`GET /parents/me`); in V1 they cannot edit their own address or name.
- **Personal name (exactly three parts):** the organization creator, the school applicant (the School Manager account created or resolved through the request) and the Parent each give a personal name of EXACTLY three non-empty parts (`أحمد محمد علي` valid; two or four parts invalid). One shared rule (`normalizePersonName`, Module 08): Unicode NFC, any run of whitespace collapsed to one space, trimmed, no control characters, at most 200 characters; no Arabic letter folding. Errors: `INVALID_APPLICANT_NAME` (organization registration, school submission), `INVALID_PARENT_NAME` (Parent). The personal name is never confused with the organization's or the school's name.
- **Where the name is stored:** ONCE, on the account: `users.full_name` (Module 08, `UserDto.fullName`). It is set when the account is created by organization registration, a public school submission or a Parent registration; for a logged-in applicant whose account has no name yet it is set from the submitted name; a different submitted name is `PERSON_NAME_MISMATCH` (409) and never replaces the stored one. `organization_admins.name` and `schools.applicant_name` still exist as request/link records of Modules 13/16 (unchanged), but identity matching uses only `users.full_name`. The Parent record keeps no name (migration `20261019110000` moved it to the account).
- **Identity and reuse (the approved matching flow):** a normalized E.164 phone identifies ONE account, but a matching name is the approved matching criterion, not independent proof of identity. Parent National ID is not required. On an existing phone the account is **never merged, overwritten, given a new password or a new security state**. Steps: normalize the phone and find the account -> read its stored three-part name -> validate/normalize the submitted name -> compare (exact normalized text, Latin case ignored, Arabic letters never folded) -> if the account already has a Parent record it must belong to the SAME organization -> add the PARENT role only if missing -> create the Parent-to-School link. A missing stored name, a different name, or any other mismatch is `PARENT_IDENTITY_CONFLICT`; a Parent of another organization is `PARENT_ORGANIZATION_CONFLICT`; a deactivated account is `PARENT_ACCOUNT_INACTIVE`.
- **Several roles, one account:** a person is one account however many permitted roles they hold, e.g. ORGANIZATION_MANAGER + SCHOOL_MANAGER (an organization manager assigned as the manager of ONE school keeps their account, phone and password; the School Manager scope covers only that school's manager link, never every school of the organization), ORGANIZATION_MANAGER/SCHOOL_MANAGER + PARENT. Role assignment still goes through Module 09 (`assignRole`, unchanged catalog) and every scope stays that of its own assignment.
- **One organization per Parent in V1:** a Parent account is reused across schools of the SAME organization only, with a separate link per school. Removing a link keeps the account, the Parent record, the address history and the other links, and is refused (`PARENT_HAS_STUDENTS_IN_SCHOOL`, 422) while the Parent still has students in that school.
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
| `PATCH /parents/{id}` (address only) | `parents.parent.update` | same |
| `DELETE /parents/{id}/schools/{schoolId}` | `parents.school-link.remove` | SCHOOL_MANAGER of that school |

The password is never returned. Scope targets: SCHOOL (resolver of Module 16) for create/list/link removal, PARENT (resolver of Module 17: the Parent's ACTIVE links are loaded server-side and need an active manager link to one of those schools) for read/update.

## Public contract (`src/modules/17-parents/public`)
`ParentService`, `ParentStudentDependencies`, `ParentLookup` (read-only: `findById`, `findByUserId`, `listActiveSchoolIds`, `isLinkedToSchool`, `getCurrentAddress`, `listAddressHistory`, `listSchoolLinkHistory`), `registerParentAuthorization`, `ParentPermissions`, DTOs, errors, events, repositories (SQL and in-memory), `createParentRouter`, `parentApiDoc`.

## Events (outbox, identifiers only)
`ParentRegistered`, `ParentAddressChanged`, `ParentSchoolLinked`, `ParentSchoolLinkRemoved`.

## Database (migration `20261018110000-create-parents`; `20261018100000-users-must-change-password` for the flag)
`parents` (unique `user_id`; no name column), `parent_addresses` (history; unique `(parent_id, active)` = exactly one current row; village needs center), `parent_schools` (history; unique `(parent_id, school_id, active)`). `active` is 1 while current, NULL once ended; the CHECKs use the NULL-safe `<=>`. No foreign key to another module's table (§14); `parent_id` keys are RESTRICT.

## Errors (Arabic + English)
`INVALID_PARENT_NAME`, `PARENT_HAS_STUDENTS_IN_SCHOOL`, `PARENT_ADDRESS_REQUIRED`, `PARENT_UPDATE_EMPTY`, `PARENT_NOT_FOUND`, `PARENT_IDENTITY_CONFLICT`, `PARENT_ORGANIZATION_CONFLICT`, `PARENT_ALREADY_LINKED_TO_SCHOOL`, `PARENT_SCHOOL_LINK_NOT_FOUND`, `PARENT_SCHOOL_NOT_ACTIVE`, `PARENT_ACCOUNT_INACTIVE`, `PARENT_CONCURRENT_MODIFICATION`; address errors come from Module 15; `PASSWORD_CHANGE_REQUIRED`, `CURRENT_PASSWORD_INCORRECT`, `NEW_PASSWORD_SAME_AS_CURRENT` from Module 10; `INVALID_PERSON_NAME`, `PERSON_NAME_MISMATCH` from Module 08.

## Unlink guard (students)
The unlink runs a `ParentStudentDependencies` guard inside its transaction, after the link row is locked. Module 19 supplies the real one. Until Module 19 exists no student can exist, so `src/config/parents.ts` wires the explicit temporary `STUDENTS_MODULE_NOT_IMPLEMENTED_YET` (always 0). A test fails as soon as `src/modules/19-students` contains source files while that temporary guard is still wired.

## Existing data (accounts created before `users.full_name`)
The migration invents nothing: existing accounts keep `full_name = NULL`. `npm run person-names:report` lists them and says, for each, whether a name recorded earlier (`organization_admins.name`, `schools.applicant_name`) is a valid three-part name on which all records agree (FILLABLE) or needs a human decision (REVIEW: none recorded, not exactly three parts, or conflicting). `npm run person-names:apply` fills ONLY the FILLABLE ones in one transaction and never overwrites. Until an account has a name it cannot be matched for Parent reuse (identity conflict). Parent names recorded by the previous version are moved to their accounts by migration `20261019110000`, which STOPS without dropping anything if a Parent's name is not exactly three parts or differs from its account.

## Open items (not decided; nothing was guessed)
- **Name correction:** the personal name cannot be edited through the Parents API (it is the account's canonical name, shared by all roles); an account-level correction workflow does not exist yet and was not invented.
- **D-3** (role assignment / user deactivation) still blocks global Parent deactivation and any role removal.
- A Parent linked to no school keeps their account and can read `GET /parents/me`.
