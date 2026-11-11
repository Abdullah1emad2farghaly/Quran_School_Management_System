import type { DayOfWeek } from '../../../23-group-schedules/public';
import type { ImportColumnKey, ImportLanguage, LocalizedPair } from '../value-objects/import-columns';

/** One data row of the sheet as text (already trimmed/normalized by `cellText`), with its 1-based sheet row number. */
export type ParsedImportRow = { readonly rowNumber: number } & { readonly [K in ImportColumnKey]: string };

export type IssueSeverity = 'ERROR' | 'CONFLICT' | 'WARNING';
/** ERROR and CONFLICT block the confirmation (all-or-nothing); WARNING never does. */
export const isBlocking = (severity: IssueSeverity): boolean => severity !== 'WARNING';

export interface ImportIssue {
  /** The sheet row, or null for a finding about the file itself (for example an ignored column). */
  readonly rowNumber: number | null;
  readonly column: ImportColumnKey | null;
  readonly severity: IssueSeverity;
  /** Stable, language-independent. */
  readonly code: string;
  readonly params: Readonly<Record<string, string | number>>;
  /** The message in BOTH languages (Master Specification §78). */
  readonly message: LocalizedPair;
}

export type EntityDecision = 'NEW' | 'EXISTING';
export type RowStatus = 'OK' | 'WARNING' | 'ERROR' | 'CONFLICT';

export interface PreviewSlot {
  readonly day: DayOfWeek;
  readonly startTime: string;
  readonly endTime: string;
}

export interface AnalyzedRow {
  readonly rowNumber: number;
  readonly status: RowStatus;
  readonly student: { readonly name: string; readonly nationalId: string; readonly decision: EntityDecision | null };
  readonly parent: { readonly name: string; readonly phone: string; readonly address: string; readonly decision: EntityDecision | null };
  readonly teacher: { readonly name: string; readonly phone: string; readonly decision: EntityDecision | null };
  readonly group: {
    readonly name: string;
    readonly decision: EntityDecision | null;
    readonly learningMode: string | null;
    readonly progression: string | null;
    readonly startingSurah: number | null;
    readonly schedule: { readonly slots: readonly PreviewSlot[]; readonly display: LocalizedPair };
  };
  readonly issues: readonly ImportIssue[];
}

export interface PreviewSummary {
  readonly totalRows: number;
  readonly rowsOk: number;
  readonly rowsWithWarnings: number;
  readonly rowsWithErrors: number;
  readonly rowsWithConflicts: number;
  readonly newUsers: number;
  readonly existingUsers: number;
  readonly newStudents: number;
  readonly existingStudents: number;
  readonly newParents: number;
  readonly existingParents: number;
  readonly newTeachers: number;
  readonly existingTeachers: number;
  readonly newGroups: number;
  readonly existingGroups: number;
  readonly errors: number;
  readonly conflicts: number;
  readonly warnings: number;
}

/** A row that passed every check, as the commit needs it (normalized values; the services re-validate them anyway). */
export interface PlannedRow {
  readonly rowNumber: number;
  readonly studentName: string;
  readonly nationalId: string;
  readonly parentName: string;
  readonly parentPhone: string;
  readonly parentAddress: string;
  readonly groupName: string;
  readonly teacherName: string;
  readonly teacherPhone: string;
  readonly learningMode: 'GROUP' | 'INDIVIDUAL';
  readonly progression: 'FORWARD' | 'BACKWARD';
  readonly startingSurah: number;
  readonly slots: readonly PreviewSlot[];
}

export interface PreviewAnalysis {
  readonly summary: PreviewSummary;
  readonly rows: readonly AnalyzedRow[];
  /** Every finding (rows and file level), blocking ones first within a row order. */
  readonly issues: readonly ImportIssue[];
  readonly blocking: number;
  readonly canConfirm: boolean;
}

export type PreviewStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'EXPIRED';

export interface ImportResultSummary {
  readonly studentsCreated: number;
  readonly studentsReused: number;
  readonly parentsCreated: number;
  readonly parentsReused: number;
  readonly teachersCreated: number;
  readonly teachersReused: number;
  readonly groupsCreated: number;
  readonly groupsReused: number;
  readonly slotsCreated: number;
  readonly assignmentsCreated: number;
}

export interface ImportPreviewRecord {
  readonly id: string;
  readonly schoolId: string;
  readonly organizationId: string;
  readonly createdBy: string;
  readonly fileId: string | null;
  readonly originalName: string;
  /** The language of the template/headers the file used (and of the preview texts the manager reads first). */
  readonly language: ImportLanguage;
  readonly status: PreviewStatus;
  readonly canConfirm: boolean;
  readonly blocking: number;
  readonly summary: PreviewSummary;
  /** Personal data (names, phones, National IDs): removed as soon as the preview is confirmed, cancelled or expired. */
  readonly sourceRows: readonly ParsedImportRow[] | null;
  readonly analysis: { readonly rows: readonly AnalyzedRow[]; readonly issues: readonly ImportIssue[] } | null;
  readonly result: ImportResultSummary | null;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly decidedAt: Date | null;
  readonly decidedBy: string | null;
  readonly version: number;
}
