export const STUDENT_STATUSES = ['ACTIVE', 'INACTIVE', 'ARCHIVED'] as const;
export type StudentStatus = (typeof STUDENT_STATUSES)[number];

export const STUDENT_ACTIONS = ['DEACTIVATE', 'REACTIVATE', 'ARCHIVE'] as const;
export type StudentLifecycleAction = (typeof STUDENT_ACTIONS)[number];

/**
 * The documented V1 lifecycle (Master Specification §39: deactivate or archive, never destroy):
 *   ACTIVE   --DEACTIVATE--> INACTIVE
 *   INACTIVE --REACTIVATE--> ACTIVE
 *   ACTIVE | INACTIVE --ARCHIVE--> ARCHIVED
 *   ARCHIVED is FINAL in V1 (no action leaves it); an ARCHIVED student is read-only.
 */
export const LIFECYCLE: Readonly<Record<StudentLifecycleAction, { readonly from: readonly StudentStatus[]; readonly to: StudentStatus }>> = {
  DEACTIVATE: { from: ['ACTIVE'], to: 'INACTIVE' },
  REACTIVATE: { from: ['INACTIVE'], to: 'ACTIVE' },
  ARCHIVE: { from: ['ACTIVE', 'INACTIVE'], to: 'ARCHIVED' },
};

export const isStudentStatus = (value: unknown): value is StudentStatus => typeof value === 'string' && (STUDENT_STATUSES as readonly string[]).includes(value);
