# Teachers (Module 18)

Status: IMPLEMENTED (unit, HTTP, API-conformance and real-database tests pass in the authoring environment). All former PROVISIONAL rules were APPROVED by the project owner on 2026-10-31 (global deactivation, decisions 5 and 7 below, is approved but not implemented: it waits for D-3). Business rules: Master Specification §24, §33, §34, §76 and the approved Module 18 amendments.

## What it owns
`User -> TEACHER role -> Teacher entity -> school links` (§33). The Teacher record (organization) and the **Teacher-to-School relationship** with history. It does not own the login account, name and password (Module 08), roles (Module 09), schools (Module 16) or groups (Module 20). No address, no National ID and no other personal data is collected in V1.

## Approved by the project owner
- **Initial password:** a NEW Teacher account gets the last four digits of the normalized phone as its password and the account-level `mustChangePassword` flag. The backend blocks every protected route except `POST /auth/change-password`, `/auth/logout` and `/auth/logout-all` until the password is changed (the Parent mechanism, nothing parallel). Passwords are hashed with the existing hasher; never stored, returned or logged in plaintext. Policy unchanged (4-12 characters; the new password must differ from the current one).
- **Existing account reuse:** the phone matches an existing User and the identity matches -> the account is reused and gets the TEACHER role and the school link. The password is never reset; `mustChangePassword` is never set, cleared or modified (a pending change stays pending, a cleared one stays cleared); the account's security state is untouched.
- **Identity:** the personal name is EXACTLY three parts (the shared rule of Module 08) and is the account's canonical name (`users.full_name`), never stored on the Teacher record. A missing or different stored name -> `TEACHER_IDENTITY_CONFLICT` (409). Names are never overwritten and accounts never merged. Comparison: exact normalized text, Latin case ignored, Arabic letters never folded. A matching name is the approved criterion, not independent proof of identity.

## Approved decisions (confirmed by the project owner on 2026-10-31)
- **Confirmed by the project owner (2026-10-31), all eight former PROVISIONAL decisions are now APPROVED:**
  1. SCHOOL_MANAGER manages the Teachers of their OWN school, within the approved permissions and school scope (register, list, read, remove the school link). ORGANIZATION_MANAGER and MAIN_ADMIN get no Teacher permission from their role; a Teacher reads only their own profile.
  2. An existing Teacher added to another school of the SAME organization reuses the existing account (never a duplicate account).
  3. Identity matching uses the phone number and the full (exactly three-part) name. A phone match with a conflicting name is NEVER merged automatically; it is handled explicitly as `TEACHER_IDENTITY_CONFLICT`.
  4. Historical Teacher-to-Group assignments are preserved; no historical relationship is removed in a way that affects previous sessions or records. Reassignment follows the approved Module 20/23 rules (the unlink guard `TEACHER_HAS_GROUPS_IN_SCHOOL` stays).
  5. Hard deletion of a Teacher account is not allowed; the account lifecycle / deactivation mechanism is used and history is preserved.
  6. One account may be linked to several schools of the same organization; permissions and data access stay scoped to the relevant school.
  7. A deactivated Teacher cannot log in or perform new operations that need an active account; historical records and completed sessions stay intact; existing group assignments are handled without destroying the historical relationships.
  8. The same person may hold PARENT and TEACHER on ONE account and one phone number; role permissions stay separate and active-role selection follows the existing RBAC rules.
- **Implementation status of the approved decisions:** 1, 2, 3, 4 (preservation of history; the unlink guard), 6 and 8 are implemented as described in this document. **Decisions 5 and 7 are APPROVED behaviour but NOT implemented:** global Teacher deactivation (blocking login and new operations, and the handling of the Teacher's groups) needs the user/role deactivation mechanism that is still open as decision **D-3** (who may deactivate, and for which scope); nothing was built for it and no deactivation or deletion endpoint exists. It will be built when D-3 is decided and the first user/role management endpoint is implemented.

### Technical details of the approved rules
- SCHOOL_MANAGER registers Teachers in THEIR school, lists/reads Teachers linked to a school they manage, and removes the school link of their own school. ORGANIZATION_MANAGER and MAIN_ADMIN get no Teacher permission from their role. TEACHER reads only their own profile.
- A Teacher account is reused across schools of the SAME organization only. If the account also has a Parent record, that record must belong to the same organization (`TEACHER_ORGANIZATION_CONFLICT`). (A Parent registration for an existing Teacher account does not check the Teacher's organization: Module 17 predates Module 18 and keeps its own rule.)
- A school link cannot be removed while the Teacher still has groups in that school (`TEACHER_HAS_GROUPS_IN_SCHOOL`, 422) through the `TeacherGroupDependencies` guard. Module 20 (Groups, 0.26.0) supplies the real one and `src/config/teachers.ts` wires it: it counts the Teacher's **ACTIVE** groups in the school (a locking read), so the unlink is refused with `TEACHER_HAS_GROUPS_IN_SCHOOL` while any ACTIVE group exists; an archived group no longer blocks. The temporary `GROUPS_MODULE_NOT_IMPLEMENTED_YET` stand-in is no longer wired (still exported, unused). To close the assign-versus-unlink race, Groups call `TeacherService.lockActiveSchoolLink` (type `TeacherSchoolLinkLocker`) inside their transaction: it locks the Teacher and the link in the same order as the unlink and tells whether the link is active; it changes nothing.
- No update endpoint (name and phone belong to the account) and no global deactivation or deletion of a Teacher (approved behaviour, implementation waits for decision D-3).

## HTTP API (`/api/v1/teachers`, OpenAPI in `teacher.openapi.ts`, served at `/api-docs`)
| Method and path | Permission | Who |
|---|---|---|
| `POST /teachers` | `teachers.teacher.create` | SCHOOL_MANAGER of `schoolId` |
| `GET /teachers/me` | `teachers.teacher.read-own` | TEACHER (own record from the token) |
| `GET /teachers/schools/{schoolId}` | `teachers.teacher.list` | SCHOOL_MANAGER of the school |
| `GET /teachers/{id}` | `teachers.teacher.read` | SCHOOL_MANAGER of a school the Teacher is linked to |
| `DELETE /teachers/{id}/schools/{schoolId}` | `teachers.school-link.remove` | SCHOOL_MANAGER of that school |

Scope targets: SCHOOL (Module 16's resolver) for create/list/link removal, TEACHER (Module 18's resolver: the Teacher's ACTIVE links are loaded server-side and need an active manager link to one of those schools) for read.

## Several roles on one account
Parent + Teacher (and ORGANIZATION_MANAGER/SCHOOL_MANAGER + Teacher) share ONE account when the stored name matches; each role keeps its own scope; the first-login change applies once to the account.

## Public contract (`src/modules/18-teachers/public`)
`TeacherService`, `TeacherLookup` (read-only: `findById`, `findByUserId`, `listActiveSchoolIds`, `isLinkedToSchool`, `listSchoolLinkHistory`), `TeacherGroupDependencies`, `registerTeacherAuthorization`, `TeacherPermissions`, DTOs, errors, events, repositories (SQL and in-memory), `createTeacherRouter`, `teacherApiDoc`.

## Events (outbox, identifiers only)
`TeacherRegistered`, `TeacherSchoolLinked`, `TeacherSchoolLinkRemoved`.

## Database (migration `20261019120000-create-teachers`)
`teachers` (unique `user_id`; no name column), `teacher_schools` (history; unique `(teacher_id, school_id, active)`; NULL-safe CHECK `<=>`; RESTRICT key to `teachers` only). No foreign key to another module's table (§14).

## Errors (Arabic + English)
`INVALID_TEACHER_NAME`, `TEACHER_NOT_FOUND`, `TEACHER_IDENTITY_CONFLICT`, `TEACHER_ORGANIZATION_CONFLICT`, `TEACHER_ALREADY_LINKED_TO_SCHOOL`, `TEACHER_SCHOOL_LINK_NOT_FOUND`, `TEACHER_SCHOOL_NOT_ACTIVE`, `TEACHER_ACCOUNT_INACTIVE`, `TEACHER_CONCURRENT_MODIFICATION`, `TEACHER_HAS_GROUPS_IN_SCHOOL`; `PASSWORD_CHANGE_REQUIRED`, `CURRENT_PASSWORD_INCORRECT`, `NEW_PASSWORD_SAME_AS_CURRENT` (Module 10); `PERSON_NAME_MISMATCH`, `INVALID_PERSON_NAME` (Module 08).

## Open items
- The PROVISIONAL rules are confirmed (see above); the Excel import of Teachers (Module 36) will use `registerTeacher`.
- Group assignment and the "a group has at most one teacher" invariant belong to Module 20.
- D-3 (role assignment / user deactivation): global Teacher deactivation (§33; approved decisions 5 and 7) is not implemented.
