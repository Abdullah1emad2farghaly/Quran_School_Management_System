/**
 * What kind of change an audit record describes (Master Specification §64 "Important audited actions"). A closed list: the catalog can only use these.
 */
export const AUDIT_ACTIONS = [
  'CREATE',
  'UPDATE',
  'DELETE',
  'ACTIVATE',
  'DEACTIVATE',
  'ROLE_CHANGE',
  'APPROVE',
  'REJECT',
  'PAYMENT',
  'WAIVER',
  /** A historical relationship was created or ended (school links, manager links, group assignments, examiners...). */
  'RELATIONSHIP_CHANGE',
  /** A status moved (student status, group archived, session cancelled, exam cancelled...). */
  'STATUS_CHANGE',
  /** A correction of previously recorded data (attendance, memorization, revision, school GPS). */
  'CORRECTION',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
