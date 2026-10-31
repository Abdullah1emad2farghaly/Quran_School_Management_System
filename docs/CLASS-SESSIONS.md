# Class Sessions (Module 24)

Master Specification §45 and the approved Module 24 decisions of the project owner. (`docs/SESSIONS.md` is Module 10, login sessions and JWT: a different thing. This module is called "class sessions" in code: `ClassSession`, table `class_sessions`, error codes `CLASS_SESSION_*`.)

## What a session is
One **occurrence** of a group's schedule slot (Module 23): it belongs to a School, a Group, a Teacher and a slot, and its time is derived from the slot. **No group schedule = no session.** There is no way to create a session by hand: no endpoint, no service method.

## Approved decisions (project owner) and how they are implemented
1. **Generation.** A background job (polls the database every 15 seconds; no Redis) creates each session automatically when its threshold (scheduled start − 15 minutes) is reached. Every active occurrence has its own session (not only the next one per group); nothing is created days or weeks ahead. The session is created already `OPEN`. A unique index on `(slot_id, occurrence_date)` makes generation idempotent. A session can therefore appear up to one polling interval (15 s) after its threshold.
2. **Lifecycle.** The system moves `OPEN → IN_PROGRESS` at the scheduled start and `IN_PROGRESS → COMPLETED` at the scheduled end (same job). Nobody triggers this by hand. If the system was down and both moments passed, the session still goes through `IN_PROGRESS` (two events).
3. **Cancellation by the Teacher.** The assigned Teacher (the session's Teacher, from the verified token) cancels an `OPEN` or `IN_PROGRESS` session with a mandatory non-empty reason (at most 500 characters). Recorded: who (`cancelled_by` = user id), when (`cancelled_at`), why (`cancel_reason`), `cancel_source = TEACHER`. A `COMPLETED` session cannot be cancelled (a session whose end has passed counts as completed even if the job has not run yet). An already `CANCELLED` session cannot be cancelled again and keeps its original cancellation. Sessions are never deleted (no endpoint, no `DELETE` anywhere in the module, no foreign-key cascade; a boundary test checks it).
4. **Retired or cancelled schedule slot** (Module 23 retires a slot when it is removed, replaced by a change, or its group is archived):
   - the session does not exist yet → it is never created (generation reads only ACTIVE slots);
   - it exists, is `OPEN` and the slot was retired **before its scheduled start** → the system cancels it: `cancel_source = SCHEDULE_SLOT_RETIRED`, `slot_retire_reason` = `REMOVED` / `REPLACED` / `GROUP_ARCHIVED`, no actor, no free-text reason;
   - it has started → untouched; it is completed → untouched;
   - already cancelled by the Teacher → the original reason, actor and source are preserved.
   Done by an event handler on `GroupScheduleSlotRetired` (idempotent) and, as a safety net for a missed or late event, by a reconciliation step of the same job. The retirement time against the start decides (retired at 17:59:50, processed at 18:00:10 → still cancelled).
5. **Module 22 dependency.** §81 lists Module 22 (Quran Position & Range Engine) as a dependency of Sessions. The range engine computes where a recitation ends from a start position, a unit and an amount; the specification uses it for memorization and revision (§48, §49; Modules 27 and 28). No approved Module 24 behaviour computes a Quran range, so **no code depends on Module 22 and none was added**. The dependency is **kept** in the specification (not edited) for when a session needs it; a boundary test states that Module 24 does not import Module 22. Please confirm (open question 3).
6. **Completion without teaching records: DECIDED (project owner), nothing to implement here.** A session may contain memorization, revision, both, or neither. Missing teaching records are NOT an error by themselves; completion creates, checks and changes no educational record and NEVER fabricates one. If memorization and/or revision were scheduled and the assigned Teacher has not recorded the corresponding data after half of the session duration, a reminder goes to the assigned Teacher; that requirement is in the Master Specification (§63, approved amendment) and its delivery belongs to Modules 31-34 (contract in `docs/ATTENDANCE.md`). `ClassSessionCompleted` is published for later modules.

## Technical defaults I had to choose (not business rules; please confirm or change)
- A session is created only if the occurrence **has not ended**, and **the slot already existed at the occurrence's threshold** (a slot added at 18:10 for today 18:00 does not create today's session). After downtime an occurrence that is still running is created and then advanced; one that ended is never back-filled.
- A group **without a Teacher** gets no session (a session belongs to a Teacher). The session keeps the Teacher the group had at creation.
- Cairo daylight-saving edges: a wall time that happens twice is its first occurrence; one that does not exist is read with the offset before the change.
- The status `SCHEDULED` is in the specification's list and in the database CHECK, but under decision 1 no code path produces it (open question 1).

## API (`/api/v1/sessions`)
| Method and path | Permission | Who |
|---|---|---|
| `GET /mine` | `sessions.session.list-own` (PROVISIONAL) | TEACHER |
| `GET /groups/:id` | `sessions.session.read` (PROVISIONAL) | SCHOOL_MANAGER of the group's school; TEACHER of the ACTIVE group |
| `GET /:id` | `sessions.session.read` (PROVISIONAL) | same, through the session's group |
| `POST /:id/cancel` body `{ "reason": "…" }` | `sessions.session.cancel` (APPROVED) | the assigned TEACHER |

Lists are paginated, `filter[status]`, `sort=scheduledStart` (default newest first). Dates are UTC ISO-8601; `occurrenceDate` is the Cairo business date. Documented in the OpenAPI document with the other modules. Authorization through the Authorization Engine (Module 12) with Module 20's MANAGEMENT/GROUP scope resolver; no resolver was added. PARENT, ORGANIZATION_MANAGER and MAIN_ADMIN have no session permission (deny by default).

## Database
Migration `20261029100000-create-class-sessions`: table `class_sessions` (no foreign keys to other modules). Unique `(slot_id, occurrence_date)`; indexes for the job (`status, scheduled_start`, `status, scheduled_end`) and for reads (`group_id`, `teacher_id`). A second migration, `20261029110000-class-sessions-cancellation-check-not-null`, closed a NULL hole found by the MariaDB test (a CHECK passes on NULL): a system cancellation without a retirement reason, or a CANCELLED row without a source, was accepted. CHECK constraints: status values; start before end; transition times consistent with the status; a `CANCELLED` row always records who or what cancelled it (a Teacher cancellation always has a non-empty reason).

## Events (outbox, same transaction)
`ClassSessionCreated`, `ClassSessionStarted`, `ClassSessionCompleted`, `ClassSessionCancelled` (with `cancelSource`, `actorId`, `reason`, `slotRetireReason`).

## Module 23 (additive, read-only)
`GroupScheduleService.listActiveSlotsForSessions()` and `findSlotsByIds()` (and the matching repository methods and `ActiveSlotDto`). No Module 23 rule, table or endpoint changed.

## Tests
- `tests/unit/class-sessions/`: time-zone conversion (5), service behaviour with in-memory fakes (27: generation, idempotency, lifecycle, Teacher cancellation, retired slots in every state, reads), boundaries and error messages, integration over the real Modules 20 and 23.
- `tests/api-docs/conformance/class-sessions.test.ts`: every documented operation against real responses.
- `tests/db/class-sessions.test.ts`: schema, CHECKs, repository, concurrency (needs MariaDB).

**Status: COMPLETED (approved by the project owner).** **Verification (USER-REPORTED local test results, not executed by me):** the project owner reports that all Module 24 checks pass on their machine (migrations including the follow-up CHECK fix, unit, integration, api:verify, test:db, the full run). This is the owner's report. **What I executed myself earlier:** only the 5 time-zone and 27 service unit tests, in a restricted sandbox using a minimal vitest-compatible runner (not the real vitest) and stubbed libraries (no `node_modules`, no database, no network): 32 passed, 0 failed. A partial `tsc` run over Module 24 and its tests showed no error other than ones caused by the libraries that are not installed there. Everything else (real vitest, `typecheck`, `build`, the integration, conformance and MariaDB tests, the migration) has **not** been run.

## Verify on your machine (XAMPP / MariaDB; PowerShell, from the project folder)
1. Start MySQL (MariaDB) in the XAMPP control panel.
2. `npm run typecheck`
3. `npm run db:migrate` (creates `class_sessions`)
4. `npm run test:unit`, then `npm run test:integration`, then `npm run api:verify`
5. `npm test`
6. `npm run test:db` (needs the migration; the Module 24 concurrency test commits and removes its own random-id rows)
7. `npm run build`
8. Try it: `npm run dev`; a session appears 15 minutes before a slot's start. To see it quickly, give a group a Teacher and a slot starting a few minutes from now (Cairo time) and watch `class_sessions`.

## Open questions (waiting for your decision)
1. `SCHEDULED` is in the specification's lifecycle, but sessions are created directly `OPEN`: keep the value unused, or drop it?
2. ~~What happens when a session reaches its end with teaching records missing?~~ **Resolved by the project owner** (see decision 6 above and the Master Specification §63).
3. Confirm that no code depends on Module 22 for Module 24 (decision 5).
4. ~~Is cancelling a session a Smart Guard protected action?~~ **Decided by the project owner (Module 25): NO.** Cancelling needs no GPS and never goes through Smart Guard; Module 24 keeps its own authorization and rules.
5. Confirm or change the PROVISIONAL read permissions (`sessions.session.read`, `sessions.session.list-own`); may Parents see sessions?
6. If the group's Teacher is replaced after a session was created: today the session keeps its original Teacher, only that Teacher may cancel it, and the authorization scope (the Teacher of the ACTIVE group) then refuses the former Teacher. Should the new Teacher be able to cancel?
7. A group archived while a session is `IN_PROGRESS`: the session keeps running to `COMPLETED` and the Teacher can no longer cancel it (the group is not ACTIVE). Acceptable?
8. §44 says "multiple recurring schedule slots are allowed"; Module 23 (approved 2026-10-28) allows one active slot per weekday, so a group has at most one session per day. Please confirm.
