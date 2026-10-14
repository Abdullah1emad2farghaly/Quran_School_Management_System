# Schools (Module 16)

Owned by Module 16 (`src/modules/16-schools`). Main Schools and Sub-School requests (Master Specification §29–31), the **school-scoped manager link** with history, the official GPS rules and the gap-free school code. It exposes its own REST API (section "HTTP API" below). **No permission-registry entries yet:** the permission matrix, including decisions D-1 and D-2 of `docs/AUTHORIZATION-MATRIX.md`, is deferred; administrative endpoints are protected by authentication plus the service's active-Main-Admin check. Other modules depend on the read-only `SchoolLookup`.

## Rules (approved)
**Types and codes.** `MAIN` or `SUB`; code `SC-000001` (globally unique, assigned from a locked, gap-free sequence); id is a UUID. Names: Unicode NFC, whitespace collapsed, 1–200 characters, **unique per organization among non-rejected schools** (a REJECTED request releases its name). The database compares names under `utf8mb4_unicode_ci` (case- and accent-insensitive, so Arabic names differing only by hamza forms or tashkeel collide); the in-memory adapter approximates it with NFC + lower case. A school belongs to an EXISTING organization (`ORGANIZATION_NOT_FOUND` otherwise) that must be ACTIVE and have a country.

**Lifecycle (V1).** Main School creation → `ACTIVE` (no approval). Sub-School request → `PENDING` → `ACTIVE` (approval) or `REJECTED` (terminal; a new attempt is a new request). `ACTIVE ⇄ INACTIVE` through explicit status changes. Everything else is refused (`SCHOOL_INVALID_STATUS_TRANSITION`). Every status change is kept in `school_status_history`.

**Address.** Structured and unchanged: `GeographyLookup.validateHierarchy` (registered, ACTIVE governorate; optional center; optional village only under its center). Module 15's Parent Address rules do **not** apply to schools, and no organization-country check is added here.

**GPS.** One official fix per school: latitude −90..90, longitude −180..180 (7 decimals) and accuracy > 0 and **at most 20 m** (`GPS_ACCURACY_EXCEEDS_LIMIT`). It can be corrected **only while PENDING** (each correction is kept in `school_gps_history`); after approval it is **immutable** (`SCHOOL_GPS_LOCKED`); a Main School is never PENDING. There is no manual-location and no IP fallback. The 50 m geofence is exported as `SCHOOL_GEOFENCE_RADIUS_METERS` with `distanceMeters` / `isWithinSchoolGeofence` for Smart Guard.

**Who may do what (provisional).** `createMainSchool`, `approveSubSchool`, `rejectSubSchool`, `correctPendingGps`, `deactivateSchool`, `reactivateSchool`, `assignSchoolManager` and `revokeSchoolManager` require the actor to be an **ACTIVE user holding an active `MAIN_ADMIN` role** (`SCHOOL_ACTION_NOT_ALLOWED` otherwise). This is a deny-by-default defence, **not** the authorization engine: scope (D-1/D-2) and permissions are not approved, the matrix rows stay PROPOSED, and no endpoint exists. Only Main Admin was chosen for GPS correction and status changes because the approved text says "authorized operation" without naming a role. `requestSubSchool` needs no role (see below).

## Sub-School request and approval
1. **Request** (service `requestSubSchool` for an existing user; over HTTP the public `submitSubSchool`, see below): the requester is an **existing, ACTIVE user** (eligibility: a valid identity, an eligible account, the `SCHOOL_MANAGER` role assignable; nothing else is required: no Teacher or any other role). The parent must be an existing ACTIVE **Main** School. The school is `PENDING`; **nothing is granted**: no manager link, no role.
2. **Approval** (`approveSubSchool`): **one UnitOfWork transaction** that (a) re-checks the Main Admin and the requester's eligibility at approval time, (b) sets the school ACTIVE (`decided_by`, `decided_at`), (c) inserts the `school_managers` link scoped to this school, (d) assigns the `SCHOOL_MANAGER` role through Module 09 `RoleService` **only if the user does not hold it already**, (e) writes the status history and the events. Any failure rolls everything back: the school stays PENDING, with no manager link and no new role (proved by a failure-injection test on MariaDB). It never assigns `MAIN_ADMIN`.
3. **Ineligible at approval time:** the approval fails (`SCHOOL_MANAGER_NOT_ELIGIBLE`), the school stays PENDING, and the Main Admin may reject it with a reason.
4. **Rejection** (`rejectSubSchool`): a nonblank reason (≤ 500 characters) is required and kept with `decided_by` / `decided_at`. No manager link, no role, the user and any role held before are untouched, nothing is deleted. The event `SchoolRejected` carries ids only; the actual notification delivery belongs to the notification modules (31/32), which read the reason from the school record.

## School manager link (`school_managers`)
- One user may manage several schools; each school has **at most one active manager** (unique index `school_id + active`, also enforced in the service). History is kept: `assigned_at`, `assigned_by`, `revoked_at`, `revoked_by`, `source` (`SUB_SCHOOL_APPROVAL` or `MAIN_ADMIN_ASSIGNMENT`).
- Roles in Module 09 are **not scoped**. The `SCHOOL_MANAGER` role alone grants access to no school; the link is what ties a manager to **exactly** its school(s). The authorization engine will ask `isSchoolManager(userId, schoolId)` through a scope resolver registered with the permissions (a later step).
- Main Schools: the Main Admin assigns the manager explicitly (`assignSchoolManager`, school must be ACTIVE). Creating a Main School grants the creator nothing (no manager link, no role, no Main Admin promotion). **Creator (`created_by`) and manager are separate concepts.** The same mechanism serves Sub-Schools (replacement after `revokeSchoolManager`).
- `revokeSchoolManager` ends the link only; it does **not** revoke the user's `SCHOOL_MANAGER` role (they may manage other schools; role cleanup is not defined for V1).

## Database (migrations `20261012100000-create-schools`, `20261013100000-add-schools-applicant-name` and `20261013110000-fix-schools-holds-name-check`)
`schools` (foreign keys with `RESTRICT` to `organizations`, `governorates`, `centers`, `villages` and to its parent school; CHECKs for type/status/code/name/parent/village-center/GPS ranges/accuracy/`holds_name`/rejection data), `school_managers`, `school_status_history`, `school_gps_history` (append-only) and `school_code_sequence` (one row, locked and incremented by the creating transaction: concurrent creations queue on the row, a rolled-back creation leaves **no gap** and no duplicate; an `AUTO_INCREMENT` would burn numbers on rollback). Users are referenced **without** foreign keys (each module owns its tables, as `user_roles` does). `applicant_name` (nullable `VARCHAR(200)`, the name typed in the submission form) was added by the second migration. `holds_name` is `1` while the school holds its name and `NULL` once REJECTED (the same NULL-in-a-unique-index pattern as `user_roles.active`).

## Public contract (`public/index.ts`)
`SchoolLookup` (read-only): `findById`, `getById`, `findByCode`, `isSchoolManager(userId, schoolId)`, `listManagedSchoolIds`, `getActiveManagerUserId`, `listManagerHistory`, `listStatusHistory`, `listGpsHistory`. `isSchoolManager` says nothing about the school's status: callers that protect operations must also require the school to be ACTIVE. Composition root: `getSchoolService()` in `src/config/schools.ts`. Also exported: GPS/geofence helpers, status and code helpers, errors, event types, adapters.

## Events (outbox, same transaction, identifiers only)
`SchoolCreated`, `SchoolApproved`, `SchoolRejected`, `SchoolDeactivated`, `SchoolReactivated`, `SchoolGpsCorrected` (aggregate `School`, payload `{ schoolId, actorId }`) and `SchoolManagerAssigned`, `SchoolManagerRevoked` (aggregate `SchoolManagerAssignment`, payload `{ assignmentId, schoolId, userId, actorId }`). No names, reasons or coordinates.

## Errors (Arabic + English)
`INVALID_SCHOOL_NAME`, `INVALID_GPS_COORDINATES`, `GPS_ACCURACY_EXCEEDS_LIMIT`, `INVALID_REJECTION_REASON`, `SCHOOL_NOT_FOUND`, `SCHOOL_NAME_ALREADY_EXISTS`, `SCHOOL_ORGANIZATION_INACTIVE`, `SCHOOL_PARENT_INVALID`, `SCHOOL_INVALID_STATUS_TRANSITION`, `SCHOOL_GPS_LOCKED`, `SCHOOL_MANAGER_NOT_ELIGIBLE`, `SCHOOL_ACTION_NOT_ALLOWED`, `SCHOOL_NOT_ACTIVE`, `SCHOOL_ALREADY_HAS_MANAGER`, `SCHOOL_MANAGER_ASSIGNMENT_NOT_FOUND`, `SCHOOL_CONCURRENT_MODIFICATION`; address errors come from Geography unchanged.

## Organizations, organization scope and the country invariant (approved change)
- **Organization registration** (`OrganizationRegistrationService`, endpoint `POST /organizations`): its own workflow, independent of schools. One transaction: validate the form (applicant name and phone, organization name, country and the organization's own address through Module 15) -> resolve or create the applicant's account through IAM (same rules as below) -> create the organization (ACTIVE; name unique system-wide) -> assign the applicant the `MAIN_ADMIN` role through Module 09 (history kept) -> link them as administrator of THAT organization only. The new account's random password is unknown, so nobody can use the role until the phone's owner sets a password through the OTP recovery flow; the role grants nothing outside the linked organization.
- **Organization scope on every school operation:** the actor must hold the `MAIN_ADMIN` role AND have an active administrator link to the school's organization (`SCHOOL_ACTION_NOT_ALLOWED` otherwise; a Main Admin of another organization is refused like anyone else). Reads: `GET /schools` returns the schools of the organizations the caller administers plus the ones they submitted or manage; `GET /schools/:id` answers 404 for anything else.
- **Main School creation** is `POST /schools` (authenticated, administrator of the organization). It is no longer public: with many organizations a public Main School endpoint would let anyone add schools to someone else's organization. This also settles the earlier conflict between "only a Main Admin creates a Main School" and the public-submission rule.
- **Country invariant:** every school's country is its organization's country. The service derives it (`schools.country_id`) and never trusts a client value (an optional `school.countryId` must equal it, else `SCHOOL_COUNTRY_MISMATCH`; a governorate of another country is `SCHOOL_COUNTRY_MISMATCH`). The database enforces it with two composite foreign keys, `(organization_id, country_id) -> organizations (id, country_id)` and `(governorate_id, country_id) -> governorates (id, country_id)` (migration `20261014110000-schools-country-invariant`). An organization without a country cannot own schools, and an organization's country cannot be changed while schools exist.
- **Each school keeps its own address:** only the country is shared; schools of one organization may be in different governorates, centers and villages of that country.

## Public submission and the applicant's account (Sub-School)
Approved rule: whoever starts a school does not need an account or a login. The form carries the school fields (name, governorate, optional center and village, GPS) plus the **applicant's name and phone**. One transaction does everything; if any step fails nothing is kept.

1. **Validation first** (nothing written yet): applicant name (NFC, whitespace collapsed, 1–200 characters), phone (IAM `normalizePhone`: E.164; Egyptian `010/011/012/015` local numbers become `+20…`; anything else that is not `+`/`00` international is `INVALID_PHONE_NUMBER`), school name, GPS.
2. **Applicant identity.**
   - *Not logged in:* a **new** account is created through IAM `createUser` with a random 12-character password from the OS CSPRNG that nobody knows (it is hashed by IAM and never returned or logged). The phone-derived initial password of §24 is deliberately **not** used: it does not force a change and would let anyone who knows the phone log in. The phone's owner sets a real password through the existing **OTP password-recovery** flow (`/auth/password-recovery/*`), which proves ownership of the phone.
   - *Phone already registered:* the IAM conflict `USER_PHONE_ALREADY_EXISTS` (409). The account is never reused, merged or changed, so a typed phone number can never claim an existing account. (IAM has no identity data beyond the phone, so "same identity" cannot be decided; a conflict is the safe, established answer.)
   - *Logged in* (a valid access token is sent): the applicant is **that user**; the submitted phone must be their own (`SCHOOL_APPLICANT_IDENTITY_MISMATCH` otherwise) and the account must be ACTIVE. The authenticated session is the proof; the token is read from the `Authorization` header only, an invalid token is a 401 and never downgraded to "anonymous".
3. **School:** Main School → `ACTIVE`; Sub-School → `PENDING` (parent must be an existing ACTIVE Main School). The applicant is stored as `created_by` and the typed name as `applicant_name` (IAM has no name field).
4. **Nothing is granted by a submission:** no role, no manager link, no `MAIN_ADMIN`. The account has **no role** until a decision grants one (Sub-School approval → `SCHOOL_MANAGER`); a rejected applicant simply keeps an account with no role. (Spec §19 says a user must always have an active role; the approved flow creates the account first, so this transient/permanent role-less state is documented here as a consequence of the approved flow, not worked around.)
5. **Abuse limit:** the two public endpoints are limited per client IP (provisional default 10 per hour, in memory, `PUBLIC_SUBMISSION_RATE_LIMIT` in `src/config/schools.ts`; the project has no generic limiter and no approved figure). `429 RATE_LIMITED` + `Retry-After`. Phone-existence is observable through the 409; the limiter slows enumeration.

### Approval and rejection (unchanged rules, now over HTTP)
Only an active Main Admin approves or rejects (§31). Approval = one transaction: re-check the approver and the applicant's eligibility, activate the school, create the school-scoped manager link, assign `SCHOOL_MANAGER` through Module 09 (only if not held), history and events; any failure rolls back everything. Rejection needs a reason and grants nothing; the account and earlier roles are untouched. Concurrent approvals: the school row is locked (`FOR UPDATE`) and the update is version-checked, so exactly one wins and the other gets `SCHOOL_INVALID_STATUS_TRANSITION`.

## HTTP API (`/api/v1/schools`)
All responses use the standard envelope `{ success, data, meta?, requestId }`; errors `{ success:false, error:{ code, message, details?, requestId } }` (Arabic by default, English with `Accept-Language: en`). Statuses: 201 created, 200 ok, 400 validation, 401 not authenticated, 403 not allowed, 404 not found, 409 conflict, 422 business rule, 429 rate limited.

| # | Method and path | Authentication | Who may call (enforced) | Success |
|---|---|---|---|---|
| 1 | `POST /schools` `{ organizationId, school }` | required | active administrator of that organization (MAIN_ADMIN role + organization link) | 201 school (ACTIVE Main School) |
| 2 | `POST /schools/sub-submissions` | none (optional login) | anyone; abuse limit; the parent decides the organization | 201 `{ school, applicant:{ userId, accountCreated } }` (school PENDING) |
| 3 | `GET /schools` | required | schools of the organizations the caller administers, plus those they submitted or actively manage | 200 paginated list |
| 4 | `GET /schools/:id` | required | administrator of the school's organization, the submitter, or the school's active manager; otherwise 404 | 200 school |
| 5 | `POST /schools/:id/approve` | required | active Main Admin (§31) | 200 `{ school, manager }` |
| 6 | `POST /schools/:id/reject` `{ reason }` | required | active Main Admin (§31) | 200 school |
| 7 | `POST /schools/:id/deactivate` | required | active Main Admin (provisional) | 200 school |
| 8 | `POST /schools/:id/reactivate` | required | active Main Admin (provisional) | 200 school |
| 9 | `PATCH /schools/:id/gps` `{ gps }` | required | active Main Admin (provisional); PENDING only | 200 school |
| 10 | `PUT /schools/:id/manager` `{ userId }` | required | active Main Admin; school must be ACTIVE | 200 assignment |
| 11 | `DELETE /schools/:id/manager` | required | active Main Admin | 200 ended assignment |

### Organization endpoints (`/api/v1/organizations`, Module 16 presentation)
| Method and path | Authentication | Who | Success |
|---|---|---|---|
| `POST /organizations` | none (optional login) | anyone; abuse limit | 201 `{ organization, applicant:{ userId, accountCreated } }` |
| `GET /organizations` | required | the organizations the caller administers (paginated) | 200 |
| `GET /organizations/:id` | required | only its administrators; otherwise 404 | 200 organization |

Registration body: `{ "applicant": { "name", "phone" }, "organization": { "name", "countryId", "governorateId", "centerId"?, "villageId"? } }`. Errors: `ORGANIZATION_NAME_ALREADY_EXISTS` (409), `ORGANIZATION_ADDRESS_COUNTRY_MISMATCH`, `INVALID_GEOGRAPHY_HIERARCHY`, `GEOGRAPHY_NODE_NOT_FOUND`/`_INACTIVE`, `INVALID_ORGANIZATION_NAME`, IAM phone errors (`INVALID_PHONE_NUMBER`, `USER_PHONE_ALREADY_EXISTS`), `RATE_LIMITED`. The response never contains a password or token.

**Sub-School submission body (2):**
```json
{
  "applicant": { "name": "أحمد محمد", "phone": "01012345678" },
  "parentSchoolId": "uuid (sub-submissions only)",
  "school": { "name": "مدرسة النور", "governorateId": "uuid", "centerId": null, "villageId": null,
              "gps": { "latitude": 30.0444, "longitude": 31.2357, "accuracyMeters": 12 } }
}
```
GPS numbers must be JSON numbers; `accuracyMeters` over 20 is `GPS_ACCURACY_EXCEEDS_LIMIT`. The response never contains a password or token. The applicant sets a password with `POST /auth/password-recovery/request|verify|reset`, then logs in at `/auth/login`.

**List query (3):** `page`, `pageSize` (max 100), `sort` (`createdAt` default descending, `code`, `name`, `status`; `-` prefix = descending), `filter[status]` (comma-separated `PENDING|ACTIVE|INACTIVE|REJECTED`), `filter[type]` (`MAIN|SUB`). Unknown parameters are rejected (400).

**Create-school body (1):** `{ "organizationId": "uuid", "school": { "name", "governorateId", "centerId"?, "villageId"?, "countryId"? (only compared), "gps": {...} } }`.

**School object:** `id, code, name, type, status, organizationId, countryId, parentSchoolId, governorateId, centerId, villageId, gps{latitude,longitude,accuracyMeters}, createdBy, applicantName, decidedBy, decidedAt, rejectionReason, createdAt, updatedAt`.

**Errors:** every code in the Errors section above plus the IAM ones (`INVALID_PHONE_NUMBER`, `USER_PHONE_ALREADY_EXISTS`), `VALIDATION_FAILED` (body/params, with `details.fields`), `AUTHENTICATION_REQUIRED`, `RATE_LIMITED`, and the Geography codes for address errors.

### Authorization status of these endpoints (deferred decisions)
- **Enforced and approved:** authentication on every non-public route; approval and rejection by an active Main Admin (§31); the applicant cannot approve their own request.
- **Provisional (deny by default, not a permission definition):** endpoints 7–11 (status changes, PENDING GPS correction, manager assignment/revocation) are limited to an active Main Admin because the approved text says "authorized operation" without naming a role. They depend on the unresolved **permission matrix and D-1/D-2** (Main Admin scope; "applicable descendants"). Endpoint 3's "Main Admin sees every school" is the review queue needed by the approved §31 flow; its formal scope definition (D-1) stays PROPOSED and unchanged. No permission-registry entries exist, and no new role grants or scopes were created.
- **Not covered by the engine yet:** `requirePermission` is not used because no permission is approved.

## OPEN DECISIONS (isolated; everything else is implemented)
1. **Granting MAIN_ADMIN at registration.** The approved rule (organization creator becomes the organization-scoped Main Admin) is implemented at registration time. The applicant's phone is not verified at that moment; the safeguard is that the new account's password is unknown, so the role is unusable until the phone's owner proves ownership through the existing OTP recovery flow. If you want the grant postponed until a phone verification step exists, say so (it needs an approved design: the OTP module serves recovery only).
2. **The platform's own administrators.** Before this change a MAIN_ADMIN managed "the" organization. The migration links every current MAIN_ADMIN to the existing organization so nothing changes today. A platform-wide administrator (who may act on all organizations) is not defined and was not invented; `bootstrap:main-admin` links the first Main Admin to the first organization only. The permission matrix and D-1/D-2 remain deferred.
3. **Existing data conflicts.** `schools-country-invariant` stops (changing nothing) if an existing school's country differs from its organization's country or the organization has no country; fix with `npm run bootstrap:organization` and re-run.
4. **Phone-ownership verification during submission**, **abuse-limit figure** (10 per hour per IP is provisional) and the **permission matrix, D-1 and D-2** are unchanged and still open.
5. **Spec §19** (a user always keeps at least one role): an applicant of a Sub-School is created with no role by the approved flow; documented, not worked around.

## Not in this step
Permission-registry entries and the SCHOOL scope resolver (after D-1/D-2); notification delivery (31/32); school move/GPS change after approval (not in V1); a status workflow beyond the one above; organization-country enforcement for schools (none defined).

## Tests
Unit `tests/unit/schools` (domain, service with simulated rollback, public submissions, HTTP handlers, route inventory and protection, rate limiter, messages and module boundaries). HTTP/API `tests/integration/schools.test.ts` (supertest: submissions, approval/rejection, 401/403/404/409/422/429, envelopes, localization, no account takeover). MariaDB `tests/db/schools.test.ts` (schema, real row-lock serialization of codes, CHECK/unique/foreign-key guards, atomic approval and the failure-injection test, account+school atomicity, listing SQL; every test is rolled back). The existing DB tests of Modules 13/14 now clear the school tables first (inside their rolled-back transactions) because schools reference organizations and geography.
