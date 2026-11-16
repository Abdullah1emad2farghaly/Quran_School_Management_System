# Module 20 — Groups

Implementation notes of `src/modules/20-groups` (version 0.26.0). Business requirements: `docs/MASTER-SPECIFICATION.md` §40-§43 (Group entity, one Teacher, learning mode, progression, starting surah) and the student-group rules of §36/§39/§65/§68. The six decisions below were **approved by the project owner** in the Module 20 authorization messages (2026-10-21); they are not yet written into the Master Specification (see "Pending").

## What a Group is
A group of **one** school with: a name, **at most one** Teacher (Module 18), a learning mode (`GROUP` / `INDIVIDUAL`), a progression (`FORWARD` / `BACKWARD`) and a Starting Surah. It does **not** own a schedule (Module 23), its students (the assignment records do) or any student data (Module 19). Groups are never deleted: they are `ACTIVE` or `ARCHIVED` (final).

## Approved decisions
1. **Starting Surah** is required and stored as the surah **number** (a whole number 1-114, the fixed number of surahs of the Quran). The surah names and the Quran structure belong to Module 21, which will link to this number.
2. **No schedule** in Module 20 (Module 23 owns it).
3. **Permissions** (all scopes resolved server-side, never from the request):
   - `SCHOOL_MANAGER`: create, list, read, update, archive groups of **their own school**; assign / change / remove the Teacher; assign / unassign / move students; list a group's students; read the group history and a student's assignment history.
   - `TEACHER`: read only the **ACTIVE** groups they teach (and list their students), in a school they are actively linked to; list their own groups (`GET /groups/mine`). No write.
   - `PARENT`: read only the **ACTIVE** group that currently holds one of their own children, in the minimal view (`id, schoolId, name, teacherName`). No student list, no write.
   - `ORGANIZATION_MANAGER` and `MAIN_ADMIN`: no Group permission.
4. **Archive, never delete.** Archiving is final, unassigns every student in the same transaction (reason `GROUP_ARCHIVED`) and keeps the students. **An archived group's name is NOT reserved:** the name can be reused by a new group of the same school while the previous group is `ARCHIVED`; the archived group keeps its complete history.
5. **Students leaving through their own lifecycle:** an `ARCHIVED` student is unassigned automatically (reason `STUDENT_ARCHIVED`, no actor); a deactivated (`INACTIVE`) student **keeps** the assignment and is back in the same group when reactivated. Only an `ACTIVE` student can be newly assigned.

## Rules enforced by the service
- A group is created in an **ACTIVE** school. The name is unique among the **ACTIVE** groups of the school (Latin letters case-insensitive, Arabic letters never folded); the same name in another school is fine.
- **One Teacher at most**, who must exist, belong to the school's organization and be **actively linked to that school** (one neutral error `GROUP_TEACHER_NOT_LINKED_TO_SCHOOL` for unknown / foreign / unlinked). The Teacher row and the link row are **locked** in the same transaction (`TeacherService.lockActiveSchoolLink`, same lock order as the unlink), so a concurrent unlink cannot slip past. A Teacher can teach several groups or none; a group can be without a Teacher.
- A student is in **ONE group at a time**, in the **same school** as the group. A student already in a group must be moved or unassigned first (`409 GROUP_STUDENT_ALREADY_ASSIGNED`). A **move** (same school, another ACTIVE group) ends one period (`MOVED`) and starts another in one transaction.
- **History is never rewritten:** every period of a student in a group is a row (`group_students`) with who / when / why; old periods keep the group they were in, so reports of an old date still show the old group (§68). The group's own changes (creation, corrections, Teacher changes, archive) are kept in `group_history` with the previous values; a learning mode or progression change applies **from then on** and rewrites nothing.
- Every change publishes an outbox event in the same transaction.

## Integrations (the stand-ins are gone)
- **Module 18:** `TeacherGroupDependencies` is now `GroupService.countGroupsOfTeacherInSchool`: a Teacher with an **ACTIVE** group in a school cannot be unlinked from it (`TEACHER_HAS_GROUPS_IN_SCHOOL`); an archived group no longer blocks. The count is a **locking read**. Additive Module 18 change: `TeacherService.lockActiveSchoolLink` and the type `TeacherSchoolLinkLocker`.
- **Module 19:** `StudentGroupAccess` is now `GroupService.isStudentInGroupOfTeacher` (a join over this module's tables): a Teacher reads a student only while the student is in an ACTIVE group of that Teacher. The fail-closed stand-ins `GROUPS_MODULE_NOT_IMPLEMENTED_YET` (18) and `GROUPS_MODULE_NOT_IMPLEMENTED_YET_FOR_STUDENTS` (19) are no longer wired (still exported, unused). A boundary test now asserts they are gone.
- **Students event consumer:** Module 19 publishes `StudentStatusChanged` and must not depend on Groups, so `createStudentArchivedHandler` (registered in `src/config/groups.ts` with the outbox handler registry before `startOutbox()`) ends the current period of an `ARCHIVED` student. Delivery is at-least-once and the handler is idempotent. Between the archive and the delivery the student is hidden from group listings and from the Parent / Teacher proofs (a page can be briefly shorter than requested). Not transactional with the Student archive by design (module boundary).

## Endpoints (under `/api/v1/groups`, documented in OpenAPI, tag `Groups`)
| Method and path | Permission | Who |
|---|---|---|
| `POST /groups` | `groups.group.create` | SCHOOL_MANAGER of `schoolId` |
| `GET /groups/mine` | `groups.group.list-own` (unscoped) | TEACHER |
| `GET /groups/schools/{schoolId}` | `groups.group.list` | SCHOOL_MANAGER (paginated, `filter[status]`, `sort`) |
| `GET /groups/students/{studentId}/assignments` | `groups.student.read-assignments` | SCHOOL_MANAGER of the student's school |
| `GET /groups/{id}` | `groups.group.read` | SCHOOL_MANAGER, TEACHER of the group, PARENT of a student in it (minimal view) |
| `PATCH /groups/{id}` | `groups.group.update` | SCHOOL_MANAGER |
| `PUT` / `DELETE /groups/{id}/teacher` | `groups.group.assign-teacher` | SCHOOL_MANAGER |
| `POST /groups/{id}/archive` | `groups.group.archive` | SCHOOL_MANAGER |
| `GET /groups/{id}/history` | `groups.group.read-history` | SCHOOL_MANAGER |
| `GET /groups/{id}/students` | `groups.group.list-students` | SCHOOL_MANAGER, TEACHER of the group |
| `POST /groups/{id}/students` | `groups.group.assign-student` | SCHOOL_MANAGER |
| `DELETE /groups/{id}/students/{studentId}` (204) | `groups.group.unassign-student` | SCHOOL_MANAGER |
| `POST /groups/{id}/students/{studentId}/move` | `groups.group.move-student` | SCHOOL_MANAGER (target: another ACTIVE group of the same school) |

The MANAGEMENT/`GROUP` resolver is **role-aware** and answers `true` only on positive proof for the role being checked. A missing group is denied (`403`, existence never revealed). There is deliberately no delete of a group.

## Errors
`INVALID_GROUP_NAME`, `INVALID_GROUP_LEARNING_MODE`, `INVALID_GROUP_PROGRESSION`, `INVALID_GROUP_STARTING_SURAH`, `INVALID_GROUP_REASON`, `GROUP_UPDATE_EMPTY`, `GROUP_NOT_FOUND`, `GROUP_SCHOOL_NOT_ACTIVE`, `GROUP_NAME_CONFLICT` (409), `GROUP_ARCHIVED`, `GROUP_TEACHER_NOT_LINKED_TO_SCHOOL`, `GROUP_HAS_NO_TEACHER`, `GROUP_STUDENT_NOT_IN_SCHOOL`, `GROUP_STUDENT_NOT_ACTIVE`, `GROUP_STUDENT_ALREADY_ASSIGNED` (409), `GROUP_STUDENT_NOT_ASSIGNED` (404), `GROUP_MOVE_TARGET_INVALID`, `GROUP_CONCURRENT_MODIFICATION` (409). Arabic and English messages are registered through Module 03.

## Events (outbox, same transaction; identifiers and statuses only)
`GroupCreated`, `GroupUpdated` (`changedFields`), `GroupTeacherChanged` (`previousTeacherId` -> `teacherId`), `GroupArchived`, `GroupStudentAssigned`, `GroupStudentUnassigned` (`reason`: `MANUAL`, `MOVED`, `GROUP_ARCHIVED`, `STUDENT_ARCHIVED`). Notifications about group changes belong to the notification module.

## Database (migration `20261021100000-create-groups`)
- `school_groups` (not `groups`: GROUPS is reserved in some MySQL versions): `active` is 1 while ACTIVE and NULL once ARCHIVED, so the unique index `(school_id, name_key, active)` allows one ACTIVE group per name in a school and any number of ARCHIVED ones. `name_key` is the lower-cased name compared byte for byte. CHECKs: status/active agreement, mode, progression, surah 1-114, non-blank name.
- `group_students`: one row per period of a student in a group; `active` is 1 while current and NULL once ended, so the unique index `(student_id, active)` allows one CURRENT group per student. CHECK for the period shape and the end reason. `unassigned_by` is NULL when the system ended the period.
- `group_history`: append-only, `seq` insertion order.
- RESTRICT keys only from `group_students` and `group_history` to `school_groups`; **no foreign key to another module's table**.

## Group Schedules (Module 23)
The schedule of a group is owned by Module 23 (`docs/GROUP-SCHEDULES.md`). Module 20 knows it only through `GroupSchedulePort` (`GroupServiceDeps.schedule`, optional: without it nothing below applies):
- **Assigning or replacing a Teacher** (`assignTeacher`) validates the group's existing schedule slots against the NEW Teacher's slots in their other ACTIVE groups (any school) after the Teacher passed the school-link checks and before the change is saved; a conflict is `409 TEACHER_SCHEDULE_CONFLICT` and nothing changes. The same Teacher is not re-checked.
- **Removing or replacing a Teacher** never deletes or retires a slot.
- **Archiving a group** retires its ACTIVE slots (reason `GROUP_ARCHIVED`) in the same transaction (history kept).
- **Any change of the Teacher** (`saveTeacher`: assign, replace, remove) tells Module 23 (`onTeacherChanged`) so the group's slots follow the Teacher; nothing is retired.
- New read method for Module 23: `lockScopeById` (a locking read of the group row, the same lock `assignTeacher` takes; also on `GroupLookup`).

## Tests
Unit: `tests/unit/groups/*` (domain, service, authorization matrix including the Module 19 integration, boundaries). HTTP and API conformance: `tests/integration/groups.test.ts`, `tests/api-docs/conformance/groups.test.ts` (14 operations); `error-kinds` and `request-validation` extended. Real database: `tests/db/groups.test.ts`. The Parent and Teacher atomicity DB tests now compare row counts taken just before the failing operation (they no longer assume empty tables).

## Pending / for confirmation
1. Record the approved decisions in `docs/MASTER-SPECIFICATION.md` (only you decide when the specification is amended).
2. Technical defaults, easy to change: an `INACTIVE` student keeps the assignment; a Parent sees only the name and the Teacher's name; a Teacher listing of students is by `assignedAt`.
3. Module 21 will link `startingSurah` to the Quran structure. The schedule is Module 23 (`docs/GROUP-SCHEDULES.md`).
