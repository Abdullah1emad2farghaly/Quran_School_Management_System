/**
 * Once-only keys (Module 31 writes one per recipient account BEFORE the notification, and never deletes it). Module 32 builds them from the id of the
 * business event (an outbox event is delivered at least once, so a retry produces the SAME key) or, for a reminder, from the subject and the instant it is about.
 * A key never contains a name, a score or any content. Every key is far below the 191-character limit.
 */
export const dedupKeys = {
  schoolRequest: (eventId: string): string => `school-request:${eventId}`,
  schoolDecision: (eventId: string): string => `school-decision:${eventId}`,
  groupChange: (eventId: string, audience: 'parent' | 'teacher' | 'previous-teacher'): string => `group-change:${eventId}:${audience}`,
  assignmentChange: (eventId: string, studentId: string): string => `assignment-change:${eventId}:${studentId}`,
  evaluation: (eventId: string): string => `evaluation:${eventId}`,
  examEventStudent: (eventId: string, studentId: string): string => `exam-event:${eventId}:${studentId}`,
  examEventExaminer: (eventId: string, teacherId: string): string => `exam-event:${eventId}:examiner:${teacherId}`,
  examResult: (eventId: string): string => `exam-result:${eventId}`,
  /** Bound to the START TIME, so an exam moved to another time is reminded again for the new time, and the same time is never reminded twice. */
  examReminderStudent: (examId: string, startAtMs: number, studentId: string): string => `exam-reminder:${examId}:${startAtMs}:${studentId}`,
  examReminderExaminer: (examId: string, startAtMs: number, teacherId: string): string => `exam-reminder:${examId}:${startAtMs}:examiner:${teacherId}`,
  sessionHalfTime: (sessionId: string): string => `session-half-time:${sessionId}`,
  sessionEvaluationWarning: (sessionId: string): string => `session-evaluation-warning:${sessionId}`,
} as const;
