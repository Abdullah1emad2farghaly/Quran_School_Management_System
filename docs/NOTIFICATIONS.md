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
<<<<<<< HEAD

## Real-time delivery (Socket.IO, 0.47.0)
Real-time makes a notification that is already stored appear at once in every browser of the account that is connected. It **complements** Web Push and the notification APIs; it replaces neither, and **the database remains the source of truth**.

| Topic | Behaviour |
|---|---|
| Endpoint | Socket.IO on the SAME HTTP server and port as the API, path `SOCKET_IO_PATH` (default `/socket.io`). No second port, no hosting-specific service. |
| Authentication | Every connection is verified on the server with the same check as an HTTP request (`SessionService.authenticate`: valid access token, active session, active user). The token is sent in the handshake `auth: { token }` (or the `Authorization: Bearer` header), never in the URL. A refused connection gets `connect_error` with `data.code` `AUTHENTICATION_REQUIRED`, `AUTHENTICATION_FAILED` or `PASSWORD_CHANGE_REQUIRED` (same rule as the HTTP notification endpoints). |
| Rooms | The server joins each connection to exactly one room, `user:<verified user id>`, taken from the verified token. The client sends no events and cannot join, leave or name a room. |
| Devices | A device is an authentication session. One account may have several connections (several sessions, several tabs); each is reached. At most `SOCKET_IO_MAX_CONNECTIONS_PER_USER` per account: above it the oldest connection is closed. |
| Events to the client | `notification:new` (same fields as an item of `GET /notifications`: `id`, `type`, `title`, `body`, `data`, `readAt`, `createdAt`) and `connection:ready` (`{ serverTime }`, after every (re)connection). |
| Creating a notification | Stored first (unchanged logic, once-only key, queued push deliveries). Then, for each recipient with live connections, `notification:new` is emitted. A created-inside-a-caller's-transaction notification (Module 32 handlers) is emitted only after it can be read from outside that transaction; if it never becomes visible (rollback) nothing is emitted. A socket problem never fails or loses a notification. |
| Web Push per device | Push deliveries stay queued per subscription exactly as before. When the push runner reaches a delivery: if that subscription's session already received the notification through its live connection, the delivery is removed (no duplicate); if the session is online but not yet reached and the notification is younger than 6 s, it waits 2 s; otherwise (offline, connection gone, no emission) the normal Web Push is sent. So desktop-online + mobile-offline = socket on the desktop, push on the phone. |
| Reconnection | The client library reconnects by itself; each reconnection is authenticated again with a fresh access token (pass `auth` as a function so it reads the current token). After `connection:ready` the client refetches `GET /notifications` / `GET /notifications/unread-count` to get what it missed. Nothing is replayed by the server. |
| Revoked sessions | When a session ends (logout, device revoked, password change, deactivation, expiry) its live connections are closed (`AuthSessionRevoked` handler). The other sessions keep theirs. |
| Disabled | `SOCKET_IO_ENABLED=false`, or a startup failure of Socket.IO (logged, the API keeps running): behaviour is exactly Web Push + notification APIs as in 0.46.0. |

### Client sketch (frontend not changed here)
```js
const socket = io(API_ORIGIN, { path: '/socket.io', auth: (cb) => cb({ token: currentAccessToken() }) });
socket.on('notification:new', (n) => addToList(n));      // de-duplicate by n.id
socket.on('connection:ready', () => refetchNotifications()); // after every (re)connect
```
Register the listeners once (outside the reconnect handler) so reconnecting never adds a second listener; de-duplicate by `id` because the list API and the event can both carry the same notification.

### Limits and deployment notes
- The connection registry is in memory of ONE server process. With several instances behind a load balancer, use sticky sessions and a shared Socket.IO adapter (for example Redis); until then a notification created on another instance reaches the user only through Web Push or the next fetch.
- A reverse proxy must forward WebSocket upgrades on `SOCKET_IO_PATH` (nginx: `proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";`). Where the host cannot upgrade, Socket.IO falls back to HTTP long polling; where it cannot even do that, the notification APIs and Web Push still work.
- Free hosts that sleep or restart drop every connection: clients reconnect and resync as described. The server does not rely on connections surviving.
- "Delivered" means emitted to a live connection of that session; the browser does not acknowledge, so a connection that dies in the same instant can miss one emission; the notification is then found by the next fetch.
- An existing connection is authenticated at connection time. It ends when its session ends (event above) or when it drops; a new connection always needs a currently valid token.
=======
>>>>>>> a54dc5556dea92ae5f6404ebe5d964eb0b936ccc
