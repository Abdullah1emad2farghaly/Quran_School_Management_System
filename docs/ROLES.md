# Roles & Permissions

Owned by Module 09 (`src/modules/09-roles-permissions`). It stores **who has which role (with history)** and answers **"does a role grant this permission?"** (Master Specification §18–20). It depends only on Module 08 (plus foundation modules).

## What it is not
- **No HTTP routes.** Authentication (Module 10) and the authorization engine (Module 12) do not exist yet. Callers (other modules) decide **who may assign or revoke roles, and for which scope**, before calling `RoleService`.
- It does not decide which role combinations one person may hold ("if identity/business rules allow it", §19). The owning module (Parents, Teachers, Schools…) enforces that.
- A permission is only the **first** authorization step (roles → permissions). Scope, organization, school, ownership, business rules and smart guards still apply (Module 12). Reporting scope never grants management permissions.

## Roles (§18)
Exactly nine: `MAIN_ADMIN`, `GOVERNORATE_MANAGER`, `CENTER_MANAGER`, `VILLAGE_MANAGER`, `SCHOOL_MANAGER`, `TEACHER`, `STUDENT`, `PARENT`, `SUBSCRIPTION_COLLECTOR` (Arabic and English names in `ROLE_CATALOG`). No Supervisor, no Competition Manager. The list is fixed in code **and** by a database CHECK; changing it needs an approved specification change and a migration.
`STUDENT` is in the catalog but **cannot be assigned** to a User (Student has no login, password or session in V1).

## Role assignments (§19)
Table `user_roles`, one row per assignment, **never deleted**: `assigned_at`, `assigned_by`, `revoked_at`, `revoked_by` (`NULL` actor = the system, e.g. a setup script creating the first Main Admin).
- A user may hold several roles (e.g. Parent + Teacher).
- The same role cannot be active twice (`ROLE_ALREADY_ASSIGNED`); the unique index on `(user_id, role_code, active)` also stops concurrent duplicates. `active` is `1` while current and `NULL` once revoked. Rows created in the same millisecond have no guaranteed order in the history. A CHECK keeps `active`, `revoked_at` and `revoked_by` consistent.
- Assigning a revoked role again creates a **new** row; earlier periods stay in the history.
- A user must always keep **at least one active role**: revoking the last one fails with `LAST_ACTIVE_ROLE`. To change a role, assign the new one first, then revoke the old one (same transaction). A brand-new user has no role until the creator assigns one, so assign the first role in the same transaction as creating the user.
- Revocation locks the user's assignment rows, so two concurrent revocations cannot both succeed and leave zero roles.
- There is no foreign key to `users` (each module owns its tables, §14); the service checks the user and actor through `IdentityService`.

## Permissions (RBAC only; no per-user permissions, §19)
`PermissionRegistry` holds role → permission grants:
- Codes look like `<module>.<resource>.<action>` (e.g. `schools.school.create`).
- **Each module registers its own permissions when it is implemented, and the role grants are approved business decisions.** V1 starts with an **empty** catalog, so nothing is granted until then. Module 09 invents no permissions.
- **Deny by default:** unknown permission, unknown user, or no roles → `false`.
- Only assignable roles can be granted; grants are fixed at startup and cannot be changed at runtime or per user.
- Register in `src/config/roles.ts` (`getPermissionRegistry()`).

## Public contract (`public/index.ts`)
`RoleService`: `assignRole`, `revokeRole`, `listActiveRoles`, `listRoleHistory`, `hasRole`, `hasAnyRole`, `hasPermission`, `listPermissions` (writes accept an optional transaction). Also `ROLE_CODES`, `ROLE_CATALOG`, `PermissionRegistry`, `RoleErrorCodes`, `ROLE_ERROR_MESSAGES`, event constants, adapters. Composition root: `getRoleService()`.

## Events (outbox, same transaction as the change)
`RoleAssigned`, `RoleRevoked` — aggregate `RoleAssignment`, payload `{ assignmentId, userId, roleCode }`. Module 10 can use them to refresh a user's roles.

## Errors (Arabic + English)
`INVALID_ROLE` (400), `ROLE_NOT_ASSIGNABLE` (422), `ROLE_ALREADY_ASSIGNED` (409), `ROLE_ASSIGNMENT_NOT_FOUND` (404), `LAST_ACTIVE_ROLE` (422), `ROLE_CONCURRENT_MODIFICATION` (409), plus `USER_NOT_FOUND` from Module 08. Registry configuration errors (`INVALID_PERMISSION_CODE`, `PERMISSION_ALREADY_REGISTERED`, `INVALID_PERMISSION_GRANT`) are startup errors, not user-facing.

## Tests
Unit: `tests/unit/roles`. Real database: `tests/db/user-roles.test.ts` (`npm run test:db`, needs `npm run db:migrate`).

## Addition for Module 12
`RoleService.countActiveByRole(role)` returns the number of ACTIVE assignments of a role across all users (port `RoleAssignmentRepository.countActiveByRole`, implemented for Sequelize and in memory). Used by the first-Main-Admin bootstrap; additive, no existing behavior changed. Permissions are now registered through Module 12's `AuthorizationPolicyRegistry`; see `docs/AUTHORIZATION.md`.
