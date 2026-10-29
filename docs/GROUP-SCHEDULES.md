# Group Schedules (Module 23)

**Status: TESTED (0.31.0).** The recurring weekly slots of a group (Master Specification §35 and §44, and the approved Module 23 decisions of 2026-10-28). Depends on Modules 18 (Teachers), 20 (Groups) and 12 (Authorization Engine). Module 20 reaches it through its own `GroupSchedulePort`; Module 24 (Sessions) will read the slots through `GroupScheduleService`.

## What a slot is
A **weekday** with a **start** and an **end**: `{ dayOfWeek: 'MONDAY', startTime: '18:00', endTime: '19:00' }`.
- Weekdays are the English names `SATURDAY, SUNDAY, MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY` and are always listed in this order (the Egyptian week, Saturday first), then by start time.
- Times are **local wall-clock `HH:MM` on a 24-hour clock** (`00:00`..`23:59`). No seconds, no zone, no `24:00`. The end must be **after** the start on the same day: a slot never crosses midnight. Module 24 converts a slot to an instant when it creates a session.
- Stored as ISO weekday (Monday 1 ... Sunday 7) and minutes since midnight, with CHECK constraints.

## The rules
1. **A group has at most ONE active slot per weekday**, whatever the times: a second slot on the same weekday is refused even when the times overlap, merely touch (`18:00-19:00` and `19:00-20:00`) or are completely separate (morning and evening), **whether or not the group has a Teacher** (`409 SCHEDULE_DAY_ALREADY_HAS_SLOT`). It applies to adding a slot and to changing one onto a weekday that already has another. A group may have slots on several different weekdays. A unique index `(group_id, day_of_week, active)` is the last guard.
2. **A Teacher's slots must not overlap** across their **ACTIVE groups in ANY school** (`409 TEACHER_SCHEDULE_CONFLICT`). Boundaries that merely touch are allowed; `18:00-19:00` and `18:30-19:30` conflict. Only ACTIVE groups and ACTIVE slots count; a group without a Teacher has no Teacher conflict; different Teachers never conflict. `details.conflicts` lists the conflicting day and time; the other group's id and name are given **only when it is in the same school** (another school's groups are never revealed).
3. **Assigning or replacing a group's Teacher is validated first.** Module 20's `assignTeacher` calls `assertTeacherCanTeach` inside its transaction (after the group row is locked, before the Teacher is changed): if the group's existing slots overlap the new Teacher's slots in their other ACTIVE groups the assignment is refused (`409 TEACHER_SCHEDULE_CONFLICT`) and nothing changes. The same Teacher is not re-checked. A group without slots is not affected.
4. **Removing or replacing a Teacher never deletes or retires slots.** While a group has no Teacher its slots are only bound by rule 1; the Teacher check happens when one is assigned.
5. **Slots are immutable and never deleted.** A **change** retires the old slot (`REPLACED`, pointing at its replacement) and creates the new one in **one transaction**, after rules 1 and 2 passed; a refused change leaves the old slot active and untouched. A **removal** retires the slot (`REMOVED`). **Archiving a group** retires its active slots (`GROUP_ARCHIVED`) in the same transaction as the archive. Retired slots stay as history (Sessions will refer to slots) and free their weekday and the Teacher's time.
6. An ARCHIVED group's schedule is **read-only** (`422 GROUP_ARCHIVED`), but its history can still be read.
7. A change that changes nothing returns the slot unchanged and writes nothing.

## Concurrency
A slot change takes its locks in a fixed order inside one transaction: **the group row** (`SELECT ... FOR UPDATE`, the same lock Module 20 takes) and then, when the group has a Teacher, **the Teacher's schedule lock** (`schedule_teacher_locks`, one row per Teacher, taken by an upsert). Only then does it read, and it reads **only this module's own rows**: every active slot carries the **current Teacher of its group** (`teacher_id`), so a Teacher's schedule is one indexed read of `group_schedule_slots`. Every writer that can change a Teacher's slots (a slot change, or Module 20 assigning a Teacher to a group that has slots) holds that Teacher's lock until it commits, so two simultaneous requests for the same Teacher never both pass, a Teacher assignment racing a slot change never both pass, and no other module's table is locked.

Two details that were found and fixed by the tests:
- **No range-locking reads on the slot path.** `LOCK IN SHARE MODE` range reads take gap locks that make inserts for *unrelated* groups wait for each other and deadlock. After the group row and the Teacher lock are held, the first plain read of the transaction starts a fresh snapshot, so the plain reads that follow are current.
- **The Module 20 hook can inherit an older snapshot.** Module 20's `assignTeacher` reads (the Teacher lookup) before it calls the check, so there the Teacher's slots are read with a locking read, on this module's own table only.

`teacher_id` is kept in step by Module 20's `GroupSchedulePort.onTeacherChanged` (called from its single `saveTeacher`: assign, replace and remove), so the slots follow the Teacher without being retired. A deadlock victim is reported as the retryable `409 SCHEDULE_CONCURRENT_MODIFICATION` and the service runs the change again (up to 3 attempts) when it owns the transaction; inside a caller's transaction (Module 20's assignment) the caller receives the 409.

## API (mounted at `/api/v1/group-schedules`; one mount path per module)
| Method and path | Permission | Who |
|---|---|---|
| `GET /mine` | `groups.schedule.list-own` | TEACHER: their own weekly schedule across their schools (the Teacher comes from the token) |
| `GET /:id/slots` | `groups.schedule.read` | SCHOOL_MANAGER of the group's school; TEACHER of the ACTIVE group; PARENT of a student currently in the ACTIVE group |
| `GET /:id/slots/history` | `groups.schedule.read-history` | SCHOOL_MANAGER: every slot, active and retired, oldest first |
| `POST /:id/slots` | `groups.schedule.manage` | SCHOOL_MANAGER: add a slot (201) |
| `PATCH /:id/slots/:slotId` | `groups.schedule.manage` | SCHOOL_MANAGER: change a slot by replacement (200, the NEW slot) |
| `DELETE /:id/slots/:slotId` | `groups.schedule.manage` | SCHOOL_MANAGER: retire a slot (204) |

`:id` is the group id. There is no physical delete. The actor always comes from the verified token; the group comes from the path; client-supplied `createdBy`, `groupId`, `schoolId` or `status` are ignored. ORGANIZATION_MANAGER and MAIN_ADMIN have no schedule permission (deny by default); see `docs/AUTHORIZATION-MATRIX.md`. The contract is in the served OpenAPI document (`Group Schedules`).

Errors (Arabic and English): `SCHEDULE_DAY_INVALID`, `SCHEDULE_TIME_INVALID`, `SCHEDULE_TIME_RANGE_INVALID`, `SCHEDULE_UPDATE_EMPTY` (400), `SCHEDULE_SLOT_NOT_FOUND` (404), `SCHEDULE_DAY_ALREADY_HAS_SLOT`, `TEACHER_SCHEDULE_CONFLICT`, `SCHEDULE_CONCURRENT_MODIFICATION` (409), plus Module 20's `GROUP_NOT_FOUND` and `GROUP_ARCHIVED`. `PUT /groups/:id/teacher` can now also answer `TEACHER_SCHEDULE_CONFLICT`.

## Data
Migration `20261028100000-create-group-schedules`: `group_schedule_slots` (no foreign key to another module's table; `teacher_id` is the group's current Teacher, kept in step by Module 23 and not part of the history; `active` is 1 while current and NULL once retired; CHECKs for the weekday, the times and the retirement consistency; `seq` is the history order) and `schedule_teacher_locks` (one row per Teacher, only used for locking; holds no business data).

## Events (outbox, same transaction; identifiers, weekday, times and reasons only)
`GroupScheduleSlotCreated` (`slotId, groupId, schoolId, dayOfWeek, startTime, endTime, actorId`) and `GroupScheduleSlotRetired` (the same plus `reason` = `REPLACED | REMOVED | GROUP_ARCHIVED` and `replacedBySlotId`). A change is a Retired(REPLACED) followed by a Created.

## Changes to Module 20 (additive; its behavior without a schedule is unchanged)
`GroupSchedulePort` (`assertTeacherCanTeach`, `onTeacherChanged`, `retireSlotsOfArchivedGroup`) injected through `GroupServiceDeps.schedule` and called from `assignTeacher` (the check, after the school-link checks and before the change), `saveTeacher` (assign, replace and remove: `onTeacherChanged`) and `archiveGroup`; the read method `lockScopeById` on `GroupService`/`GroupLookup`; the `PUT /groups/:id/teacher` and `POST /groups/:id/archive` OpenAPI descriptions. No Module 20 table gets a new query. Wiring: `src/config/schedules.ts`, `src/config/groups.ts`.

## Not in this module
The Excel "Group Schedule" cell format (the import module parses it and calls this service), Sessions generated from slots (Module 24), and a time zone (slots are local wall-clock times).

## Tests
- `tests/unit/schedules/` (75): domain, the service (including explicit proofs that a second slot on the same weekday is rejected with no overlap, touching or separate, with and without a Teacher), authorization, boundaries.
- `tests/integration/schedules.test.ts` (9) and `tests/api-docs/conformance/schedules.test.ts`: the HTTP behavior and the OpenAPI conformance.
- `tests/db/schedules.test.ts` (19, `npm run test:db`): schema constraints, the SQL repository, the Teacher column, the real service, and the concurrency guarantees (committed rows with random ids, deleted afterwards). Negative controls were run by hand and each makes tests fail: without the Teacher lock the overlap race test fails; without the locking read in the Module 20 hook the stale-snapshot test fails; without `onTeacherChanged` the Teacher-sync tests fail. The file was also run as two simultaneous processes, repeatedly, against one database.
