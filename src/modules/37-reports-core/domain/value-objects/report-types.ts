import type { RoleCode } from '../../../09-roles-permissions/public';

/** The report types of Master Specification §68. */
export const REPORT_TYPES = ['STUDENT', 'PARENT', 'GROUP', 'TEACHER', 'SCHOOL', 'GEOGRAPHIC', 'ATTENDANCE', 'MEMORIZATION', 'REVISION', 'EVALUATION', 'PERFORMANCE', 'PAYMENT'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];
export const isReportType = (value: unknown): value is ReportType => typeof value === 'string' && (REPORT_TYPES as readonly string[]).includes(value);

const LEARNING_REPORTS: readonly ReportType[] = ['STUDENT', 'GROUP', 'ATTENDANCE', 'MEMORIZATION', 'REVISION', 'EVALUATION', 'PERFORMANCE'];

/**
 * REPORT AVAILABILITY MATRIX (owner-approved 2026-11-17: the recommended matrix of `docs/REPORTS-CORE.md`, always subject to the mandatory organizational scope).
 * It decides which report TYPES a role may run; the scope (ReportScope) decides over WHICH DATA. Deny by default: a role not listed here has no report.
 *   - ORGANIZATION_MANAGER, GOVERNORATE/CENTER/VILLAGE managers: every report type, including GEOGRAPHIC, inside their scope.
 *   - SCHOOL_MANAGER: every report type except GEOGRAPHIC (a school is not a geographic unit), inside their school.
 *   - TEACHER: the learning reports of their current groups and those groups' students.
 *   - PARENT: PARENT plus the learning reports of their own linked children (each child with its own context, §68).
 *   - SUBSCRIPTION_COLLECTOR: PAYMENT reports of their assigned schools, nothing else.
 *   - MAIN_ADMIN (system-level, never treated as an Organization Manager) and STUDENT: none.
 */
export const REPORT_AVAILABILITY: Readonly<Partial<Record<RoleCode, readonly ReportType[]>>> = {
  ORGANIZATION_MANAGER: REPORT_TYPES,
  GOVERNORATE_MANAGER: REPORT_TYPES,
  CENTER_MANAGER: REPORT_TYPES,
  VILLAGE_MANAGER: REPORT_TYPES,
  SCHOOL_MANAGER: REPORT_TYPES.filter((t) => t !== 'GEOGRAPHIC'),
  TEACHER: LEARNING_REPORTS,
  PARENT: ['PARENT', ...LEARNING_REPORTS.filter((t) => t !== 'GROUP')],
  SUBSCRIPTION_COLLECTOR: ['PAYMENT'],
};

export const isReportAvailableTo = (role: string, type: ReportType): boolean => ((REPORT_AVAILABILITY as Record<string, readonly ReportType[] | undefined>)[role] ?? []).includes(type);
