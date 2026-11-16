# Sessions & JWT (authentication)

Owned by Module 10 (`src/modules/10-sessions-jwt`). It answers **"who is calling?"** (Master Specification §25). It does **not** decide what the caller may do: roles, permissions, scope, ownership and business rules are Module 12 (authorization). It depends on Modules 08 (identity) and 09 (roles, for the informational `roles` list).

## Approved rules
| Rule | Value |
|---|---|
| Access token | JWT (HS256), **15 minutes** |
| Refresh token | opaque random 256-bit token, **30 days**, **rotated on every refresh** |
| Active sessions | up to **three per account, every role** (approved amendment 2026-11-04); a new login never revokes another session; a fourth login is refused (`SESSION_LIMIT_REACHED`) |
| Reuse of a rotated refresh token | rejected **and the session is revoked** (`REFRESH_TOKEN_REUSE`); the user must log in again |
| Logout | the current session only, or all of the user's sessions |
| Session end | logout, revocation, or the 30-day refresh token expiring (`SESSION_EXPIRED`); expired sessions stop counting |
| Change password | keeps the calling session, revokes every other one (`PASSWORD_CHANGED`) |
| My devices | list own active sessions (safe info only); revoke one selected session (`DEVICE_REVOKED`) |

Lifetimes are constants in code (`token-policy.ts`), **not** environment settings, so they cannot be extended by configuration. Changing them needs an approved specification change.

## Configuration
`JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` must both be set in `.env` and must be **different** (production also requires them to be long and random, Module 01). The refresh secret is used as the key of the refresh-token hash.

## Tokens
- **Access token** claims: `sub` (user id), `sid` (session id), `iat`, `exp`, `iss`. No roles and no phone: roles can change, so authorization always reads them from the backend. Verification pins HS256 and the issuer (`alg: none` and algorithm-confusion tokens are rejected).
- **Refresh token**: never stored. Only `HMAC-SHA256(token, JWT_REFRESH_SECRET)` is saved (`refresh_tokens.token_hash`). A database leak alone cannot be used to forge or check tokens. Raw tokens are never logged or put in events.
- Each authenticated request checks the **session** (not revoked) and the **user** (active), so logout, revocation (including from My devices), password change on another device and deactivation take effect **immediately**, not after the 15 minutes.

## Flows
- **Login** (`phone` + `password`): wrong password, unknown phone and malformed phone all return the same `INVALID_CREDENTIALS` (no account enumeration; unknown phones still spend a password-hash time). An inactive account returns `ACCOUNT_INACTIVE` only after the password was verified. A previous active session is revoked (`LOGIN_REPLACED`) in the same transaction as the new one is created.
- **Refresh**: valid token → new access token **and** new refresh token; the old token is revoked and linked to its replacement. A token that was already rotated → `REFRESH_TOKEN_REUSED` + session revoked (the revocation is committed even though the request fails). A token revoked together with its session (logout, replaced by a new login) → `SESSION_REVOKED` (not an attack). Expired → `REFRESH_TOKEN_EXPIRED`. Unknown → `REFRESH_TOKEN_INVALID`.
- **Sessions and slots**: each ACTIVE session occupies a slot 1..3 (`MAX_ACTIVE_SESSIONS` in `session-policy.ts`); revoking frees it. Login runs in one transaction: lock the account's active sessions, release those whose refresh token expired (`SESSION_EXPIRED`), take the lowest free slot, insert the session and its first refresh token. If no slot is free: `SESSION_LIMIT_REACHED` (HTTP 422, `details.maxActiveSessions = 3`), after the password and the account state were checked, and nothing is revoked. Two simultaneous logins are made safe by the database (unique `(user_id, slot)`): the loser is retried (up to 5 times) and then takes another slot or is refused.
- **Logout**: revokes only the current session. **Logout-all**: revokes all of the account's sessions. Both idempotent.
- **Expired sessions**: a session whose current refresh token expired is revoked (`SESSION_EXPIRED`, `AuthSessionRevoked`) at login and by `SessionExpiryScheduler` (polls every 5 minutes, in-process, no Redis; `SessionService.expireSessions`). Each session is re-checked under its own lock in its own transaction, so the job is idempotent and never revokes a session that was refreshed meanwhile.
- **Change password**: in the same transaction as the password change, every active session except the calling one is revoked (`PASSWORD_CHANGED`, one event each); no token is reissued.
- **My devices**: `GET /auth/sessions` and `DELETE /auth/sessions/:sessionId`, authentication only; the account always comes from the token. A session that is unknown, another account's or already ended answers the same `SESSION_NOT_FOUND` (404). The list shows `id`, `deviceLabel`, `createdAt`, `lastActiveAt` (when the tokens were last issued: login or refresh; per-request activity is not tracked), `expiresAt`, `isCurrent`; never a token or hash. `deviceLabel` is a coarse "Chrome on Android" derived at login from the User-Agent (`device-label.ts`): no raw header, no IP address, no version.
- **Deactivated user**: the `UserDeactivated` event (Module 08) revokes the user's sessions (`USER_DEACTIVATED`); authentication already rejects inactive users meanwhile.
- **Password reset** (Module 11) calls `SessionService.revokeAllForUser(userId, 'PASSWORD_RESET')`.

## HTTP API (`/api/v1/auth`)
`POST /auth/change-password` (authenticated; revokes the account's other sessions; `currentPassword`, `newPassword`; 204) lets the user change their own password (policy 4-12 characters, must differ from the current one, wrong current password -> `CURRENT_PASSWORD_INCORRECT`). **Mandatory first-login change (account-level flag `users.must_change_password`, Module 17):** while the flag is set, `requireAuthentication` answers every protected route with `403 PASSWORD_CHANGE_REQUIRED`; only `POST /auth/change-password`, `/auth/logout` and `/auth/logout-all` (`requireAuthenticationAllowingPasswordChange`) and the public login/refresh stay reachable. Login and refresh report `mustChangePassword`. The flag is read live from the user on every request; a successful change clears it, the session stays valid and no token is reissued.

The endpoints (`POST /login`, `/refresh`, `/logout`, `/logout-all`, `/change-password`, `GET /sessions`, `DELETE /sessions/:sessionId`) are documented in the OpenAPI document served at `/api-docs` (`docs/API-DOCUMENTATION.md`; contract in `src/modules/10-sessions-jwt/presentation/http/auth.openapi.ts`).

Token responses carry `Cache-Control: no-store`. The access token is accepted **only** from `Authorization: Bearer <token>` (never from the URL or body). `roles` in the response is informational for the UI; the backend never trusts it.
Errors (Arabic + English): `SESSION_LIMIT_REACHED` (422), `SESSION_NOT_FOUND` (404), `AUTHENTICATION_REQUIRED`, `INVALID_CREDENTIALS`, `ACCESS_TOKEN_INVALID`, `ACCESS_TOKEN_EXPIRED` (the client should refresh), `SESSION_REVOKED`, `REFRESH_TOKEN_INVALID`, `REFRESH_TOKEN_EXPIRED`, `REFRESH_TOKEN_REUSED` (all 401), `ACCOUNT_INACTIVE` (403), `SESSION_CONCURRENT_MODIFICATION` (409).

## Active role (per session)
An account may hold several roles; the **active role belongs to the session (device)**, in `auth_sessions.active_role`, never to the user. Three devices can act as three different roles at once; changing one never touches another.
- **Login / refresh** answer `roles` (all current assignments) and `activeRole`: one role -> already active; several -> `null` until chosen; none -> `[]` / `null`. Refresh keeps the session's role.
- **`POST /auth/switch-role`** `{ role }` (authentication only): locks the session, checks it is active and unexpired and that the account holds the role NOW, persists on this session only. Same role again = no-op. Errors: 400 malformed, 403 `ROLE_NOT_ASSIGNED`, 401 `SESSION_REVOKED`, 403 `PASSWORD_CHANGE_REQUIRED`. No token rotation; not a new session (the limit of 3 is unchanged).
- **No stale roles:** the access token has no role claim; the active role is read from the persisted session on every request and checked against the CURRENT roles (`effectiveActiveRole`), so a switch or a role revocation takes effect immediately. A session created before the column existed (NULL) works for a single-role account and must choose for a multi-role one.
- `schoolId` (login, refresh, switch-role): the school the user actively manages as School Manager, else `null`.

## For other modules
Protect a route with `requireAuthentication` (`src/config/sessions.ts`); the caller is then in `req.auth` (`userId`, `sessionId`) and in the request log context. Authorization is a separate step (Module 12). Use `getSessionService()` for `revokeAllForUser`.

## Database (migrations `create-auth-sessions`, `auth-sessions-three-session-model`)
- `auth_sessions`: one row per login, never deleted. `active` is `1` while current and `NULL` once revoked. Since migration `20261105100000`: `slot` (1..3, `NULL` once revoked) with CHECK `slot IS NULL OR slot BETWEEN 1 AND 3`, **unique `(user_id, slot)`** (the database itself allows at most three active sessions per user and lets only one of two racing logins take a slot), `device_label` (VARCHAR 100, `NULL` for older sessions), plain index `(user_id, active)`; the one-active-session unique index was dropped. Revoke reasons added: `SESSION_EXPIRED`, `DEVICE_REVOKED`, `PASSWORD_CHANGED` (`LOGIN_REPLACED` stays valid for history and is no longer produced). Existing active sessions got slot 1. `down` refuses (changing nothing) when a user has several active sessions or rows use the new reasons. CHECKs keep `active`, `revoked_at` and `revoked_reason` consistent and limit the reason list.
- `refresh_tokens`: one row per issued token (hash only). `active` is `1` for the session's current token; unique `(session_id, active)` and unique `token_hash`; rotated tokens stay (`replaced_by_id`) so reuse can be detected. CHECK `expires_at > issued_at`.
- Lock order is always session, then token (no deadlocks); refresh decides on the **locked** rows, so two simultaneous refreshes with the same token cannot both succeed.
- No foreign keys to other modules' tables (§14).

## Events (outbox)
`AuthSessionStarted`, `AuthSessionRevoked` (aggregate `AuthSession`, payload `{ sessionId, userId, reason? }`; never tokens). Named so they never collide with the teaching-session events of Module 24.

## Not included (not in the specification)
No login rate limiting or lockout, no IP tracking and no storage of the raw User-Agent (only the coarse device label), no absolute maximum session age (a session lasts as long as it keeps being refreshed within 30 days), no "remember me". Add them only if the specification is extended.

## Tests
Unit: `tests/unit/sessions` (`three-session-model.test.ts` covers the limit, concurrency, isolation, expiry, change-password, My devices and the device label); HTTP: `tests/integration/auth.test.ts`; real database: `tests/db/auth-sessions.test.ts` (`npm run test:db`, needs `npm run db:migrate`).
