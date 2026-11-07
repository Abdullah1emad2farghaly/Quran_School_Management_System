import type { Exam } from '../../domain/entities/exam';
import type { ExamResultSnapshot } from '../../domain/entities/exam-result';
import { fromHundredths, toHundredths, type ExamStatus } from '../../domain/value-objects/exam-rules';
import type { ExamStudentRow, ExamStudentStatus } from '../ports/exam-repository';

export interface ExaminerDto {
  readonly teacherId: string;
  readonly assignedAt: Date;
}

/** The exam as the School Manager and an assigned examiner see it: the configuration, the targets and the CURRENT examiners. Never any result. */
export interface ExamDto {
  readonly id: string;
  readonly schoolId: string;
  readonly status: ExamStatus;
  readonly wholeSchool: boolean;
  readonly groupIds: readonly string[];
  readonly startAt: Date;
  readonly endAt: Date | null;
  readonly questionCount: number;
  readonly maxScore: number;
  readonly maxTotal: number;
  readonly examiners: readonly ExaminerDto[];
  readonly createdAt: Date;
}

/** The schedule a Parent sees: when, for which school, and the status. Nothing about targets, examiners or other students. */
export interface ExamScheduleDto {
  readonly id: string;
  readonly schoolId: string;
  readonly status: ExamStatus;
  readonly wholeSchool: boolean;
  readonly startAt: Date;
  readonly endAt: Date | null;
}

export interface ExamResultDto {
  readonly id: string;
  readonly examId: string;
  readonly studentId: string;
  readonly groupId: string;
  readonly scores: readonly number[];
  readonly total: number;
  readonly maxTotal: number;
  readonly recordedAt: Date;
}

export interface ExamAbsentDto {
  readonly studentId: string;
  readonly groupId: string;
  readonly fullName: string;
}

/** All the recorded results of an exam and its ABSENT students: School Manager only. The recording examiner is deliberately not part of it. */
export interface ExamResultsDto {
  readonly examId: string;
  readonly status: ExamStatus;
  readonly results: readonly ExamResultDto[];
  readonly absent: readonly ExamAbsentDto[];
}

export interface StudentExamOutcomeDto {
  readonly exam: ExamScheduleDto & { readonly questionCount: number; readonly maxScore: number };
  readonly outcome: 'EXAMINED' | 'ABSENT';
  /** null for ABSENT: no score and no result exist. */
  readonly result: { readonly scores: readonly number[]; readonly total: number; readonly maxTotal: number; readonly recordedAt: Date } | null;
}

export interface PendingGroupDto {
  readonly groupId: string;
  readonly groupName: string;
  readonly total: number;
  readonly pending: number;
}

export interface PendingStudentDto {
  readonly studentId: string;
  readonly fullName: string;
  readonly groupId: string;
  readonly groupName: string;
  /** Always PENDING: the examiner sees only the students not yet examined. */
  readonly examinationStatus: 'PENDING';
}

export interface ExamResultReceiptDto {
  readonly examId: string;
  readonly studentId: string;
  readonly groupId: string;
}

export interface ExamReminderStatusDto {
  readonly examId: string;
  readonly schoolId: string;
  readonly status: ExamStatus;
  readonly startAt: Date;
  /** 24 hours before the start: when the reminder is due (only while the exam is SCHEDULED). */
  readonly reminderDueAt: Date;
  readonly examinerTeacherIds: readonly string[];
}

export const maxTotalOf = (exam: Exam): number => fromHundredths(toHundredths(exam.snapshot.maxScore) * exam.snapshot.questionCount);

export function toExamDto(exam: Exam): ExamDto {
  const s = exam.snapshot;
  return {
    id: s.id, schoolId: s.schoolId, status: s.status, wholeSchool: s.wholeSchool, groupIds: [...s.groupIds], startAt: s.startAt, endAt: s.endAt, questionCount: s.questionCount, maxScore: s.maxScore, maxTotal: maxTotalOf(exam),
    examiners: s.examiners.filter((e) => e.releasedAt === null).map((e) => ({ teacherId: e.teacherId, assignedAt: e.assignedAt })), createdAt: s.createdAt,
  };
}

export const toScheduleDto = (exam: Exam): ExamScheduleDto => {
  const s = exam.snapshot;
  return { id: s.id, schoolId: s.schoolId, status: s.status, wholeSchool: s.wholeSchool, startAt: s.startAt, endAt: s.endAt };
};

export const toResultDto = (r: ExamResultSnapshot, maxTotal: number): ExamResultDto => ({ id: r.id, examId: r.examId, studentId: r.studentId, groupId: r.groupId, scores: [...r.scores], total: r.total, maxTotal, recordedAt: r.recordedAt });

export const toPendingStudentDto = (row: ExamStudentRow): PendingStudentDto => ({ studentId: row.studentId, fullName: row.fullName, groupId: row.groupId, groupName: row.groupName, examinationStatus: 'PENDING' });

export type { ExamStudentStatus };
