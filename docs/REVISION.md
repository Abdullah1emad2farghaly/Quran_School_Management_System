# Revision (Module 28)

**Status: IMPLEMENTED (0.36.0), NOT yet verified on the project owner's machine, not COMPLETED.** Master Specification §49 and §63 and the approved Module 28 business decisions of the project owner (2026-11-01): Revision follows the approved Module 27 rules, with the range-selection clarifications below.
**What I executed myself (sandbox without network, no `node_modules`):** the 35 service tests, 13 boundary tests and 20 range-resolver tests of this module (68/68 pass) with a minimal vitest-compatible runner and `tsx`, together with the 48 Module 27 unit tests and the Attendance unit tests (148/148 pass in total); a `tsc` run with the project's `tsconfig` plus `types: []` (no Module 28 type error beyond those caused by the missing `express` / `sequelize` / `vitest` / `@types/node` packages); a static check that the OpenAPI document and the router list the same 7 operations and that every documented error code is registered. **Not executed by me (needs your environment):** `npm run db:migrate`, the real `vitest`, `npm run typecheck`, `npm run build`, `npm run api:verify` (including the new conformance test `tests/api-docs/conformance/revision.test.ts`, which I could not run), `npm run test:db` (the written `tests/db/revision.test.ts`), `npm test`.

## What it does
The same as Module 27, for revision: the next-session **revision assignment** (defined by the session's Teacher during the session, final when it ends, history kept, carried forward), the students' **revision records** (assigned Teacher only, through Smart Guard, overlapping ranges valid, same-session correction with the original kept, never deleted), the owner-approved reads, and the public read `RevisionService.getScheduledRevision(sessionId)` for the future half-session reminder (Modules 31-34; nothing is notified here). Revision assignments and memorization assignments are independent (separate tables, permissions, events, endpoints); a session may have both, either or neither (§63). See `docs/MEMORIZATION.md` for the full list of rules; they apply unchanged.

## What is different: how a range is entered (approved decisions)
- **Form A, Start + Unit + Amount** `{ unit, start, amount, direction }` (+ `surah` for AYAHS). Units: AYAHS, PAGES, QUARTERS, SURAHS (**LINES is not offered for revision**: `REVISION_UNIT_NOT_SUPPORTED`). The meaning of `start`:
  - AYAHS: the ayah number inside `surah` (`surah` is required: `REVISION_SURAH_REQUIRED`).
  - PAGES: the Mushaf page number. QUARTERS: the quarter number (1-240). SURAHS: the surah number in Mushaf order. A separate `surah` is not allowed with these units (`REVISION_SURAH_NOT_ALLOWED`).
- **Form B, From Surah X to Surah Y** `{ fromSurah, toSurah }`: complete surahs, both ends included, forward when `fromSurah <= toSurah` and backward otherwise; translated to Module 22 as start = X, unit SURAHS, amount = |Y - X| + 1, direction. Exactly one form per request (`REVISION_RANGE_FORM_INVALID`).
- **Module 22 is not changed.** It anchors a range only at a surah/ayah, so `RevisionRangeResolver` (Module 28) turns a page or quarter number into the right anchor using the same read-only Module 21 lookup the engine itself reads (`getPage`, `listQuarters`, `getAyah`, ...), then asks Module 22 to calculate. Every record stores what was entered (`input`), the Module 22 request it became and the result.
- Evaluation compares the ayahs covered, so a range entered in one form fulfils an assignment entered in another when they cover exactly the same ayahs.

## Technical interpretations (NOT business rules; please confirm or change)
1. **Page anchor.** FORWARD from page P starts at the first ayah that BEGINS on P; BACKWARD from page P ends at the last ayah that ENDS on P. Module 22 counts "the page that contains the anchor" as the first one, so anchoring at an ayah that began on the previous page would count the wrong pages. In the official 604-page edition an ayah never crosses a page, so this only matters for data where it does (the test fixture has one such ayah, and the tests pin the behaviour).
2. **Quarter anchor.** FORWARD from quarter Q starts at the first ayah of Q; BACKWARD ends at its last ayah (the ayah before quarter Q+1 starts, or the last ayah of the Quran for quarter 240).
3. **Form B direction** is derived from the order of the two surahs (no separate direction field); X = Y is one surah.
4. **Assignment, evaluation and repeat rules** are exactly Module 27's, including its documented interpretations 1-7 (see `docs/MEMORIZATION.md`).
5. **Module 27 was reviewed against the approved rules before being reused:** no deviation from the approved decisions was found in its code (assignment window, finalization, history, group types, carry-forward, repeat, Smart Guard, correction window, reads, never-delete were all checked by its tests); the interpretations listed in its document are the only open points and were carried over unchanged rather than silently re-decided.
6. Module 28 does **not** import Module 27 (no coupling between the two modules); the shared shape was copied, not shared.

## API (7 endpoints, `/api/v1/revision`, documented in Swagger)
| Method | Path | Permission | Who |
|---|---|---|---|
| GET | `/students/{id}/records` | `revision.student.read` | SCHOOL_MANAGER (school), PARENT (own children) |
| GET | `/sessions/{id}` | `revision.session.read` | SCHOOL_MANAGER (school), the session's TEACHER |
| POST | `/sessions/{id}/assignments` | `revision.assignment.manage` | the session's TEACHER, session IN_PROGRESS |
| PUT | `/assignments/{id}` | `revision.assignment.manage` | the session's TEACHER, defining session IN_PROGRESS |
| POST | `/assignments/{id}/cancel` | `revision.assignment.manage` | the session's TEACHER, defining session IN_PROGRESS |
| POST | `/sessions/{id}/records` | `revision.record.record` | the session's TEACHER + Smart Guard |
| PUT | `/records/{id}` | `revision.record.correct` | the session's TEACHER + Smart Guard, same session only |

## Database (migration `20261102100000-create-revision`, additive, no foreign keys to other modules)
`revision_assignments` (unique `(defined_in_session_id, subject_key, active_slot)`; the NULL-safe CHECK from the start, see Module 27 migration `20261101110000`), `revision_assignment_history` (append-only), `revision_records` (no uniqueness), `revision_correction_history` (append-only). Ranges are stored as JSON text (input + Module 22 request and result).

## Events (outbox)
`RevisionAssignmentDefined`, `RevisionAssignmentModified`, `RevisionAssignmentCancelled`, `RevisionRecorded`, `RevisionRecordCorrected` (identifiers only).

## Dependencies (public contracts only)
Modules 00, 02, 03, 04, 06, 12, 16, 18, 19, 20, 22 (range calculation and the `QuranRangeSource` type), 24, 25; the same set as Module 27. The Module 21 lookup is injected at composition (`src/config/revision.ts`), so Module 28's code imports no Module 21 file.

## Verify on your machine (in this order)
`npm run db:migrate` · `npm run typecheck` · `npm run test:unit` · `npm run test:integration` · `npm run api:verify` · `npm run test:db` · `npm test` · `npm run build`. Please send me any failing output.

## Remaining
- The conformance and DB tests are written but never executed by me.
- Page and quarter translation is tested against the hand-built mini Quran only; the real KFGQPC data (`tests/db/quran-range-engine.test.ts` style) has no Module 28 test yet. A quick manual check with the real data is worth doing (for example page 1 and 604, quarter 1 and 240, backward from page 2).
- Concurrency and the reminder itself: as in Module 27.
