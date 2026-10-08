# Identity Core

Owned by Module 08 (`src/modules/08-identity-core`). It owns the **login identity**: a User with a normalized phone, a password hash and an `ACTIVE`/`INACTIVE` status (Master Specification §21–24). Names, roles, sessions and business profiles (parent, teacher…) belong to other modules.

## What it is not
- **No HTTP routes.** Authentication (Module 10) and authorization (Module 12) do not exist yet, so nothing is exposed over HTTP. Other modules call the public `IdentityService`; **they** authorize the caller (role → permission → scope → ownership → business rules) before using it.
- It does not decide identity reuse vs. conflict between people. The owning module (Parents, Teachers…) compares identity data; Module 08 only guarantees one User per phone.

## Phone numbers (shared infrastructure)
Every module must call `normalizePhone` before storing or comparing a phone. Canonical form is **E.164** (`+201012345678`).

| Input | Result |
|---|---|
| Egyptian local mobile `010` / `011` / `012` / `015` + 8 digits | `+20…` (country code added) |
| `+` or `00` prefix (any country) | validated E.164 |
| Arabic-Indic / Persian digits, spaces, `-`, `.`, `()`, invisible direction marks | accepted and removed |
| Digits only without `0`/`+`/`00` (e.g. `1012345678`, `201012345678`), other local numbers (e.g. landlines) | rejected (`INVALID_PHONE_NUMBER`) — the country is never guessed |
| `+20` followed by a trunk `0`, or an Egyptian mobile not exactly 10 digits after `+20` | rejected |

`phone` is **globally unique** (`uq_users_phone`). The same person typed as `010…`, `+20 10…`, `0020…` or in Arabic digits maps to one User.

## Passwords
- 4–12 characters (counted as characters, so Arabic letters count once), no composition rule (§23).
- Stored only as a **bcrypt** hash (`BcryptPasswordHasher`, cost 10; tests use 4). Plaintext is never stored, logged, returned or put in events.
- `initialPasswordFromPhone(phone)` = last 4 digits (§24). It does not force a change; the parent-creation workflow uses it.

## Lifecycle (§22)
`ACTIVE ⇄ INACTIVE`, reversible, nothing is deleted (history preserved). Invalid transitions fail with `USER_ALREADY_ACTIVE` / `USER_ALREADY_INACTIVE`.
`UserDeactivated` is the signal for **Module 10** to revoke the user's sessions. `isActive` must be checked by login and by the authorization engine to block protected actions; `verifyPassword` deliberately does not look at status.

## Public contract (`public/index.ts`)
`IdentityService`: `createUser`, `findById`, `getById`, `findByPhone`, `verifyPassword`, `deactivateUser`, `activateUser`, `changePassword`. Each write accepts an optional transaction so the caller can make its own changes atomic with the user change. DTOs never include the hash.
Also exported: `normalizePhone`, `tryNormalizePhone`, `lastFourDigitsOf`, password policy helpers, `IdentityErrorCodes`, `IDENTITY_ERROR_MESSAGES`, event type constants, adapters (`SequelizeUserRepository`, `InMemoryUserRepository`, `BcryptPasswordHasher`). Composition root: `getIdentityService()` in `src/config/identity.ts`.

`createUser` **always** fails with `USER_PHONE_ALREADY_EXISTS` when the phone exists (no silent merge, §86). Callers that may reuse a user call `findByPhone` first and apply their own identity rules.
Password-recovery flows must not turn `USER_NOT_FOUND` into an account-existence leak (§86).

## Events (via the transactional outbox, same transaction as the change)
`UserCreated`, `UserDeactivated`, `UserActivated`, `UserPasswordChanged` — aggregate `User`, payload `{ userId }` only (no phone, password or hash).

## Errors (Arabic + English)
`INVALID_PHONE_NUMBER` (400), `INVALID_PASSWORD` (400, `{min}`/`{max}`), `USER_PHONE_ALREADY_EXISTS` (409), `USER_NOT_FOUND` (404), `USER_ALREADY_ACTIVE` / `USER_ALREADY_INACTIVE` (422), `USER_CONCURRENT_MODIFICATION` (409).

## Database (`users`, migration `create-users`)
`id` (UUID), `phone` (unique), `password_hash`, `status` (`CHECK` ACTIVE/INACTIVE), `status_changed_at`, `version` (optimistic lock), `created_at`, `updated_at`. Concurrent creation of the same phone is stopped by the unique index even if two requests pass the application check.

## Tests
Unit: `tests/unit/identity` (phone, password policy, aggregate, service, messages, module boundaries). Real database: `tests/db/users.test.ts` (`npm run test:db`, needs `npm run db:migrate`).
