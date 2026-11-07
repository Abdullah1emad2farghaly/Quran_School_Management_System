import { newUuid } from '../../../00-shared-kernel/public';
import { dedupKeys } from '../../domain/value-objects/dedup-keys';
import { formatCairoDateTime } from '../../domain/value-objects/message-format';
import { REMINDER_KINDS, REMINDER_LIMITS, examReminderDueAt, reminderRetryDelayMs, sessionPhaseOf } from '../../domain/value-objects/reminder-rules';
import type { ReminderRecord } from '../ports/rule-state-repository';
import { TEMPLATE_KEYS } from './rule-templates';
import { notifyParentsOf, notifyTeacher, type RuleDeps } from './rule-support';

export interface ReminderPassResult {
  readonly sent: number;
  readonly suppressed: number;
  readonly postponed: number;
  readonly retried: number;
  readonly failed: number;
}

type Outcome = { readonly kind: 'SENT' } | { readonly kind: 'SUPPRESSED' } | { readonly kind: 'POSTPONE'; readonly dueAt: Date };
const SENT: Outcome = { kind: 'SENT' };
const SUPPRESSED: Outcome = { kind: 'SUPPRESSED' };

/**
 * The time-driven reminders (Master Specification §57, §63; approved Module 32 decisions 3, 5, 6, 9 and 10). A pass claims the reminders that are DUE (`due_at <= now`, locked so two
 * instances never process one row twice), re-checks the CURRENT facts through the public reads of the other modules, and either sends, suppresses or postpones each one:
 *  - EXAM_24H:   the exam must still be SCHEDULED and not yet started. Parents of every target student and every currently assigned examiner. An exam scheduled less than 24 hours
 *                before the start is due immediately, so it is sent at the next pass instead of skipped. A start time moved later postpones the reminder to the new time.
 *  - SESSION_HALF_TIME:  the session must be IN PROGRESS and not over; memorization and/or revision must have been SCHEDULED and still have no record; the assigned Teacher only.
 *  - SESSION_EVALUATION: the session must be IN PROGRESS and not over; present students with an assignment must still lack the evaluation; the assigned Teacher only.
 * DELAYED SCHEDULER: because the rows are due-based, a missed time (delay, outage, restart) is simply late: the next pass sends the reminder at once when, and only when, the conditions
 * above STILL hold (decisions 5 and 6); otherwise it is suppressed. A cancelled session or exam never produces a reminder (decision 9). Every notification uses a once-only key, so a
 * crash between sending and marking the row done, or two instances, cannot send twice (decision 10). A technical error retries with a growing delay, then gives up (FAILED).
 */
export class ReminderProcessor {
  constructor(private readonly deps: RuleDeps) {}

  async processDue(): Promise<ReminderPassResult> {
    const { state, clock } = this.deps;
    const now = clock.now();
    const due = await state.claimDue({ claimId: newUuid(), now, lockUntil: new Date(now.getTime() + REMINDER_LIMITS.claimLockMs), limit: REMINDER_LIMITS.batchSize });
    let sent = 0;
    let suppressed = 0;
    let postponed = 0;
    let retried = 0;
    let failed = 0;
    for (const reminder of due) {
      try {
        const outcome = await this.evaluate(reminder, clock.now());
        if (outcome.kind === 'POSTPONE') {
          await state.postpone(reminder.id, outcome.dueAt, clock.now());
          postponed += 1;
        } else {
          await state.complete(reminder.id, outcome.kind, clock.now());
          if (outcome.kind === 'SENT') sent += 1;
          else suppressed += 1;
        }
      } catch (error) {
        const attempts = reminder.attempts + 1;
        const giveUp = attempts >= REMINDER_LIMITS.maxAttempts;
        const message = (error instanceof Error ? error.message : String(error)).slice(0, REMINDER_LIMITS.errorMax);
        const at = clock.now();
        await state.recordFailure(reminder.id, attempts, giveUp ? null : new Date(at.getTime() + reminderRetryDelayMs(attempts)), message, at);
        if (giveUp) failed += 1;
        else retried += 1;
      }
    }
    return { sent, suppressed, postponed, retried, failed };
  }

  private evaluate(reminder: ReminderRecord, now: Date): Promise<Outcome> {
    switch (reminder.kind) {
      case REMINDER_KINDS.EXAM_24H:
        return this.examReminder(reminder.subjectId, now);
      case REMINDER_KINDS.SESSION_HALF_TIME:
        return this.halfTimeReminder(reminder.subjectId, now);
      case REMINDER_KINDS.SESSION_EVALUATION:
        return this.evaluationWarning(reminder.subjectId, now);
      default:
        return Promise.resolve(SUPPRESSED);
    }
  }

  private async examReminder(examId: string, now: Date): Promise<Outcome> {
    const { exams, students } = this.deps;
    const info = await exams.find(examId);
    if (!info || info.status !== 'SCHEDULED') return SUPPRESSED; // cancelled, deleted, started or over: no reminder (decision 9)
    const dueAt = examReminderDueAt(info.startAt);
    if (dueAt.getTime() > now.getTime()) return { kind: 'POSTPONE', dueAt }; // the start was moved later: remind at the new time
    if (info.startAt.getTime() <= now.getTime()) return SUPPRESSED; // the start time has passed: it is too late to remind
    const start = formatCairoDateTime(info.startAt);
    const startMs = info.startAt.getTime();
    for (const studentId of (await exams.listLiveTargetStudentIds(examId)) ?? []) {
      const student = await students.find(studentId);
      if (student) await notifyParentsOf(this.deps, student, TEMPLATE_KEYS.examReminderParent, { student: student.fullName, start }, { examId, studentId }, dedupKeys.examReminderStudent(examId, startMs, studentId));
    }
    for (const teacherId of info.examinerTeacherIds) {
      await notifyTeacher(this.deps, teacherId, TEMPLATE_KEYS.examReminderExaminer, { start }, { examId }, dedupKeys.examReminderExaminer(examId, startMs, teacherId));
    }
    return SENT;
  }

  /** Common gate of both session reminders: undefined = go on, otherwise the outcome to return. */
  private sessionGate(status: string, scheduledEnd: Date, now: Date): Outcome | undefined {
    const phase = sessionPhaseOf(status);
    if (phase === 'OVER' || scheduledEnd.getTime() <= now.getTime()) return SUPPRESSED; // ended or cancelled (or the end time has passed and the scheduler has not closed it yet)
    if (phase === 'NOT_STARTED') return { kind: 'POSTPONE', dueAt: new Date(now.getTime() + REMINDER_LIMITS.notStartedRecheckMs) }; // the scheduler has not started it yet: look again shortly
    return undefined;
  }

  private async halfTimeReminder(sessionId: string, now: Date): Promise<Outcome> {
    const view = await this.deps.sessions.activities(sessionId);
    if (!view) return SUPPRESSED;
    const gate = this.sessionGate(view.status, view.scheduledEnd, now);
    if (gate) return gate;
    // Only an activity that was explicitly SCHEDULED and still has no record is reminded; an unscheduled activity never is, and nothing is ever created for the Teacher.
    const templateKey =
      view.memorizationPending && view.revisionPending
        ? TEMPLATE_KEYS.sessionHalfTimeBoth
        : view.memorizationPending
          ? TEMPLATE_KEYS.sessionHalfTimeMemorization
          : view.revisionPending
            ? TEMPLATE_KEYS.sessionHalfTimeRevision
            : undefined;
    if (!templateKey) return SUPPRESSED;
    await notifyTeacher(this.deps, view.teacherId, templateKey, {}, { sessionId }, dedupKeys.sessionHalfTime(sessionId));
    return SENT;
  }

  private async evaluationWarning(sessionId: string, now: Date): Promise<Outcome> {
    const view = await this.deps.sessions.evaluationStatus(sessionId);
    if (!view) return SUPPRESSED;
    const gate = this.sessionGate(view.status, view.scheduledEnd, now);
    if (gate) return gate;
    if (view.incompleteStudentIds.length === 0) return SUPPRESSED; // nobody present is missing a required evaluation
    await notifyTeacher(this.deps, view.teacherId, TEMPLATE_KEYS.sessionEvaluationWarning, { count: view.incompleteStudentIds.length }, { sessionId, groupId: view.groupId }, dedupKeys.sessionEvaluationWarning(sessionId));
    return SENT;
  }
}
