# Module 19 — Students

Implementation notes of `src/modules/19-students` (version 0.25.0). Business requirements: `docs/MASTER-SPECIFICATION.md` §36-§39 (Student entity, name, National ID, lifecycle). The three Module 19 decisions below were **approved by the project owner** in the Module 19 authorization message (2026-10-20); they are not yet written into the Master Specification (see "Pending" at the end).

## What a Student is
A **business entity only**: no login, no password, no token, no session, no user account. It has exactly one Parent (Module 17), one school (Module 16), a name, a National ID, a join date and a lifecycle status. It does **not** store a group (Module 20 owns group assignment and its history) and it does **not** store an address: the address read back is the Parent's **current** address, derived at read time (§28/§37) and it follows the Parent's address.

## Approved decisions
1. **Permissions** (all scopes resolved server-side, never from the request):
   - `SCHOOL_MANAGER`: create, list, read, update, deactivate, reactivate, archive and read the history of Students **of their own school only**.
   - `PARENT`: read **only their own linked children** (`GET /students/:id`, `GET /students/mine`); no write, no lifecycle.
   - `TEACHER`: read **only** a Student of a group assigned to them (and only inside a school they are actively linked to); no write, no lifecycle. The Teacher receives a minimal view (see below).
   - `ORGANIZATION_MANAGER` and `MAIN_ADMIN`: no Student permission (a scope never grants a permission).
2. **Lifecycle**: `ACTIVE`, `INACTIVE`, `ARCHIVED`. Only the School Manager changes it. Students with history are never hard-deleted (there is no delete operation at all). Parent and Teacher cannot change the status.
3. **National ID**: the Egyptian 14-digit National ID is unique **globally** across the system (every organization, school and status).

## Rules enforced by the service
- **Registration** needs an `ACTIVE` school and a Parent that belongs to the **same organization** and is **actively linked to that school** (one neutral error `STUDENT_PARENT_NOT_LINKED_TO_SCHOOL` for unknown / foreign / unlinked, so nothing is revealed across organizations). The link row is **locked** in the registration transaction (`ParentService.lockActiveSchoolLink`, same lock order as the unlink), so a student can never attach to a link that is being removed.
- **Name** (§37): at least three parts; the **second** part is the Parent's **first** name and the **third** part the Parent's **second** name (same comparison as identity matching: exact text, Latin case ignored, Arabic letters never folded). A fourth part and more are allowed.
- **National ID** (§38): exactly 14 digits (surrounding spaces trimmed, Arabic-Indic digits converted to ASCII; nothing else accepted). Only the format is validated: no century/birth-date/governorate-code rule is invented.
- **Join date**: optional `YYYY-MM-DD`; defaults to today's business date (Africa/Cairo) because the Excel columns (§75) carry no join date. No future-date restriction was invented.
- **Exactly one Parent, never moved**: the Parent, the school and the National ID can never be changed (no transfer in V1, no automatic move to another Parent, no ID-correction workflow). A duplicate National ID moves and replaces nothing.
- **Update** (ACTIVE or INACTIVE only): the name and/or the join date. A corrected name must still carry the Parent's first and second names as parts 2 and 3. An unchanged value changes nothing and records nothing. An `ARCHIVED` student is read-only.
- **Every change** appends a `student_history` row (who, when, what, previous value, reason) and publishes an outbox event in the same transaction.

## Lifecycle (documented transitions)
| Action | From | To | Extra conditions |
|---|---|---|---|
| `POST /students/:id/deactivate` | ACTIVE | INACTIVE | none |
| `POST /students/:id/reactivate` | INACTIVE | ACTIVE | school must be `ACTIVE`; the Parent link must still be active |
| `POST /students/:id/archive` | ACTIVE, INACTIVE | ARCHIVED | none |

`ARCHIVED` is **final in V1** (no action leaves it; `STUDENT_ARCHIVED`). Any other move is `STUDENT_INVALID_STATUS_TRANSITION`. An optional free-text `reason` (≤ 500 characters) is kept in the history. The School Manager role alone can perform every lifecycle action, including reactivation.

## National ID uniqueness: enforcement strategy
1. **Database (final guard):** `UNIQUE INDEX uq_students_national_id (national_id)` on the whole table: no school or organization column in it, and **every status** counts, so archiving never frees an ID. `CHECK` constraints reinforce the format (14 ASCII digits).
2. **Application (clear error, no wasted write):** the registration transaction looks the ID up first and answers `409 STUDENT_NATIONAL_ID_CONFLICT`.
3. **Concurrency:** two simultaneous registrations of the same ID: one wins at the unique index; the repository maps the database duplicate error to the same `STUDENT_NATIONAL_ID_CONFLICT` and the losing transaction rolls back completely (student, history and event).
4. **Safe duplicate handling:** the error and message never say which school, organization or student holds the ID; no existing record is moved, replaced or modified. (A School Manager can still learn that the ID is registered somewhere: unavoidable for a global uniqueness rule.)

## Teacher view
A Teacher reading a Student receives only `id, schoolId, fullName, joinDate, status`: no National ID, no Parent reference and no (Parent-derived) address. This is data minimization chosen by the implementation; the approved decision only says a Teacher may read their students. Reversible on request.
The Teacher relationship comes from Module 20 (Groups): since 0.26.0 `src/config/students.ts` wires `GroupService.isStudentInGroupOfTeacher`, so a Teacher reads a student only while the student is in an **ACTIVE group of that Teacher** (and only inside a school they are actively linked to). The temporary fail-closed stand-in `GROUPS_MODULE_NOT_IMPLEMENTED_YET_FOR_STUDENTS` is no longer wired (still exported, unused; a boundary test asserts it). Module 20 also ends the group period of an `ARCHIVED` student through the `StudentStatusChanged` event. A Teacher **listing** of students is the group's student list (`GET /groups/{id}/students`).

## Endpoints (under `/api/v1/students`, documented in OpenAPI, tag `Students`)
| Method and path | Permission | Who |
|---|---|---|
| `POST /students` | `students.student.create` | SCHOOL_MANAGER of `schoolId` |
| `GET /students/mine` | `students.student.list-own-children` (unscoped) | PARENT |
| `GET /students/schools/{schoolId}` | `students.student.list` | SCHOOL_MANAGER of the school (paginated; `filter[status]`, `sort`) |
| `GET /students/{id}` | `students.student.read` | SCHOOL_MANAGER of the school, PARENT of the student, TEACHER of a group the student is in |
| `GET /students/{id}/history` | `students.student.read-history` | SCHOOL_MANAGER of the school |
| `PATCH /students/{id}` | `students.student.update` | SCHOOL_MANAGER of the school |
| `POST /students/{id}/deactivate` / `reactivate` / `archive` | `students.student.deactivate` / `reactivate` / `archive` | SCHOOL_MANAGER of the school |

The MANAGEMENT/`STUDENT` scope resolver is **role-aware** and answers `true` only on positive proof for the role being checked (School Manager of the student's school; Parent whose record is the student's Parent; Teacher actively linked to the school **and** assigned the student through a group). A missing student is denied (`403`, existence never revealed).

## Errors
`INVALID_STUDENT_NAME`, `STUDENT_NAME_PARENT_MISMATCH`, `INVALID_STUDENT_NATIONAL_ID`, `INVALID_STUDENT_JOIN_DATE`, `INVALID_STUDENT_REASON`, `STUDENT_UPDATE_EMPTY`, `STUDENT_NOT_FOUND`, `STUDENT_SCHOOL_NOT_ACTIVE`, `STUDENT_PARENT_NOT_LINKED_TO_SCHOOL`, `STUDENT_NATIONAL_ID_CONFLICT` (409), `STUDENT_INVALID_STATUS_TRANSITION`, `STUDENT_ARCHIVED`, `STUDENT_CONCURRENT_MODIFICATION` (409). Arabic and English messages are registered through Module 03.

## Events (outbox, same transaction; identifiers and statuses only, never a name or National ID)
`StudentRegistered`, `StudentUpdated` (`changedFields`), `StudentStatusChanged` (`previousStatus` → `status`). Group and assignment events belong to Module 20.

## Database (migration `20261020100000-create-students`)
- `students`: `id`, `school_id`, `organization_id`, `parent_id` (plain references, **no foreign key to other modules' tables**), `full_name`, `national_id CHAR(14)`, `join_date DATE`, `status`, `created_by`, `version` (optimistic lock), timestamps. Indexes: unique `national_id`; `(school_id, status)`, `(school_id, created_at)`, `(parent_id, school_id)`. CHECKs: status, 14-digit National ID, non-blank name.
- `student_history`: append-only (`seq` insertion order), `RESTRICT` key to `students` (a student with history can never be deleted at the database level either).
- The update statement never touches `parent_id`, `school_id`, `organization_id` or `national_id`.

## Impact on existing modules
- **Module 17:** one additive method `ParentService.lockActiveSchoolLink` and the exported type `ParentSchoolLinkLocker`; `src/config/parents.ts` now wires the real Students guard (`countStudentsOfParentInSchool`, **every status counted**: an archived student still anchors the link) instead of the temporary stub (still exported, now unused). No other Module 17 behavior changed.
- No existing migration was changed.
- Test helpers: `tests/helpers/parents-harness.ts` and `teachers-harness.ts` gained additive options (`useStudentGuard`, `extraStores`).

## Pending / for confirmation
1. Record the three approved decisions in `docs/MASTER-SPECIFICATION.md` (not done: only you decide when the specification is amended).
2. Defaults chosen by the implementation, easy to change: `ARCHIVED` final; only name and join date updatable; archived students still block the Parent unlink; minimal Teacher view; join date defaults to today.
3. (Done in 0.26.0) Module 20 replaced the Teacher stand-in; the Student's group is Module 20 data (`docs/GROUPS.md`).
