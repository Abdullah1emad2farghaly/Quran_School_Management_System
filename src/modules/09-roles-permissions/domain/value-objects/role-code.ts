/**
 * V1 roles are EXACTLY these nine (Master Specification §18). There is no Supervisor and
 * no Competition Manager. Adding or changing a role requires an approved specification change
 * (and a new migration, because the database also enforces this list).
 */
export const ROLE_CODES = [
  'MAIN_ADMIN',
  'GOVERNORATE_MANAGER',
  'CENTER_MANAGER',
  'VILLAGE_MANAGER',
  'SCHOOL_MANAGER',
  'TEACHER',
  'STUDENT',
  'PARENT',
  'SUBSCRIPTION_COLLECTOR',
] as const;
export type RoleCode = (typeof ROLE_CODES)[number];

export interface RoleDefinition {
  readonly code: RoleCode;
  readonly name: { readonly ar: string; readonly en: string };
  /**
   * Student is a business entity only in V1: no login, password, token or session, so a User
   * can never hold the Student role (§18).
   */
  readonly assignable: boolean;
}

export const ROLE_CATALOG: readonly RoleDefinition[] = Object.freeze([
  { code: 'MAIN_ADMIN', name: { ar: 'المدير الرئيسي', en: 'Main Admin' }, assignable: true },
  { code: 'GOVERNORATE_MANAGER', name: { ar: 'مدير المحافظة', en: 'Governorate Manager' }, assignable: true },
  { code: 'CENTER_MANAGER', name: { ar: 'مدير المركز', en: 'Center Manager' }, assignable: true },
  { code: 'VILLAGE_MANAGER', name: { ar: 'مدير القرية', en: 'Village Manager' }, assignable: true },
  { code: 'SCHOOL_MANAGER', name: { ar: 'مدير المدرسة', en: 'School Manager' }, assignable: true },
  { code: 'TEACHER', name: { ar: 'معلم', en: 'Teacher' }, assignable: true },
  { code: 'STUDENT', name: { ar: 'طالب', en: 'Student' }, assignable: false },
  { code: 'PARENT', name: { ar: 'ولي أمر', en: 'Parent' }, assignable: true },
  { code: 'SUBSCRIPTION_COLLECTOR', name: { ar: 'محصّل الاشتراكات', en: 'Subscription Collector' }, assignable: true },
]);

export const ASSIGNABLE_ROLE_CODES: readonly RoleCode[] = ROLE_CATALOG.filter((r) => r.assignable).map((r) => r.code);

export function isRoleCode(value: unknown): value is RoleCode {
  return typeof value === 'string' && (ROLE_CODES as readonly string[]).includes(value);
}

export function isAssignableRole(value: unknown): value is RoleCode {
  return isRoleCode(value) && (ASSIGNABLE_ROLE_CODES as readonly string[]).includes(value);
}

/** Stable catalog order, used to sort role lists deterministically. */
export function sortRoles(roles: Iterable<RoleCode>): RoleCode[] {
  return [...new Set(roles)].sort((a, b) => ROLE_CODES.indexOf(a) - ROLE_CODES.indexOf(b));
}
