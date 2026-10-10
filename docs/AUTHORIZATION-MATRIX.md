# Authorization Matrix

The **central record of authorization decisions** across all modules. The Master Specification stays the single source of truth for business rules; this document records how each protected operation is authorized and what has been approved.

**Rules of this document**
- Business permissions are approved **module by module**. Approval of the generic Authorization Engine (Module 12) is *not* approval of any role-to-permission grant.
- Before a module that adds or changes a protected operation is implemented, its rows are filled in here: operation, roles, permission id, management/reporting scope, ownership, restrictions, and any open decision. If the Master Specification already defines a rule, it is recorded as APPROVED with its section; if it does not, implementation of that behavior stops until the owner decides.
- Never mark a PROPOSED rule APPROVED without explicit authorization. Never grant a permission "to make an endpoint work".
- Scope decides **where**; the permission decides **whether**. A scope assignment never grants a permission. Management scope and reporting scope are separate and never imply each other.

**Status columns**
- Decision: `PROPOSED` (suggested, not approved) · `APPROVED` (approved by the owner or defined by the Master Specification).
- Implementation: `NOT_STARTED` · `IMPLEMENTED`.
- Test: `NOT_TESTED` · `TESTED` (the implementation passed its required authorization tests).

---

## 1. Engine rules (Module 12)

| Module | Rule | Decision | Implementation | Test |
|---|---|---|---|---|
| 12 | Authorization fails closed: unknown permission, missing/invalid scope or ownership input, missing resolver, resolver error or non-`true` answer all deny | APPROVED (Module 12 direction §5) | IMPLEMENTED | TESTED¹ |
| 12 | Inactive or unknown users are never authorized; checked on every call (no caching) | APPROVED | IMPLEMENTED | TESTED¹ |
| 12 | Only ACTIVE role assignments count; revoked history never grants access | APPROVED | IMPLEMENTED | TESTED¹ |
| 12 | A role gets a permission only if explicitly granted; nothing is implicit | APPROVED | IMPLEMENTED | TESTED¹ |
| 12 | Scope (and ownership) must hold under the SAME role that holds the permission | APPROVED (technical design) | IMPLEMENTED | TESTED¹ |
| 12 | Management and reporting scope are separate (a permission declares its kind; the resolver is asked only about that kind) | APPROVED | IMPLEMENTED | TESTED¹ |
| 12 | Scope/ownership data is owned by other modules and reached only through registered resolver ports; Module 12 has no organizational tables | APPROVED | IMPLEMENTED | TESTED¹ |
| 12 | Denials answer 403 `ACCESS_DENIED` with no reason; reasons are logged only | APPROVED (technical design) | IMPLEMENTED | TESTED¹ |
| 12 | Module 12 defines **no** permissions and **no** HTTP endpoints | APPROVED | IMPLEMENTED | TESTED¹ |
| 12 | First Main Admin only through the one-time CLI; refuses if an active Main Admin exists; no registration endpoint | APPROVED | IMPLEMENTED | TESTED (unit¹; real-DB² run by the project owner) |

¹ Executed with the project's test files through a compatibility harness (native Vitest could not start in the build environment: the supplied `node_modules` contains Windows-only binaries). Re-run `npm test` on your machine to confirm.
² `tests/db/authorization-bootstrap.test.ts` (lock row, atomic create, refusal, rollback, concurrent bootstraps) was run against MariaDB by the project owner: 5 of 5 passed.

## 2. Scope model (architectural direction; validated against the Master Specification)

| Role | Scope direction | Decision | Basis / note |
|---|---|---|---|
| Main Admin | Global system scope | PROPOSED | Given as direction for Module 12; the Master Specification does not state it explicitly. Wired as configuration in `src/config/authorization.ts` (`GLOBAL_SCOPE_ROLES`, both kinds). It only removes the need for a resolver for that role; the role still needs each permission. **Confirm, per kind, when the first module needs it.** |
| Governorate Manager | Assigned governorate and applicable descendants | PROPOSED | "Applicable descendants" semantics belong to Geography/Organization resolvers; to be approved with the first module that uses it |
| Center Manager | Assigned center and applicable descendants | PROPOSED | Same |
| Village Manager | Assigned village and its schools | PROPOSED | Same |
| School Manager | Assigned school | PROPOSED | Same |
| Teacher | Assigned schools; groups, sessions and students restricted where required | APPROVED (spec: a Teacher may belong to several schools) for the school part; group/session/student restrictions PROPOSED | Per-operation restrictions are recorded in section 3 |
| Parent | Own children and explicitly authorized information only | PROPOSED | Ownership-style scope owned by the Parents module |
| Student | Business entity only: no login, no session in V1 | APPROVED (spec) | Cannot hold a role assignment (Module 09) |
| Subscription Collector | Assigned schools and explicitly authorized collection operations | APPROVED (spec §61: assigned school scope) | Cannot waive in V1 |

## 3. Operation rules

Permission ids are assigned when the owning module is implemented (`<module>.<resource>.<action>`). Rows below record rules **already defined by the Master Specification** so they are not asked again; everything not listed is undecided.

| Module | Operation | Permission id | Roles | Management scope | Reporting scope | Ownership | Additional restrictions | Decision | Impl. | Test |
|---|---|---|---|---|---|---|---|---|---|---|
| Sub-school workflow (owning module per MODULE-MAP) | Approve / reject a PENDING sub-school | TBD | Main Admin | n/a | n/a | n/a | Rejection requires a reason and a notification (§31) | APPROVED (§31) | NOT_STARTED | NOT_TESTED |
| Subscriptions / Payments & Collection (33, 34) | Record a collection | TBD | School Manager, Subscription Collector | Collector: assigned school | n/a | n/a | — | APPROVED (§61) | NOT_STARTED | NOT_TESTED |
| Subscriptions / Payments & Collection (33, 34) | Waive a subscription | TBD | School Manager (primary responsibility) | School Manager's school | n/a | n/a | Subscription Collector **cannot** waive in V1 (§61). Whether any other role may waive is **not defined** ("primarily School Manager") | Collector exclusion APPROVED (§61); full role list OPEN | NOT_STARTED | NOT_TESTED |
| Sessions / Smart Guard (24, 25) | Teacher protected actions | TBD | Teacher | Assigned school/group (to confirm) | n/a | Teacher of the session (to confirm) | Only from 15 minutes before the session start until its end (§45); validated by Smart Guard, not by the engine | Time window APPROVED (§45); roles/scope/ownership PROPOSED | NOT_STARTED | NOT_TESTED |
| Reports (37–39) | Export a report | TBD | — | — | — | — | Report export requires explicit approval (§70) | OPEN | NOT_STARTED | NOT_TESTED |

## 4. Open decisions (none blocks Module 12)

| # | Decision | Needed by |
|---|---|---|
| D-1 | Confirm Main Admin global scope, separately for management and for reporting | First module that protects an operation Main Admin performs |
| D-2 | "Applicable descendants" for Governorate / Center / Village managers (and whether reporting scope is broader than management scope) | Geography / Organization / Schools (13, 14, 16) |
| D-3 | Who may assign and revoke roles and deactivate users (and for which scope); needed before any role/user management endpoint exists | First module exposing user or role management |
| D-4 | Recovery path if the only Main Admin is lost or deactivated (see `docs/AUTHORIZATION.md`, "Recovery"): approve a dedicated recovery CLI, or accept the documented manual procedure | Before production go-live |
| D-5 | Who else, if anyone, may waive a subscription besides the School Manager | Subscriptions (33) |
