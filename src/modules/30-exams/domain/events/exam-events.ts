/**
 * Exam events (outbox, same transaction as the change). They are the integration data the Notifications modules (31-34) need (approved Module 30 decisions, §57/§63);
 * NOTHING is notified inside Module 30. Identifiers, statuses and times only, except `ExamResultRecorded` (the scores the Parent is told immediately).
 *  - ExamExaminerAssigned / ExamExaminerRemoved          the Teacher (examiner)
 *  - ExamScheduled                                        the exam became SCHEDULED (the parents of the target students are told; they are resolved by the Notifications modules)
 *  - ExamStudentTargeted / ExamStudentUntargeted          before STARTED, a student joined or left a group the exam targets (so the parents of a student added after scheduling are told)
 *  - ExamUpdated / ExamEndTimeChanged / ExamCancelled / ExamDeleted   schedule changes
 *  - ExamStarted (the target list is frozen) / ExamCompleted (carries the students marked ABSENT) / ExamEnded
 *  - ExamResultRecorded                                   one student's result was recorded: the result notification is sent immediately
 * The 24-hour reminder is a READ (`ExamService.getExamReminderStatus`), delivered by the Notifications modules.
 */
export const ExamEventTypes = {
  SCHEDULED: 'ExamScheduled',
  UPDATED: 'ExamUpdated',
  CANCELLED: 'ExamCancelled',
  DELETED: 'ExamDeleted',
  STARTED: 'ExamStarted',
  END_TIME_CHANGED: 'ExamEndTimeChanged',
  COMPLETED: 'ExamCompleted',
  ENDED: 'ExamEnded',
  EXAMINER_ASSIGNED: 'ExamExaminerAssigned',
  EXAMINER_REMOVED: 'ExamExaminerRemoved',
  STUDENT_TARGETED: 'ExamStudentTargeted',
  STUDENT_UNTARGETED: 'ExamStudentUntargeted',
  RESULT_RECORDED: 'ExamResultRecorded',
} as const;
export type ExamEventType = (typeof ExamEventTypes)[keyof typeof ExamEventTypes];

export const EXAM_AGGREGATE_TYPE = 'Exam';
export const EXAM_RESULT_AGGREGATE_TYPE = 'ExamResult';

export interface ExamEventPayload {
  readonly examId: string;
  readonly schoolId: string;
  readonly status: string;
  readonly startAt: string;
  readonly endAt: string | null;
  readonly wholeSchool: boolean;
  readonly groupIds: readonly string[];
  readonly actorId: string | null;
  readonly teacherId?: string;
  readonly studentId?: string;
  readonly groupId?: string;
  readonly changedFields?: readonly string[];
  readonly absentStudentIds?: readonly string[];
  readonly wasScheduled?: boolean;
  readonly frozenStudentCount?: number;
}

export interface ExamResultEventPayload {
  readonly examId: string;
  readonly resultId: string;
  readonly schoolId: string;
  readonly groupId: string;
  readonly studentId: string;
  readonly scores: readonly number[];
  readonly total: number;
  readonly maxTotal: number;
  readonly actorId: string;
}
