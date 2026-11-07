import type { ExamDto, ExamReminderStatusDto, ExamResultDto, ExamResultReceiptDto, ExamResultsDto, ExamScheduleDto, PendingGroupDto, PendingStudentDto, StudentExamOutcomeDto } from '../../application/dto/exam-dto';

const iso = (d: Date): string => d.toISOString();
const isoOrNull = (d: Date | null): string | null => (d === null ? null : iso(d));

/** The public JSON of an exam (instants are UTC ISO-8601). Never contains a result. */
export const serializeExam = (e: ExamDto) => ({
  id: e.id,
  schoolId: e.schoolId,
  status: e.status,
  wholeSchool: e.wholeSchool,
  groupIds: e.groupIds,
  startAt: iso(e.startAt),
  endAt: isoOrNull(e.endAt),
  questionCount: e.questionCount,
  maxScore: e.maxScore,
  maxTotal: e.maxTotal,
  examiners: e.examiners.map((x) => ({ teacherId: x.teacherId, assignedAt: iso(x.assignedAt) })),
  createdAt: iso(e.createdAt),
});

export const serializeSchedule = (e: ExamScheduleDto) => ({ id: e.id, schoolId: e.schoolId, status: e.status, wholeSchool: e.wholeSchool, startAt: iso(e.startAt), endAt: isoOrNull(e.endAt) });

const serializeResult = (r: ExamResultDto) => ({ id: r.id, examId: r.examId, studentId: r.studentId, groupId: r.groupId, scores: r.scores, total: r.total, maxTotal: r.maxTotal, recordedAt: iso(r.recordedAt) });

export const serializeResults = (r: ExamResultsDto) => ({ examId: r.examId, status: r.status, results: r.results.map(serializeResult), absent: r.absent.map((a) => ({ studentId: a.studentId, groupId: a.groupId, fullName: a.fullName })) });

export const serializeOutcome = (o: StudentExamOutcomeDto) => ({
  exam: { ...serializeSchedule(o.exam), questionCount: o.exam.questionCount, maxScore: o.exam.maxScore },
  outcome: o.outcome,
  result: o.result ? { scores: o.result.scores, total: o.result.total, maxTotal: o.result.maxTotal, recordedAt: iso(o.result.recordedAt) } : null,
});

export const serializePendingGroup = (g: PendingGroupDto) => ({ groupId: g.groupId, groupName: g.groupName, total: g.total, pending: g.pending });
export const serializePendingStudent = (s: PendingStudentDto) => ({ studentId: s.studentId, fullName: s.fullName, groupId: s.groupId, groupName: s.groupName, examinationStatus: s.examinationStatus });
export const serializeReceipt = (r: ExamResultReceiptDto) => ({ examId: r.examId, studentId: r.studentId, groupId: r.groupId });
export const serializeReminder = (r: ExamReminderStatusDto) => ({ examId: r.examId, schoolId: r.schoolId, status: r.status, startAt: iso(r.startAt), reminderDueAt: iso(r.reminderDueAt), examinerTeacherIds: r.examinerTeacherIds });
