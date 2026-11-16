# Evaluations (Module 29)

Master Specification §52 **as amended by the approved Module 29 decisions of the project owner (2026-11-02)**. The original §52 text is kept in the Master Specification as the historical record; the amendment right under it says what it supersedes. Amendments were also made to §50 (the narrow Smart Guard exception), §63 (notifications), §64 (no audit of score changes) and §81 (dependencies).

## What it is
One evaluation per **student per class session**: an independent score per available category and **one optional Teacher note**. Only the Teacher assigned to the session creates or modifies it, through Smart Guard. Nothing in this module sends a notification, keeps a history, or deletes anything.

## Approved decisions and where they are enforced
| # | Decision | Enforced in |
|---|---|---|
| 1 | Only the assigned Teacher creates/modifies. The School Manager cannot create, modify or correct. No correction permission. Organization/geographic managers read through the future Reports module; Main Admin no direct permission; Student has no login. | `evaluation.record.record` is the only write permission (TEACHER); `SMART_GUARD_NOT_SESSION_TEACHER` for a non-Teacher at service level; boundary test: the router has exactly 2 GET and 1 POST |
| 2 | Reads: Teacher (own sessions), School Manager (own school, grades + notes), Parent (own linked children, grades + notes). No historical values or modification details for Parents. | `evaluation.session.read`, `evaluation.student.read`; `EvaluationDto` carries no previous value, no modification time, no actor |
| 3 | Based on assignments (existence is enough). Categories follow the assignments; each its own 0-10 score; Performance and Tajweed once; per student. | `availableCategories`, `assignmentRefsOf` (domain); the service reads `getScheduledMemorization` / `getScheduledRevision`; `evaluation_scores` stores the associated assignment ids |
| 4 | ABSENT cannot be evaluated; an evaluated student cannot be marked ABSENT; unmarked is not ABSENT; enforced transactionally, also concurrently. | See "Attendance consistency" below |
| 5 | Scores 0.00-10.00 **rounded**; one optional note, 200 characters, immutable; no history. | `roundScore`, `normalizeNote`, no history table, boundary tests |
| 6 | Smart Guard + GPS; modify scores while the session lasts; no evaluation for a cancelled session; 15-minute grace for MISSING evaluations only; closed afterwards; by the scheduled end. | `evaluationPhaseAt` (domain), Smart Guard exception, service |
| 7 | Parent notifications through the Notifications modules from events. | `EvaluationRecorded`, `EvaluationScoresUpdated`; nothing is delivered here |
| 8 | Missing evaluations never block completion; never a default/zero/fabricated score. | Nothing creates an evaluation except the Teacher's request |

## Categories
```
Memorization assignment only  -> MEMORIZATION, PERFORMANCE, TAJWEED
Revision assignment only      -> REVISION, PERFORMANCE, TAJWEED
Both                          -> MEMORIZATION, REVISION, PERFORMANCE, TAJWEED
Neither                       -> none (EVALUATION_NO_APPLICABLE_ASSIGNMENT)
```
"Applicable" assignment = a Module 27 / 28 assignment scheduled for the session that is the student's own (individual group) or the shared one (collective group). The Memorization score is associated with the memorization assignment, the Revision score with the revision assignment, Performance and Tajweed with both ids that exist.

## Attendance consistency (Modules 26 and 29)
```
Module 29 write:   lock the session row (Module 24 lockSession)
                   -> read attendance with a LOCKING read (Module 26 lockStudentStatuses)  -> any ABSENT => EVALUATION_STUDENT_ABSENT
                   -> lock + read the evaluations -> write
Module 26 ABSENT:  lock the SAME session row first
                   -> ask the veto (StudentEvaluationGuard.findEvaluatedStudents, a LOCKING read) -> any evaluated => ATTENDANCE_STUDENT_ALREADY_EVALUATED
                   -> write
```
Both paths take the session row lock first, so the two can never interleave, and each reads the other side with a locking read (a snapshot read could miss a row that just committed). A student with no attendance record (UNMARKED) is never turned into ABSENT by anything here. Module 26 does **not** import Module 29: the veto is a port owned by Module 26 (`application/ports/student-evaluation-guard.ts`) that the composition root (`src/config/attendance.ts`) plugs in lazily; a boundary test fails if that wiring disappears. Writing PRESENT needs neither the lock nor the veto.

## Time windows (by the SCHEDULED end from Module 24, never by processing time)
```
Smart Guard opens      scheduled start - 15 min
IN_SESSION             ... <= scheduled end (inclusive)    record; modify previously recorded scores
GRACE                  end < now <= end + 15 min (incl.)   record MISSING evaluations only
CLOSED                 after                               every write refused (SMART_GUARD_OUTSIDE_SESSION_WINDOW / EVALUATION_WRITE_WINDOW_CLOSED)
```
- The window is judged from `scheduledEnd` (the UTC instant Module 24 computed from the Africa/Cairo schedule, so a daylight-saving day is already inside it; unit-tested with 2026-04-24). The session **status** is irrelevant: a session the job has not yet marked COMPLETED is already in grace, and one it has marked COMPLETED is not closed before the grace ends.
- In grace an existing evaluation cannot be touched: no score change, no duplicate, no note (`EVALUATION_GRACE_CREATE_ONLY`; the whole request is rejected, atomically).
- **Smart Guard exception (Module 25):** `SmartGuard.check` got an optional `allowAfterEndMinutes` (default 0, at most `MAX_AFTER_END_MINUTES` = 15, anything else throws). Only Module 29 passes it (one place, `allowAfterEndMinutes: GRACE_MINUTES`); Attendance, Memorization and Revision never do, so their window still ends at the scheduled end. Ownership, GPS, geofence, accuracy and the cancelled-session check all still apply in the extra minutes. Tests: `tests/unit/smart-guard/smart-guard-grace.test.ts` (including a source scan that nobody else mentions the option).
- **Pre-end warning:** 15 minutes before the scheduled end the Notifications modules need to know who is missing a required evaluation. `EvaluationService.getSessionEvaluationStatus(sessionId)` returns, per student currently in the group: attendance (PRESENT / ABSENT / UNMARKED), available categories, whether evaluated, whether an evaluation is still **required** (PRESENT + assignment + not evaluated), plus `warningDueAt`, `graceEndsAt` and `incompleteStudentIds`. It creates and changes nothing.

## API (`/api/v1/evaluations`)
| Method | Path | Permission | Who |
|---|---|---|---|
| POST | `/sessions/{id}/records` | `evaluation.record.record` | the session's Teacher, Smart Guard + GPS; one atomic batch (1-200 students) |
| GET | `/sessions/{id}` | `evaluation.session.read` | School Manager; the session's Teacher |
| GET | `/students/{id}` | `evaluation.student.read` | School Manager (own school); Parent (own linked children) |

`POST` request: `{ gps, records: [{ studentId, scores: [{ category, score }], note? }] }`. Per student the outcome is `RECORDED` (created), `UPDATED` (a score changed, only while the session lasts) or `UNCHANGED`. **Creation** needs exactly the categories available to the student; a **modification** sends any subset of the categories the evaluation already has. Any invalid student rejects the whole request.

## Events (outbox, same transaction)
- `EvaluationRecorded` — `{ evaluationId, sessionId, schoolId, groupId, studentId, occurrenceDate, scores:[{category,score}], note|null, actorUserId }` (grades and note, for the Parent notification).
- `EvaluationScoresUpdated` — the same without `note`, with ALL the current scores, only when a score really changed. Never any previous value.

## Database (migration `20261103100000-create-evaluations`, additive)
- `evaluations`: UNIQUE (session_id, student_id); optional `note` (CHECK: null or 1-200 characters, not blank); session snapshot (`occurrence_date`, `scheduled_start`); recorded/updated by and at. Never deleted.
- `evaluation_scores`: PK (evaluation_id, category); `score DECIMAL(4,2)` CHECK 0..10; category CHECK; NULL-safe assignment CHECK (Memorization needs the memorization assignment and no revision one, Revision the reverse, Performance/Tajweed at least one); FK only to `evaluations` (its own parent); **no** foreign key to another module's table.
- **No history/audit table** (approved). A score change updates the row.

## Changes outside Module 29 (all additive; existing tests untouched)
- **Module 25:** optional `allowAfterEndMinutes` (see above).
- **Module 24:** `ClassSessionService.lockSession(sessionId, tx)` (a `SELECT ... FOR UPDATE` of the session row; changes nothing).
- **Module 26:** `StudentEvaluationGuard` port; error `ATTENDANCE_STUDENT_ALREADY_EVALUATED` (422, ar/en); `AttendanceService` takes the optional guard, takes the session lock before marking a student ABSENT, and gained `lockStudentStatuses` and `listStudentStatuses` reads.
- **Composition root:** `src/config/evaluations.ts`, the guard in `src/config/attendance.ts`, route mount, error messages, `evaluationApiDoc`, and the registrations in the error-kinds and request-validation tests.

## Technical interpretations (NOT business rules; please confirm or change)
1. **Creation is complete.** An evaluation is created with ALL categories available to the student (a partial set is `EVALUATION_CATEGORIES_MISMATCH`). This follows "each available category receives its own score", "evaluation is mandatory" and "cannot create duplicate evaluations for students already evaluated", and makes the grace rule simple: a student either has an evaluation or does not.
2. **The note exists only from creation.** It is accepted when the evaluation is created. Re-sending the very same note is harmless; a different one, or a note on an evaluation that was created without one, is `EVALUATION_NOTE_IMMUTABLE`. (The decisions say the note cannot be edited or deleted "after its initial submission"; whether a note may be ADDED later to an evaluation that had none is not stated, so the conservative reading was taken.)
3. **Modification window.** Scores can be modified from the moment evaluations can be recorded (Smart Guard's 15 minutes before the start) until the scheduled end, inclusive. "While the session is still in progress" was read as the scheduled times, not the status (like Smart Guard).
4. **"Present" means a PRESENT attendance record.** A student with no record is UNMARKED: they may be evaluated, but the evaluation is not *mandatory* for the warning.
5. **Rounding** is half away from zero on the shortest decimal text (1.005 gives 1.01); the submitted value must itself be within 0..10 *before* rounding (10.004 is refused, 9.999 is stored as 10.00). Scores must be JSON numbers.
6. **Notes** are trimmed; blank means no note; the length counts characters (code points).
7. **Technical limits:** 1-200 students per request; three automatic retries on a concurrent creation, then `EVALUATION_CONCURRENT_CHANGE` (409). Lists are by the session's start, newest first by default.
8. **Readers see** scores, the note and `recordedAt`; no modification time or actor is exposed to anyone.
9. **Event payloads** carry the grades (and the note) so the Notifications modules need no extra read; they resolve the student's Parent themselves.

## Tests
- Unit: 23 rules (categories, rounding, note, windows incl. a daylight-saving day), 38 service, 11 boundary, 10 integration over the REAL Smart Guard / sessions / group assignments / Attendance / Memorization / Revision; 8 Smart Guard grace; 7 attendance-veto.
- API conformance: all 3 operations exercised with real responses (`tests/api-docs/conformance/evaluations.test.ts`).
- Real database (`tests/db/evaluations.test.ts`, 14): schema constraints, repository, and the **concurrency** proofs: two deterministic orderings (the second request really waits on the session lock, then is refused) and 25 racing evaluation/ABSENT pairs where never both win; racing first creations produce one evaluation. A mutation check (removing the session lock from Module 26) makes the deterministic tests fail.
