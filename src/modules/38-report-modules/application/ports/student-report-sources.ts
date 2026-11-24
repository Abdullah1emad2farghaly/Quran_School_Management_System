import type { StudentAssignmentDto } from '../../../20-groups/public';
import type { StudentExamReportQuery } from '../../../30-exams/public';
import type { StudentExamReportRowDto } from '../../../30-exams/public';
import type { StudentSubscriptionReportQuery, StudentSubscriptionReportRow } from '../../../33-subscriptions/public';

/**
 * Where the STUDENT report gets the data that the four existing reports do not already provide. Every method is a read through the OWNING module's public contract (Module 38 owns no table, §102);
 * the report has already proven the student lies inside the requester's scope before it asks for anything here.
 */
export interface StudentReportSources {
  /** Every school of the organizations (any status). */
  schoolIdsOfOrganizations(organizationIds: readonly string[]): Promise<string[]>;
  /** The school of a student (ANY lifecycle status), or undefined when the student does not exist. */
  schoolIdOfStudent(studentId: string): Promise<string | undefined>;
  /** True when the student is CURRENTLY in a group the Teacher (identified by their user id) teaches. */
  isStudentInGroupOfTeacherUser(studentId: string, teacherUserId: string): Promise<boolean>;
  /** The name and JOIN DATE of the student, or undefined when the student does not exist (§67). */
  studentFacts(studentId: string): Promise<{ fullName: string; joinDate: string } | undefined>;
  /** The student's group periods, oldest first (Module 20). */
  assignmentHistoryOfStudent(studentId: string): Promise<StudentAssignmentDto[]>;
  /** The student's recorded exam outcomes of the exams that started inside the period (Module 30). */
  examOutcomes(query: StudentExamReportQuery): Promise<StudentExamReportRowDto[]>;
  /** The student's subscriptions, the status recorded now (Module 33). */
  subscriptions(query: StudentSubscriptionReportQuery): Promise<StudentSubscriptionReportRow[]>;
  groupNames(groupIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
  schoolNames(schoolIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
}
