import type { TransactionContext } from '../../../00-shared-kernel/public';
import type { ReminderKind, ReminderState } from '../../domain/value-objects/reminder-rules';

export type ExamAudienceRole = 'STUDENT' | 'EXAMINER';

export interface ReminderRecord {
  readonly id: string;
  readonly kind: ReminderKind;
  /** The exam id (EXAM_24H) or the class session id (the session reminders). */
  readonly subjectId: string;
  readonly dueAt: Date;
  readonly state: ReminderState;
  readonly attempts: number;
}

export interface ClaimDueParams {
  readonly claimId: string;
  readonly now: Date;
  readonly lockUntil: Date;
  readonly limit: number;
}

/**
 * Persistence of Module 32 (its own tables only: `notification_reminders` and `notification_exam_targets`).
 *  - Reminders: ONE row per (kind, subject). A row is created when the subject appears (an exam is scheduled, a session is generated), moved when its time changes,
 *    suppressed when the subject is cancelled or over, and claimed by the worker when due (the claim is a lock, so two instances never process the same row at once).
 *  - Exam audience: the students (role STUDENT) and the examiners' Teacher ids (role EXAMINER) Module 32 has told about an exam, a snapshot kept up to date by the exam events, so that
 *    a change of targets can tell the parents who were removed, and a cancellation or deletion can reach the parents and examiners of an exam that is no longer live.
 *    It is Module 32's own record of who it notified, never a copy of Module 30's data.
 */
export interface RuleStateRepository {
  /**
   * Creates the reminder, or MOVES it when the due time changed (state back to PENDING, attempts reset). The same due time again changes nothing, so a redelivered event
   * never revives a reminder that was already sent or suppressed.
   */
  upsertReminder(kind: ReminderKind, subjectId: string, dueAt: Date, now: Date, tx?: TransactionContext): Promise<void>;
  /** PENDING reminders of the subject become SUPPRESSED (a cancelled exam, a cancelled or finished session). Returns how many were suppressed. */
  suppressPending(subjectId: string, kinds: readonly ReminderKind[], now: Date, tx?: TransactionContext): Promise<number>;
  findReminder(kind: ReminderKind, subjectId: string, tx?: TransactionContext): Promise<ReminderRecord | undefined>;

  /** Locks the due PENDING reminders (oldest due first) for this pass and returns them. */
  claimDue(p: ClaimDueParams): Promise<ReminderRecord[]>;
  complete(id: string, state: 'SENT' | 'SUPPRESSED', now: Date): Promise<void>;
  /** Puts it back to PENDING at another time (the session has not started yet; the exam start moved). */
  postpone(id: string, dueAt: Date, now: Date): Promise<void>;
  /** A technical failure: `nextDueAt` retries it later, null gives up (FAILED). */
  recordFailure(id: string, attempts: number, nextDueAt: Date | null, error: string, now: Date): Promise<void>;

  replaceExamAudience(examId: string, role: ExamAudienceRole, ids: readonly string[], now: Date, tx?: TransactionContext): Promise<void>;
  addExamAudience(examId: string, role: ExamAudienceRole, id: string, now: Date, tx?: TransactionContext): Promise<void>;
  removeExamAudience(examId: string, role: ExamAudienceRole, id: string, tx?: TransactionContext): Promise<void>;
  listExamAudience(examId: string, role: ExamAudienceRole, tx?: TransactionContext): Promise<string[]>;
  /** Both roles: the exam is over for notification purposes (cancelled, deleted or ended). */
  clearExamAudience(examId: string, tx?: TransactionContext): Promise<void>;
}
