# Schools (Module 16)

Owned by Module 16 (`src/modules/16-schools`). Schools belong **directly to an organization** (Master Specification §29–31, amended): there is **no Main School / Sub-School distinction**. Every school starts `PENDING` and becomes `ACTIVE` only when the **Organization Manager of the owning organization** approves it. The module also owns the **school-scoped manager link** with history, the official GPS rules, the gap-free school code and organization registration. It exposes its own REST API (below). Authorization is enforced by the **shared Authorization Engine (Module 12)**: this module registers its permissions and its `SCHOOL` scope resolver (`registerSchoolAuthorization`) and its routes call `requirePermission`. Other modules depend on the read-only `SchoolLookup`.

Every endpoint is documented in OpenAPI (`/api-docs`, contracts in `school.openapi.ts` and `organization.openapi.ts`) and verified by `npm run api:verify`; the table below is a summary.

## Rules (approved)
**Codes and names.** Code `SC-000001` (globally unique, locked gap-free sequence); id is a UUID. Names: Unicode NFC, whitespace collapsed, 1–200 characters, **unique per organization among non-rejected schools** (a REJECTED request releases its name; `utf8mb4_unicode_ci`, case- and accent-insensitive). A school belongs to an EXISTING organization (`ORGANIZATION_NOT_FOUND` otherwise) that must be ACTIVE (`SCHOOL_ORGANIZATION_INACTIVE`).

**Lifecycle.** Every new school → `PENDING` → `ACTIVE` (approve) or `REJECTED` (terminal; a new attempt is a new school). `ACTIVE ⇄ INACTIVE` through explicit status changes. Everything else is refused (`SCHOOL_INVALID_STATUS_TRANSITION`): a school can never reach `ACTIVE` except through approval, and `reactivate` does not work on a PENDING or REJECTED school. Every status change is kept in `school_status_history`. Schools that existed before the Main/Sub removal keep their status (former Main Schools stay ACTIVE).

**Country and address.** The school's country is the **organization's country** (`schools.country_id`, derived by the service, never trusted from the client; an optional `school.countryId` must equal it, else `SCHOOL_COUNTRY_MISMATCH`). The address uses the **shared address contract of Module 15** (`validateSchoolAddress`, identical to the Parent address): a registered, ACTIVE **governorate of the organization's country**; `centerName` and `villageName` are **free text** (NFC, whitespace collapsed, at most 200 characters, optional; a village only together with a center; no registered center or village is ever required or stored as an id). Address errors are the shared ones (`PARENT_ADDRESS_GOVERNORATE_NOT_FOUND`, `PARENT_ADDRESS_GOVERNORATE_INACTIVE`, `PARENT_ADDRESS_COUNTRY_MISMATCH`, `INVALID_PARENT_ADDRESS`; the names say "parent" for historical reasons). The database keeps the composite foreign keys `(organization_id, country_id)` and `(governorate_id, country_id)`.

**GPS.** One official fix per school: latitude −90..90, longitude −180..180 (7 decimals), accuracy > 0 and **at most 20 m** (`GPS_ACCURACY_EXCEEDS_LIMIT`). It can be corrected **only while PENDING** (each correction kept in `school_gps_history`); after approval it is **immutable** (`SCHOOL_GPS_LOCKED`). No manual-location or IP fallback. The 50 m geofence is exported as `SCHOOL_GEOFENCE_RADIUS_METERS` with `distanceMeters` / `isWithinSchoolGeofence` for Smart Guard.

## Creation paths
1. **Organization manager** (`POST /schools`): creates a school of THEIR organization. It is `PENDING`, has no applicant and no manager, and grants the creator nothing. The same manager then approves it (explicit separate step) and assigns a School Manager.
2. **Public submission** (`POST /schools/submissions`, no login required): the applicant chooses the organization; one transaction creates (or reuses, when logged in) the applicant account and a `PENDING` school. See "Public submission".

## Approval and rejection
- **Approve** (`schools.school.approve`): only the `ORGANIZATION_MANAGER` of the school's organization. One UnitOfWork transaction: re-check the organization is ACTIVE and (when the school has an applicant) the applicant's eligibility → school `ACTIVE` (`decided_by`, `decided_at`) → if the school has an **applicant** (`applicant_user_id`), insert the `school_managers` link (source `APPROVAL`) and assign `SCHOOL_MANAGER` through Module 09 **only if not already held** → history and events. Any failure rolls everything back (proved by a failure-injection test on MariaDB). A school without an applicant is approved with **no manager** (`manager: null`) and gets one through the assignment endpoint. Never assigns MAIN_ADMIN or ORGANIZATION_MANAGER. If the applicant is no longer eligible the approval fails (`SCHOOL_MANAGER_NOT_ELIGIBLE`), the school stays PENDING and may be rejected.
- **Reject** (`schools.school.reject`): same actor; a nonblank reason (≤ 500 characters) is required and kept with `decided_by`/`decided_at`. No manager link, no role; accounts and earlier roles are untouched; the event carries ids only (notification delivery belongs to modules 31/32).
- An Organization Manager cannot approve or reject a school of another organization: the engine's scope resolver denies it (`403 ACCESS_DENIED`).
- Concurrent approvals: the school row is locked (`FOR UPDATE`) and the update is version-checked, so exactly one wins.

## School manager link (`school_managers`)
- One user may manage several schools; each school has **at most one active manager** (unique index, also enforced in the service). History: `assigned_at`, `assigned_by`, `revoked_at`, `revoked_by`, `source` (`APPROVAL` or `ASSIGNMENT`; the old `SUB_SCHOOL_APPROVAL`/`MAIN_ADMIN_ASSIGNMENT` values are archived and mapped, see Database).
- Roles in Module 09 are **not scoped**: the `SCHOOL_MANAGER` role alone grants access to no school; the link ties a manager to exactly its school(s) and is what the `SCHOOL` scope resolver checks.
- Assignment requires an ACTIVE (approved) school and an eligible user; `revokeSchoolManager` ends the link only (the role is not revoked). **D-3 (partial):** SCHOOL_MANAGER is assigned only through approval or `PUT /schools/:id/manager` by the Organization Manager of the owning organization.

## Authorization (Module 12; deny by default)
Permissions registered by this module (`SchoolPermissions`), all granted to `ORGANIZATION_MANAGER` with **MANAGEMENT scope**, unless noted:

| Permission | Roles | Scope target |
|---|---|---|
| `schools.school.create` | ORGANIZATION_MANAGER | `ORGANIZATION` (the body's `organizationId`, proven against the caller's own organization link) |
| `schools.school.list` | ORGANIZATION_MANAGER, SCHOOL_MANAGER | UNSCOPED (rows derived from the caller's own links) |
| `schools.school.read` | ORGANIZATION_MANAGER, SCHOOL_MANAGER | `SCHOOL` |
| `schools.school.approve`, `.reject`, `.deactivate`, `.reactivate`, `.correct-gps` | ORGANIZATION_MANAGER | `SCHOOL` |
| `schools.manager.assign`, `schools.manager.revoke` | ORGANIZATION_MANAGER | `SCHOOL` |

The `MANAGEMENT/SCHOOL` resolver loads the school **from the server** (never trusts a client-claimed organization) and answers true only on positive proof: `ORGANIZATION_MANAGER` with an active link to the school's organization, or `SCHOOL_MANAGER` with an active manager link to that exact school. A nonexistent school is denied. **MAIN_ADMIN has no school permission** (platform permissions are not approved: open). `SCHOOL_MANAGER` can list and read only their own school and has no write permission. The public submission is intentionally unauthenticated (rate limited). An applicant whose school is still PENDING has no role and therefore **cannot see it through the API** until approval (deny by default; open decision 4).

## Database
Migrations `20261012100000-create-schools`, `20261013100000-add-schools-applicant-name`, `20261013110000-fix-schools-holds-name-check`, `20261014110000-schools-country-invariant`, and the three of this change: `20261015100000-organization-manager-role`, `20261015110000-free-text-center-village`, `20261015120000-schools-remove-main-sub` (all forward-only; `down` refuses).
`schools`: RESTRICT foreign keys to `organizations` and `governorates` (and the composite country keys); **no `type`, no `parent_school_id`, no `center_id`/`village_id`**; `center_name`/`village_name` (free text, `village_name` needs `center_name`, no blank text), `applicant_user_id` (nullable, no foreign key to users, like the other user references), CHECKs for status/code/name/GPS ranges/accuracy/`holds_name`/rejection data. `school_managers`, `school_status_history`, `school_gps_history` (append-only), `school_code_sequence` (locked, gap-free).
**Data preservation (Main/Sub removal):** before dropping structure, `school_classification_archive (school_id, type, parent_school_id, archived_at)` and `school_manager_source_archive (assignment_id, source, archived_at)` copy the old information (append-only, RESTRICT foreign keys); `applicant_user_id` is backfilled from `created_by` for former Sub-School requests. **Address migration:** every registered center/village is converted to its name before the id columns are dropped (the migration stops if any row cannot be converted); geography rows are untouched. **Information lost:** nothing; the old Main/Sub label and parent link exist only in the archive table.

## Public contract (`public/index.ts`)
`SchoolLookup` (read-only): `findById`, `getById`, `findByCode`, `isSchoolManager`, `listManagedSchoolIds`, `getActiveManagerUserId`, `listManagerHistory`, `listStatusHistory`, `listGpsHistory` (`isSchoolManager` says nothing about the school's status). Also exported: `registerSchoolAuthorization`, `SchoolPermissions`, `SCHOOL_TARGET_TYPE`, GPS/geofence helpers, errors, events, adapters. Composition root: `getSchoolService()` in `src/config/schools.ts`, which also registers the permissions and the resolver once at load.

## Events (outbox, same transaction, identifiers only)
`SchoolCreated`, `SchoolApproved`, `SchoolRejected`, `SchoolDeactivated`, `SchoolReactivated`, `SchoolGpsCorrected` (aggregate `School`, `{ schoolId, actorId }`) and `SchoolManagerAssigned`, `SchoolManagerRevoked` (aggregate `SchoolManagerAssignment`).

## Errors (Arabic + English)
`INVALID_SCHOOL_NAME`, `INVALID_GPS_COORDINATES`, `GPS_ACCURACY_EXCEEDS_LIMIT`, `INVALID_REJECTION_REASON`, `SCHOOL_NOT_FOUND`, `SCHOOL_NAME_ALREADY_EXISTS`, `SCHOOL_ORGANIZATION_INACTIVE`, `SCHOOL_INVALID_STATUS_TRANSITION`, `SCHOOL_GPS_LOCKED`, `SCHOOL_MANAGER_NOT_ELIGIBLE`, `SCHOOL_NOT_ACTIVE`, `SCHOOL_ALREADY_HAS_MANAGER`, `SCHOOL_MANAGER_ASSIGNMENT_NOT_FOUND`, `SCHOOL_CONCURRENT_MODIFICATION`, `SCHOOL_COUNTRY_MISMATCH`, `SCHOOL_APPLICANT_IDENTITY_MISMATCH`; removed: `SCHOOL_PARENT_INVALID`, `SCHOOL_ACTION_NOT_ALLOWED` (replaced by the engine's `403 ACCESS_DENIED`). Address errors: see above.

## Organizations
- **Registration** (`OrganizationRegistrationService`, `POST /organizations`): its own workflow. One transaction: validate the form → resolve or create the applicant's account through IAM → create the organization (ACTIVE; name unique system-wide; country immutable) → assign the applicant **`ORGANIZATION_MANAGER`** through Module 09 (history kept) → link them as manager of THAT organization (`organization_admins`, which now means "organization manager link"). **MAIN_ADMIN is never assigned.** The new account's random password is unguessable; the phone's owner sets one through OTP recovery.
- **Authorization:** `organizations.organization.list` (ORGANIZATION_MANAGER, UNSCOPED) and `organizations.organization.read` (ORGANIZATION_MANAGER, MANAGEMENT/`ORGANIZATION`), registered by Module 13 (`registerOrganizationAuthorization`). Another organization's manager gets `403`, the platform administrator gets `403`.
- **Address:** `country` chosen and required; `governorateId` registered, ACTIVE, of that country (`ORGANIZATION_ADDRESS_COUNTRY_MISMATCH`); `centerName`/`villageName` free text. Stored as `center_name`/`village_name`.

## Public submission and the applicant's account
Approved rule: whoever starts a school needs no account or login. The form carries the school fields plus the **applicant's name and phone** and the **organizationId**. One transaction; any failure keeps nothing.
1. **Validation first:** applicant name, phone (IAM `normalizePhone`, E.164), school name, GPS.
2. **Applicant identity:** not logged in → a **new** account with a random 12-character password nobody knows (not the phone-derived one); phone already registered → `USER_PHONE_ALREADY_EXISTS` (409, never reused or merged); logged in (valid token only; invalid token is 401) → that user, the submitted phone must be theirs (`SCHOOL_APPLICANT_IDENTITY_MISMATCH`), account ACTIVE.
3. **School:** `PENDING`; `created_by` and `applicant_user_id` = the applicant; typed name in `applicant_name`.
4. **Nothing is granted:** no role, no manager link (spec §19 role-less applicant: documented consequence of the approved flow).
5. **Abuse limit:** per client IP, 10 per hour (provisional, in memory, `PUBLIC_SUBMISSION_RATE_LIMIT`); `429 RATE_LIMITED` + `Retry-After`.

## HTTP API (`/api/v1/schools`)
Standard envelopes; statuses: 201, 200, 400 validation, 401 not authenticated, 403 `ACCESS_DENIED`, 404, 409, 422, 429.

| # | Method and path | Authentication | Permission / who | Success |
|---|---|---|---|---|
| 1 | `POST /schools` `{ organizationId, school }` | required | `schools.school.create`: ORGANIZATION_MANAGER of that organization | 201 school (PENDING) |
| 2 | `POST /schools/submissions` | none (optional login) | public, abuse limit | 201 `{ school, applicant }` (PENDING) |
| 3 | `GET /schools` | required | `schools.school.list` (own organization's schools / own school only) | 200 paginated |
| 4 | `GET /schools/:id` | required | `schools.school.read` (scope: school) | 200 school |
| 5 | `POST /schools/:id/approve` | required | `schools.school.approve` | 200 `{ school, manager|null }` |
| 6 | `POST /schools/:id/reject` `{ reason }` | required | `schools.school.reject` | 200 school |
| 7 | `POST /schools/:id/deactivate` | required | `schools.school.deactivate` | 200 school |
| 8 | `POST /schools/:id/reactivate` | required | `schools.school.reactivate` | 200 school |
| 9 | `PATCH /schools/:id/gps` `{ gps }` | required | `schools.school.correct-gps`; PENDING only | 200 school |
| 10 | `PUT /schools/:id/manager` `{ userId }` | required | `schools.manager.assign`; school ACTIVE | 200 assignment |
| 11 | `DELETE /schools/:id/manager` | required | `schools.manager.revoke` | 200 ended assignment |

Organizations (`/api/v1/organizations`): `POST /` (public, 201 `{ organization, applicant }`), `GET /` (`organizations.organization.list`), `GET /:id` (`organizations.organization.read`).

Bodies: school `{ "name", "governorateId", "centerName"?, "villageName"?, "countryId"? (only compared), "gps": { "latitude", "longitude", "accuracyMeters" } }`; submission adds `"applicant": { "name", "phone" }` and `"organizationId"`; organization registration `{ "applicant": {...}, "organization": { "name", "countryId", "governorateId", "centerName"?, "villageName"? } }`.
**School object:** `id, code, name, status, organizationId, countryId, governorateId, centerName, villageName, gps{...}, createdBy, applicantUserId, applicantName, decidedBy, decidedAt, rejectionReason, createdAt, updatedAt`. **List query:** `page`, `pageSize` (max 100), `sort` (`createdAt`, `code`, `name`, `status`; `-` = descending), `filter[status]`; unknown parameters are 400.

## OPEN DECISIONS (isolated; everything else is implemented)
1. **Platform (MAIN_ADMIN) permissions (D-1):** none registered; MAIN_ADMIN is denied every school and organization operation until you approve specific platform permissions. Management vs reporting scope for the platform administrator is undefined.
2. **D-2 ("applicable descendants" for Governorate/Center/Village managers):** unchanged, still deferred; not needed by schools or Parents.
3. **D-3 (role assignment):** only the school-manager part is implemented (see above). Who may assign ORGANIZATION_MANAGER beyond registration, who deactivates users, and who assigns TEACHER/STUDENT/COLLECTOR/PARENT remain undefined (the PARENT/TEACHER/COLLECTOR rules of the School Manager belong to their modules).
4. **PENDING visibility for an applicant:** an applicant without a role cannot read their own PENDING school (deny by default). A "my submissions" read needs a decision.
5. **Granting ORGANIZATION_MANAGER at registration** happens before the phone is verified (the password is unknown, so the role is unusable until OTP recovery proves ownership); postponing needs a designed verification step.
6. **Self-approval:** an Organization Manager can create a school and approve it themselves (both operations are theirs by the approved rule).
7. **Spec §19** role-less applicants, abuse-limit figure (10/hour): unchanged.

## Pending
Notification delivery (31/32); Module 17 (not started).

## Tests
Unit `tests/unit/schools` (domain, service with simulated rollback, public submissions, **engine authorization**, HTTP handlers and route/permission inventory, organization registration, boundaries), `tests/unit/organization`, `tests/unit/unified-address`, `tests/unit/roles`. HTTP/API `tests/integration/schools.test.ts` (supertest; cross-organization 403s, approval flow, free-text address). MariaDB `tests/db/schools.test.ts` (schema, no Main/Sub or center/village ids, archive tables, role migration SQL on fixture rows, atomic approval and failure injection, listing SQL; every test is rolled back) and `tests/db/organizations.test.ts`.
