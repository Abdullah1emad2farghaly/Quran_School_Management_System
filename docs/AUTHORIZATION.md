# Authorization Engine (Module 12)

Reusable authorization infrastructure. Chain (Master Specification §20): Authentication → **Roles → Permissions → Scope → Ownership** → Business rules → Smart Guards. Module 10 authenticates; Module 09 stores roles and grants; **Module 12 decides**. Business rules and Smart Guard checks still follow a successful authorization.

Module 12 defines **no permissions and no HTTP endpoints**. The catalog starts empty, so every request is denied until a module registers an approved permission (see `docs/AUTHORIZATION-MATRIX.md`).

## How a request is evaluated (`AuthorizationService`)
1. Request is well formed and matches the permission's policy: a scope `target` is present exactly when the policy is scoped, an ownership `resource` exactly when the policy has ownership roles. Otherwise `INVALID_REQUEST`.
2. The permission is registered **with a policy**. Unknown → denied.
3. The user exists and is **ACTIVE** (read on every call; deactivation applies at once).
4. The user's **active** role assignments are read from Module 09 (revoked history never counts).
5. Candidates are the active roles the permission is **granted** to. No grant, no access.
6. For each candidate role, scope of the policy's kind (and ownership, for the roles that need it) must hold **under that same role**.
7. Allowed if any candidate passes. A missing resolver, a resolver that throws, or an answer other than exactly `true` is a denial. Failures of the identity/role services propagate as errors; they can never become an allow.

Denial reasons (`DenyReason`) go to the log only. Clients always get `403 ACCESS_DENIED` (Arabic/English). Unauthenticated callers get `401 AUTHENTICATION_REQUIRED` from Module 10.

## Using it from a module
```ts
// 1. Register the module's approved permission (after the grants are in docs/AUTHORIZATION-MATRIX.md)
getAuthorizationPolicyRegistry().register({
  code: 'schools.school.update',          // <module>.<resource>.<action>
  roles: ['SCHOOL_MANAGER'],              // approved grants only
  scope: 'MANAGEMENT',                    // 'MANAGEMENT' | 'REPORTING' | 'UNSCOPED' (explicit, no default)
  ownershipRequiredFor: [],               // roles that must also own the resource
});

// 2. Provide the data the engine cannot own (the module that owns it registers the resolver)
getAuthorizationResolvers().registerScopeResolver('MANAGEMENT', 'SCHOOL', {
  covers: async ({ userId, role, kind, target }) => /* true ONLY on positive proof */,
});

// 3. Protect the route
router.patch('/schools/:id', requireAuthentication,
  requirePermission('schools.school.update', {
    target: async (req) => ({ type: 'SCHOOL', id: await schools.schoolIdFor(req.params.id) }), // server-side data
  }),
  handler); // handler can read req.authorization.role

// Non-HTTP callers inject `Authorizer` (getAuthorizer()) and call assertAuthorized / authorize.
```
Rules for dependent modules: register permissions **only** through `getAuthorizationPolicyRegistry()` (a permission registered directly in Module 09 has no policy and is denied); derive `target`/`resource` from server-side data, never from client-claimed ids; management resolvers must not read reporting data and vice versa; role-dependent differences are separate permissions or a business-rule check using the returned role.

## Scope and ownership
Scope kinds: `MANAGEMENT` and `REPORTING`, never implied by each other. `GLOBAL_SCOPE_ROLES` (in `src/config/authorization.ts`) lists roles whose scope is global per kind (Main Admin, PROPOSED). Geographic/school/teacher/parent scope data is owned by later modules (13, 14, 16, 17, 18, 20, 33, 34...); Module 12 only asks their resolvers.

## First Main Admin bootstrap (one-time CLI)
`BootstrapMainAdmin` creates the first Main Admin. No endpoint exists.

Setup
1. `npm run db:migrate` (creates `authorization_bootstrap_lock`).
2. In an **interactive terminal**: `npm run bootstrap:main-admin`.
3. Type the phone number, then the password twice (hidden prompts). Passwords are never taken from arguments, the environment, or pipes (non-interactive runs exit with code 2).
4. The command prints the new user id (never the phone or password). Sign in with `POST /api/v1/auth/login`.

Behavior: one transaction: lock → refuse (`MAIN_ADMIN_ALREADY_EXISTS`, exit 1) if an **active** Main Admin assignment exists → create the user through Module 08 (phone normalization, password policy §23, bcrypt) → assign `MAIN_ADMIN` through Module 09 (`assignedBy = null`, the system). An existing phone is a conflict (`USER_PHONE_ALREADY_EXISTS`); users are never merged. The row lock serializes concurrent runs, so exactly one can succeed. Events `UserCreated` and `RoleAssigned` go through the outbox as usual. Nothing is logged except error names.

Failure recovery: any failure rolls back everything (exit 1, "Nothing was created"); fix the cause (for example run the migration) and run again.

Recovery of access (what exists today)
- Forgotten password: the Module 11 flow (`/auth/password-recovery/*`). It needs a real `OtpSender` provider, which is not chosen yet (development uses `DevFileOtpSender`).
- Only Main Admin lost/deactivated: the bootstrap **refuses while an active Main Admin role assignment exists**, even for a deactivated user, and no user/role management endpoint exists yet. Today this needs a controlled manual database fix by the operator. A dedicated recovery CLI is **not** implemented because it is a privileged path that needs approval (decision D-4).

## Files
`src/modules/12-authorization-engine/` (domain, application, infrastructure, presentation, public); composition root `src/config/authorization.ts`; CLI `src/app/cli/`; migration `database/migrations/20261010120000-create-authorization-bootstrap-lock.js`. Module 09 gained `RoleService.countActiveByRole` (additive; used by the bootstrap).

## Tests
Unit: `tests/unit/authorization` (registries, deny-by-default matrix, scope/ownership/role separation, bootstrap use case, CLI). Integration: `tests/integration/authorization.test.ts` (`requireAuthentication` + `requirePermission`). Real database: `tests/db/authorization-bootstrap.test.ts` (`npm run test:db`, fresh database with no active Main Admin).

## Remaining dependencies
Scope resolvers and permissions arrive with the owning modules: Organization/Geography/Schools (13, 14, 16), Parents (17), Teachers (18), Groups (20), Subscriptions/Payments (33, 34). Open decisions: `docs/AUTHORIZATION-MATRIX.md`, section 4.
