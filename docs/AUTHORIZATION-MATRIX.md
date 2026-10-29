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
| School Manager | Assigned school | PROPOSED | Same. Module 16 owns the data: `school_managers` (one active manager per school, one user may manage several schools); the SCHOOL scope resolver will use `SchoolLookup.isSchoolManager` and is registered with the permissions in a later step |
| Teacher | Assigned schools; groups, sessions and students restricted where required | APPROVED (spec: a Teacher may belong to several schools) for the school part; group/session/student restrictions PROPOSED | Per-operation restrictions are recorded in section 3 |
| Parent | Own children and explicitly authorized information only | PROPOSED | Ownership-style scope owned by the Parents module |
| Student | Business entity only: no login, no session in V1 | APPROVED (spec) | Cannot hold a role assignment (Module 09) |
| Subscription Collector | Assigned schools and explicitly authorized collection operations | APPROVED (spec §61: assigned school scope) | Cannot waive in V1 |

## 3. Operation rules

Permission ids are assigned when the owning module is implemented (`<module>.<resource>.<action>`). Rows below record rules **already defined by the Master Specification** so they are not asked again; everything not listed is undecided.

| Module | Operation | Permission id | Roles | Management scope | Reporting scope | Ownership | Additional restrictions | Decision | Impl. | Test |
|---|---|---|---|---|---|---|---|---|---|---|
| Schools (16) | Approve / reject a PENDING school | `schools.school.approve`, `schools.school.reject` | ORGANIZATION_MANAGER | the organization of THE SCHOOL (organization manager link); never another organization | n/a | n/a | Rejection requires a reason and a notification (§31). Approval activates the school and, when the school has an applicant, links the applicant as its School Manager in one transaction | APPROVED (final workflow rule) | IMPLEMENTED (engine permission + scope resolver) | TESTED (unit and API written; MariaDB pending on the project machine) |
| Schools (16) | Create a school | `schools.school.create` | ORGANIZATION_MANAGER | the organization of the body's `organizationId`, proven against the caller's own link | n/a | n/a | Starts PENDING (never ACTIVE before approval); grants the creator nothing | APPROVED | IMPLEMENTED (engine) | TESTED (unit and API written; MariaDB pending) |
| Schools (16) | Submit a school (public) | none (public by design) | Any eligible user (no role required) | n/a | n/a | applicant becomes School Manager only after approval | `POST /schools/submissions` (login optional, per-IP abuse limit, organization chosen by the applicant); the applicant gets no role until approved | APPROVED | IMPLEMENTED (public endpoint) | TESTED (unit and API written; MariaDB pending) |
| Schools (16) | Correct a PENDING school's GPS; deactivate / reactivate; assign / revoke a school manager | `schools.school.correct-gps`, `.deactivate`, `.reactivate`, `schools.manager.assign`, `schools.manager.revoke` | ORGANIZATION_MANAGER | the organization of THE SCHOOL | n/a | n/a | GPS immutable after approval; manager link is school-scoped; MAIN_ADMIN has none of these | APPROVED (organization manager only, no platform power) | IMPLEMENTED (engine) | TESTED (unit and API written; MariaDB pending) |
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

### Organization scope (approved decision, Modules 13/16)
| Module | Operation | Permission id | Roles | Management scope | Reporting scope | Ownership | Additional restrictions | Decision | Impl. | Test |
|---|---|---|---|---|---|---|---|---|---|---|
| Organizations (16) | Register an organization | none (public by design) | Anyone (public form, login optional) | the new organization only | n/a | applicant becomes its ORGANIZATION_MANAGER (never MAIN_ADMIN) | name unique system-wide; country and governorate validated, free-text center/village; account created through IAM | APPROVED | IMPLEMENTED (endpoint) | TESTED (unit and API written; MariaDB pending) |
| Schools (16) | List / read schools | `schools.school.list` (UNSCOPED), `schools.school.read` (MANAGEMENT, school) | ORGANIZATION_MANAGER; SCHOOL_MANAGER (own school only) | organization link / school manager link, checked server-side from the loaded school | n/a | n/a | the list shows only the caller's own organizations' schools or own school; MAIN_ADMIN none; D-2 deferred | APPROVED | IMPLEMENTED (engine) | TESTED (unit and API written; MariaDB pending) |
| Teachers (18) | Register (or reuse) a Teacher for a school | `teachers.teacher.create` | SCHOOL_MANAGER | the school of the body's `schoolId` (active manager link, Module 16 resolver) | n/a | n/a | school must be ACTIVE; ORGANIZATION_MANAGER and MAIN_ADMIN none; existing accounts are never merged and their password/flag never touched (identity rules in `docs/TEACHERS.md`) | PROVISIONAL (initial password and identity rules APPROVED) | IMPLEMENTED (engine) | TESTED (unit, API, MariaDB) |
| Teachers (18) | List the Teachers of a school | `teachers.teacher.list` | SCHOOL_MANAGER | the school in the path | n/a | n/a | only Teachers with an ACTIVE link to that school | PROVISIONAL | IMPLEMENTED (engine) | TESTED (unit, API, MariaDB) |
| Teachers (18) | Read a Teacher | `teachers.teacher.read` | SCHOOL_MANAGER | a school the Teacher is actively linked to (loaded server-side, Module 18 resolver) | n/a | n/a | a Teacher linked only to other schools is unreachable | PROVISIONAL | IMPLEMENTED (engine) | TESTED (unit, API, MariaDB) |
| Teachers (18) | End the Teacher's link to one school | `teachers.school-link.remove` | SCHOOL_MANAGER | the school in the path | n/a | n/a | account, Teacher record and other links untouched; refused while the Teacher has groups there (Module 20 guard) | PROVISIONAL | IMPLEMENTED (engine) | TESTED (unit, API, MariaDB) |
| Teachers (18) | Read the own Teacher profile | `teachers.teacher.read-own` (UNSCOPED) | TEACHER | n/a | n/a | the record of the verified token (no id accepted) | no self-edit | PROVISIONAL | IMPLEMENTED (engine) | TESTED (unit, API, MariaDB) |
| Teachers (18) | Global deactivation / deletion of a Teacher | none | none | n/a | n/a | n/a | NOT IMPLEMENTED: blocked by D-3 | NOT DECIDED | NOT_STARTED | n/a |
| Students (19) | Register a Student in a school | `students.student.create` | SCHOOL_MANAGER | the school of the body's `schoolId` (active manager link, Module 16 resolver) | n/a | exactly one Parent of the same organization actively linked to the school | school must be ACTIVE; three-part name tied to the Parent; GLOBAL unique 14-digit National ID; ORGANIZATION_MANAGER and MAIN_ADMIN none | APPROVED (project owner, 2026-10-20) | IMPLEMENTED | TESTED (unit; HTTP, API and MariaDB tests written, not executed) |
| Students (19) | List the Students of a school | `students.student.list` | SCHOOL_MANAGER | the school in the path | n/a | n/a | every status, `filter[status]` | APPROVED | IMPLEMENTED | TESTED (unit; HTTP not executed) |
| Students (19) | Read a Student | `students.student.read` | SCHOOL_MANAGER; PARENT; TEACHER | SCHOOL_MANAGER: the student's school; PARENT: the student's own Parent; TEACHER: a group assigned to them containing the student, inside a school they are linked to | n/a | role-aware MANAGEMENT/STUDENT resolver, positive proof per role | Teacher gets the minimal view (no National ID, Parent or address); Teacher stand-in denies all until Module 20 | APPROVED (minimal Teacher view: implementation default) | IMPLEMENTED | TESTED (unit) |
| Students (19) | Own children | `students.student.list-own-children` (UNSCOPED) | PARENT | n/a | n/a | the Parent record of the verified token (no id accepted) | | APPROVED | IMPLEMENTED | TESTED (unit; HTTP not executed) |
| Students (19) | Update name / join date; deactivate; reactivate; archive; read history | `students.student.update`, `.deactivate`, `.reactivate`, `.archive`, `.read-history` | SCHOOL_MANAGER | the student's school (loaded server-side) | n/a | n/a | Parent, school and National ID never change; ARCHIVED is final and read-only; reactivation needs an ACTIVE school | APPROVED (lifecycle rules: implementation, see `docs/STUDENTS.md`) | IMPLEMENTED | TESTED (unit) |
| Groups (20) | Create a group in a school | `groups.group.create` | SCHOOL_MANAGER | the school of the body's `schoolId` (Module 16 resolver) | n/a | optional Teacher actively linked to the school | ACTIVE school; name unique among ACTIVE groups; surah 1-114; ORGANIZATION_MANAGER and MAIN_ADMIN none | APPROVED (project owner, 2026-10-21) | IMPLEMENTED | TESTED |
| Groups (20) | List the groups of a school | `groups.group.list` | SCHOOL_MANAGER | the school in the path | n/a | n/a | `filter[status]`, sort | APPROVED | IMPLEMENTED | TESTED |
| Groups (20) | Read a group | `groups.group.read` | SCHOOL_MANAGER; TEACHER; PARENT | SCHOOL_MANAGER: the group's school; TEACHER: the ACTIVE group they teach (linked to the school); PARENT: the ACTIVE group currently holding one of their children | n/a | role-aware MANAGEMENT/GROUP resolver, positive proof per role | Parent gets the minimal view (name, Teacher name) | APPROVED | IMPLEMENTED | TESTED |
| Groups (20) | Update, assign / change / remove Teacher, archive, read history, assign / unassign / move students, a student's assignment history | `groups.group.update`, `.assign-teacher`, `.archive`, `.read-history`, `.assign-student`, `.unassign-student`, `.move-student`, `groups.student.read-assignments` | SCHOOL_MANAGER | the group's school (loaded server-side; the student's school for assignment history) | n/a | n/a | ARCHIVED is final and read-only; move only inside the same school; one group per student; archive unassigns every student | APPROVED | IMPLEMENTED | TESTED |
| Groups (20) | List students of a group | `groups.group.list-students` | SCHOOL_MANAGER; TEACHER | SCHOOL_MANAGER: the group's school; TEACHER: the group they teach | n/a | role-aware resolver | a Parent has no student list | APPROVED | IMPLEMENTED | TESTED |
| Groups (20) | Own groups | `groups.group.list-own` (UNSCOPED) | TEACHER | n/a | n/a | the Teacher record of the verified token | ACTIVE groups only | APPROVED | IMPLEMENTED | TESTED |
| Groups (20) | Delete a group | none | none | n/a | n/a | n/a | NOT IMPLEMENTED by design (archive instead) | APPROVED | n/a | TESTED (boundary test) |
| Group Schedules (23) | Add, change (atomic replacement) or remove a slot of a group's schedule | `groups.schedule.manage` | SCHOOL_MANAGER | the group's school (role-aware MANAGEMENT/GROUP resolver of Module 20) | n/a | server-loaded group; the actor is the token | ONE active slot per weekday for a group (any times, with or without a Teacher); a Teacher's slots must not overlap across their ACTIVE groups in any school (touching allowed); an ARCHIVED group is read-only; slots are retired, never deleted | APPROVED | IMPLEMENTED | TESTED |
| Group Schedules (23) | Read a group's schedule (ACTIVE slots) | `groups.schedule.read` | SCHOOL_MANAGER; TEACHER; PARENT | SCHOOL_MANAGER: the group's school; TEACHER: the ACTIVE group they teach; PARENT: the ACTIVE group currently holding one of their children | n/a | role-aware resolver, positive proof per role | the same audience as reading the group | APPROVED | IMPLEMENTED | TESTED |
| Group Schedules (23) | Read a group's schedule history (active and retired slots) | `groups.schedule.read-history` | SCHOOL_MANAGER | the group's school | n/a | server-loaded group | a Teacher or Parent never reads the history | APPROVED | IMPLEMENTED | TESTED |
| Group Schedules (23) | A Teacher's own weekly schedule | `groups.schedule.list-own` (UNSCOPED) | TEACHER | n/a | n/a | the Teacher record of the verified token | ACTIVE slots of ACTIVE groups, across the Teacher's schools | APPROVED | IMPLEMENTED | TESTED |
| Group Schedules (23) | Delete a slot physically | none | none | n/a | n/a | n/a | NOT IMPLEMENTED by design (retire instead; history is kept) | APPROVED | n/a | TESTED (boundary test) |
| Quran structure (21) | Read the Quran structure (dataset, surahs, ayahs with official text, pages with lines, juz starts, the 240 quarters, printed quarter markers) | `quran.structure.read` (UNSCOPED) | every assignable role (all authenticated users) | none: global reference data | n/a | n/a | READ-ONLY: no write, update or delete endpoint or permission; answers `QURAN_DATASET_NOT_IMPORTED` until the dataset is imported | APPROVED (project owner, Module 21 decisions) | IMPLEMENTED | TESTED (synthetic data) |
| Students (19) | Delete a Student | none | none | n/a | n/a | n/a | NOT IMPLEMENTED by design (deactivate / archive instead) | APPROVED | n/a | TESTED (boundary test) |
| Parents (17) | Create (or reuse) a Parent for a school | `parents.parent.create` | SCHOOL_MANAGER | the school of the body's `schoolId` (active manager link, Module 16 resolver) | n/a | n/a | school must be ACTIVE; ORGANIZATION_MANAGER and MAIN_ADMIN none; existing accounts are never merged (identity rules in `docs/PARENTS.md`) | APPROVED | IMPLEMENTED (engine) | TESTED (unit, API, MariaDB) |
| Parents (17) | List the Parents of a school | `parents.parent.list` | SCHOOL_MANAGER | the school in the path | n/a | n/a | only Parents with an ACTIVE link to that school | APPROVED | IMPLEMENTED (engine) | TESTED (unit, API, MariaDB) |
| Parents (17) | Read a Parent / update the address | `parents.parent.read`, `parents.parent.update` | SCHOOL_MANAGER | a school the Parent is actively linked to (loaded server-side, Module 17 resolver) | n/a | n/a | a Parent linked only to other schools is unreachable; name (the account's canonical name), phone, organization and account never change here | APPROVED | IMPLEMENTED (engine) | TESTED (unit, API, MariaDB) |
| Parents (17) | End the Parent's link to one school | `parents.school-link.remove` | SCHOOL_MANAGER | the school in the path | n/a | n/a | account, Parent record, address history and other links untouched; Module 19 will add the "has students" guard | APPROVED | IMPLEMENTED (engine) | TESTED (unit, API, MariaDB) |
| Parents (17) | Read the own Parent profile | `parents.parent.read-own` (UNSCOPED) | PARENT | n/a | n/a | the record of the verified token (no id accepted) | V1: no self-edit of name or address | APPROVED | IMPLEMENTED (engine) | TESTED (unit, API, MariaDB) |
| Parents (17) | Global deactivation / deletion of a Parent | none | none | n/a | n/a | n/a | NOT IMPLEMENTED: blocked by D-3 | NOT DECIDED | NOT_STARTED | n/a |
| Organizations (16) | List / read organizations | `organizations.organization.list` (UNSCOPED), `organizations.organization.read` (MANAGEMENT, organization) | ORGANIZATION_MANAGER | the manager's own organization only | n/a | n/a | MAIN_ADMIN none | APPROVED | IMPLEMENTED (engine, Module 13 registers) | TESTED (unit and API written; MariaDB pending) |
