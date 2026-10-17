export const SCHOOL_STATUSES = ['PENDING', 'ACTIVE', 'INACTIVE', 'REJECTED'] as const;
export type SchoolStatus = (typeof SCHOOL_STATUSES)[number];

/**
 * The only legal transitions (V1):
 *   every new school -> PENDING (never ACTIVE before approval)
 *   PENDING -> ACTIVE (approval) | REJECTED (rejection, terminal)
 *   ACTIVE <-> INACTIVE (explicit status change)
 */
const ALLOWED: Readonly<Record<SchoolStatus, readonly SchoolStatus[]>> = {
  PENDING: ['ACTIVE', 'REJECTED'],
  ACTIVE: ['INACTIVE'],
  INACTIVE: ['ACTIVE'],
  REJECTED: [],
};

export function isSchoolStatus(value: unknown): value is SchoolStatus {
  return typeof value === 'string' && (SCHOOL_STATUSES as readonly string[]).includes(value);
}

export function canTransitionSchoolStatus(from: SchoolStatus, to: SchoolStatus): boolean {
  return ALLOWED[from].includes(to);
}
