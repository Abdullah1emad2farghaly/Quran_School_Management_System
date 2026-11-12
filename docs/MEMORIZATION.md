# Memorization (Module 27)

**Status: COMPLETED (declared by the project owner on 2026-11-01; owner-run verification, not executed by me). History: IMPLEMENTED (0.35.2: the owner's `test:db` run passed except one CHECK-constraint bug, fixed by a new migration; 0.35.1; 0.35.0 failed 3 `api:verify` tests, fixed in 0.35.1, see the changelog), NOT yet verified on the project owner's machine, not COMPLETED.** Master Specification §48 and §63 and the approved Module 27 business decisions of the project owner (2026-10-31).
**What I executed myself (sandbox without network, no `node_modules`):** the 35 service tests and 13 boundary tests of this module (48/48 pass) with a minimal vitest-compatible runner and `tsx`; the same runner re-ran the 44 existing Attendance unit tests (pass); a `tsc` run with the project's `tsconfig` plus `types: []` (no Module 27 type error beyond those caused by the missing `express` / `sequelize` / `vitest` / `@types/node` packages; the three real errors found were fixed); a static check that the OpenAPI document and the router list the same seven operations and every documented error code is registered. **USER-REPORTED (owner's local run, not executed by me):** `npm run test:db`: the 7 Module 27 DB tests pass after the 0.35.2 migration. **Not executed by me (needs your environment):** `npm run db:migrate`, the real `vitest`, `npm run typecheck`, `npm run build`, `npm run api:verify`, `npm run test:db` (the written `tests/db/memorization.test.ts`), the API-conformance test `tests/api-docs/conformance/memorization.test.ts` (written after your first `api:verify` run, not executed by me).

## What it does
1. **The next-session assignment.** The Teacher assigned to the group defines, **during the current session**, the memorization assignment of the **next session**. It is *scheduled* only because it was explicitly defined before the target session starts; no session is assumed to include memorization.
2. **The students' memorization records**, recorded only by the assigned Teacher, through Smart Guard (GPS).
3. **Public reads** for the future half-session reminder (Modules 31-34): what is scheduled for a session and which records exist. Nothing is notified, created or changed by them.

## Approved business rules (all enforced)
- **Who records:** only the Teacher assigned to the session, through Module 25 Smart Guard (ownership, time window, GPS distance 50 m, accuracy 20 m, session not cancelled). A School Manager cannot record or correct (no permission, and Smart Guard refuses a non-Teacher).
- **When the assignment can change:** the Teacher may define, modify or cancel the next-session assignment **only while the current session is IN_PROGRESS** (status `IN_PROGRESS` and the scheduled end not reached). When the session ends it is final and immutable. Every change is kept in `memorization_assignment_history` (append-only: `DEFINED`, `MODIFIED` with the previous range, `CANCELLED`). A cancelled assignment is kept, never deleted.
- **Group type (Module 20 `learningMode`):** `GROUP` (collective): ONE shared assignment for the whole group, `studentId` must be absent, the Teacher may repeat it or define a new shared one. `INDIVIDUAL`: one independent assignment per student (`studentId` required, the student must currently be in the group), different ranges allowed.
- **Evaluation:** a record is evaluated against the assignment in effect for the student. `matchesAssignment` is computed from the calculated ranges (never sent by a client): only exactly the assigned ayahs fulfil it; a different range is recorded but is **not fulfilment**. The scheduled assignment and the actual record stay distinct (`assignmentId` links them).
- **Repeat:** an unfulfilled assignment stays pending **in full**, so the ENTIRE original assignment is repeated, never only the unfinished part. In an INDIVIDUAL group the Teacher cannot define a different next assignment for a student who did not fulfil theirs in the session (`MEMORIZATION_REPEAT_REQUIRED`), and a record that would not fulfil the assignment is refused while a different next assignment exists for the student (`MEMORIZATION_RECORD_CONFLICTS_WITH_NEXT_ASSIGNMENT`; change or cancel it first).
- **Continuity:** the assignment belongs to the group (or student), not to a session id. It is scheduled for every later session until a fulfilling record exists in an earlier session or a newer assignment replaces it. So a **cancelled** session, a **rescheduled** session (the group's updated schedule decides which session comes next) and a session the **Teacher missed** (no record, nothing replaced) all carry it forward **unchanged**. Nothing discards or resets it.
- **Overlap:** overlapping ranges, the same verses again, several records for the same student in one session: all valid, every record independent. Nothing is overwritten, deleted or altered because of an overlap (no uniqueness on records).
- **Correction:** only the session's Teacher, through Smart Guard, only while that session is in progress. The correction updates the record's range and evaluation and appends an entry to `memorization_correction_history` with the ORIGINAL (previous) and the new range, so nothing is lost. After the session ends the record is immutable. The same ayahs again change nothing (`UNCHANGED`, no history, no event). A reason is optional (max 500). Records are never deleted.
- **Reads:** the assigned Teacher (their sessions) and the School Manager of the school read a session; the School Manager and a Parent (their own linked children only) read a student's records; a Student has no read access in this module.
- **Reminder read (§63):** `MemorizationService.getScheduledMemorization(sessionId)` returns `scheduled` (true only when an assignment was explicitly defined before the session), the assignments, the records, `studentsWithRecords` and `unrecordedAssignmentIds`. A session without a scheduled assignment has no scheduled activity. A missing record never creates a record.

## Technical interpretations (NOT business rules; please confirm or change)
These are the points the approved decisions did not spell out. I implemented the most conservative reading and did not add behaviour beyond it.
1. **When is an assignment "used up"?** The approved text says it carries forward when the target session is cancelled, rescheduled, or the Teacher is absent, and that an unfinished range is repeated. I implemented: *pending until a fulfilling record exists in an earlier session, or a newer assignment replaces it*. Consequence: if the Teacher held the session, no fulfilling record was made and no new assignment was defined, the old one is shown as scheduled again for the following session (it is never silently dropped).
2. **Collective groups:** "fulfilled" means at least one student has a record that is exactly the shared range; the mandatory per-student repeat applies to INDIVIDUAL groups, because the approved text lets the Teacher choose between repeating and a new shared assignment in collective groups and forbids per-student assignments there.
3. **No GPS for assignments:** Smart Guard is required for recording and correcting records (the "recording operations"), not for defining/modifying/cancelling an assignment, which the decisions bind only to the Teacher and the in-progress session.
4. **Records without a scheduled assignment** are valid (`assignmentId` and `matchesAssignment` are `null`): §48 allows several valid records per session and the decisions do not require an assignment before recording.
5. **School Manager reads assignments too** (they are part of `GET /memorization/sessions/{id}`), because the approved read rule covers records and the school scope; Parents do not read assignments.
6. A record's evaluation is fixed when it is recorded (the assignment in effect at that time) and only changes through a Teacher correction in the same session.
7. The Teacher of a **cancelled** defining session: the assignments stay as defined, final, and carry forward like any other.

## API (7 endpoints, `/api/v1/memorization`, documented in Swagger)
| Method | Path | Permission | Who |
|---|---|---|---|
| GET | `/students/{id}/records` | `memorization.student.read` | SCHOOL_MANAGER (school), PARENT (own children) |
| GET | `/sessions/{id}` | `memorization.session.read` | SCHOOL_MANAGER (school), the session's TEACHER |
| POST | `/sessions/{id}/assignments` | `memorization.assignment.manage` | the session's TEACHER, session IN_PROGRESS |
| PUT | `/assignments/{id}` | `memorization.assignment.manage` | the session's TEACHER, defining session IN_PROGRESS |
| POST | `/assignments/{id}/cancel` | `memorization.assignment.manage` | the session's TEACHER, defining session IN_PROGRESS |
| POST | `/sessions/{id}/records` | `memorization.record.record` | the session's TEACHER + Smart Guard |
| PUT | `/records/{id}` | `memorization.record.correct` | the session's TEACHER + Smart Guard, same session only |
There is no endpoint that deletes anything, no School Manager record/correct, and no read of the histories yet (Module 35).

## Database (migrations `20261101100000-create-memorization` and `20261101110000-memorization-assignment-slot-check-null-safe`, additive, no foreign keys to other modules)
`memorization_assignments` (unique `(defined_in_session_id, subject_key, active_slot)`: one ACTIVE per session and subject, any number CANCELLED), `memorization_assignment_history` (append-only), `memorization_records` (no uniqueness; CHECK that `assignment_id` and `matches_assignment` are null together), `memorization_correction_history` (append-only). Ranges are stored as the Module 22 request and result (JSON text).

## Events (outbox)
`MemorizationAssignmentDefined`, `MemorizationAssignmentModified`, `MemorizationAssignmentCancelled`, `MemorizationRecorded`, `MemorizationRecordCorrected` (identifiers only).

## Dependencies (public contracts only)
Modules 00, 02, 03, 04, 06, 12, 16 (is the caller the school's manager), 18 (teacher of a user), 19 and 20 (scope resolvers; group learning mode; who is in the group), 22 (range validation and calculation), 24 (session, times, status), 25 (Smart Guard). §81 lists 22, 24 and 25; the others follow the same pattern as Module 26 (lower-numbered, documented, locked by the boundary test). It does **not** import Attendance (26): Teacher absence is derived from the absence of a fulfilling record, not from attendance.

## Verify on your machine (in this order)
`npm run db:migrate` · `npm run typecheck` · `npm run test:unit` · `npm run test:integration` · `npm run api:verify` · `npm run test:db` · `npm test` · `npm run build`. Please send me any failing output.

## Remaining
- Written but never executed by me: the API-conformance test (real routers, real Smart Guard, real Range Engine over the mini Quran) and the DB test. No separate HTTP integration test exists beyond the conformance test.
- Concurrency: define/modify, record and correct all lock the session's assignments (`SELECT ... FOR UPDATE`) and a correction locks the record; the unique active slot makes a duplicate assignment impossible. A real-database race test is not written.
- A session can end a few seconds before the scheduler marks it COMPLETED; the service also compares the clock with the scheduled end, so the window closes exactly at the end.
- The 15-second scheduler delay is not an issue for correctness; the reminder itself (Modules 31-34) is not implemented.

## Quran ayahs for the selection UI (0.45.0, approved 2026-11-11)
`GET /api/v1/memorization/ayahs` (`getMemorizationAyahs`): authenticated, permission `quran.structure.read` (the existing one; every assignable role; no new permission). It returns a page (default 20, max 100; `sort=-globalPosition` reverses) of **all** ayahs of the approved edition (`MADINAH_MUSHAF_HAFS_604`, 6236 ayahs) with Module 21's own `AyahDto` and the exact stored text. **Memorization and Revision return the same complete dataset**: no progress-based filtering, no student-specific structure; this endpoint changes no memorization business rule (ranges, assignments and records are unchanged). The data is read through Module 21's public `QuranStructureLookup.listAyahs`; this module keeps no Quran data, table or query, and Module 21 does not depend on this module.

