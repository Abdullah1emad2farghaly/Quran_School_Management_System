# Attendance (Module 26)

Master Specification §51 and the approved Module 26 decisions of the project owner.

## What it records
`PRESENT` or `ABSENT` for each **student** and for the **Teacher** of a class session (Module 24), unique per **Session + Student** and **Session + Teacher**. A **student** without a record is **unmarked**: students are NEVER created or marked `ABSENT` automatically, not even when the session ends. There is **one automatic rule, for the Teacher only** (next section). Records are **never deleted**.

## The one automatic rule: a Teacher who does not check in, or who cancels, is ABSENT
Approved by the project owner. It is applied **by the system** (actor role `SYSTEM`, user id the nil UUID `00000000-0000-0000-0000-000000000000`), driven by Module 24's existing events through the outbox, with no timer or job of its own:
- **Session COMPLETED** (`ClassSessionCompleted`, at the scheduled end) and the Teacher has **no** attendance record → an `ABSENT` record is created (`AttendanceRecorded`). An existing record (PRESENT or ABSENT, by the Teacher or the School Manager) is never touched.
- **The Teacher cancels the session** (`ClassSessionCancelled` with `cancelSource = TEACHER`) → the Teacher is `ABSENT`. No record → created. An existing `PRESENT` record (the Teacher had checked in) becomes `ABSENT` as a **SYSTEM correction** with the fixed reason `SESSION_CANCELLED_BY_TEACHER`, and the previous value is kept in the append-only history (`AttendanceCorrected`).
- **A cancellation by the system** (a retired schedule slot, `cancelSource = SCHEDULE_SLOT_RETIRED`) marks nobody: the Teacher is not at fault.
- Idempotent (delivery is at least once): the same event twice changes nothing the second time. **Students are never touched** (a boundary test checks the handler does not mention them).
- This is the only exception to "no attendance for a cancelled session": a system record for the Teacher. Neither the Teacher nor the School Manager can record or correct attendance for a cancelled session, so a Teacher who cancelled stays ABSENT. After a normal completion the School Manager can still correct the automatic `ABSENT` to `PRESENT` with a reason (kept in the history).
- Needs migration `20261031100000-attendance-allow-system-actor` (it only widens the role CHECK constraints to accept `SYSTEM`; the earlier migration is untouched). The handler is registered at startup by `registerAttendanceEventHandlers()` (`src/app/server.ts`).

## Who does what
| Action | Who | GPS / Smart Guard | Reason |
|---|---|---|---|
| Record students (one batch) | the session's Teacher | **yes**: one GPS reading for the whole batch (Module 25: ownership, window start−15 min..end inclusive, ≤ 50 m, accuracy ≤ 20 m, session not cancelled) | only for a student whose **existing** record changes status |
| Teacher check-in (PRESENT) | the session's Teacher | **yes** (only inside the window, which ends with the session) | only if an `ABSENT` record exists (a correction) |
| Automatic Teacher `ABSENT` (session completed with no record, or cancelled by the Teacher) | the system (`SYSTEM`) | no (not an action of a person) | not needed for a first record; fixed reason `SESSION_CANCELLED_BY_TEACHER` when it overrides a PRESENT record |
| Record / correct the Teacher (PRESENT or ABSENT) | School Manager of the school | **no**, any time | only if an existing record changes status |
| Record / correct one student | School Manager of the school | **no**, any time | only if an existing record changes status |

- The batch is **atomic**: every submitted record is accepted or the whole request is rejected (all validation happens before anything is written, then one transaction).
- Only students **currently assigned** to the session's group (Module 20) can be included in a Teacher batch, each at most once (1..200 records). The School Manager may record a student without a record only if currently assigned; an existing record can always be corrected, even if the student has left the group.
- **Cancelled sessions accept no attendance** (Teacher or School Manager).
- **First marking: no reason. Changing the status of an existing record = a correction: a non-empty reason (≤ 500 characters) is mandatory.** The same status again is `UNCHANGED`: no reason, no history, no event.

## Audit history (append-only) and events
- Table `attendance_correction_history`: one row per correction with the **previous status, new status, reason, actor (user id and role), time**. The application only ever `INSERT`s into it (a boundary test enforces it); a record's current status is updated in the same transaction. Nothing is overwritten silently and nothing is deleted.
- Events through the existing outbox, same transaction: **`AttendanceRecorded`** (first marking) and **`AttendanceCorrected`** (with `previousStatus`, `status`, `reason`, `actorUserId`, `actorRole`). No second audit mechanism was introduced; Module 35 (History & Audit) will consume these. No endpoint exposes the history yet (`AttendanceService.listCorrectionsOfSession` is used by tests and by Module 35 later).

## API (`/api/v1/attendance`)
| Method and path | Permission | Who |
|---|---|---|
| `GET /students/:id` | `attendance.student.read` | School Manager of the school; the student's own Parent (linked children only). Not Teachers (they read through their sessions); not Students |
| `GET /sessions/:id` | `attendance.session.read` | School Manager of the school; the Teacher assigned to the session (checked in the application) |
| `POST /sessions/:id/students` `{ gps, records: [{ studentId, status, reason? }] }` | `attendance.student.record` | the session's Teacher + Smart Guard |
| `POST /sessions/:id/teacher/check-in` `{ gps, reason? }` | `attendance.teacher.check-in` | the session's Teacher + Smart Guard |
| `PUT /sessions/:id/teacher` `{ status, reason? }` | `attendance.record.correct` | School Manager |
| `PUT /sessions/:id/students/:studentId` `{ status, reason? }` | `attendance.record.correct` | School Manager |

Every write returns `{ sessionId, results: [{ subjectId, outcome: RECORDED | CORRECTED | UNCHANGED, record }] }`. Permissions are registered through the Authorization Engine; no new scope resolver (Module 20's MANAGEMENT/GROUP through the session, Module 19's MANAGEMENT/STUDENT). Documented in OpenAPI. The `gps` field is not marked required in the schema on purpose so that a missing reading returns `SMART_GUARD_GPS_REQUIRED` (and an invalid one `SMART_GUARD_GPS_INVALID`) and not a generic validation error.

## Database
Migrations `20261030100000-create-attendance` and `20261031100000-attendance-allow-system-actor` (the second only adds `SYSTEM` to the role CHECKs). `20261030100000-create-attendance`: `attendance_records` (unique `(session_id, subject_type, subject_id)`, CHECKs for status, subject type and roles; a snapshot of the session's date and start so a student's attendance lists by date) and `attendance_correction_history` (CHECK: a real change, a non-blank reason, valid role and subject type; `seq` keeps insertion order). No foreign keys to other modules. Every column is NOT NULL, so no CHECK can pass on a NULL (the lesson of Module 24's follow-up migration).

## Dependencies (actual code imports)
00, 02, 03, 04, 06, 12 (permission registry), 16 (is the user the school's manager), 18 (user → Teacher record), 19 (student scope), 20 (current group assignment), 24 (session), 25 (Smart Guard). §81 lists 24, 25 and 19; the others are needed for the approved behaviour (current assignment, the Teacher record, the manager check). A boundary test locks the exact set and checks that no notification, audit or teaching-record module (27–35) is imported.

## Deferred (approved, NOT implemented): the half-session reminder
The project owner approved this requirement and asked for it to be in the Master Specification; **actual notification delivery belongs to Modules 31–34 and nothing of it is in Module 26** (no notification code, no infrastructure, no timer or job; a boundary test checks it). It is now in the Master Specification (§63, approved amendment).

> The assigned Teacher is reminded **only when scheduled memorization and/or revision records are still missing after half of the session duration has elapsed**. No reminder is sent for activities that are not scheduled for that session.

Contract the Notifications phase can build on (nothing to change in Module 26):
- **When:** half of the duration is `scheduledStart + (scheduledEnd − scheduledStart) / 2`, from Module 24's public `ClassSessionService.getSession` (`scheduledStart`, `scheduledEnd`, `teacherId`, `status`) and its events `ClassSessionCreated / Started / Completed / Cancelled`. A cancelled session never triggers it.
- **To whom:** `session.teacherId` (the assigned Teacher) only.
- **Whether:** only for activities scheduled for that session that still have no record. **This needs something that does not exist yet:** a notion of "scheduled" memorization/revision activities for a session and the records of Modules 27/28. Modules 27/28 must expose that (e.g. a public read of "scheduled activities and their records for a session") before Modules 31–34 can implement the reminder. Attendance records are unrelated to the reminder.

## Technical interpretations (not business rules; please confirm or change)
0. **Timing at the very end of the session:** Smart Guard's window is inclusive of the scheduled end and the system marks the Teacher ABSENT when the session is COMPLETED at that same end. A check-in in the last instant that loses this race then needs a reason (it is a correction of the automatic ABSENT). Likewise a Teacher who checked in and then cancels becomes ABSENT (the approved rule is applied literally); a School Manager cannot undo it because the session is cancelled.
1. **A School Manager may also make a first marking** of a student or the Teacher (not only correct): the approved text allows the Manager to "record the Teacher as ABSENT" and to "correct"; for students I applied the same rule (no reason for a first marking; a reason for any change).
2. A Teacher can only correct **students currently assigned** to the group (the batch rule); the School Manager can correct a record of a student who has left.
3. Teacher correction of their own record: a check-in over an `ABSENT` record counts as a correction and needs a reason.
4. Batch limit: 200 students. Student status (e.g. deactivated) is not checked beyond the current group assignment.
5. **Teachers do not read `GET /students/:id`** (approved: Teachers read attendance for their own sessions); a Parent does not read a session's attendance, only their own children's records.
6. Two near-simultaneous first markings of the same subject: the loser rolls back and retries (up to 3 attempts), then sees the existing record (`UNCHANGED`, or a correction that needs a reason); after 3 failed attempts `ATTENDANCE_CONCURRENT_CHANGE` (409).

## Tests
- `tests/unit/attendance/`: service (32: batch atomicity, one Smart Guard call, roster rule, unmarked students, corrections and reasons, append-only history, Teacher check-in, manager at any time without GPS, cancelled sessions, concurrency retry, the automatic Teacher-absence rule in every case, reads), boundaries and messages (12), integration over the real Smart Guard, sessions, assignments and slots (7).
- `tests/api-docs/conformance/attendance.test.ts`: every documented operation against real responses (in-memory, no MariaDB).
- `tests/db/attendance.test.ts` (**needs your MariaDB/XAMPP**): schema, CHECKs, repository, the correction writing status and history together, and concurrency (racing first markings; racing corrections serialized by the row lock).

**What I executed myself:** the 32 service and 12 boundary tests, in a restricted sandbox with a minimal vitest-compatible runner and stubbed libraries (44 passed, 0 failed), plus a partial `tsc` that showed no error other than missing-library ones. Not run by me: the integration, conformance and MariaDB tests, the migration, the real vitest, `typecheck`, `build`, `api:verify`.

## Verify on your machine (PowerShell, project folder, MySQL started in XAMPP)
```
npm run typecheck
npm run db:migrate          # creates attendance_records and attendance_correction_history, then allows the SYSTEM actor
npm run test:unit
npm run test:integration
npm run api:verify
npm run test:db             # needs MariaDB
npm test
npm run build
```
