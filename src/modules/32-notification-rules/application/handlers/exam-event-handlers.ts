import type { DomainEvent } from '../../../00-shared-kernel/public';
import type { EventHandler } from '../../../06-domain-events-outbox/public';
import { ExamEventTypes, type ExamEventPayload, type ExamResultEventPayload } from '../../../30-exams/public';
import { dedupKeys } from '../../domain/value-objects/dedup-keys';
import { formatCairoDateTime, formatScore, NO_VALUE, parseInstant } from '../../domain/value-objects/message-format';
import { REMINDER_KINDS, examReminderDueAt } from '../../domain/value-objects/reminder-rules';
import { TEMPLATE_KEYS } from '../services/rule-templates';
import { idOf, notifyParentsOf, notifyTeacher, payloadOf, type RuleDeps } from '../services/rule-support';

type Times = { readonly start: string; readonly end: string };
const timesOf = (p: Partial<ExamEventPayload>): Times => ({ start: formatCairoDateTime(p.startAt), end: p.endAt === null || p.endAt === undefined ? NO_VALUE : formatCairoDateTime(p.endAt) });

/**
 * Exam notifications (approved Module 32 decisions 3 and 4; §57, §63; Module 30 lifecycle unchanged). Module 30 only publishes events and reads; delivery is here.
 *  - ExamExaminerAssigned / ExamExaminerRemoved          -> the Teacher concerned.
 *  - ExamScheduled                                        -> the parents of the target students ("an exam was scheduled"); the 24-hour reminder is scheduled.
 *  - ExamStudentTargeted / ExamStudentUntargeted          -> the parents of THAT student only (the student joined / left a targeted group before the start).
 *  - ExamUpdated (start, end, targets, question count, maximum score) -> every MODIFICATION of a scheduled exam: the parents of the affected students and the currently assigned
 *    examiners. A change of targets tells the parents of the students ADDED ("an exam was scheduled") and REMOVED; the other changes tell the parents of the current targets the
 *    current schedule. ExamEndTimeChanged (also after the start) is told the same way. Module 30 only publishes changes its own rules permit, so nothing else can arrive here.
 *  - ExamCancelled / ExamDeleted of a scheduled exam       -> the parents of the target students and the examiners; the pending reminder is suppressed (decision 9).
 *  - ExamResultRecorded                                   -> the parents of that student, immediately, with the question scores and the total.
 * Who was told is remembered (a snapshot of students and examiners) so a removed student's parents and a cancelled exam's audience can still be reached. The notification is created
 * BEFORE the snapshot is updated, so a retry after a partial failure re-sends nothing twice (the once-only keys) and loses nothing.
 */
export function createExamEventHandlers(deps: RuleDeps): EventHandler[] {
  const { state, exams } = deps;

  /** The students targeted now (a live exam) or, once the exam is no longer live, the students Module 32 told. */
  const currentStudents = async (examId: string): Promise<string[]> => (await exams.listLiveTargetStudentIds(examId)) ?? (await state.listExamAudience(examId, 'STUDENT'));

  const notifyStudents = async (studentIds: readonly string[], templateKey: string, examId: string, eventId: string, times: Times, withEnd: boolean): Promise<void> => {
    for (const studentId of studentIds) {
      const student = await deps.students.find(studentId);
      if (!student) continue;
      const params: Record<string, string> = withEnd ? { student: student.fullName, start: times.start, end: times.end } : { student: student.fullName, start: times.start };
      await notifyParentsOf(deps, student, templateKey, params, { examId, studentId }, dedupKeys.examEventStudent(eventId, studentId));
    }
  };

  const currentExaminers = async (examId: string): Promise<string[]> => (await exams.find(examId))?.examinerTeacherIds.slice() ?? (await state.listExamAudience(examId, 'EXAMINER'));

  const notifyExaminers = async (teacherIds: readonly string[], templateKey: string, examId: string, eventId: string, times: Times, withEnd: boolean): Promise<void> => {
    for (const teacherId of teacherIds) {
      const params: Record<string, string> = withEnd ? { start: times.start, end: times.end } : { start: times.start };
      await notifyTeacher(deps, teacherId, templateKey, params, { examId }, dedupKeys.examEventExaminer(eventId, teacherId));
    }
  };

  const isCancelled = async (examId: string): Promise<boolean> => (await exams.find(examId))?.status === 'CANCELLED';

  return [
    {
      name: 'notification-rules.exam-scheduled',
      eventTypes: [ExamEventTypes.SCHEDULED],
      async handle(event: DomainEvent): Promise<void> {
        const p = payloadOf<ExamEventPayload>(event);
        const examId = idOf(p.examId);
        const startAt = parseInstant(p.startAt);
        if (!examId || !startAt) return;
        const info = await exams.find(examId);
        if (!info || info.status === 'CANCELLED') return;
        const targets = (await exams.listLiveTargetStudentIds(examId)) ?? [];
        await notifyStudents(targets, TEMPLATE_KEYS.examScheduledParent, examId, event.eventId, timesOf(p), true);
        const now = deps.clock.now();
        await state.replaceExamAudience(examId, 'STUDENT', targets, now);
        await state.replaceExamAudience(examId, 'EXAMINER', info.examinerTeacherIds, now);
        // Due 24 hours before the start; when the exam is scheduled less than 24 hours ahead this is already past and the reminder goes out at the next worker pass (decision 3).
        // No historical reminder: an exam whose start is already past gets none. (Exams scheduled BEFORE Module 32 was deployed never reach this handler: there is no backfill.)
        if (startAt.getTime() > now.getTime()) await state.upsertReminder(REMINDER_KINDS.EXAM_24H, examId, examReminderDueAt(startAt), now);
      },
    },
    {
      name: 'notification-rules.exam-updated',
      eventTypes: [ExamEventTypes.UPDATED],
      async handle(event: DomainEvent): Promise<void> {
        const p = payloadOf<ExamEventPayload>(event);
        const examId = idOf(p.examId);
        if (!examId) return;
        const changed = Array.isArray(p.changedFields) ? p.changedFields.filter((f): f is string => typeof f === 'string') : [];
        if (changed.length === 0 || (await isCancelled(examId))) return;
        const times = timesOf(p);
        const now = deps.clock.now();
        const known = await state.listExamAudience(examId, 'STUDENT');
        const live = await exams.listLiveTargetStudentIds(examId);
        const current = live ?? known;
        const added = new Set<string>();
        // An exam Module 32 has never seen (scheduled before deployment: no reminder row, no audience) is not backfilled: nobody was told about it, so a target change cannot be
        // expressed as "added / removed". Its current targets learn the current schedule below, and the snapshot is seeded from now on (without creating a reminder).
        const tracked = known.length > 0 || (await state.findReminder(REMINDER_KINDS.EXAM_24H, examId)) !== undefined;
        if (changed.includes('targets') && live && tracked) {
          const knownSet = new Set(known);
          const liveSet = new Set(live);
          for (const id of live) if (!knownSet.has(id)) added.add(id);
          const removed = known.filter((id) => !liveSet.has(id));
          await notifyStudents([...added], TEMPLATE_KEYS.examScheduledParent, examId, event.eventId, times, true);
          await notifyStudents(removed, TEMPLATE_KEYS.examRemovedParent, examId, event.eventId, times, false);
          await state.replaceExamAudience(examId, 'STUDENT', live, now);
        }
        // Any other change (start, end, question count, maximum score): the parents of the current targets learn the current schedule. A student just added already got the
        // full "an exam was scheduled" message with the current schedule, so they are not told twice.
        if (changed.some((f) => f !== 'targets') || (changed.includes('targets') && !tracked)) {
          await notifyStudents(current.filter((id) => !added.has(id)), TEMPLATE_KEYS.examUpdatedParent, examId, event.eventId, times, true);
        }
        await notifyExaminers(await currentExaminers(examId), TEMPLATE_KEYS.examUpdatedExaminer, examId, event.eventId, times, true);
        const startAt = parseInstant(p.startAt);
        // Seeded AFTER the notifications (a retry after a partial failure then still notifies).
        if (changed.includes('targets') && live && !tracked) await state.replaceExamAudience(examId, 'STUDENT', live, now);
        // Only an exam whose reminder Module 32 already scheduled is re-scheduled (no reminder is created for a record that predates the deployment).
        if (changed.includes('startAt') && startAt && startAt.getTime() > now.getTime() && (await state.findReminder(REMINDER_KINDS.EXAM_24H, examId)) !== undefined) {
          await state.upsertReminder(REMINDER_KINDS.EXAM_24H, examId, examReminderDueAt(startAt), now);
        }
      },
    },
    {
      name: 'notification-rules.exam-end-time-changed',
      eventTypes: [ExamEventTypes.END_TIME_CHANGED],
      async handle(event: DomainEvent): Promise<void> {
        const p = payloadOf<ExamEventPayload>(event);
        const examId = idOf(p.examId);
        if (!examId || (await isCancelled(examId))) return;
        const times = timesOf(p);
        await notifyStudents(await currentStudents(examId), TEMPLATE_KEYS.examUpdatedParent, examId, event.eventId, times, true);
        await notifyExaminers(await currentExaminers(examId), TEMPLATE_KEYS.examUpdatedExaminer, examId, event.eventId, times, true);
      },
    },
    {
      name: 'notification-rules.exam-cancelled',
      eventTypes: [ExamEventTypes.CANCELLED, ExamEventTypes.DELETED],
      async handle(event: DomainEvent): Promise<void> {
        const p = payloadOf<ExamEventPayload>(event);
        const examId = idOf(p.examId);
        if (!examId) return;
        const now = deps.clock.now();
        // The reminder never goes out for a cancelled exam, whether or not anybody had been told about it.
        await state.suppressPending(examId, [REMINDER_KINDS.EXAM_24H], now);
        if (p.wasScheduled === true) {
          const times = timesOf(p);
          await notifyStudents(await state.listExamAudience(examId, 'STUDENT'), TEMPLATE_KEYS.examCancelledParent, examId, event.eventId, times, false);
          await notifyExaminers(await currentExaminers(examId), TEMPLATE_KEYS.examCancelledExaminer, examId, event.eventId, times, false);
        }
        await state.clearExamAudience(examId);
      },
    },
    {
      name: 'notification-rules.exam-examiner-changed',
      eventTypes: [ExamEventTypes.EXAMINER_ASSIGNED, ExamEventTypes.EXAMINER_REMOVED],
      async handle(event: DomainEvent): Promise<void> {
        const p = payloadOf<ExamEventPayload>(event);
        const examId = idOf(p.examId);
        const teacherId = idOf(p.teacherId);
        if (!examId || !teacherId) return;
        const assigned = event.eventType === ExamEventTypes.EXAMINER_ASSIGNED;
        const times = timesOf(p);
        await notifyTeacher(deps, teacherId, assigned ? TEMPLATE_KEYS.examExaminerAssigned : TEMPLATE_KEYS.examExaminerRemoved, assigned ? { start: times.start, end: times.end } : { start: times.start }, { examId }, dedupKeys.examEventExaminer(event.eventId, teacherId));
        if (assigned) await state.addExamAudience(examId, 'EXAMINER', teacherId, deps.clock.now());
        else await state.removeExamAudience(examId, 'EXAMINER', teacherId);
      },
    },
    {
      name: 'notification-rules.exam-target-changed',
      eventTypes: [ExamEventTypes.STUDENT_TARGETED, ExamEventTypes.STUDENT_UNTARGETED],
      async handle(event: DomainEvent): Promise<void> {
        const p = payloadOf<ExamEventPayload>(event);
        const examId = idOf(p.examId);
        const studentId = idOf(p.studentId);
        if (!examId || !studentId) return;
        const targeted = event.eventType === ExamEventTypes.STUDENT_TARGETED;
        const known = (await state.listExamAudience(examId, 'STUDENT')).includes(studentId);
        if (targeted === known) return; // already told (targeted) or never told (untargeted): nothing to say, nothing to change
        const times = timesOf(p);
        await notifyStudents([studentId], targeted ? TEMPLATE_KEYS.examScheduledParent : TEMPLATE_KEYS.examRemovedParent, examId, event.eventId, times, targeted);
        if (targeted) await state.addExamAudience(examId, 'STUDENT', studentId, deps.clock.now());
        else await state.removeExamAudience(examId, 'STUDENT', studentId);
      },
    },
    {
      name: 'notification-rules.exam-result-recorded',
      eventTypes: [ExamEventTypes.RESULT_RECORDED],
      async handle(event: DomainEvent): Promise<void> {
        const p = payloadOf<ExamResultEventPayload>(event);
        const examId = idOf(p.examId);
        const studentId = idOf(p.studentId);
        if (!examId || !studentId || !Array.isArray(p.scores) || typeof p.total !== 'number' || typeof p.maxTotal !== 'number') return;
        const student = await deps.students.find(studentId);
        if (!student) return;
        const scores = p.scores.filter((n): n is number => typeof n === 'number');
        await notifyParentsOf(
          deps,
          student,
          TEMPLATE_KEYS.examResultParent,
          { student: student.fullName, total: formatScore(p.total), max: formatScore(p.maxTotal), scores: scores.map(formatScore).join(', ') },
          { examId, studentId },
          dedupKeys.examResult(event.eventId),
        );
      },
    },
    {
      name: 'notification-rules.exam-lifecycle',
      eventTypes: [ExamEventTypes.STARTED, ExamEventTypes.ENDED],
      async handle(event: DomainEvent): Promise<void> {
        const examId = idOf(payloadOf<ExamEventPayload>(event).examId);
        if (!examId) return;
        // STARTED: the 24-hour reminder is no longer meaningful. ENDED: the exam is closed for good, forget the audience snapshot.
        if (event.eventType === ExamEventTypes.STARTED) await state.suppressPending(examId, [REMINDER_KINDS.EXAM_24H], deps.clock.now());
        else await state.clearExamAudience(examId);
      },
    },
  ];
}
