/**
 * The REPORTING SCOPE of a requester: the only data universe a report may read for them (owner decision 2026-11-17: every role may access reports and the underlying data ONLY
 * within its own authorized organizational scope). It is always computed on the server from the verified session (user id + ACTIVE role) and the stored role assignments; an id sent by the
 * client is only ever a request that is checked AGAINST this scope, never a source of it.
 *
 *  - NONE:          the active role has no reporting scope (deny).
 *  - ORGANIZATIONS: the organization(s) the user administers (ORGANIZATION_MANAGER).
 *  - GEOGRAPHIC:    the governorate(s) / center(s) / village(s) assigned to a geographic manager.
 *  - SCHOOLS:       the school(s) the user manages (SCHOOL_MANAGER) or is currently assigned to (SUBSCRIPTION_COLLECTOR).
 *  - GROUPS:        the groups the Teacher currently teaches (their students are those groups' students).
 *  - STUDENTS:      the Parent's own linked children.
 */
export type ReportScope =
  | { readonly kind: 'NONE'; readonly reason: ReportScopeDenialReason }
  | { readonly kind: 'ORGANIZATIONS'; readonly organizationIds: readonly string[] }
  | { readonly kind: 'GEOGRAPHIC'; readonly level: GeographicLevel; readonly areaIds: readonly string[] }
  | { readonly kind: 'SCHOOLS'; readonly schoolIds: readonly string[] }
  | { readonly kind: 'GROUPS'; readonly groupIds: readonly string[] }
  | { readonly kind: 'STUDENTS'; readonly studentIds: readonly string[] };

export const GEOGRAPHIC_LEVELS = ['GOVERNORATE', 'CENTER', 'VILLAGE'] as const;
export type GeographicLevel = (typeof GEOGRAPHIC_LEVELS)[number];

export type ReportScopeDenialReason =
  /** The role has no reporting access in V1 (STUDENT) or is a system-level role whose reporting rules are not defined (MAIN_ADMIN: never treated as an organization manager). */
  | 'ROLE_HAS_NO_REPORT_ACCESS'
  /** The role may report but the user currently has no assignment to report on (no organization, school, group, child or geographic area). */
  | 'NO_CURRENT_ASSIGNMENT'
  /** The geographic manager role exists but its area assignment is not stored anywhere yet, so no area can be proven: deny. */
  | 'GEOGRAPHIC_ASSIGNMENT_UNAVAILABLE';

export const isEmptyScope = (scope: ReportScope): boolean => scope.kind === 'NONE';
