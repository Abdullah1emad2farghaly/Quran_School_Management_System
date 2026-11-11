# Notification Rules (Module 32)

Owned by Module 32 (`src/modules/32-notification-rules`). Master Specification §57, §63 and the **approved Module 32 decisions** (owner, 2026-11-07; recorded as an amendment after §63). Module 32 decides WHO is told WHAT and WHEN; Module 31 (Notifications Core) stores, renders (Arabic / English) and delivers. Module 32 has **no HTTP API, no permissions and publishes no events**.

## Architecture
- Event consumers (`application/handlers`) are registered in the existing outbox (`src/config/notification-rules.ts`, called from `server.ts` before `startOutbox()`). The outbox runs them AFTER the business transaction committed, so a failure is retried and can never roll back the business change. At-least-once delivery is made safe by once-only keys.
- Time-driven reminders live in the database (`notification_reminders`, due-based) and are processed by `ReminderScheduler` (10 s poll, in-process, no Redis) through `ReminderProcessor`.
- Every read of another module goes through a narrow port (`application/ports/directories.ts`) implemented by an adapter over the other module's PUBLIC contract (`infrastructure/adapters`). Notifications are created only through `NotificationService.notify`.

## The rules
| # | Trigger | Recipients | Notes |
|---|---|---|---|
| 1 | `SchoolCreated` (a public request: the school has an applicant) | Organization Manager(s) of the organization | a school created directly by an organization manager is not a request: nobody is told |
| 2 | `SchoolApproved` | the original requester (applicant) only | no one else, not even the managers |
| 3 | `SchoolRejected` | the original requester only | includes the rejection reason |
| 4 | `GroupStudentAssigned`, `GroupStudentUnassigned` | Parent accounts linked to THAT student; the Teacher currently responsible for the group | a move = removal + assignment, so parents hear both and each group's Teacher hears their side; removal caused by archiving says so |
| 5 | `GroupTeacherChanged` | BOTH the newly assigned Teacher and the previously assigned Teacher | no parent (no particular student); only one of them exists on a first assignment or a removal |
| 6 | `GroupArchived` | the responsible Teacher | confirmed unchanged: each Parent linked to a student of the archived group is told through that student's own `GroupStudentUnassigned` event (reason GROUP_ARCHIVED) |
| 7 | Memorization / Revision assignment defined (new), modified, cancelled | Parent accounts of the affected student(s) only | carries the ACTUAL range by unit (see below); individual assignment: its student; shared GROUP assignment: every current student of the group, each parent told only about their own children; the Teacher who made the change is not notified |
| 8 | `ExamExaminerAssigned` / `ExamExaminerRemoved` | the Teacher concerned | |
| 9 | `ExamScheduled` | parents of the target students | schedules the 24-hour reminder |
| 10 | `ExamUpdated` (start, end, targets, question count, maximum score), `ExamEndTimeChanged` | parents of the affected students + currently assigned examiners | a change of targets tells the parents of students ADDED ("an exam was scheduled") and REMOVED; other changes tell the parents of the current targets the current schedule |
| 11 | `ExamStudentTargeted` / `ExamStudentUntargeted` | parents of that student | |
| 12 | `ExamCancelled` / `ExamDeleted` of a scheduled exam | parents of the target students + examiners | pending reminder suppressed |
| 13 | `ExamResultRecorded` | parents of that student | question scores and total |
| 14 | 24 hours before the exam start | parents of every target student + every currently assigned examiner | scheduled < 24 h before the start: sent at once |
| 15 | `EvaluationRecorded` / `EvaluationScoresUpdated` | every Parent account linked to the student | assignment, individual scores, total, Teacher note when present; updates carry current scores only |
| 16 | Half of the session elapsed | the assigned Teacher only | memorization and/or revision explicitly SCHEDULED and still without a record |
| 17 | 15 minutes before the scheduled session end | the assigned Teacher only | present students with an assignment still lack the evaluation |

## Assignment details (approved clarification 4)
The assignment events carry identifiers only, so the range is read when the notification is made:
- `MemorizationService.findAssignmentById` / `RevisionService.findAssignmentById` (new, read-only, no authorization, never an endpoint; Modules 27 / 28) return the assignment in its CURRENT state (a modified assignment shows its current range; a cancelled one keeps the range that was cancelled). The range is the Quran Range Engine's stored result (Module 22), so nothing is recalculated and no business logic is duplicated.
- Module 21's read-only `QuranStructureLookup` supplies the Arabic surah names and the page and quarter of the two end ayahs.
- The text depends on the UNIT the assignment was defined in (every shape also states the exact ayah span, e.g. `البقرة 2:5 → 2:10`):
  - AYAHS: surah and ayah range and the ayah count.
  - SURAHS: the surah range, BOTH endpoints included, and the number of surahs.
  - PAGES: the Mushaf page range (first page of the first ayah to last page of the last ayah).
  - QUARTERS: the quarter range.
  - LINES: the number of lines and the Mushaf pages.
- If the page / quarter data is unavailable the exact ayah range is still sent (never a guess); if the assignment itself can no longer be found the plain notification (student and group) is sent rather than none. A technical read failure is retried by the outbox.
- The evaluation notification's assignment text uses the same ayah span (with the surah name).

## Recipient resolution
- **Parents of a student:** `StudentLookup.findById` -> `parentId` -> `ParentLookup.findById` -> `userId`. The port returns a LIST of Parent accounts (decision 10: every currently linked Parent account); today a student has exactly one linked Parent record.
- **Teacher of a group / session:** the Teacher record id -> `TeacherLookup.findById` -> `userId`. For a group, the Teacher responsible AT HANDLING TIME.
- **Previous Teacher of a group (Teacher change):** `previousTeacherId` of the event, then the same Teacher lookup.
- **Organization Managers:** `OrganizationLookup.listOrganizationAdminUserIds` (new, read-only; see below).
- **Requester:** `SchoolLookup.findById().applicantUserId`.
- **Current group students (shared assignments):** `GroupService.listStudentsOfGroup`.
- **Target students of an exam:** `ExamService.listPendingGroups` + `listPendingStudents` while the exam is DRAFT/SCHEDULED; afterwards Module 32's own audience snapshot.
- **Examiners:** `ExamService.getExamReminderStatus().examinerTeacherIds` (current); the snapshot when the exam is no longer readable (a deleted exam).
- Every notification about a student is a SEPARATE `notify` call for THAT student's parents, so no parent can ever receive another student's data.

## Idempotency and duplicate prevention
- Every `notify` carries a `dedupKey` (`domain/value-objects/dedup-keys.ts`) built from ids only. Module 31 records one key per recipient account BEFORE creating the notification and never deletes it. Event-driven keys use the event id (a redelivered event has the same id); a student-specific notification adds the student id; exam reminders are bound to the start time (`exam-reminder:<examId>:<startAtMs>:<studentId>`), so a moved exam is reminded for the new time and the same time never twice; session reminders use the session id.
- Notifications are created BEFORE the audience snapshot is updated, so a retry after a partial failure loses nothing and duplicates nothing.
- `notification_reminders` has a unique key on (kind, subject): the same due time again changes nothing (a redelivered event never revives a sent or suppressed reminder); a different due time re-arms it.

## Delayed scheduler recovery (decisions 5, 6, 9)
Reminders are rows with `due_at`; a pass claims rows with `due_at <= now` (locked with `locked_until` / `claim_id`, so two instances never process one row; a crashed worker's lock expires after 60 s). A reminder missed by a delay, outage or restart is therefore simply late, and the next pass re-checks the CURRENT facts through public reads:
- **Half-session:** session IN_PROGRESS and not past its end; memorization/revision SCHEDULED (`getScheduledMemorization` / `getScheduledRevision`) with `unrecordedAssignmentIds` still not empty -> the assigned Teacher is told immediately. An unscheduled activity is never reminded. A session not yet started by the scheduler is checked again after 30 s.
- **Evaluation warning:** session IN_PROGRESS and not past its end; `getSessionEvaluationStatus().incompleteStudentIds` not empty -> the assigned Teacher is told immediately.
- **Exam 24 h:** exam still SCHEDULED and not started; a start moved later postpones the reminder to the new time.
- Cancelled / completed / ended / not-in-progress subjects are SUPPRESSED, never sent. `ClassSessionCancelled`, `ClassSessionCompleted`, `ExamCancelled`, `ExamDeleted`, `ExamStarted` also suppress their pending rows at once.
- A technical failure retries after 30 / 60 / 120 / 240 s, then the row is FAILED (`last_error`); other reminders are never blocked.

## Data model (migration `20261107100000-create-notification-rules`)
No foreign keys to other modules (§14). Rollback (`down`) drops both tables; it loses only pending reminders and the audience snapshot, never a notification.
- `notification_reminders(id, kind, subject_id, due_at, state, attempts, locked_until, claim_id, last_error, processed_at, created_at, updated_at)`; unique (kind, subject_id); index (state, due_at); CHECKs on kind (EXAM_24H, SESSION_HALF_TIME, SESSION_EVALUATION) and state (PENDING, SENT, SUPPRESSED, FAILED).
- `notification_exam_audience(exam_id, role, subject_id, created_at)`; primary key (exam_id, role, subject_id); CHECK role IN (STUDENT, EXAMINER). The students / examiners Module 32 has told about an exam (ids only, no content). Cleared when the exam is cancelled, deleted or ended.

## No backfill (approved clarification 5)
Nothing is created for a record that predates the deployment. Reminders exist only for exams scheduled and sessions generated AFTER Module 32 started consuming events (`ExamScheduled` / `ClassSessionCreated`), and the handlers also refuse to create a reminder for a start or an end already in the past. An exam Module 32 has never seen (no reminder row, no audience snapshot) gets no reminder even if it is modified later; a target change on it is reported as "the exam was modified" to its current targets (nobody was told about it before, so "added / removed" is meaningless), and the snapshot is seeded from then on without creating a reminder. No delayed notification is ever sent for such records.

## Changes outside Module 32 (smallest compliant additions)
- **Module 13:** `OrganizationAdminRepository.listActiveUserIdsByOrganization` (port, in-memory, Sequelize) and `OrganizationService.listOrganizationAdminUserIds`, added to `OrganizationLookup`. Read-only; nothing existing changed. Needed because no public read could list an organization's managers.
- **Modules 27 and 28:** `findAssignmentById` on `MemorizationService` and `RevisionService` (read-only, additive; the repositories already had `findAssignment`).
- `src/app/server.ts` registers the handlers and starts / stops the reminder scheduler.

## Remaining interpretations and limitations
1. **Group archive:** the responsible Teacher receives the `GroupArchived` message and, because each student's removal is its own `GroupStudentUnassigned` event, also one message per student (the previous review kept this unchanged). If exactly one Teacher message is wanted, suppress the per-student Teacher message for reason GROUP_ARCHIVED (a one-line change in `group-change-handlers.ts`).
2. **Cancelled assignments** still notify the parents (with the cancelled range), as an assignment change.
3. **Pre-deployment exams:** cancelling one notifies only its examiners (the parents are not in the snapshot); this follows from "no backfill".
4. A student is linked to ONE Parent record today; the port returns a list, so several linked Parents will all be notified without a code change.
5. Surah names are Arabic (Module 21 stores only Arabic names), also inside English messages.

## Subscription rules (added with Module 33, release 0.43.0)
Approved 2026-11-07/08; details in `docs/SUBSCRIPTIONS.md`. Module 32 consumes Module 33's events and still creates notifications only through Module 31.
- **A. `SubscriptionsCreated`** → the school's CURRENT Subscription Collectors. The same event schedules the reminders below.
- **B. `SubscriptionPaid`** → the student's Parent ONLY (no Collector, no School Manager); cancels the pending 3-day reminder. `SubscriptionWaived` cancels it too.
- **C. `SUBSCRIPTION_UNPAID_3D`** (one reminder row per subscription, subject = subscription id): due at 00:00 Africa/Cairo of (creation date + 3 calendar days). The CURRENT status is read when it fires; only UNPAID is reminded; the Parent only; once-only key per subscription.
- **D. `SUBSCRIPTION_UNPAID_MONTH_END`** (one row per bulk batch = school and month): due at 00:00 Africa/Cairo of the first day of the final five calendar days of the month (30 days → 26th, 31 → 27th, February by its real length). Only UNPAID subscriptions at that moment; each Parent hears about their own child; the school's CURRENT Collectors and School Manager get one message listing the unpaid students (first 20 names, then "(+N)"); nothing is sent when none is unpaid; once per school and month. If the month is already over the reminder is suppressed; a bulk run made inside the window is sent at the next pass.
- Templates: `subscription.monthly-created.collector`, `subscription.paid.parent`, `subscription.unpaid-reminder.parent`, `subscription.month-end.parent|collector|manager` (Arabic and English).
- Migration `20261108110000-notification-reminders-subscription-kinds` widens the `notification_reminders.kind` CHECK (additive). Module 32 now depends on Module 33's public contract (events, read-only lookups); Module 33 never imports Module 32.
- **0.43.1 (no rule changed):** `SubscriptionMarkedUnpaid` creates no notification and changes no reminder. Payment notification (B) is still Parent only and once per subscription (a payment made again after a revert does not notify the Parent a second time). The 3-day reminder is not re-armed after a revert; the end-of-month reminder reads the current status.
- Tests: `tests/unit/notification-rules/subscription-rules.test.ts` (25 tests) and `tests/unit/subscriptions/subscription-time-rules.test.ts`.

## Tests
`tests/unit/notification-rules` (129 tests: formatting and timing, templates, school, group, assignment details per unit, evaluation, exam, reminders, scheduler recovery, no backfill, concurrency, retry, boundaries), `tests/unit/organization/organization-admin-user-ids.test.ts`, `tests/unit/memorization/memorization-find-assignment.test.ts`, `tests/unit/revision/revision-find-assignment.test.ts`, real-database suite `tests/db/notification-rules.test.ts` (claim lock under concurrency, upsert re-arm, CHECK constraints, chunked audience). See `docs/PROJECT-CHANGELOG.md` (0.41.0) for what was actually executed.
