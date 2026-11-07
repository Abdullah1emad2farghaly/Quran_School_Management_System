# Module 31 — Notifications Core: Requirements Reconciliation and Design (v5, IMPLEMENTED, awaiting owner verification)

Status: **IMPLEMENTED in the project (changelog 0.40.0; see `docs/NOTIFICATIONS.md`). NOT verified by the owner; NOT marked COMPLETED.** Sections below are the design record; where the implementation differs it is listed in the v5 revision row.
This file is a standalone draft and is NOT part of the project tree. Nothing in the project was modified. After approval it would become `docs/NOTIFICATIONS.md` (implementation docs describe what was actually built).

## 0. Revision history (no silent changes)
| Version | Change |
|---|---|
| v1 | Reconciliation report in chat: §§62–63, Outbox review, architecture, API, open questions. |
| v2 | Records the owner's approvals Q1–Q3 as requirements. Adds finding F-1 (single active session) and open items Q4–Q6. No earlier approved decision was changed. |
| v3 | Q4 REVISED by the owner: up to 3 concurrent sessions (supersedes the earlier Option A). Q5 resolved (delete subscriptions on ANY actual session revocation). Q6 resolved (no account-language setting in Module 31). F-1 and F-3 closed. Module 31 now depends on the Module 10 change described in `MODULE-10-THREE-SESSION-IMPACT.md`. |
| v4 (2026-11-05) | Owner approvals: the technical approvals of Section 11 are GRANTED (`web-push` + types, `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT` with push disabled gracefully when absent in development, Module 31 depending on Module 10's public contract). Q7 = A and Q8 = in scope were applied to Module 10, which is now IMPLEMENTED (changelog 0.39.0) but NOT yet verified by the owner. Module 31 implementation has NOT started: Phase 3 starts only after Module 10 is verified. Decisions Q1-Q6 are unchanged. |
| v5 (2026-11-05) | Module 31 IMPLEMENTED after the owner's go-ahead (Module 10 three-session change implemented first, also awaiting verification). Differences from the draft: unsubscribe is `POST /notifications/push-subscriptions/unsubscribe` (body) instead of `DELETE /push-subscriptions`; push delivery rows carry `recipient_user_id` and `claim_id`; the dependency list is 00, 01, 02, 03, 04, 06, 10; a technical SSRF guard for endpoints and a cap of 10 subscriptions per account were added; the `locale` column was NOT added (the rendered text is stored). Nothing approved earlier was changed. |

## 1. Approved decisions (authoritative)
**A. Channels (approved earlier).** Only In-App and Web Push (Web Push API, Service Workers, VAPID, Node `web-push`, MariaDB storage). No SMS, no Email. Push depends on browser/OS support and user permission.
**B. Account-based notifications (approved earlier).** One notification record per recipient account; shared by all devices; `Notification` belongs to an account, `PushSubscription` belongs to a browser/device endpoint and is linked to an account; one account may have several subscriptions; invalid/expired subscriptions are cleaned up without touching the account's other subscriptions; logout never deletes notifications.
**C. Operations (approved earlier).** Mark as read, mark all as read, delete, clear all; all account-level; ownership enforced.
**D. Hard delete (approved earlier).** No `deleted_at`, no archive. Deleting never touches domain events, audit records or other modules' data.

**Q1 — Deduplication (APPROVED, Option A).**
- Table `notification_dedup_keys` with ONLY `recipient_user_id`, `dedup_key`, `created_at`.
- No notification content; never exposed through the API.
- Hard-deleting a notification does NOT delete its dedup key.
- Reprocessing the same event or reminder must not recreate a notification that was already generated and later deleted.

**Q2 — Language (APPROVED, Option 1).**
- Arabic and English throughout; every template has an Arabic and an English version.
- Use the account's configured language when available; default Arabic when none is configured.
- Title and body are rendered and persisted in the selected language at creation time.
- Existing notifications keep their original language and content if the account language changes later.

**Q4 — Concurrent sessions (APPROVED, REVISED; supersedes the earlier Option A).** Up to 3 active sessions per account for every role, each with its own refresh-token lifecycle; a new login never replaces a session; a 4th login is rejected; logout revokes only its own session. Full impact on Module 10 and the Master Specification: `MODULE-10-THREE-SESSION-IMPACT.md`. Module 31 implementation starts only after that change is approved, implemented and verified.

**Q5 — Subscription lifecycle on revocation (APPROVED).** On logout or ANY actual session revocation delete only the push subscription(s) bound to that revoked session, using Module 10's `AuthSessionRevoked` event as the server-side safety mechanism. The client also unsubscribes its own endpoint before logout where possible. Never delete subscriptions of other active sessions. Never delete account notifications.

**Q6 — Language setting (APPROVED).** Module 31 does NOT add an account-language setting unless separately approved. Language resolution goes through a port; while no account language exists anywhere, every notification is rendered in Arabic (the approved default). English templates exist and are used as soon as an account language is configured.

**Q3 — Push subscription on logout (APPROVED).**
- On logout delete ONLY the Web Push subscription associated with the device/browser session being logged out.
- Preserve all other active subscriptions of the same account.
- Do not delete or modify the account's stored notifications.

## 2. Findings that affect the design
**F-1 (RESOLVED by revised Q4).** Master Specification §25 and Module 10 enforce one active session per user (`LOGIN_REPLACED`, unique index `(user_id, active)`). The owner replaced this with a 3-session model. The required change is analysed in `MODULE-10-THREE-SESSION-IMPACT.md` and is a prerequisite of Module 31.
**F-2 (technical).** Module 10 already publishes `AuthSessionRevoked { sessionId, userId, reason }` through the outbox. Reasons: `LOGIN_REPLACED, LOGOUT, LOGOUT_ALL, USER_DEACTIVATED, PASSWORD_RESET, REFRESH_TOKEN_REUSE`. The access token carries `sid`, and `req.auth` exposes `userId` and `sessionId`.
**F-3 (RESOLVED by Q6).** No account language setting exists anywhere. Module 31 adds none; the resolver returns "not configured" and the default Arabic applies.
**F-4 (technical).** The Outbox runs handlers with a fixed `ar` locale, retries the whole message (all handlers) on any handler failure, marks a message dead after 5 attempts (about 8 minutes of retries) and has no replay tool.
**F-6 (technical, new).** Module 10 never expires sessions server-side, and expired sessions publish no `AuthSessionRevoked`. Their push subscriptions would never be cleaned up. The proposed Module 10 expiry job (impact document, section 5) closes this; Module 31 relies on it and must not read `auth_sessions` itself.
**F-5 (technical).** Events carry ids only (profile ids for teachers/students). Recipient resolution (student → parent → user, teacher → user) needs public lookups of Modules 17–19.

## 3. Responsibilities
| Module | Responsibility |
|---|---|
| 31 Notifications Core | Storage; template registry (ar/en); `NotificationService.notify`; dedup ledger; in-app API; push subscriptions; push delivery, retry and cleanup. Consumes no business domain events. |
| 32 Notification Rules | Event consumers and time-driven reminders; recipient resolution; dedup keys per rule; V1 template content. Needs a §81 amendment (public lookups of 16–20, 24, 27–30). |
| 33 / 34 | §63 defines no V1 notifications for them. Nothing required now. |

## 4. Data model (no foreign keys to other modules; UUID and DATE(3) conventions)
- `notifications`: `id`, `recipient_user_id`, `type`, `title`, `body`, `data` (JSON, language-neutral ids/params), `read_at`, `created_at` (the §62 fields). Optional: a `locale` column recording the language used. Indexes: (recipient, created_at), (recipient, read_at). Hard-deleted.
- `notification_dedup_keys` (Q1): PK/unique `(recipient_user_id, dedup_key)`, `created_at`. Nothing else.
- `push_subscriptions`: `id`, `user_id`, `auth_session_id` (Q3), `endpoint`, `endpoint_hash` (unique), `p256dh`, `auth`, `created_at`, `last_success_at`. The same endpoint subscribing again is reassigned to the new account/session (shared-device safety).
- `push_deliveries`: `notification_id`, `subscription_id`, `status` (pending/sent/failed), `attempts`, `next_attempt_at`, lock fields, `last_error`. Rows are deleted with their notification or subscription.

## 5. Creation flow (Q1, Q2)
`notify({ recipientUserIds, type, templateKey, params, data, dedupKey })` runs in one transaction per recipient:
1. Insert `(recipient_user_id, dedup_key)` into the ledger. On a duplicate-key result: stop, create nothing.
2. Resolve the language: account language (through a port) else `ar`.
3. Render title and body from the template in that language and persist them.
4. Insert the notification and one `push_deliveries` row per current subscription of the account.
The ledger row is never removed. A retry of the same event, or a reminder poll after the user deleted the notification, finds the key and creates nothing. Dedup keys are built by Module 32 (event id based, or type + aggregate + variant for reminders, so a rescheduled exam can use a new variant).

## 6. Push delivery and cleanup
A Module 31 polling scheduler (same pattern as `OutboxScheduler`/`ExamScheduler`, no Redis) claims pending deliveries and sends with `web-push`.
- 404/410: delete that subscription only. Other permanent 4xx: treat as invalid, delete that subscription.
- 429/5xx/network: retry with the outbox backoff shape, then mark failed. A push failure never changes the notification.
- Repeated consecutive failures of one subscription: delete it.

## 7. Logout and session revocation (Q3, Q5)
- A subscription is created by an authenticated request and stores that request's `sessionId`.
- Primary path: the client calls `DELETE /notifications/push-subscriptions` for its own endpoint before logging out.
- Safety net: a Module 31 handler for `AuthSessionRevoked` deletes the subscriptions whose `auth_session_id` equals the revoked session, for EVERY revocation reason (logout, logout-all, deactivation, password reset, refresh-token reuse, and the proposed `SESSION_EXPIRED`). It is idempotent and tolerant of events for sessions without subscriptions.
- Revoking one session never touches the subscriptions of the account's other sessions, and never touches `notifications`.
- Push delivery targets the subscriptions of the account's sessions that have not been revoked. A subscription whose session ended is removed by the handler; between the revocation and the handler run (seconds) the delivery step re-checks nothing in Module 10, so that window is accepted and documented.
- The handler never touches `notifications` and never touches subscriptions of other sessions.
- Module 31 would import `SessionEventTypes` from Module 10's `public/` (this adds Module 10 to the §81 dependencies of Module 31).

## 8. API (authentication only; account taken from the token; no scope resolver)
`GET /notifications`, `GET /notifications/unread-count`, `POST /notifications/:id/read`, `POST /notifications/read-all`, `DELETE /notifications/:id`, `DELETE /notifications`, `GET /notifications/push/public-key`, `POST|DELETE|GET /notifications/push-subscriptions`.
- A foreign id and a missing id behave identically (no enumeration). Delete is idempotent (204). Marking an already-read notification keeps its original `read_at`.
- Every endpoint is documented in OpenAPI and registered for `api:verify`.

## 9. Multi-device behavior
All operations act on the account's rows, so a change made on one device is visible after the next refetch (focus, interval, or the service worker telling open tabs to refetch on push). Closing an already-displayed OS notification on another device cannot be controlled from the server. Up to three devices can be signed in at once (revised Q4), so a change made on one is visible on the others after their next refetch.

## 10. V1 event inventory (owned by Module 32; recipients to be confirmed there)
| §63 item | Source | Recipient |
|---|---|---|
| School approval/rejection | `SchoolApproved`, `SchoolRejected` (ids only; "sub-school" no longer exists) | not defined in spec |
| Exam examiner assignment | `ExamExaminerAssigned/Removed` | the examiner Teacher |
| Exam created/assigned | `ExamScheduled`, `ExamStudentTargeted/Untargeted` | parents of target students |
| Exam result | `ExamResultRecorded` | the student's parent |
| Group / student assignment change | `GroupTeacherChanged`, `GroupStudentAssigned/Unassigned` | not defined in spec |
| Exam 24 h reminder | `ExamService.getExamReminderStatus` (due `startAt − 24 h`, SCHEDULED) | not defined in spec |
| Evaluation recorded/updated | `EvaluationRecorded`, `EvaluationScoresUpdated` | the student's parent |
| Evaluation 15-minute warning | `EvaluationService.getSessionEvaluationStatus` | the session Teacher |
| Session half-time reminder | session times (24) + scheduled/recorded reads (27, 28) | the assigned Teacher only |

## 11. Technical approvals still required before implementation
- New dependency: `web-push` (+ types). Nothing in `package.json` provides VAPID signing.
- New environment variables: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`; push disabled gracefully when unset outside production.
- §81 amendment: Module 31 depends on Module 10 public events (Section 7).
- GRANTED 2026-11-05: `web-push` + types, the three VAPID variables, the Module 10 dependency. Do not log or return VAPID private keys.
- Module 31 implementation is blocked until the Module 10 three-session change is verified (implemented 2026-11-05; awaiting the owner's test run).

## 12. Open business questions (one at a time)
- Q4, Q5, Q6: resolved (Section 1).
- Module 10 questions Q7 and Q8 are tracked in `MODULE-10-THREE-SESSION-IMPACT.md` and must be answered before the Module 10 change is implemented.
- Deferred to Module 32 planning: undefined recipients in Section 10.

## 13. Not approved
Implementation, migrations, new packages, spec amendments and the COMPLETED status. Each needs your explicit approval.
