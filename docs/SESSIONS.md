# Sessions & JWT (authentication)

Owned by Module 10 (`src/modules/10-sessions-jwt`). It answers **"who is calling?"** (Master Specification §25). It does **not** decide what the caller may do: roles, permissions, scope, ownership and business rules are Module 12 (authorization). It depends on Modules 08 (identity) and 09 (roles, for the informational `roles` list).

## Approved rules
| Rule | Value |
|---|---|
| Access token | JWT (HS256), **15 minutes** |
| Refresh token | opaque random 256-bit token, **30 days**, **rotated on every refresh** |
| Active sessions | **one per user**; a new login revokes the previous session (history kept) |
| Reuse of a rotated refresh token | rejected **and the session is revoked** (`REFRESH_TOKEN_REUSE`); the user must log in again |
| Logout | current session, or all of the user's sessions |

Lifetimes are constants in code (`token-policy.ts`), **not** environment settings, so they cannot be extended by configuration. Changing them needs an approved specification change.

## Configuration
`JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` must both be set in `.env` and must be **different** (production also requires them to be long and random, Module 01). The refresh secret is used as the key of the refresh-token hash.

## Tokens
- **Access token** claims: `sub` (user id), `sid` (session id), `iat`, `exp`, `iss`. No roles and no phone: roles can change, so authorization always reads them from the backend. Verification pins HS256 and the issuer (`alg: none` and algorithm-confusion tokens are rejected).
- **Refresh token**: never stored. Only `HMAC-SHA256(token, JWT_REFRESH_SECRET)` is saved (`refresh_tokens.token_hash`). A database leak alone cannot be used to forge or check tokens. Raw tokens are never logged or put in events.
- Each authenticated request checks the **session** (not revoked) and the **user** (active), so logout, replacement by a new login and deactivation take effect **immediately**, not after the 15 minutes.

## Flows
- **Login** (`phone` + `password`): wrong password, unknown phone and malformed phone all return the same `INVALID_CREDENTIALS` (no account enumeration; unknown phones still spend a password-hash time). An inactive account returns `ACCOUNT_INACTIVE` only after the password was verified. A previous active session is revoked (`LOGIN_REPLACED`) in the same transaction as the new one is created.
- **Refresh**: valid token → new access token **and** new refresh token; the old token is revoked and linked to its replacement. A token that was already rotated → `REFRESH_TOKEN_REUSED` + session revoked (the revocation is committed even though the request fails). A token revoked together with its session (logout, replaced by a new login) → `SESSION_REVOKED` (not an attack). Expired → `REFRESH_TOKEN_EXPIRED`. Unknown → `REFRESH_TOKEN_INVALID`.
- **Logout / logout-all**: idempotent.
- **Deactivated user**: the `UserDeactivated` event (Module 08) revokes the user's sessions (`USER_DEACTIVATED`); authentication already rejects inactive users meanwhile.
- **Password reset** (Module 11) calls `SessionService.revokeAllForUser(userId, 'PASSWORD_RESET')`.

## HTTP API (`/api/v1/auth`)
| Endpoint | Auth | Body | Success |
|---|---|---|---|
| `POST /login` | none | `{ phone, password }` | 200 `{ tokenType, accessToken, accessTokenExpiresAt, refreshToken, refreshTokenExpiresAt, user:{id,phone}, roles }` |
| `POST /refresh` | none | `{ refreshToken }` | 200, same shape (new tokens) |
| `POST /logout` | Bearer access token | – | 204 |
| `POST /logout-all` | Bearer access token | – | 204 |

Token responses carry `Cache-Control: no-store`. The access token is accepted **only** from `Authorization: Bearer <token>` (never from the URL or body). `roles` in the response is informational for the UI; the backend never trusts it.
Errors (Arabic + English): `AUTHENTICATION_REQUIRED`, `INVALID_CREDENTIALS`, `ACCESS_TOKEN_INVALID`, `ACCESS_TOKEN_EXPIRED` (the client should refresh), `SESSION_REVOKED`, `REFRESH_TOKEN_INVALID`, `REFRESH_TOKEN_EXPIRED`, `REFRESH_TOKEN_REUSED` (all 401), `ACCOUNT_INACTIVE` (403), `SESSION_CONCURRENT_MODIFICATION` (409).

## For other modules
Protect a route with `requireAuthentication` (`src/config/sessions.ts`); the caller is then in `req.auth` (`userId`, `sessionId`) and in the request log context. Authorization is a separate step (Module 12). Use `getSessionService()` for `revokeAllForUser`.

## Database (migration `create-auth-sessions`)
- `auth_sessions`: one row per login, never deleted. `active` is `1` while current and `NULL` once revoked; the unique index `(user_id, active)` allows **one active session per user** in the database itself. CHECKs keep `active`, `revoked_at` and `revoked_reason` consistent and limit the reason list.
- `refresh_tokens`: one row per issued token (hash only). `active` is `1` for the session's current token; unique `(session_id, active)` and unique `token_hash`; rotated tokens stay (`replaced_by_id`) so reuse can be detected. CHECK `expires_at > issued_at`.
- Lock order is always session, then token (no deadlocks); refresh decides on the **locked** rows, so two simultaneous refreshes with the same token cannot both succeed.
- No foreign keys to other modules' tables (§14).

## Events (outbox)
`AuthSessionStarted`, `AuthSessionRevoked` (aggregate `AuthSession`, payload `{ sessionId, userId, reason? }`; never tokens). Named so they never collide with the teaching-session events of Module 24.

## Not included (not in the specification)
No login rate limiting or lockout, no device/IP/user-agent tracking, no absolute maximum session age (a session lasts as long as it keeps being refreshed within 30 days), no "remember me". Add them only if the specification is extended.

## Tests
Unit: `tests/unit/sessions`; HTTP: `tests/integration/auth.test.ts`; real database: `tests/db/auth-sessions.test.ts` (`npm run test:db`, needs `npm run db:migrate`).
