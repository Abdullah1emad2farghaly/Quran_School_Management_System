# Notifications Core (Module 31)

Owned by Module 31 (`src/modules/31-notifications-core`). Master Specification §62-63 plus the approved amendment (channels, account-based notifications, hard delete, once-only keys, language, push subscription lifecycle). Design record: `docs/MODULE-31-DESIGN.md`. It depends on 00, 01, 02, 03, 04, 06 and 10 through their public contracts only (boundary test: `tests/unit/notifications/notification-boundaries.test.ts`).

## What it does
| Rule | Behaviour |
|---|---|
| Channels | In-App and free Web Push (VAPID, `web-push`). No SMS, no email. |
| Ownership | A notification belongs to the ACCOUNT (`recipient_user_id`), never to a device or session. All devices of the account see the same notifications; read, mark-all, delete and clear-all act on the whole account. |
| Hard delete | `DELETE` removes the row for good: no `deleted_at`, no archive, no automatic purge. Nothing in other modules changes. |
| Once-only keys | `notification_dedup_keys(recipient_user_id, dedup_key, created_at)`: inserted BEFORE the notification, never deleted, never exposed. A repeated event/reminder with the same key creates nothing, even after the user deleted the notification. |
| Language | Every template has Arabic and English. The rendered title and body are stored at creation, in the account's language when one is configured (`AccountLanguageResolver`), otherwise Arabic. They never change afterwards. Module 31 adds no language setting: today the resolver answers "none", so every notification is Arabic. |
| Push subscriptions | One per browser endpoint, linked to the account AND to the authentication session that created it. Deleted when that session ends for ANY reason (`AuthSessionRevoked`), only that session's ones. The client should also unsubscribe before logout. |
| Push delivery | Queued per subscription of the account in the same transaction as the notification, sent later by `PushDeliveryScheduler` (polls every 5 s, no Redis). A push failure never changes the notification. |
| Disabled push | Without VAPID configuration push is off: notifications still work in-app, no delivery is queued, the push endpoints answer `PUSH_NOT_CONFIGURED` (422). |

> The rules that decide who is notified of what (school requests, groups, assignments, exams, evaluations, session reminders) are in `docs/NOTIFICATION-RULES.md` (Module 32).

## Contract for producing modules (Module 32 and later)
Register templates (`notificationTemplates` in `src/config/notifications.ts`, `NotificationTemplateRegistry.register`; both languages are mandatory) and call `NotificationService.notify({ recipientUserIds, templateKey, params, data, dedupKey }, tx?)`. Pass `tx` to join an outbox handler's transaction. `dedupKey` is per recipient (<= 191 chars): build it from the event id, or type + aggregate + variant for reminders. The result lists `created` and `duplicates`. A caller mistake (unknown template, bad key, data over 4 KB) throws `NotificationDefinitionError`. Module 31 itself knows no business event.

## API (`/api/v1/notifications`, authentication only)
The account and session come from the verified token; there is no role, permission or scope and no way to name another account. Responses are `Cache-Control: no-store`.
| Operation | Endpoint |
|---|---|
| List (paged, newest first, `filter[unread]=true`) | `GET /` |
| Unread count | `GET /unread-count` |
| Mark one read (idempotent, keeps first read time) | `POST /:id/read` |
| Mark all read | `POST /read-all` |
| Delete one (permanent, idempotent) | `DELETE /:id` |
| Clear all (permanent) | `DELETE /` |
| VAPID public key | `GET /push/public-key` |
| List own subscriptions (ids and times only) | `GET /push-subscriptions` |
| Subscribe this browser (idempotent) | `POST /push-subscriptions` |
| Unsubscribe this browser | `POST /push-subscriptions/unsubscribe` |
An unknown, already deleted or foreign id answers 204 and changes nothing (indistinguishable, so ids cannot be probed and two devices deleting at once is harmless). Unsubscribe is a POST with a body (the endpoint URL stays out of URLs and logs); the earlier design draft said DELETE.
Errors (Arabic + English): `INVALID_PUSH_SUBSCRIPTION` (400), `PUSH_NOT_CONFIGURED` (422), `PUSH_SUBSCRIPTION_LIMIT_REACHED` (422).

## Multi-device behaviour
Everything is stored once per account, so a change made on one device is visible on the others at their next request. Clients should refetch on focus or on an interval, poll `GET /unread-count`, and refetch when the service worker receives a push. A notification already shown by the operating system on another device cannot be closed from the server.

## Push security and retries
- The server posts to the endpoint a browser supplies, so an endpoint must be `https`, the default port, a real DNS name (no IP literal, no single-label host, no `localhost`, `.local`, `.internal`), without credentials, at most 2048 characters (SSRF guard, `isSafePushEndpoint`). DNS rebinding is not addressed beyond this and is a known residual risk.
- A safety cap of 10 subscriptions per account (technical, not a business rule).
- Payload: id, type, title and a body preview of at most 300 characters; never the data object, the endpoint or keys. VAPID private key: used only to sign, never logged, returned or documented (`config-redaction`).
- Outcomes: sent (row removed, failure count reset); 404/410 (that subscription and its deliveries deleted); timeout, 429 and 5xx (retry after 30 s, 60 s, 120 s, 240 s, then FAILED); other 4xx (FAILED at once). A subscription whose deliveries fail for good 5 times in a row is deleted. FAILED rows are kept 7 days. Claiming uses the outbox pattern (`locked_until`, `claim_id`) so a delivery is sent once.
- Moving a browser to another account drops what was queued for the previous account.

## Database (migration `20261105110000-create-notifications-core`)
`notifications` (rendered `title`/`body`, `data` JSON text, `read_at`; indexes `(recipient_user_id, created_at, id)` and `(recipient_user_id, read_at)`), `notification_dedup_keys` (primary key `(recipient_user_id, dedup_key)`), `push_subscriptions` (unique `endpoint_hash`, indexes on user and session), `push_deliveries` (status PENDING/FAILED, foreign keys to the two parent tables with ON DELETE CASCADE). No foreign key to another module's table.

## Configuration
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:` or `https:`): all three or none. Generate once with `npx web-push generate-vapid-keys`. Partial or malformed settings stop startup with a clear message.

## Known limits
Only a Module 31 test template exists: the real templates, event consumers and reminders belong to Module 32. In this environment the HTTP, OpenAPI conformance and database suites were not executed; see the changelog entry.
