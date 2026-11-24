import type { AttendanceCounts } from './attendance-report';
import type { GroupEvaluationFigures } from './group-report';
import type { MemorizationCounts } from './memorization-report';
import type { ReportPeriodDto } from './payment-report';
import type { StudentExamCounts } from './student-report';

/** What a client may ask of the TEACHER report. `teacherId` is REQUIRED and is only a REQUEST that is checked against the requester's scope. */
export interface TeacherReportRequest {
  readonly period: { readonly kind: string; readonly startDate?: string | undefined; readonly endDate?: string | undefined };
  readonly teacherId: string;
}

export interface TeacherReportSchool {
  readonly id: string;
  readonly name: string | null;
}

/** The Teacher header: the name and the schools the Teacher is CURRENTLY linked to INSIDE THE REQUESTER'S SCOPE (never a phone, an address or a school outside the scope). */
export interface TeacherReportTeacher {
  readonly id: string;
  readonly name: string;
  readonly schools: readonly TeacherReportSchool[];
}

/**
 * One stint in which the Teacher taught one group of an authorized school (a group the Teacher left and came back to has one entry per stint, each with its own dates and figures). `taughtFrom` / `taughtTo`
 * (`YYYY-MM-DD`, Africa/Cairo, both inclusive) are the stint clipped to the reporting period; every figure below is limited to exactly those dates. `stillTeaching` says the Teacher teaches the group when the
 * report is made. Nothing is combined across groups or schools: every entry carries its own school.
 */
export interface TeacherTaughtGroup {
  readonly groupId: string;
  readonly groupName: string;
  readonly schoolId: string;
  readonly schoolName: string | null;
  readonly learningMode: string;
  readonly taughtFrom: string;
  readonly taughtTo: string;
  readonly stillTeaching: boolean;
  /** The Teacher's OWN attendance in this group during the stint (existing authoritative attendance records). */
  readonly teacherAttendance: AttendanceCounts;
  /** The group report's figures for the stint: roster size and the students' counts (no exam score, no overall score). */
  readonly students: number;
  readonly attendance: AttendanceCounts;
  readonly memorization: MemorizationCounts;
  readonly revision: MemorizationCounts;
  readonly evaluations: GroupEvaluationFigures;
  readonly exams: StudentExamCounts;
}

/**
 * The report of ONE Teacher (Master Specification §68), data only, limited to the requester's authorized schools: a School Manager only ever sees their own schools, an Organization Manager the schools of their
 * organization, even when the Teacher also works elsewhere. `groups` is ONE PAGE of the Teacher's taught groups (the only pagination; files hold every entry). No subscription, payment or other financial data, no score,
 * ranking or comparison between teachers, groups or schools is created.
 */
export interface TeacherReport {
  readonly type: 'TEACHER';
  readonly period: ReportPeriodDto;
  /** When the report was produced (UTC ISO). */
  readonly generatedAt: string;
  readonly teacher: TeacherReportTeacher;
  readonly groups: readonly TeacherTaughtGroup[];
}
