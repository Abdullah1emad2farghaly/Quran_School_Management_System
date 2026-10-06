# CLAUDE CODE — MASTER PROJECT IMPLEMENTATION PROMPT

# Quran School Management System

# Master Specification + Architecture + Implementation Rules

# Version 1.0

* * *

# 1\. ROLE AND RESPONSIBILITY

You are the primary software engineer responsible for implementing the entire:

**Multi-School / Multi-Branch Quran School Management System**

You are working inside ONE repository and ONE continuous project context.

The project must be implemented **module-by-module**, according to the approved module map and implementation order defined in this document.

This document is the:

> **SINGLE SOURCE OF TRUTH**

for the system.

You MUST NOT invent, assume, simplify, remove, reinterpret, or modify business rules defined here.

If implementation reveals a genuinely missing business decision that changes system behavior:

```plaintext
STOP
↓
Identify the missing business decision
↓
Ask the user
↓
Wait for explicit approval
↓
Update the Master Specification / project documentation
↓
Continue implementation
```

Do NOT silently make business decisions.

Technical implementation decisions that do NOT change business behavior may be made by you when necessary, provided they respect this architecture and do not violate any approved business rule.

* * *

# 2\. PRIMARY OBJECTIVES

The final system must be:

-   Production-oriented

-   Secure

-   Modular

-   Maintainable

-   Scalable

-   Testable

-   Multi-school

-   Multi-branch

-   Role-based

-   Scope-aware

-   Ownership-aware

-   History-aware

-   Audit-aware

-   Localization-ready

-   Transaction-safe

-   API-first

-   Backend-enforced

The backend is the final security boundary.

Frontend restrictions must NEVER be considered authorization.

* * *

# 3\. DEVELOPMENT PHILOSOPHY

The system must be designed in this order:

```plaintext
Requirements
↓
Business Logic
↓
Roles
↓
Permissions
↓
Scopes
↓
Ownership
↓
Workflows
↓
Smart Guards
↓
Notifications
↓
Historical Rules
↓
Reporting
↓
Database
↓
Backend/API
↓
Frontend
```

Do NOT start by designing database tables and then invent business behavior around them.

Business logic owns the database design, not the opposite.

* * *

# 4\. BACKEND ARCHITECTURE

Use:

> Modular Monolith + Clean Architecture + Strong Module Boundaries

with:

-   Domain Events

-   Transactional Operations

-   Transactional Outbox

-   Selective CQRS where useful

-   Strong authorization boundaries

-   Module-owned infrastructure

-   Module-owned persistence

-   Explicit public contracts

Do NOT build microservices.

Do NOT create a distributed architecture.

Do NOT over-engineer CQRS.

Use CQRS only where read/write separation provides real value, especially reporting/read-heavy workflows.

* * *

# 5\. TECHNOLOGY STACK

Use:

-   Node.js

-   Express

-   TypeScript

-   TypeScript strict mode

-   Sequelize ORM

-   MySQL

-   express-validator

-   dotenv

-   cors

-   jsonwebtoken

-   bcryptjs

-   nodemon / tsx

-   sequelize-cli

Where background processing is required:

-   BullMQ

-   Redis

Use package versions that are mutually compatible and currently stable.

Do NOT replace the approved stack without explicit approval.

* * *

# 6\. API

Base API:

```plaintext
/api/v1
```

API must use:

-   consistent response structure

-   consistent error structure

-   stable error codes

-   pagination

-   whitelisted sorting

-   whitelisted filtering

-   request/correlation IDs

-   localized user-facing messages

Default pagination:

```plaintext
default = 20
maximum = 100
```

Never allow arbitrary database sorting/filtering fields from clients.

* * *

# 7\. REQUEST / CORRELATION ID

Every request must have a request/correlation ID.

It must be usable in:

-   logs

-   errors

-   audits

-   troubleshooting

-   relevant API responses

If the client provides an acceptable correlation/request ID, validate and safely reuse it according to the implementation policy.

Otherwise generate one.

* * *

# 8\. LOCALIZATION

Supported locales:

```plaintext
ar
en
```

Default:

```plaintext
ar
```

Fallback:

```plaintext
en
```

Locale resolution priority:

```plaintext
Explicit User Preference
↓
Request Locale / Accept-Language
↓
System Default
```

User-facing errors must include:

-   stable language-independent error code

-   localized message

-   locale

-   request ID where applicable

Error codes must NEVER depend on language.

* * *

# 9\. PROJECT ARCHITECTURE

Use the following overall structure.

```plaintext
project-root/
│
├── src/
│   │
│   ├── app/
│   │   ├── bootstrap/
│   │   ├── middleware/
│   │   ├── routes/
│   │   └── server.ts
│   │
│   ├── config/
│   │
│   └── modules/
│       │
│       ├── 00-shared-kernel/
│       ├── 01-configuration/
│       ├── 02-database/
│       ├── 03-error-localization/
│       ├── 04-validation-api/
│       ├── 05-logging-request-context/
│       ├── 06-domain-events-outbox/
│       ├── 07-file-infrastructure/
│       │
│       ├── 08-identity-core/
│       ├── 09-roles-permissions/
│       ├── 10-sessions-jwt/
│       ├── 11-otp-password-recovery/
│       ├── 12-authorization-engine/
│       │
│       ├── 13-organization-core/
│       ├── 14-geography/
│       ├── 15-unified-address/
│       ├── 16-schools/
│       │
│       ├── 17-parents/
│       ├── 18-teachers/
│       ├── 19-students/
│       │
│       ├── 20-groups/
│       ├── 21-quran-structure/
│       ├── 22-quran-range-engine/
│       ├── 23-group-schedules/
│       ├── 24-sessions/
│       │
│       ├── 25-smart-guard/
│       ├── 26-attendance/
│       ├── 27-memorization/
│       ├── 28-revision/
│       ├── 29-evaluations/
│       ├── 30-exams/
│       │
│       ├── 31-notifications-core/
│       ├── 32-notification-rules/
│       ├── 33-subscriptions/
│       ├── 34-payments-collection/
│       ├── 35-history-audit/
│       │
│       ├── 36-excel-import/
│       ├── 37-reports-core/
│       ├── 38-report-modules/
│       ├── 39-file-excel-access/
│       │
│       └── 40-integration-e2e/
│
├── database/
│   ├── migrations/
│   └── seeders/
│
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
│
├── docs/
│   ├── MASTER-SPECIFICATION.md
│   ├── ARCHITECTURE.md
│   ├── MODULE-MAP.md
│   ├── IMPLEMENTATION-STATUS.md
│   └── PROJECT-CHANGELOG.md
│
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
├── sequelize.config.*
└── README.md
```

The exact extension of configuration files may follow the chosen Sequelize/TypeScript setup, but consistency is mandatory.

* * *

# 10\. MODULE INTERNAL ARCHITECTURE

Every business module must follow:

```plaintext
Module
├── Domain
├── Application
├── Infrastructure
├── Presentation
└── Public
```

Recommended structure:

```plaintext
XX-module/
│
├── domain/
│   ├── entities/
│   ├── value-objects/
│   ├── services/
│   ├── events/
│   ├── repositories/
│   └── contracts/
│
├── application/
│   ├── use-cases/
│   ├── dto/
│   ├── services/
│   └── ports/
│
├── infrastructure/
│   ├── persistence/
│   │   └── sequelize/
│   │       ├── models/
│   │       ├── repositories/
│   │       └── mappers/
│   ├── services/
│   └── jobs/
│
├── presentation/
│   └── http/
│       ├── controllers/
│       ├── routes/
│       ├── validators/
│       └── serializers/
│
└── public/
    ├── contracts/
    ├── dto/
    └── events/
```

This structure is the implementation architecture.

* * *

# 11\. CLEAN ARCHITECTURE RULES

## Domain

Domain must contain business concepts.

Domain MUST NOT depend on:

-   Express

-   Sequelize

-   HTTP

-   controllers

-   infrastructure

-   database implementation

## Application

Application coordinates use cases.

Application depends on:

-   domain

-   ports

-   public contracts

Application must NOT contain HTTP-specific implementation.

## Infrastructure

Infrastructure implements:

-   repositories

-   Sequelize models

-   persistence

-   external services

-   queues

-   background jobs

-   storage

## Presentation

Presentation contains:

-   controllers

-   routes

-   HTTP validators

-   serializers

-   request/response mapping

Controllers must remain thin.

## Public

Public exposes only contracts required by other modules.

Other modules must NOT access private implementation.

* * *

# 12\. MODULE BOUNDARY RULES

A module may depend on another module only through:

-   Public Domain Contracts

-   Public Application Contracts

-   Public DTO Contracts

-   Public Events

A module MUST NOT depend on:

-   another module's private services

-   private repositories

-   internal Sequelize models

-   internal database tables

-   internal infrastructure

-   private helpers

No circular dependencies.

If two modules appear to require each other:

```plaintext
A → B
B → A
```

Do NOT create direct circular imports.

Instead:

-   move a generic abstraction to Shared Kernel when appropriate

-   use a public contract

-   use a domain event

-   restructure ownership

* * *

# 13\. OWNERSHIP RULE

Every business concept must have exactly one owning module.

Other modules may reference it.

They must not duplicate its business ownership.

Examples:

-   School belongs to Schools module.

-   Teacher belongs to Teachers module.

-   Student belongs to Students module.

-   Group belongs to Groups module.

-   Session belongs to Sessions module.

-   Attendance belongs to Attendance module.

-   Memorization belongs to Memorization module.

-   Subscription belongs to Subscriptions module.

-   Payment belongs to Payments module.

* * *

# 14\. DATABASE OWNERSHIP

Sequelize models are internal to their owning module.

Do NOT allow other modules to directly query another module's Sequelize models.

Do NOT allow other modules to directly depend on internal tables.

Cross-module data access must happen through:

-   public application contracts

-   public domain contracts

-   events

-   appropriate read/query contracts

Transactions must be abstracted.

Do not expose Sequelize transaction internals throughout the entire application.

* * *

# 15\. TRANSACTIONS

Multi-resource business operations must use transactions.

Important examples:

-   user + role assignment

-   school creation

-   sub-school approval

-   student/group changes

-   payment operations

-   Excel import

-   business action + outbox event

Excel import must be atomic.

If a critical failure happens:

```plaintext
ROLLBACK EVERYTHING
```

No partially imported dataset.

* * *

# 16\. DOMAIN EVENTS / OUTBOX

Business actions that require asynchronous side effects must use:

```plaintext
Business Action
↓
Domain Event
↓
Transactional Outbox
↓
Notification / Background Processing
```

The business transaction and outbox record must be committed atomically.

Notification delivery failure must never roll back an already successful business transaction.

Persistence is the source of truth.

Realtime delivery is not the source of truth.

* * *

# 17\. MASTER BUSINESS SPECIFICATION

## 17.1 SYSTEM TYPE

The system is a:

**Multi-School / Multi-Branch Quran School Management System**

V1 includes:

-   Main Organization

-   Schools / Branches

-   Main School / Sub-School

-   Geography

-   Address

-   Users

-   Authentication

-   Sessions

-   Roles

-   Permissions

-   Scopes

-   Ownership

-   Parents

-   Teachers

-   Students

-   Groups

-   Quran

-   Schedules

-   Sessions

-   Attendance

-   Memorization

-   Revision

-   Evaluations

-   Exams

-   Subscriptions

-   Payments

-   Notifications

-   Audit

-   Excel Import

-   Reports

-   File access

Competition is V2.

Do NOT implement Competition in V1.

* * *

# 18\. ROLES

V1 roles are EXACTLY:

```plaintext
Main Admin
Governorate Manager
Center Manager
Village Manager
School Manager
Teacher
Student
Parent
Subscription Collector
```

There is:

-   NO Supervisor role.

-   NO Competition Manager role.

Student is a business entity only in V1.

Student has:

-   no login

-   no password

-   no access token

-   no refresh token

-   no session

* * *

# 19\. MULTIPLE ROLES

A User may have multiple roles if identity/business rules allow it.

Example:

```plaintext
One User
├── Parent
└── Teacher
```

Role assignments must retain history:

```plaintext
assignedAt
assignedBy
revokedAt
revokedBy
```

A user must always have at least one active role.

Direct user-specific permissions are NOT used in V1.

Use RBAC.

* * *

# 20\. AUTHORIZATION MODEL

Authorization follows:

```plaintext
User
↓
Authentication
↓
Roles
↓
Permissions
↓
Scope
↓
Organization
↓
School
↓
Resource
↓
Ownership
↓
Action
↓
Business Rules
↓
Smart Guards
↓
ALLOW / REJECT
```

Frontend hiding is NOT authorization.

Reporting scope does NOT grant management permissions.

* * *

# 21\. USER IDENTITY

Login identifier:

```plaintext
Phone Number
```

One phone number can belong to only one User globally.

Phone numbers must be:

-   normalized

-   validated

-   canonicalized

-   uniquely constrained

Prefer E.164 representation.

Rules:

```plaintext
Same phone + same identity
→ reuse User

Same phone + different identity
→ conflict
→ NEVER automatic merge
```

* * *

# 22\. USER LIFECYCLE

```plaintext
ACTIVE
↓
INACTIVE
↓
ACTIVE
```

Deactivation:

-   is reversible

-   invalidates active sessions

-   blocks protected actions

-   preserves history

* * *

# 23\. PASSWORD POLICY

Password length:

```plaintext
4–12 characters
```

Allowed:

-   digits only

-   letters only

-   letters + digits

-   optionally special characters

No mandatory composition requirement.

Passwords must always be hashed.

Never store plaintext passwords.

* * *

# 24\. INITIAL PASSWORD

For parent creation:

```plaintext
Initial password = last 4 digits of phone number
```

Initial password does NOT force a password change.

System only recommends changing it.

* * *

# 25\. SESSION / JWT

Each authenticated session uses:

-   accessToken

-   refreshToken

Access token:

```plaintext
15 minutes
```

Refresh token:

```plaintext
30 days
```

Refresh tokens must be:

-   hashed

-   linked to user/session

-   expiration-aware

-   revocable

-   rotated

Refresh token reuse must be rejected.

Only one active session/device per User.

When the user logs in from another device:

```plaintext
Revoke old active session
↓
Create new active session
```

Support:

-   logout current session

-   logout all sessions

* * *

# 26\. FORGOT PASSWORD / OTP

Flow:

```plaintext
Phone
↓
Recovery Request
↓
OTP
↓
Verify
↓
New Password
```

Prevent account enumeration.

OTP:

```plaintext
6 digits
5 minutes validity
5 wrong attempts maximum
3 resends per hour maximum
5 OTP requests per 15 minutes per phone/IP combination
```

Every resend:

```plaintext
invalidate previous OTP
create new OTP
```

Successful password reset revokes existing sessions.

Never log:

-   plaintext OTP

-   plaintext refresh token

-   password

-   secrets

* * *

# 27\. ORGANIZATION / GEOGRAPHY

Hierarchy:

```plaintext
Country
↓
Governorate
↓
Center / City
↓
Village
↓
School
```

Geography is master data.

Used geography records must not be casually hard-deleted.

* * *

# 28\. UNIFIED ADDRESS

Format:

```plaintext
Governorate / Center or City / Village
```

Rules:

-   Governorate required.

-   Center optional.

-   Village optional.

-   Village cannot exist without Center.

Pipeline:

```plaintext
Raw
↓
Parse
↓
Normalize
↓
Validate Hierarchy
↓
Structured
↓
Persist
```

* * *

# 29\. SCHOOL

School supports:

```plaintext
Main School
Sub-School
```

Statuses:

```plaintext
PENDING
ACTIVE
INACTIVE
REJECTED
```

School code example:

```plaintext
SC-000001
```

Internal technical identifier should be UUID.

* * *

# 30\. SCHOOL CREATION

Main School creation includes:

-   school name

-   administrative address

-   physical GPS

-   organization

-   creator account

-   Main Admin relationship

-   School Manager relationship

GPS at creation becomes the official school center.

After approval:

```plaintext
Official GPS = immutable
```

No school move workflow exists in V1.

Geofence:

```plaintext
50 meters
```

GPS accuracy maximum:

```plaintext
20 meters
```

* * *

# 31\. SUB-SCHOOL WORKFLOW

```plaintext
PENDING
↓
Main Admin
├── APPROVE
└── REJECT
```

Rejection requires reason and notification.

Approval activates/creates the school account and School Manager according to the approved workflow.

* * *

# 32\. PARENT

Parent is User-based.

School Manager creates/reuses:

```plaintext
User
↓
Parent Role
↓
Parent Entity
```

Required:

-   three-part name

-   phone

-   unified address

One Parent can have multiple children.

Parent identity is globally reusable across schools.

* * *

# 33\. TEACHER

Teacher is User-based.

Structure:

```plaintext
User
+
Teacher Entity
+
Teacher Role
+
School Assignment
```

Teacher can belong to multiple schools.

Teacher can teach multiple groups.

Each group:

```plaintext
maximum one teacher
```

Teacher may temporarily have no group.

Teacher is NOT automatically School Manager.

Removing Teacher from a school removes only that school relationship.

Global teacher deactivation blocks teaching actions across schools but preserves history.

* * *

# 34\. TEACHER PHONE / PARENT PHONE COLLISION

If:

```plaintext
Teacher Phone == Parent Phone
```

and identity is the same:

```plaintext
Reuse the same User
Assign both roles
```

Do NOT create duplicate Users.

If identity conflicts:

```plaintext
Conflict
```

Never automatically merge.

* * *

# 35\. TEACHER SCHEDULE CONFLICT

Teacher schedule conflicts are checked globally across all schools assigned to that Teacher.

Example:

```plaintext
18:00–19:00
vs
18:30–19:30
```

Conflict.

But:

```plaintext
18:00–19:00
vs
19:00–20:00
```

No conflict.

* * *

# 36\. STUDENT

Student is NOT a User in V1.

Fields include:

-   Full Name

-   National ID

-   Parent

-   School

-   Group

-   Join Date

Exactly one Parent.

Group is optional.

One student can be assigned to only one group at a time.

Student can be unassigned.

* * *

# 37\. STUDENT NAME RULES

Student name must contain at least 3 parts.

Second name:

```plaintext
Parent First Name
```

Third name:

```plaintext
Parent Second Name
```

Normalize:

-   trim

-   collapse extra spaces

Student has no independent address.

Student current address is derived from Parent.

When Parent address changes:

```plaintext
linked students' current derived address changes
```

Historical information remains auditable.

* * *

# 38\. NATIONAL ID

National ID:

-   required

-   Egyptian

-   exactly 14 digits

National ID is the trusted Student identifier during Excel import.

Duplicate National ID in the same import:

```plaintext
Conflict
```

Existing student with different Parent:

```plaintext
Identity/Data Conflict
```

Never automatically move or replace the student.

School transfer is NOT supported in V1.

* * *

# 39\. STUDENT LIFECYCLE

Students with meaningful history should be:

-   deactivated

-   archived

rather than destructively deleted.

Group deletion/archive:

```plaintext
Students → Unassigned
```

Students are never deleted because of group deletion.

* * *

# 40\. GROUPS

Group belongs to exactly one School.

Fields include:

-   Group Name

-   Teacher

-   Students

-   Schedule

-   Learning Mode

-   Progression Direction

-   Starting Surah

Group name unique within the same School only.

Maximum one Teacher.

Teacher can teach multiple Groups.

* * *

# 41\. LEARNING MODE

Allowed:

```plaintext
GROUP
INDIVIDUAL
```

GROUP:

```plaintext
same session assignment
```

INDIVIDUAL:

```plaintext
student-specific assignment
```

Changing mode must NOT rewrite history.

New mode applies forward.

* * *

# 42\. PROGRESSION

Allowed:

```plaintext
FORWARD
BACKWARD
```

Changing progression affects new assignments only.

Historical assignments retain their original direction.

* * *

# 43\. STARTING SURAH

Starting Surah is required.

* * *

# 44\. GROUP SCHEDULE

Schedule is optional during configuration/import.

Structure:

```plaintext
Day of Week
Start Time
End Time
```

Multiple recurring schedule slots are allowed.

No overlapping teacher schedules.

Exact boundaries do not overlap.

* * *

# 45\. SESSION

Critical invariant:

> NO GROUP SCHEDULE = NO SESSION.

Sessions cannot be:

-   ad-hoc

-   manual

-   unscheduled

-   special

Session belongs to:

-   School

-   Group

-   Teacher

-   Group Schedule

-   Date/Time

Session lifecycle:

```plaintext
SCHEDULED
↓
OPEN
↓
IN_PROGRESS
↓
COMPLETED
```

or:

```plaintext
CANCELLED
```

Session time is derived from Group Schedule.

Teacher protected action window:

```plaintext
Session Start - 15 minutes
through
Session End
```

* * *

# 46\. QURAN STRUCTURE

Quran reference data contains:

-   Surahs

-   Ayahs

-   Pages/Faces

-   Lines

-   Juz

-   Hizb

-   Quarters

Canonical Quran ordering must support:

-   Surah

-   Ayah

-   Page/Face

-   Line

-   Quarter

-   global position

* * *

# 47\. QURAN RANGE ENGINE

Input:

```plaintext
Start Position
+
Unit
+
Amount
+
Direction
```

Units:

```plaintext
Ayahs
Lines
Pages/Faces
Quarters
```

Amount:

```plaintext
positive integer
```

Output:

```plaintext
End Position
+
Generated Range
```

Ranges may cross Surahs.

Direction:

```plaintext
FORWARD
BACKWARD
```

The engine must be deterministic and independently testable.

* * *

# 48\. MEMORIZATION

Memorization is separate from Revision.

Input:

```plaintext
Start
Unit
Amount
Direction
```

System calculates:

```plaintext
End
Range
```

A session may contain multiple valid memorization records.

Historical context must remain unchanged.

* * *

# 49\. REVISION

Revision uses the same Quran range engine.

Supported forms:

```plaintext
Start + Unit + Amount
```

or:

```plaintext
From Surah X
to Surah Y
```

Historical context must remain preserved.

* * *

# 50\. SMART GUARD

Protected Teacher actions must validate:

```plaintext
Authentication
↓
Permission
↓
Scope
↓
Ownership
↓
Correct Time
↓
Distance
↓
GPS Accuracy
↓
Business Rules
↓
ALLOW
```

Distance:

```plaintext
<= 50m
```

GPS accuracy:

```plaintext
<= 20m
```

If GPS is:

-   unavailable

-   denied

-   missing

-   invalid

-   inaccurate

then:

```plaintext
REJECT
```

No:

-   IP fallback

-   manual location

-   postal fallback

* * *

# 51\. ATTENDANCE

Statuses:

```plaintext
PRESENT
ABSENT
```

Unique:

```plaintext
Session + Student
Session + Teacher
```

Teacher may correct attendance during the same Session according to permissions.

School Manager may correct according to permissions.

Every correction must be audited.

History must never be silently overwritten.

* * *

# 52\. EVALUATIONS

Categories:

```plaintext
Memorization
Revision
Performance
Tajweed / Rules
```

Score:

```plaintext
0.00–10.00
```

Two decimal places.

Notes optional.

After Session completion:

```plaintext
Immutable
```

Authorized corrections require:

```plaintext
Authorization
+
Audit
```

* * *

# 53\. EXAMS

There is NO restriction of one exam per month.

School Manager may create any number of exams at any time.

Target:

-   one Group

-   multiple Groups

-   whole School

Fields:

-   Date

-   Start Time

-   optional End Time

-   target Groups

-   whole-school option

-   examiners

Examiner:

-   must be Teacher

-   must belong to same School

-   may differ from Group Teacher

-   multiple examiners allowed

Manager may change examiner assignments after start according to permissions.

Completed results remain unchanged.

* * *

# 54\. EXAM LIFECYCLE

```plaintext
DRAFT
↓
SCHEDULED
↓
STARTED
↓
COMPLETED
```

or:

```plaintext
CANCELLED
```

Draft/scheduled can be cancelled.

Started cancellation requires special Manager permission.

Completed cannot be cancelled.

* * *

# 55\. EXAM QUESTIONS

Exam defines:

```plaintext
Question Count
Max Score per Question
```

Examiner enters score per question.

Validation:

```plaintext
0 <= score <= max score
```

System calculates total.

Examiner sees only students not yet examined.

After result completion:

```plaintext
student removed from pending
```

* * *

# 56\. EXAM RESULT IMMUTABILITY

Before completion:

```plaintext
Authorized changes allowed
```

After completion:

```plaintext
Immutable
```

Correction requires:

```plaintext
Authorization
+
Audit
```

* * *

# 57\. EXAM NOTIFICATIONS

Required:

-   examiner assignment

-   exam created/assigned to parents

-   result immediately

-   reminder 24 hours before

* * *

# 58\. SUBSCRIPTIONS

Subscription represents:

```plaintext
Student + Month
```

Statuses:

```plaintext
PAID
UNPAID
WAIVED
```

Multiple unpaid months are allowed.

New student subscription amount is determined outside the system.

The system tracks only:

-   paid

-   unpaid

-   waived

No prorating.

* * *

# 59\. OLDEST UNPAID RULE

A newer month cannot be paid until all older months are:

```plaintext
PAID
or
WAIVED
```

No partial payments.

* * *

# 60\. PAYMENTS

Payment method:

```plaintext
CASH ONLY
```

Payment belongs to:

```plaintext
Student
+
School
+
Subscription
```

One successful payment per subscription.

Successful payment must never be hard-deleted.

Reversal requires:

-   reason

-   actor

-   timestamp

-   audit

* * *

# 61\. COLLECTION

Allowed:

-   School Manager

-   Subscription Collector

Subscription Collector:

-   assigned school scope

-   cannot waive in V1

Waiver is primarily School Manager responsibility.

* * *

# 62\. NOTIFICATIONS ARCHITECTURE

Use:

```plaintext
Business Action
↓
Domain Event
↓
Transactional Outbox
↓
Notification Service
↓
Locale Resolution
↓
Arabic / English Content
↓
Persistent Notification
↓
Realtime Delivery
```

Persistent notification is the source of truth.

Realtime failure must NOT lose notification.

Notification fields:

-   id

-   recipient

-   type

-   title

-   body

-   data

-   readAt

-   createdAt

Retention:

```plaintext
Indefinite
```

* * *

# 63\. REQUIRED NOTIFICATIONS

V1:

-   Sub-school approval

-   Sub-school rejection

-   Exam assignment

-   Exam created/assigned

-   Exam result

-   Group assignment change

-   Student assignment change

-   Exam reminder

No competition notifications.

* * *

# 64\. AUDIT / HISTORY

Audit is immutable.

Retention:

```plaintext
Indefinite
```

Fields:

```plaintext
actorUserId
action
module
entityType
entityId
before
after
ipAddress
userAgent
timestamp
```

Important audited actions include:

-   create

-   update

-   delete

-   activate

-   deactivate

-   role changes

-   permission changes

-   approval

-   rejection

-   payment

-   waiver

-   sensitive actions

-   corrections

Never log:

-   password

-   plaintext OTP

-   plaintext refresh token

-   secrets

* * *

# 65\. HISTORICAL RULE

Historical data must NEVER be silently rewritten.

Current relationships and historical relationships must remain distinguishable.

Example:

If Student was in:

```plaintext
Group A
```

and later moved to:

```plaintext
Group B
```

reports for old periods must still show:

```plaintext
Group A
```

not Group B.

* * *

# 66\. REPORTING

Reports must use historical context.

Periods:

### This Month

```plaintext
First day of current month
→ Now
```

### Last Month

```plaintext
Previous full calendar month
```

### Across Time

All historical data within authorized scope.

### Custom

Inclusive start/end.

Internally:

```plaintext
[start, end + 1 day)
```

* * *

# 67\. STUDENT REPORT START

Student report effective start:

```plaintext
MAX(Student Join Date, Requested Report Start)
```

Never report student data before joining date.

* * *

# 68\. REPORT TYPES

Reports include:

-   Student

-   Parent

-   Group

-   Teacher

-   School

-   Geographic

-   Attendance

-   Memorization

-   Revision

-   Evaluation

-   Performance

-   Payment

Parent reports include all linked children with separate context.

* * *

# 69\. CURRENT ASSIGNMENT REPORTING

Current assignment depends on Learning Mode.

GROUP:

```plaintext
Group assignment
```

INDIVIDUAL:

```plaintext
Student-specific assignment
```

* * *

# 70\. REPORT OUTPUT

APIs / JSON are primary.

Exports are NOT automatically part of reporting.

Report export requires explicit approval.

Report export is not generic file management.

* * *

# 71\. DATE / TIME

Database timestamps:

```plaintext
UTC
```

Business/display timezone:

```plaintext
Africa/Cairo
```

This applies to:

-   sessions

-   schedules

-   reminders

-   reports

-   Smart Guards

-   business dates

* * *

# 72\. BACKGROUND JOBS

Use BullMQ + Redis where required.

Approved use cases include:

-   OTP expiration

-   monthly subscriptions

-   exam reminders

-   outbox processing

-   notification processing

Jobs must NEVER invent business behavior.

* * *

# 73\. EXCEL FILE INFRASTRUCTURE

V1 supports Excel only:

```plaintext
.xlsx
```

Maximum:

```plaintext
10 MB
10,000 rows
```

Files are private by default.

No generic:

-   PDF management

-   certificate management

unless explicitly approved later.

* * *

# 74\. EXCEL IMPORT

Import pipeline:

```plaintext
Upload
↓
Parse
↓
Normalize
↓
Address Validation
↓
National ID Matching
↓
Parent Matching
↓
Teacher Matching
↓
Group Matching
↓
Duplicate Detection
↓
Conflict Detection
↓
Business Validation
↓
Preview
↓
Explicit Confirmation
↓
Transaction
↓
Create / Reuse
↓
Relationships
↓
Commit
```

Critical error:

```plaintext
ROLLBACK
```

* * *

# 75\. EXCEL FIELDS

Required:

```plaintext
1. Student Full Name *
2. Student National ID *
3. Parent Full Name *
4. Parent Phone *
5. Parent Address *
6. Group Name *
7. Teacher Name *
8. Teacher Phone *
9. Learning Mode *
10. Progression Direction *
11. Starting Surah *
12. Group Schedule (optional)
```

There is NO Student Address column.

* * *

# 76\. EXCEL IDENTITY MATCHING

Student:

```plaintext
National ID
```

Parent:

```plaintext
Phone + Identity
```

Teacher:

```plaintext
Phone + Identity
```

Same phone + same identity:

```plaintext
Reuse
```

Same phone + different identity:

```plaintext
Conflict
```

Never silently replace.

* * *

# 77\. EXCEL CONFLICTS

Examples:

-   duplicate student ID

-   existing student with different parent

-   existing group with different teacher

-   teacher schedule overlap

-   invalid student name

-   invalid address

-   invalid learning mode

-   invalid progression direction

-   invalid starting Surah

No silent replacement.

* * *

# 78\. EXCEL PREVIEW

Preview must show:

-   new users

-   existing users

-   new students

-   existing students

-   new parents

-   existing parents

-   new teachers

-   existing teachers

-   new groups

-   warnings

-   conflicts

-   errors

User must explicitly confirm before commit.

Errors require:

-   stable error code

-   Arabic message

-   English message

* * *

# 79\. FILE ACCESS

Files are private by default.

File access must validate:

```plaintext
Authentication
+
Permission
+
Scope
+
Ownership
+
Visibility
```

No direct public file URLs for private resources.

* * *

# 80\. MODULE MAP

Implement exactly these 41 modules:

```plaintext
00 Shared Kernel
01 Configuration & Environment
02 Database & Transaction Infrastructure
03 Error & Localization
04 Validation & API Standards
05 Logging & Request Context
06 Domain Events & Transactional Outbox
07 File Infrastructure

08 Identity Core
09 Roles & Permissions
10 Sessions & JWT
11 OTP & Password Recovery
12 Authorization Engine

13 Organization Core
14 Geography
15 Unified Address
16 Schools

17 Parents
18 Teachers
19 Students

20 Groups
21 Quran Structure
22 Quran Position & Range Engine
23 Group Schedules
24 Sessions

25 Smart Guard
26 Attendance
27 Memorization
28 Revision
29 Evaluations
30 Exams

31 Notifications Core
32 Notification Rules
33 Subscriptions
34 Payments & Collection
35 History & Audit

36 Excel Import
37 Reports Core
38 Report Modules
39 File / Excel Access Control

40 Integration & E2E
```

Competition is not included.

* * *

# 81\. MODULE DEPENDENCIES

## 00

No dependencies.

## 01

Depends on 00.

## 02

Depends on 00, 01.

## 03

Depends on 00, 01.

## 04

Depends on 03.

## 05

Depends on 00, 03.

## 06

Depends on 02, 05.

## 07

Depends on 00, 01.

## 08

Depends on 02, 03, 04, 05.

## 09

Depends on 08.

## 10

Depends on 08, 09.

## 11

Depends on 08, 10, 03.

## 12

Depends on 08, 09, 10.

## 13

Depends on 02, 06.

## 14

Depends on 13.

## 15

Depends on 14.

## 16

Depends on 12, 13, 14, 15, 06.

## 17

Depends on 08, 12, 15, 16.

## 18

Depends on 08, 12, 16.

Schedule conflict ownership remains in Module 23.

## 19

Depends on 17, 16, 12.

## 20

Depends on 16, 18, 19, 12.

## 21

Depends on 02.

## 22

Depends on 21.

## 23

Depends on 18, 20, 12.

## 24

Depends on 20, 23, 22, 18, 16.

## 25

Depends on 12, 16, 23, 24.

## 26

Depends on 24, 25, 19.

## 27

Depends on 22, 24, 25.

## 28

Depends on 22, 24, 25.

## 29

Depends on 24, 27, 28, 25.

## 30

Depends on 18, 19, 20, 25.

## 31

Depends on 06, 03.

## 32

Depends on 31, 06.

## 33

Depends on 19, 16, 12.

## 34

Depends on 33, 12, 16, 19.

## 35

Depends on 06, 05.

## 36

Depends on 07, 15, 17, 18, 19, 20, 12, 02.

## 37

Depends on 35, 12, 02.

## 38

Depends on 37, 26, 27, 28, 29, 30, 33, 34, 35.

## 39

Depends on 07, 12, 36.

## 40

Depends on all required modules for final integration.

* * *

# 82\. IMPLEMENTATION ORDER

Implement in this exact order.

## PHASE 1 — FOUNDATION

```plaintext
00
01
02
03
04
05
06
07
```

## PHASE 2 — SECURITY

```plaintext
08
09
10
11
12
```

## PHASE 3 — ORGANIZATION

```plaintext
13
14
15
16
```

## PHASE 4 — PEOPLE

```plaintext
17
18
19
```

## PHASE 5 — EDUCATIONAL STRUCTURE

```plaintext
20
21
22
23
24
```

## PHASE 6 — PROTECTED EDUCATIONAL OPERATIONS

```plaintext
25
26
27
28
29
30
```

## PHASE 7 — NOTIFICATIONS / HISTORY

```plaintext
31
32
35
```

## PHASE 8 — FINANCIAL

```plaintext
33
34
```

## PHASE 9 — IMPORT / REPORTING / FILE ACCESS

```plaintext
36
37
38
39
```

## PHASE 10 — FINAL INTEGRATION

```plaintext
40
```

* * *

# 83\. MODULE IMPLEMENTATION PROCESS

Before implementing each module, analyze:

```plaintext
1. Requirements
2. Business Logic
3. Roles
4. Permissions
5. Scope
6. Ownership
7. Validation
8. Workflow
9. Smart Guards
10. Domain Events
11. Notifications
12. Historical Rules
13. Reporting Requirements
14. Domain Model
15. Database Design
16. Application Use Cases
17. API Design
18. Implementation
19. Authorization
20. Tests
21. Documentation
```

Do not skip these because another module already exists.

Cross-module dependencies must be checked before implementation.

* * *

# 84\. MODULE COMPLETION CRITERIA

A module is NOT complete merely because its code compiles.

A module is complete only when:

-   business responsibility is implemented

-   public contracts exist where needed

-   roles are enforced

-   permissions are enforced

-   scope is enforced

-   ownership is enforced

-   validation exists

-   transactions are correct

-   domain events are correct

-   history is preserved

-   audit is implemented where required

-   localization exists

-   tests exist

-   documentation exists

-   API behavior is documented

-   module boundaries are respected

* * *

# 85\. TESTING

Every module must have appropriate:

-   Unit tests

-   Application/use-case tests

-   Integration tests

-   Authorization tests

-   Business rule tests

-   Validation tests

Critical workflows require E2E tests.

Tests must cover at least:

### IAM

-   login

-   password

-   refresh

-   logout

-   session replacement

-   OTP

-   password recovery

-   role lifecycle

-   authorization

### Organization

-   organization

-   geography

-   addresses

-   schools

-   sub-school approval/rejection

### People

-   parents

-   teachers

-   students

-   identity matching

### Education

-   groups

-   schedules

-   sessions

-   Quran range engine

-   attendance

-   memorization

-   revision

-   evaluation

-   exams

### Finance

-   subscriptions

-   oldest unpaid rule

-   payments

-   waiver

-   reversal

### Import

-   parsing

-   normalization

-   duplicates

-   conflicts

-   rollback

-   preview

-   confirmation

### Notifications

-   events

-   persistence

-   localization

-   realtime failure behavior

### Reports

-   date periods

-   historical relationships

-   scope

-   join date

### Audit

-   important actions

-   corrections

-   immutable history

Competition tests must NOT be added.

* * *

# 86\. SECURITY RULES

Never:

-   store plaintext passwords

-   store plaintext OTP

-   store plaintext refresh tokens

-   expose secrets

-   expose private files

-   trust frontend authorization

-   trust client-provided ownership

-   trust client-provided school scope

-   allow arbitrary query fields

-   allow arbitrary sorting

-   leak account existence during password recovery

-   silently merge identities

Validate every protected action on backend.

* * *

# 87\. ERROR HANDLING

Use centralized error handling.

Errors should provide:

```plaintext
errorCode
message
locale
requestId
```

Where applicable.

Business errors must use stable codes.

Do not expose:

-   SQL errors

-   stack traces

-   secrets

-   internal infrastructure details

to normal production API clients.

* * *

# 88\. API DESIGN RULES

Use:

-   RESTful resource naming

-   explicit DTOs

-   validation

-   pagination

-   sorting whitelist

-   filtering whitelist

-   standardized success responses

-   standardized error responses

Do not expose Sequelize models directly.

Do not return domain entities directly from controllers.

Use serializers / DTO mapping.

* * *

# 89\. DATABASE RULES

Use Sequelize migrations.

Do not rely on `sync({ alter: true })` as production schema management.

Use migrations for schema evolution.

Use indexes and unique constraints for true invariants where appropriate.

Database constraints should reinforce business invariants, but business logic must also be enforced at application level.

* * *

# 90\. SEED DATA

Create only necessary development/reference seed data.

Do not create fake business data unless explicitly needed for tests.

Quran reference data must be treated as authoritative project reference data.

Do not invent Quran content.

* * *

# 91\. DOCUMENTATION

Maintain:

```plaintext
docs/MASTER-SPECIFICATION.md
docs/ARCHITECTURE.md
docs/MODULE-MAP.md
docs/IMPLEMENTATION-STATUS.md
docs/PROJECT-CHANGELOG.md
README.md
```

Documentation must remain synchronized with implementation.

* * *

# 92\. PROJECT CHANGE SUMMARY

After every significant implementation change, update the Markdown project-change summary.

It must contain:

```plaintext
Architecture
Implemented Modules
Business Rules
Roles
Permissions
Scopes
Ownership
Workflows
Decisions
Database Changes
API Changes
Dependencies
Environment Changes
Constraints
Remaining Work
Tests
```

Do not allow documentation to become stale.

* * *

# 93\. MASTER SPECIFICATION CHANGE CONTROL

If a new requirement is introduced:

```plaintext
New Requirement
↓
Define
↓
Discuss
↓
Approve
↓
Update Master Specification
↓
Update Module Map if necessary
↓
Implement
↓
Test
↓
Document
```

Never implement an unapproved behavior change.

* * *

# 94\. INITIAL PROJECT BOOTSTRAP

Before implementing business modules:

1.  Create the project structure.

2.  Initialize TypeScript.

3.  Configure strict mode.

4.  Configure Node/Express.

5.  Configure Sequelize/MySQL.

6.  Configure dotenv.

7.  Configure CORS.

8.  Configure JWT dependencies.

9.  Configure bcryptjs.

10.  Configure express-validator.

11.  Configure nodemon/tsx.

12.  Configure sequelize-cli.

13.  Add BullMQ/Redis dependencies only where needed.

14.  Create environment configuration.

15.  Create `.env.example`.

16.  Create base application bootstrap.

17.  Create base HTTP server.

18.  Create health endpoint.

19.  Create module directories.

20.  Create architecture documentation.

21.  Create testing infrastructure.

22.  Make sure the server can start.

Do NOT implement module business logic during this bootstrap stage.

The bootstrap stage is architecture/setup only.

* * *

# 95\. DO NOT PREMATURELY IMPLEMENT FUTURE MODULES

Do not create fake implementations for modules that have not reached their phase.

Create their structural folders if required by the architecture, but do not invent business logic.

When a module's phase begins, implement it fully.

* * *

# 96\. CROSS-MODULE INTEGRATION

When implementing a module:

-   reuse existing public contracts

-   reuse existing events

-   reuse shared authorization infrastructure

-   reuse transaction abstraction

-   reuse localization

-   reuse request context

-   reuse audit/history mechanisms

Do not duplicate existing infrastructure.

* * *

# 97\. SELECTIVE CQRS

Use CQRS only where useful.

Good candidates:

-   Reports

-   complex read-heavy queries

-   historical aggregations

-   dashboards/read models

Do NOT create separate command/query infrastructure for every CRUD operation without justification.

* * *

# 98\. PERFORMANCE

Use appropriate:

-   database indexes

-   pagination

-   efficient queries

-   eager/lazy loading deliberately

-   batching where useful

-   background jobs for expensive asynchronous work

Avoid:

-   N+1 queries

-   unbounded queries

-   loading entire tables unnecessarily

* * *

# 99\. CODE QUALITY

Code must be:

-   TypeScript strict

-   strongly typed

-   readable

-   cohesive

-   modular

-   testable

-   maintainable

Avoid:

-   `any` unless genuinely unavoidable and documented

-   giant controllers

-   giant services

-   god classes

-   duplicated business logic

-   circular dependencies

-   hidden side effects

-   magic values

* * *

# 100\. DOMAIN LOGIC LOCATION

Business rules must live in the appropriate Domain/Application layer.

Do NOT place important business rules only inside:

-   controllers

-   Sequelize hooks

-   routes

-   frontend

-   random utility functions

Database constraints may reinforce invariants but must not be the only place a business rule exists.

* * *

# 101\. SMART GUARD OWNERSHIP

Smart Guard is reusable infrastructure.

It does NOT own:

-   attendance business logic

-   memorization business logic

-   revision business logic

-   evaluation business logic

Protected modules invoke Smart Guard before executing protected actions.

* * *

# 102\. REPORT OWNERSHIP

Reports are read models / projections over business data.

Reports are NOT the source of truth.

Business modules own business records.

Reports read them according to historical rules and authorized scope.

* * *

# 103\. HISTORY OWNERSHIP

Historical information must be available without mutating current business state.

If a relationship changes, retain:

-   previous state

-   new state

-   actor

-   timestamp

-   reason where applicable

* * *

# 104\. NO SILENT DATA LOSS

Never silently:

-   delete history

-   overwrite identity

-   merge users

-   move students

-   replace teachers

-   alter old assignments

-   alter completed exam results

-   alter completed session evaluations

-   remove payment history

If destructive behavior is not explicitly defined:

```plaintext
STOP
ASK
```

* * *

# 105\. V1 EXCLUSIONS

Do NOT implement:

-   Competition

-   Competition Manager

-   Student login

-   Student password

-   Student session

-   arbitrary ad-hoc sessions

-   school move workflow

-   generic PDF management

-   generic certificate management

-   partial payments

-   automatic identity merging

-   automatic school transfer

-   direct user-specific permissions

unless explicitly approved later.

* * *

# 106\. FINAL INTEGRATION MODULE

Module 40 is responsible for final integration and E2E verification.

It must NOT introduce new business logic.

It verifies:

-   module integration

-   authorization chains

-   event flow

-   outbox flow

-   notification flow

-   historical reporting

-   Excel import

-   financial flows

-   Smart Guard

-   session constraints

-   final API behavior

-   final security boundaries

* * *

# 107\. FINAL PROJECT QUALITY GATE

Before declaring the project complete:

### Architecture

-   no circular module dependencies

-   no private cross-module imports

-   clean architecture respected

-   module ownership respected

### Security

-   authentication works

-   authorization works

-   scope works

-   ownership works

-   sessions work

-   refresh rotation works

-   OTP limits work

-   secrets protected

### Business

-   approved rules implemented

-   no invented rules

-   no silent data mutation

### Database

-   migrations work

-   constraints work

-   indexes appropriate

-   transactions correct

### API

-   validation works

-   pagination works

-   error handling works

-   localization works

-   request IDs work

### Events

-   domain events work

-   outbox works

-   transactionality works

### Notifications

-   persistent notifications work

-   localized notifications work

-   realtime is secondary to persistence

### History

-   audit works

-   historical relationships work

### Tests

-   unit tests pass

-   integration tests pass

-   E2E tests pass

### Documentation

-   README complete

-   architecture documented

-   module map documented

-   implementation status updated

-   project changelog updated

-   master specification synchronized

* * *

# 108\. ENVIRONMENT FILE

Provide:

```plaintext
.env.example
```

It must contain placeholders only.

Never commit real credentials.

Examples of configuration categories:

```plaintext
NODE_ENV
PORT
DATABASE_HOST
DATABASE_PORT
DATABASE_NAME
DATABASE_USER
DATABASE_PASSWORD

JWT_ACCESS_SECRET
JWT_REFRESH_SECRET

REDIS_HOST
REDIS_PORT

APP_TIMEZONE
DEFAULT_LOCALE

FILE_STORAGE_PATH
MAX_FILE_SIZE
```

Use appropriate naming based on implementation.

* * *

# 109\. README

README must explain:

-   project purpose

-   architecture

-   stack

-   setup

-   environment variables

-   database setup

-   migrations

-   seeders

-   development server

-   test commands

-   build commands

-   module architecture

-   module implementation status

-   API base path

-   localization

-   background jobs

-   final project structure

* * *

# 110\. CLAUDE WORKING RULES

While implementing:

1.  Read the existing repository before changing it.

2.  Never destroy existing correct work.

3.  Never duplicate functionality unnecessarily.

4.  Check dependencies before creating code.

5.  Keep module boundaries strict.

6.  Keep business logic traceable.

7.  Keep migrations synchronized.

8.  Add tests with implementation.

9.  Update documentation with implementation.

10.  Never silently change business behavior.

11.  Never skip authorization because frontend will handle it.

12.  Never expose internal infrastructure through APIs.

13.  Never introduce a dependency without justification.

14.  Never create circular imports.

15.  Never create fake implementations simply to satisfy compilation.

16.  Never mark a module complete if its tests/business rules are incomplete.

* * *

# 111\. HOW TO HANDLE AMBIGUITY

There are two types of ambiguity.

## Technical ambiguity

You may choose a technically sound implementation.

Example:

-   internal class naming

-   repository naming

-   exact serializer implementation

-   logger library configuration

provided it does not change business behavior.

## Business ambiguity

STOP and ask.

Example:

-   who may perform an action

-   whether a record can be deleted

-   whether a status transition is allowed

-   whether historical data changes

-   whether a role gets permission

-   whether a notification is required

-   whether a workflow has an exception

Never invent these.

* * *

# 112\. IMPLEMENTATION STYLE

Implement each module completely before moving to the next phase.

For each module:

```plaintext
Analyze
↓
Design
↓
Implement
↓
Migrate
↓
Test
↓
Integrate
↓
Document
↓
Verify
↓
Mark Complete
```

Do not implement random modules out of order unless required by an explicit dependency and the user approves the deviation.

* * *

# 113\. PROJECT STATUS

Maintain:

```plaintext
docs/IMPLEMENTATION-STATUS.md
```

Each module must have a status such as:

```plaintext
NOT_STARTED
IN_PROGRESS
IMPLEMENTED
TESTED
COMPLETED
```

Do not mark a module COMPLETED until its completion criteria are satisfied.

* * *

# 114\. FINAL DELIVERY

When the entire system is complete:

1.  Run dependency installation verification.

2.  Run TypeScript typecheck.

3.  Run lint if configured.

4.  Run unit tests.

5.  Run integration tests.

6.  Run E2E tests.

7.  Run database migration verification.

8.  Verify application startup.

9.  Verify production build.

10.  Review module boundaries.

11.  Review secrets.

12.  Remove unnecessary temporary files.

13.  Do NOT include:

-   `node_modules`

-   real `.env`

-   logs

-   temporary files

-   unnecessary build artifacts

14.  Include:

-   source code

-   tests

-   migrations

-   seeders

-   docs

-   configuration

-   `.env.example`

-   README

-   package files

15.  Create:

```plaintext
Quran-School-Management-System.zip
```

The ZIP must represent the complete project.

If the environment does not support attaching the ZIP directly, create it in the project workspace and report its exact filesystem path.

* * *

# 115\. FINAL IMPORTANT INSTRUCTION

This entire document is the authoritative specification.

You are NOT allowed to:

-   invent business rules

-   remove approved rules

-   simplify approved workflows

-   change roles

-   create unauthorized roles

-   create unauthorized permissions

-   create student authentication

-   introduce Competition in V1

-   weaken backend authorization

-   bypass Smart Guard

-   rewrite history

-   silently merge identities

-   silently move students

-   silently alter completed records

-   create unscheduled sessions

-   violate module boundaries

If a required business decision is missing:

```plaintext
STOP
ASK THE USER
WAIT FOR APPROVAL
UPDATE DOCUMENTATION
THEN IMPLEMENT
```

Otherwise, proceed independently with the technical implementation.

* * *

# 116\. FIRST ACTION

When starting from an empty/new repository:

FIRST perform only the project bootstrap:

```plaintext
Create architecture
Create folders
Initialize TypeScript
Initialize Express
Configure Sequelize/MySQL
Configure environment handling
Configure base middleware
Configure request context
Configure error foundation
Configure testing foundation
Configure migration foundation
Configure health endpoint
Install required packages
Create documentation foundation
```

Do NOT implement business modules during the initial bootstrap.

After bootstrap is verified, begin:

```plaintext
MODULE 00
```

and continue according to the exact implementation order.

The final objective is a complete production-oriented Quran School Management System implemented in ONE repository, with all 41 modules integrated under the architecture and rules defined above.