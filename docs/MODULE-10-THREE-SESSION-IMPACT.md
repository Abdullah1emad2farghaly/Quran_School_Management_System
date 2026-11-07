# Three-Session Model: Impact Analysis for Module 10 and the Master Specification

## Revision history (no silent changes)
| Version | Change |
|---|---|
| v1 | Impact analysis and proposal (before implementation). |
| v2 (2026-11-05) | Owner approvals recorded and the change IMPLEMENTED in the project copy: Q7 = option A (change-password revokes the other sessions), Q8 = My devices in scope (list + revoke one session), 3-session limit, expiry cleanup at login AND by a periodic job (`SESSION_EXPIRED`), slot design approved. Proposed design in sections 5-6 was implemented as written, with the additions listed in section 11. |

Status: **IMPLEMENTED in the project (see `docs/SESSIONS.md`, changelog 0.39.0). NOT verified on the owner's machine; Module 10 is NOT re-marked COMPLETED.** Sections 1-10 below are the original analysis and are kept as the historical record.
Sources inspected: Master Specification §§22, 25, 26; `docs/SESSIONS.md`, `ARCHITECTURE.md`, `PASSWORD-RECOVERY.md`, `PROJECT-CHANGELOG.md`; the whole of `src/modules/10-sessions-jwt`; migration `20261009100000-create-auth-sessions.js`; Module 11's use of sessions; tests under `tests/unit/sessions`, `tests/integration/auth.test.ts`, `tests/db/auth-sessions.test.ts`.

## 1. Approved rule (owner, supersedes the earlier one-session rule)
Up to **3 concurrent active sessions per account, every role**. Independent session and refresh-token lifecycle per session. A new login never revokes another session. A 4th login is rejected with a clear message (the user must log out of a device first); nothing is auto-terminated. Logout revokes only its own session. Security/administrative revocation affects only the targeted session unless an existing approved rule says otherwise. Refresh or revocation of one session never affects another. The limit must hold under concurrent logins.

## 2. Where the one-session rule lives today
| Area | Location | Effect today |
|---|---|---|
| Spec | §25: "Only one active session/device per User", then "Revoke old active session / Create new active session" | Must be amended |
| Database | `auth_sessions` unique index `uq_auth_sessions_user_active (user_id, active)`; CHECK `ck_auth_sessions_reason` lists `LOGIN_REPLACED`; CHECK `ck_auth_sessions_state` ties `active` to revocation | The index forbids a second active row |
| Service | `SessionService.startSession` locks the user's one active session and revokes it with `LOGIN_REPLACED`; retries up to 3 times on `SESSION_CONCURRENT_MODIFICATION` | Replaces instead of adding |
| Service | `revokeAllForUser` (used by logout-all, deactivation, password reset) locks and revokes **one** session | Would leave 2 of 3 sessions alive |
| Port/repo | `lockActiveSessionByUser` (single result) in the port, the Sequelize repository and the in-memory repository; `insertSession` maps the unique violation to `SESSION_CONCURRENT_MODIFICATION` | Must change shape |
| Domain | `AuthSession` doc comment; `SESSION_REVOKE_REASONS` comment on `LOGIN_REPLACED` | Comments become wrong |
| Docs | `SESSIONS.md` (summary table, login paragraph, `auth_sessions` paragraph), `ARCHITECTURE.md` line 49, `PROJECT-CHANGELOG.md` (0.x Module 10 entry), `IMPLEMENTATION-STATUS.md`, comment in `SessionService.changePassword` | Outdated |
| OpenAPI | `auth.openapi.ts` login responses (no limit error) | Needs the new response |
| Tests | `session-service.test.ts` "only one active session per user"; `auth.test.ts` "a second login on another device ends the first one"; `auth-sessions.test.ts` three tests (replace, unique-index guard, two simultaneous logins); `session-repository-deadlock.test.ts` | Assert the old rule; must be rewritten |

## 3. Already compatible (verified in code)
- Access tokens carry `sid`; every request checks that session, so revoking one session cuts only its tokens.
- Refresh tokens belong to one session; unique `(session_id, active)` keeps one current token per session; rotation and reuse detection act on that session only (reuse revokes only that session). Rules 2 and 9 need no change.
- `logout(sessionId)` revokes only the caller's session. Rule 7 needs no change.
- Existing account-wide revocations are approved elsewhere and stay: logout-all (§25), deactivation (§22 "invalidates active sessions"), password reset (§26 "revokes existing sessions"). I read rule 8's exception as covering exactly these.

## 4. Risks and conflicts
- **R1 (critical): sessions never expire on the server.** No code revokes a session whose refresh token (30 days) expired; such a session stays `active = 1` forever. Under one session this was harmless; under a cap, three abandoned sessions would permanently block login (the user cannot even log out, having no valid token).
- **R2 (critical): dropping the unique index removes the only concurrency guard.** A plain count-then-insert lets two simultaneous logins create a 4th session.
- **R3: `revokeAllForUser` and `logoutAll` revoke one session.** They must revoke all.
- **R4: error ordering.** The limit error must appear only after the password is verified and the account is active, so it reveals nothing to someone who does not know the password.
- **R5: database safety.** The change drops an existing unique index and replaces a CHECK. Your database rules require explicit approval for removing constraints. Rollback (`down`) cannot restore the old index if any user then has more than one active session.
- **R6: freeing a slot.** Today the ways are: logout on a device the user holds, logout-all from one, or password recovery (revokes all). There is no list-my-sessions or revoke-one-other-session endpoint. A lost device is covered only by logout-all or recovery.
- **R7: password change leaves other sessions alive.** The authenticated `change-password` revokes nothing. That was harmless with one session; with three, other devices stay signed in after a password change.
- **R8: Module 31 coupling.** Push cleanup relies on `AuthSessionRevoked` (at-least-once, seconds of delay, dead after about 8 minutes of outbox failures). Expired sessions emit no event today, so their push subscriptions would never be cleaned. Module 31 may not read `auth_sessions` directly (private table).
- **R9: existing data.** Every user has at most one active session now, so migrating is safe.
- **R10: limit change cost.** A fixed constant plus a CHECK means changing 3 later needs a migration.

## 5. Proposed design (for review)
**Schema (new migration, additive plus two constraint changes needing approval):**
- Add `auth_sessions.slot TINYINT UNSIGNED NULL`; backfill `slot = 1` for current active rows.
- Unique index `(user_id, slot)`; CHECK `slot IS NULL OR slot BETWEEN 1 AND 3`; extend `ck_auth_sessions_state` so `slot IS NOT NULL` exactly while `active = 1`. Revocation sets `slot = NULL` (NULLs are distinct, so history is unlimited).
- Drop `uq_auth_sessions_user_active`; keep `active` with a plain index `(user_id, active)`.
- Add revoke reason `SESSION_EXPIRED` to `ck_auth_sessions_reason`. `LOGIN_REPLACED` stays valid for historical rows and is never produced again.
- Why slots: the database itself guarantees at most 3 active sessions per user and that two racing logins cannot take the same slot; the loser retries (already implemented pattern) and then either takes another free slot or is rejected.

**Login algorithm (one transaction):** verify credentials and account state first; lock the user's active sessions with their current refresh token; revoke those whose refresh token has expired (`SESSION_EXPIRED`, event published); pick the lowest free slot in 1..3; if none, throw `SESSION_LIMIT_REACHED` (kind BUSINESS_RULE, HTTP 422, details `{ maxActiveSessions: 3 }`); otherwise insert the session in that slot with its first refresh token. No existing session is touched.
**Error text (proposed, for your review):** Arabic and English, in substance: "You are already signed in on 3 devices. Sign out from one of them, then try again."
**Revocation:** `revokeAllForUser` and `logoutAll` loop over all active sessions; each revocation publishes its own `AuthSessionRevoked`.
**Expiry:** lazy at login (above) plus a small polling job in Module 10 (same pattern as the existing schedulers, no Redis) that revokes sessions with expired refresh tokens, so push subscriptions and slots are released without waiting for a login.
**Events:** payload unchanged `{ sessionId, userId, reason }`; new reason value only.
**API:** no new endpoint. `POST /auth/login` gains the 422 response; logout and logout-all descriptions updated; verified by `api:verify`.
**Module 31:** subscription stores the creating `sessionId`; on every `AuthSessionRevoked` (any reason) Module 31 deletes that session's subscriptions; push targets the account's subscriptions (those of sessions that were not revoked). No Module 31 access to `auth_sessions`.

## 6. Proposed Master Specification amendment (§25)
Keep the original text as the historical record and add, in the project's amendment style: "Approved amendment (Module 10, owner decision, 2026-11-04): an account may have up to THREE concurrent active sessions (every role); each session has its own refresh-token lifecycle; a login never revokes another session; a fourth login is rejected (`SESSION_LIMIT_REACHED`) and nothing is terminated automatically; logout revokes only the current session; logout-all, deactivation and password reset keep revoking all of the account's sessions; a session ends when logged out, revoked, or when its refresh token expires. This supersedes 'Only one active session/device per User' and the replace-on-login flow." §§22 and 26 are unchanged.

## 7. Documentation and test changes to make (after approval)
- Docs: `MASTER-SPECIFICATION.md` §25 amendment; `SESSIONS.md` (rules table, login, schema, errors, events); `ARCHITECTURE.md` line 49; `API-DOCUMENTATION.md` if it lists login errors; `PROJECT-CHANGELOG.md` new entry; `IMPLEMENTATION-STATUS.md` (Module 10 shown as amended and awaiting your re-verification, not COMPLETED by documentation alone).
- Tests to rewrite: the replace-on-login tests in unit, integration and DB suites. Tests to add: three sessions coexist; 4th login rejected with `SESSION_LIMIT_REACHED` and nothing revoked; wrong password on a full account still `INVALID_CREDENTIALS`; logout frees exactly one slot; logout-all, deactivation and password reset revoke all three; refresh and reuse affect only their session; expired session stops counting and is revoked with the event; two and five simultaneous logins never exceed three (DB suite); migration backfill; in-memory repository parity; OpenAPI conformance.
- Verification: `typecheck`, `test:unit`, `test:integration`, `test:db`, `api:verify`, `build` (there is no lint script). I could not run any of them in this environment, so the results would come from your machine.

## 8. Order of work (proposed)
1. Module 10 change as its own approved task (spec amendment, migration, service, tests, docs).
2. Your re-verification of Module 10.
3. Then Module 31 implementation.

## 9. Technical approvals needed
Drop `uq_auth_sessions_user_active`; replace `ck_auth_sessions_reason` and `ck_auth_sessions_state`; add `slot`; new reason `SESSION_EXPIRED`; new error code `SESSION_LIMIT_REACHED`; Module 10 expiry job; Module 31 dependency on Module 10 public events; `web-push` dependency; VAPID environment variables.

## 10. Open business questions (one at a time)
- **Q7 (asked now):** should the authenticated password change revoke the account's other sessions? (R7)
- **Q8 (queued):** whether a self-service "my devices" list with revoking a specific other session is in scope now or deferred. Not proposed here; the approved text only requires the clear error. (R6)

## 11. Implementation record (v2)
- **Slot design:** implemented as proposed (`slot` 1..3, unique `(user_id, slot)`, CHECK range and state, plain `(user_id, active)` index; old unique index dropped last). The schema inspection found no conflict with MariaDB.
- **Additions to the proposal:** reasons `DEVICE_REVOKED` (My devices) and `PASSWORD_CHANGED` (in addition to `SESSION_EXPIRED`); `device_label` column; login retries raised from 3 to 5 attempts because up to three racers can contend for slots; a session with no visible refresh token is NOT released at login (the periodic job cleans such leftovers) so a concurrent login whose token is not committed yet is never revoked by mistake.
- **Verification actually performed (assistant environment, no MariaDB, no npm registry):** a temporary mini test runner with stand-ins for `vitest`, `jsonwebtoken`, `bcryptjs` and stubs for `express`/`sequelize`/`express-validator` executed the unit tests: 30/30 new tests and the rewritten `session-service.test.ts` pass; the 561 other unit tests that load in that setup give identical results before and after (differences caused only by the stand-ins). The real OpenAPI document was built: 7 Module 10 operations, `SESSION_LIMIT_REACHED` documented on login, every Module 10 error code has Arabic and English text. A `tsc` comparison against the original zip shows no new error other than those caused by the missing packages.
- **NOT executed:** `npm run typecheck`/`build` with real dependencies, the HTTP integration and OpenAPI conformance suites (need `supertest`, `express`), the real-database suite (`npm run test:db`, needs MariaDB), the migration itself. They must be run by the owner.
- **Open points for the owner:** none new. `lastActiveAt` means "tokens last issued" (no per-request tracking).
