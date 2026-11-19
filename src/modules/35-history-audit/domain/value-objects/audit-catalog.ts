import type { AuditAction } from './audit-action';

export interface AuditedEvent {
  /** The module label stored in the audit record (`module`). */
  readonly module: string;
  readonly action: AuditAction;
}

/**
 * The domain events that become audit records (allow-list: an event not listed here is NOT audited, so a future event never leaks into the audit trail by accident).
 * Master Specification §64: create, update, delete, activate, deactivate, role changes, permission changes, approval, rejection, payment, waiver, historical
 * relationships, scope, join date; corrections ("Every correction must be audited").
 *
 * Deliberately NOT audited:
 *  - `EvaluationScoresUpdated`: approved Module 29 amendment (§64): evaluation score modifications are not audited and no previous value is kept.
 *  - `AuthSessionStarted`, `AuthSessionRevoked`: sign-in/sign-out telemetry, not in §64 (the request log covers it).
 *  - Operational per-session records and lifecycle ticks (`ClassSessionCreated/Started/Completed`, `AttendanceRecorded`, `MemorizationRecorded`, `RevisionRecorded`,
 *    `EvaluationRecorded`, `ExamStarted/Completed/Ended`): high-volume daily data that is itself the record. Their CORRECTIONS are audited.
 * Adding or removing a line here is the whole change needed to audit another event (a unit test checks every listed name really exists in a module's events).
 */
export const AUDITED_EVENTS: Readonly<Record<string, AuditedEvent>> = Object.freeze({
  // identity and roles (08, 09, 11)
  UserCreated: { module: 'identity', action: 'CREATE' },
  UserDeactivated: { module: 'identity', action: 'DEACTIVATE' },
  UserActivated: { module: 'identity', action: 'ACTIVATE' },
  UserPasswordChanged: { module: 'identity', action: 'UPDATE' },
  PasswordResetCompleted: { module: 'identity', action: 'UPDATE' },
  RoleAssigned: { module: 'roles', action: 'ROLE_CHANGE' },
  RoleRevoked: { module: 'roles', action: 'ROLE_CHANGE' },
  // organizations and schools (13, 16)
  OrganizationCreated: { module: 'organizations', action: 'CREATE' },
  OrganizationCountryAssigned: { module: 'organizations', action: 'UPDATE' },
  OrganizationAdminAssigned: { module: 'organizations', action: 'RELATIONSHIP_CHANGE' },
  SchoolCreated: { module: 'schools', action: 'CREATE' },
  SchoolApproved: { module: 'schools', action: 'APPROVE' },
  SchoolRejected: { module: 'schools', action: 'REJECT' },
  SchoolDeactivated: { module: 'schools', action: 'DEACTIVATE' },
  SchoolReactivated: { module: 'schools', action: 'ACTIVATE' },
  SchoolGpsCorrected: { module: 'schools', action: 'CORRECTION' },
  SchoolManagerAssigned: { module: 'schools', action: 'RELATIONSHIP_CHANGE' },
  SchoolManagerRevoked: { module: 'schools', action: 'RELATIONSHIP_CHANGE' },
  // people (17, 18, 19)
  ParentRegistered: { module: 'parents', action: 'CREATE' },
  ParentAddressChanged: { module: 'parents', action: 'UPDATE' },
  ParentSchoolLinked: { module: 'parents', action: 'RELATIONSHIP_CHANGE' },
  ParentSchoolLinkRemoved: { module: 'parents', action: 'RELATIONSHIP_CHANGE' },
  TeacherRegistered: { module: 'teachers', action: 'CREATE' },
  TeacherSchoolLinked: { module: 'teachers', action: 'RELATIONSHIP_CHANGE' },
  TeacherSchoolLinkRemoved: { module: 'teachers', action: 'RELATIONSHIP_CHANGE' },
  StudentRegistered: { module: 'students', action: 'CREATE' },
  StudentUpdated: { module: 'students', action: 'UPDATE' },
  StudentStatusChanged: { module: 'students', action: 'STATUS_CHANGE' },
  // groups, schedules, sessions (20, 23, 24)
  GroupCreated: { module: 'groups', action: 'CREATE' },
  GroupUpdated: { module: 'groups', action: 'UPDATE' },
  GroupTeacherChanged: { module: 'groups', action: 'RELATIONSHIP_CHANGE' },
  GroupArchived: { module: 'groups', action: 'STATUS_CHANGE' },
  GroupStudentAssigned: { module: 'groups', action: 'RELATIONSHIP_CHANGE' },
  GroupStudentUnassigned: { module: 'groups', action: 'RELATIONSHIP_CHANGE' },
  GroupScheduleSlotCreated: { module: 'schedules', action: 'CREATE' },
  GroupScheduleSlotRetired: { module: 'schedules', action: 'STATUS_CHANGE' },
  ClassSessionCancelled: { module: 'sessions', action: 'STATUS_CHANGE' },
  // attendance, memorization, revision (26, 27, 28): corrections and assignment changes
  AttendanceCorrected: { module: 'attendance', action: 'CORRECTION' },
  MemorizationAssignmentDefined: { module: 'memorization', action: 'CREATE' },
  MemorizationAssignmentModified: { module: 'memorization', action: 'UPDATE' },
  MemorizationAssignmentCancelled: { module: 'memorization', action: 'STATUS_CHANGE' },
  MemorizationRecordCorrected: { module: 'memorization', action: 'CORRECTION' },
  RevisionAssignmentDefined: { module: 'revision', action: 'CREATE' },
  RevisionAssignmentModified: { module: 'revision', action: 'UPDATE' },
  RevisionAssignmentCancelled: { module: 'revision', action: 'STATUS_CHANGE' },
  RevisionRecordCorrected: { module: 'revision', action: 'CORRECTION' },
  // exams (30)
  ExamScheduled: { module: 'exams', action: 'CREATE' },
  ExamUpdated: { module: 'exams', action: 'UPDATE' },
  ExamCancelled: { module: 'exams', action: 'STATUS_CHANGE' },
  ExamDeleted: { module: 'exams', action: 'DELETE' },
  ExamEndTimeChanged: { module: 'exams', action: 'UPDATE' },
  ExamExaminerAssigned: { module: 'exams', action: 'RELATIONSHIP_CHANGE' },
  ExamExaminerRemoved: { module: 'exams', action: 'RELATIONSHIP_CHANGE' },
  ExamStudentTargeted: { module: 'exams', action: 'RELATIONSHIP_CHANGE' },
  ExamStudentUntargeted: { module: 'exams', action: 'RELATIONSHIP_CHANGE' },
  ExamResultRecorded: { module: 'exams', action: 'CREATE' },
  // subscriptions and collectors (33)
  SubscriptionsCreated: { module: 'subscriptions', action: 'CREATE' },
  SubscriptionCreated: { module: 'subscriptions', action: 'CREATE' },
  SubscriptionPaid: { module: 'subscriptions', action: 'PAYMENT' },
  SubscriptionWaived: { module: 'subscriptions', action: 'WAIVER' },
  SubscriptionMarkedUnpaid: { module: 'subscriptions', action: 'PAYMENT' },
  // payments (34): the payment itself (the subscription status change is audited above)
  PaymentRecorded: { module: 'payments', action: 'PAYMENT' },
  PaymentReversed: { module: 'payments', action: 'PAYMENT' },
  CollectorSchoolLinked: { module: 'subscriptions', action: 'RELATIONSHIP_CHANGE' },
  CollectorSchoolLinkRemoved: { module: 'subscriptions', action: 'RELATIONSHIP_CHANGE' },
});

export const AUDITED_EVENT_TYPES: readonly string[] = Object.freeze(Object.keys(AUDITED_EVENTS));
