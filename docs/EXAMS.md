# Exams (Module 30)

Master Specification §53-57 **as amended by the approved Module 30 decisions of the project owner (2026-11-02)**. The original §53-57 text is kept in the Master Specification as the historical record; the amendment at the end of §57 says what it supersedes. Amendments were also made to §50 (Smart Guard entry point), §63 (notifications) and §81 (dependencies).

## What it is
An exam belongs to a school and is created and managed **only by its School Manager**. Assigned examiners record one **immutable** result per student. Nothing in this module sends a notification, edits a result, or deletes a result.

## Lifecycle
```
DRAFT -> SCHEDULED -> STARTED -> COMPLETED -> ENDED          CANCELLED (from DRAFT or SCHEDULED only)
 manual    manual     automatic   automatic      manual       Deletion (soft): DRAFT or SCHEDULED only
                      at start    at end (or     final,
                      (Cairo)     manual if no   never
                                  end time)      automatic
```
| Step | Who / when | Effect |
|---|---|---|
| create | School Manager, any time, any number | DRAFT |
| schedule | School Manager; the start must be strictly in the future | SCHEDULED, `ExamScheduled` |
| STARTED | the scheduler at `startAt` (inclusive) | the target list is **frozen** (stored), `ExamStarted` |
| COMPLETED | the scheduler when `now > endAt` (an exam WITH an end time); the School Manager manually only for an exam WITHOUT an end time | every PENDING target becomes ABSENT (no score, no result), `ExamCompleted` with the absent ids |
| ENDED | School Manager only, only after COMPLETED, **never automatic**, one-way | every examiner's exam-scoped permission is released; everything locks; all records are kept, `ExamEnded` |
| cancel | School Manager, DRAFT or SCHEDULED only (never after STARTED, with any permission) | CANCELLED, `ExamCancelled` |
| delete | School Manager, DRAFT or SCHEDULED only | soft delete: the exam disappears from every read, the record is kept, `ExamDeleted` |

## What can change when
| | DRAFT / SCHEDULED | STARTED | COMPLETED | ENDED |
|---|---|---|---|---|
| start time, question count, maximum score, targets | yes (a SCHEDULED start stays in the future) | **locked** (`EXAM_CONFIG_LOCKED`) | locked | locked |
| end time | yes (set or cleared via the configuration) | **extend or reduce, strictly in the future and after the start; cannot be cleared** (`PUT /end-time`) | no (`EXAM_LOCKED`) | no |
| examiners (add / remove) | yes | yes | yes | **no** (`EXAM_LOCKED`) |
| results | no | the examiners record | no | no |

## Targets and the freeze
- Before STARTED the target list is **computed live** from the current members of the targeted groups (whole school: every ACTIVE group of the school). Add, remove, move and "change the targeted groups" are therefore reflected immediately and nothing can drift (there is no copy to keep in sync). Reads (`/groups`, `/groups/{id}/students`) use this live list.
- At STARTED, inside the transition (under the exam lock, reading the membership at that moment) the list is stored in `exam_students` and **frozen**: students who leave a group stay in the exam, students who join are not added.
- Module 20's `GroupStudentAssigned` / `GroupStudentUnassigned` events only make Module 30 publish `ExamStudentTargeted` / `ExamStudentUntargeted` for SCHEDULED exams that target the group (so the Notifications modules can tell the parent of a student added after scheduling). A MOVED unassignment is ignored for a whole-school exam (the student is still targeted). Delivery is at least once; consumers de-duplicate by exam and student.

## Examiners and the exam-scoped permission ("TESTER")
- Eligible: a Teacher **registered in the exam's school** (not another school, even in the same organization). A School Manager qualifies only as such a Teacher.
- The approved "TESTER" permission is **not a role**. It is the policy `exam.result.record` (role TEACHER) plus a **MANAGEMENT/EXAM scope resolver** (registered through the Authorization Engine) that is true only while the Teacher is a *currently assigned* examiner of an exam in SCHEDULED, STARTED or COMPLETED, in a school they are registered in. Removing an examiner (or ENDED releasing everyone) makes the resolver answer false at once, and the examiner row is kept with `released_at` and a reason (`REMOVED` / `EXAM_ENDED`). **No role is created, changed or removed** (a boundary test forbids any role-module import). The permission is re-checked under the exam lock at submission time.
- Examiners can be added and removed until ENDED, also while STARTED; results already recorded by a removed examiner stay.

## Results
- `POST /exams/{id}/results`: one student, **one score per question in order, all at once**; atomic (nothing is stored on any failure). `0 <= score <= maxScore` is checked on the submitted value, then each score is **rounded to two decimals**; the total is the **exact sum**; no pass mark, percentage or ranking.
- Preconditions (re-checked under the lock): the caller is a currently assigned examiner, the exam is STARTED, `now <= endAt` (inclusive) when there is an end time, the student is in the frozen list and still PENDING.
- **First wins:** the student's row is taken with a row lock and `status = 'PENDING'`; the second concurrent submission waits, finds the student no longer pending and gets `EXAM_RESULT_ALREADY_RECORDED`. A unique `(exam, student)` key is a second guard.
- **Immutable:** `ExamResult` has no mutator; the repository has no UPDATE or DELETE of `exam_results` / `exam_result_scores` (a boundary test scans for it); no endpoint edits or deletes; a School Manager has no such power either.
- **Smart Guard:** through the new `SmartGuard.checkProtectedAction({ teacherId, schoolId, gps, window })`: window = 15 minutes before `startAt` through `endAt` (no upper bound when there is no end time). Because results are only recorded while STARTED, the lead minutes matter only for `EXAM_NOT_STARTED` vs the Smart Guard window error. Ownership (assigned examiner) is verified by Module 30 first.

## Absence
At COMPLETED every PENDING target becomes ABSENT (`exam_students.status`). **No result row, no zero score** is created. After COMPLETED nothing can be submitted and the end time cannot be extended. The exam stays COMPLETED until the School Manager ends it.

## Reads (approved)
| Who | What |
|---|---|
| School Manager | all exams of the school (`GET /exams/schools/{id}`), `GET /exams/{id}`, all results and the absent students (`GET /exams/{id}/results`), a student's outcomes |
| Assigned examiner | `GET /exams/assigned`, `GET /exams/{id}`, `GET /exams/{id}/groups`, `GET /exams/{id}/groups/{groupId}/students` (**pending only**, with group and status). **Never any result**, not even their own. After ENDED (or removal) all of it is denied |
| Parent | `GET /exams/schedule` (scheduled exams of the schools of their children), `GET /exams/students/{id}` (their own children's recorded results and ABSENT only; never pending, never another family's) |
| Teacher not assigned, Student | nothing |
| Organization / geographic managers, Main Admin | nothing directly (the future Reports module) |

## API (`/api/v1/exams`, 19 operations, all in Swagger)
POST `/`, GET `/schools/{schoolId}`, GET `/schedule`, GET `/assigned`, GET `/students/{id}`, GET `/{id}`, PATCH `/{id}`, DELETE `/{id}`, POST `/{id}/schedule|cancel|complete|end`, PUT `/{id}/end-time`, POST `/{id}/examiners`, DELETE `/{id}/examiners/{teacherId}`, GET `/{id}/results`, GET `/{id}/groups`, GET `/{id}/groups/{groupId}/students`, POST `/{id}/results`.

## Concurrency design
Every change and transition takes the exam row `FOR UPDATE`; a result submission takes it `LOCK IN SHARE MODE` (submissions run in parallel, never while a change or the completion holds the exam), re-checks the examiner and the status under that lock, then takes the student row. Consequences, each proved on a real MariaDB: examiner removal vs submission (both orders), end-time change vs automatic completion (both orders: a completion that was due re-checks and does not complete after the end was moved into the future; a change after completion is refused), the freeze at STARTED vs an edit (the edit waits, then is refused; the frozen list is the one read at the start), ENDED one-way under 5 parallel requests, parallel submissions of the same student (one wins) and of different students (all succeed), and a rollback leaving the student PENDING.

## Restart and delayed-job recovery
`ExamScheduler` (started from `src/app/server.ts`, 15-second in-process poll, no Redis) calls `ExamService.runCycle()`, which works only from the **stored** start/end times and is idempotent: an exam whose start and end both passed during downtime is started and completed in one pass, in order; two server instances racing do it exactly once (the lock + re-check under it); `advanceExam` also advances one exam on demand (a submission arriving right at the start does not wait for a tick). ENDED is never part of a pass.

## Database (migration `20261104100000-create-exams`, additive)
`exams` (status CHECK, 1-200 questions, `max_score` 0-1000, `end_at IS NULL OR end_at > start_at`, soft-delete `deleted_at`), `exam_groups`, `exam_examiners` (released with a reason or not at all, NULL-safe CHECK), `exam_students` (the frozen list, status PENDING / EXAMINED / ABSENT), `exam_results` (UNIQUE exam + student), `exam_result_scores` (PK result + question, score 0-1000). Foreign keys only to this module's own parent tables (`ON DELETE RESTRICT`); none to another module.

## Changes outside Module 30 (all additive; existing tests untouched)
- **Module 25:** `SmartGuard.checkProtectedAction` (+ its exported input type). `check` is unchanged; a test scans the sources so only Module 30 calls the new method.
- **Composition root:** `src/config/exams.ts`, `src/app/server.ts` (scheduler + group handler), route mount, error messages, `examApiDoc`, and the registrations in the error-kinds and request-validation tests.
- No change to Modules 20, 24, 26-29.

## Technical interpretations (NOT business rules; please confirm or change)
1. Scheduling requires a start strictly in the future; the end must be after the start; the end time is a full date and time.
2. The end time can be **set or changed** while STARTED but **not cleared** (not stated); before STARTED it is part of the editable configuration.
3. COMPLETED happens when `now > endAt`; a submission at exactly `endAt` is still accepted (the same inclusive end Smart Guard uses).
4. Deletion is a **soft delete** (`deleted_at`): the spec protects exam records and a hard delete would also lose the history of events already sent.
5. There is no title or description field (none was approved); notifications identify the exam by school and time.
6. A CANCELLED exam is final (not editable, not deletable); only DRAFT and SCHEDULED exams can be deleted.
7. Question count 1-200 and maximum score above 0 up to 1000 are technical limits; the maximum score is rounded to two decimals like scores.
8. A DRAFT is the School Manager's working copy: examiners and Parents do not see it (examiners see SCHEDULED to COMPLETED; Parents see exams that have been scheduled). A cancelled exam that had been scheduled stays visible to Parents with status CANCELLED.
9. `GET /exams/students/{id}` lists only EXAMINED and ABSENT outcomes.
10. The result stores the recording examiner's ids internally; no reader (not even the School Manager) is shown who recorded it.
11. Immutability of results is enforced by the application (no code path, boundary test) and by uniqueness/RESTRICT keys; there is no database trigger, so a direct SQL session could still alter a row (a deliberate choice: it keeps cleanup of test data possible; a trigger can be added if you want it).

## Tests
- Unit: 15 domain rules/lifecycle, 40 service (every approved decision), 12 boundary, 6 Smart Guard entry point.
- API conformance over the real Authorization Engine, Smart Guard, groups, teachers and parents: all 19 operations exercised, including the exam-scoped examiner permission (denied for an unassigned Teacher, a removed examiner and after ENDED), Parent/Manager/other-school reads, and the lifecycle (`tests/api-docs/conformance/exams.test.ts`).
- Real database (`tests/db/exams.test.ts`, 21): schema constraints (including NULL-safe checks), repository, and the concurrency / recovery scenarios above. Mutation checks (removing the shared lock on submissions, and removing the exclusive lock on changes and transitions) make the deterministic race tests fail; the files were restored and the tests pass again.
- Full verification in the authoring environment (a real MariaDB 10.11): `npm run typecheck` and `npm run build` clean; `npm test` 1,846 passed / 8 skipped; `npm run api:verify` 96 passed; `npm run test:db` (all modules) passed, including the 21 exam tests. The database tests also caught and fixed a NULL-in-CHECK defect in `exam_examiners` (a release without a reason slipped past the constraint) before delivery.
