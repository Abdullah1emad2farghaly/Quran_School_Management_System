# OTP & Password Recovery

Owned by Module 11 (`src/modules/11-otp-password-recovery`). Forgot-password with an OTP (Master Specification §26). It depends on Modules 08 (change the password), 10 (revoke sessions), 03 (messages) and 06 (events).

```
POST /auth/password-recovery/request  { phone }                    -> 200 { expiresInSeconds }
POST /auth/password-recovery/verify   { phone, otp }               -> 200 { resetToken, resetTokenExpiresAt }
POST /auth/password-recovery/reset    { resetToken, newPassword }  -> 204
```
All three are public (the caller is not logged in) and answer with `Cache-Control: no-store`.

## Rules
| Rule | Value |
|---|---|
| OTP | 6 digits, uniformly random (`crypto.randomInt`), valid **5 minutes**, **single use** |
| Wrong attempts | **5** per OTP; the 5th invalidates the OTP (a new request is needed) |
| Resend | a new request invalidates the previous OTP; one live recovery per user |
| Request limits | the first OTP + 3 resends = **4 per phone per rolling hour**; **5 per phone+IP per rolling 15 minutes** |
| Reset token | random 256-bit, **single use**, valid **10 minutes**, issued only after a correct OTP |
| New password | the 4–12 character policy (§23); a rejected password does **not** use up the token |
| After a reset | password changed, recovery closed, **all sessions revoked** (`PASSWORD_RESET`), in ONE transaction |

The values are constants in code, not settings. (The 5-per-15-minutes pair limit can never trigger on its own because the 4-per-hour phone limit always fires first; both are implemented as approved.)

## No account enumeration
- `/request` answers **identically** (status, body, headers) for an active, an unknown and a disabled account. Only active accounts get an OTP; disabled and unknown accounts get nothing.
- **Every** request counts toward the limits, whether or not the account exists, so the `429` answers reveal nothing either. Rejected (429) requests are not recorded, so a blocked caller does not extend its own block.
- `/verify` gives the same `OTP_INVALID` for wrong, expired, used, locked, unknown, disabled and malformed input. `/reset` gives the same `RESET_TOKEN_INVALID` for unknown, expired, used or no-longer-valid tokens.
- OTP delivery runs **in the background after the commit**, so the answer neither waits for nor depends on the provider (no timing difference, and a delivery failure is never visible). Only a malformed phone number is rejected (`400 INVALID_PHONE_NUMBER`): the format is not account information.
- Residual difference: for a real account the request does a few more database writes (a few milliseconds). The response is not delayed artificially.

## Rate limiting (MySQL, concurrency-safe)
The request path runs in one transaction: it takes an **exclusive row lock for the phone** (`INSERT ... ON DUPLICATE KEY UPDATE` on `password_recovery_locks`), counts the rolling windows in `password_recovery_requests`, and records the request. Concurrent requests for the same phone queue behind the lock, so 10 simultaneous requests yield exactly 4 successes and 6 `429`s (verified by a real-database test). Wrong-OTP counting and reset-token use lock the recovery row, so simultaneous guesses cannot exceed 5 attempts and a token cannot be used twice.
`429` answers carry `Retry-After` (seconds until a slot frees, the longer of the violated windows) and `error.details.retryAfterSeconds`, with code `RATE_LIMITED`.

## What is stored (and what is not)
- The OTP, the reset token, the phone (in the request log) and the IP are stored **only as keyed hashes**: HMAC-SHA256 with sub-keys derived from the dedicated `OTP_HMAC_SECRET` (separate keys for OTP, reset token, phone and IP; the OTP hash is also bound to its recovery id). A 6-digit OTP has only a million values, so an unkeyed hash would be broken instantly; keyed with a secret that is not in the database, a leaked database cannot be used to check guesses.
- The OTP, reset token and new password are **never** logged, never put in events or the outbox, and never returned except the reset token in the `/verify` answer. A test fails the build if a logger call passes them.
- Events (outbox): `PasswordResetCompleted` (`{ recoveryId, userId }`) and Module 08's `UserPasswordChanged`.

## OTP delivery (provider not chosen yet)
`OtpSender` is a port. The real provider is configurable and will be selected later (add it in `src/config/password-recovery.ts` and as a new `OTP_SENDER` value).
- `OTP_SENDER=disabled` (default, the only production value for now): nothing is delivered; the failure is logged by **error name only** (`OTP delivery failed`), never the message, phone or OTP.
- `OTP_SENDER=dev-file` (**development only**, rejected in production): writes the latest OTP per phone to `.dev-otp/otp-outbox.json` (owner-only permissions, Git-ignored) for manual testing. It never uses the logger and is not exposed over HTTP.
- Automated tests use `InMemoryOtpSender`.

## Configuration
| Variable | Default | Rule |
|---|---|---|
| `OTP_HMAC_SECRET` | empty | **required in production**, ≥ 32 chars, must differ from both JWT secrets. In development password recovery needs it set (a clear error otherwise); login does not. |
| `OTP_SENDER` | `disabled` | `disabled` or `dev-file` (not in production) |
| `TRUSTED_PROXIES` | empty | see below |

## Reverse proxy / client IP
The per-IP limit uses `req.ip`. Express **ignores** `X-Forwarded-For` unless the connecting proxy is trusted, so a client cannot forge its IP. By default **no proxy is trusted**. Before deploying behind a reverse proxy or load balancer, set `TRUSTED_PROXIES` to a comma-separated list of the proxy addresses (`10.0.0.5`, a CIDR such as `10.0.0.0/24`, or `loopback`/`linklocal`/`uniquelocal`). `true`, hop counts, `*` and match-everything ranges (`/0`) are rejected at startup. Without it, behind a proxy every client appears to come from the proxy's address, which weakens the per-IP limit (the per-phone limit still holds). Applied in `src/app/bootstrap/trusted-proxies.ts`.

## Errors (Arabic + English)
`OTP_INVALID` (400), `RESET_TOKEN_INVALID` (400), `RATE_LIMITED` (429), `INVALID_PHONE_NUMBER` (400), `INVALID_PASSWORD` (400), `RECOVERY_CONCURRENT_MODIFICATION` (409).

## Database (migration `create-password-recovery`)
- `password_recoveries`: one row per OTP issued to an active user. `live` is `1` while PENDING/VERIFIED and `NULL` once closed; unique `(user_id, live)` allows one live recovery per user; unique `reset_token_hash`. Null-safe CHECKs keep status, `live`, `closed_at`, `attempts ≤ 5` and the reset-token fields consistent. Rows are kept for history.
- `password_recovery_requests`: one row per accepted OTP request (hashed phone and IP, UTC time).
- `password_recovery_locks`: one row per phone hash, used only as a mutex.
- `purgeOlderThan(date)` deletes old closed recoveries, request-log rows and lock rows. It is **not scheduled yet** (no job infrastructure; the spec reserves BullMQ for where required). Expiry itself is checked at use time, so nothing depends on it. Attackers can add rows by requesting OTPs for many unknown phones; schedule the purge before production.

## Not included
Per-IP global limits, CAPTCHA, localized SMS text, the real delivery provider, the setup script for the first Main Admin (deferred), Redis.

## Tests
Unit: `tests/unit/recovery`; HTTP: `tests/integration/password-recovery.test.ts`, `tests/integration/trusted-proxies.test.ts`; configuration: `tests/unit/configuration/config-otp-proxy.test.ts`; real database (concurrency, atomicity, constraints): `tests/db/password-recovery.test.ts` (`npm run test:db`, needs `npm run db:migrate`).
