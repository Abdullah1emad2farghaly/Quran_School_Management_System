/**
 * Read-only ports of Module 32. Each one is a NARROW view over another module's PUBLIC contract, implemented by an adapter in `infrastructure/adapters`
 * (so no handler imports another module, and a test can fake them with plain objects). Nothing here reads another module's tables.
 */

export interface StudentInfo {
  readonly id: string;
  readonly fullName: string;
  readonly schoolId: string;
  /** The user ids of every Parent account currently linked to the student (one per linked Parent). Never includes any other account. */
  readonly parentUserIds: readonly string[];
}
export interface StudentDirectory {
  find(studentId: string): Promise<StudentInfo | undefined>;
}

export interface TeacherDirectory {
  /** The user account of a Teacher record, or undefined when the Teacher does not exist. */
  userIdOf(teacherId: string): Promise<string | undefined>;
}

export interface GroupInfo {
  readonly id: string;
  readonly name: string;
  readonly schoolId: string;
  /** The Teacher record currently responsible for the group, or null when none. */
  readonly teacherId: string | null;
}
export interface GroupDirectory {
  find(groupId: string): Promise<GroupInfo | undefined>;
  /** The ids of the students CURRENTLY assigned to the group. */
  listStudentIds(groupId: string): Promise<string[]>;
}

export interface SchoolInfo {
  readonly id: string;
  readonly name: string;
  readonly organizationId: string;
  /** The user who asked to create the school (a public submission); null when an organization manager created it directly. */
  readonly applicantUserId: string | null;
  readonly applicantName: string | null;
  readonly rejectionReason: string | null;
}
export interface SchoolDirectory {
  find(schoolId: string): Promise<SchoolInfo | undefined>;
  /** The user ids of the ACTIVE managers of the organization. */
  organizationManagerUserIds(organizationId: string): Promise<string[]>;
}

export interface ExamInfo {
  readonly examId: string;
  readonly schoolId: string;
  readonly status: string;
  readonly startAt: Date;
  /** The Teacher records CURRENTLY assigned as examiners. */
  readonly examinerTeacherIds: readonly string[];
}
export interface ExamDirectory {
  find(examId: string): Promise<ExamInfo | undefined>;
  /**
   * The students targeted by the exam RIGHT NOW (computed from the current group membership) while the exam is still DRAFT or SCHEDULED, undefined once it is no longer
   * live (started, cancelled...). After that the snapshot Module 32 keeps (`RuleStateRepository`) is the best knowledge of who was told.
   */
  listLiveTargetStudentIds(examId: string): Promise<string[] | undefined>;
}

export interface SessionEvaluationView {
  readonly status: string;
  readonly teacherId: string;
  readonly groupId: string;
  readonly scheduledStart: Date;
  readonly scheduledEnd: Date;
  /** Present students that have an assignment and still lack the required evaluation. */
  readonly incompleteStudentIds: readonly string[];
}
export interface SessionActivityView {
  readonly status: string;
  readonly teacherId: string;
  readonly scheduledStart: Date;
  readonly scheduledEnd: Date;
  /** Memorization was explicitly scheduled for the session AND at least one scheduled assignment has no record yet. */
  readonly memorizationPending: boolean;
  readonly revisionPending: boolean;
}
export interface AssignmentTexts {
  /** `surah:ayah → surah:ayah` of the student's scheduled memorization assignment for the session, when there is one. */
  readonly memorization?: string;
  readonly revision?: string;
}
export interface SessionReads {
  /** undefined when the session does not exist. */
  evaluationStatus(sessionId: string): Promise<SessionEvaluationView | undefined>;
  activities(sessionId: string): Promise<SessionActivityView | undefined>;
  /** The assignments scheduled for the session for this student (a shared GROUP-mode assignment counts). Best effort: empty when none can be resolved. */
  assignmentTexts(sessionId: string, studentId: string): Promise<AssignmentTexts>;
}

export type AssignmentKind = 'memorization' | 'revision';

/** The range of an assignment as Modules 27 / 28 stored it (the Quran Range Engine's result): the unit it was defined in and the first / last ayah it covers. */
export interface RangeSnapshot {
  /** SURAHS, AYAHS, QUARTERS, PAGES or LINES (Module 22). */
  readonly unit: string;
  readonly amount: number;
  readonly first: { readonly surah: number; readonly ayah: number };
  readonly last: { readonly surah: number; readonly ayah: number };
  readonly ayahCount: number;
}
export interface AssignmentDirectory {
  /** The assignment in its CURRENT state (a cancelled one keeps the range that was cancelled); undefined when it does not exist. */
  find(kind: AssignmentKind, assignmentId: string): Promise<RangeSnapshot | undefined>;
}

export interface AyahLocation {
  readonly firstPage: number;
  readonly lastPage: number;
  /** The quarter (rub' al-hizb, 1..240) containing the ayah. */
  readonly quarter: number;
}
/** Read-only Quran reference data (Module 21's public lookup): names and where an ayah sits in the Mushaf. */
export interface QuranDirectory {
  surahName(surah: number): Promise<string>;
  ayahLocation(surah: number, ayah: number): Promise<AyahLocation | undefined>;
}
