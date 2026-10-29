import type { AuthorizationPolicyRegistry } from '../../../12-authorization-engine/public';

/** Permissions of the group schedule (registered ONLY through the shared Authorization Engine). */
export const SchedulePermissions = {
  MANAGE: 'groups.schedule.manage',
  READ: 'groups.schedule.read',
  READ_HISTORY: 'groups.schedule.read-history',
  LIST_OWN: 'groups.schedule.list-own',
} as const;

export interface ScheduleAuthorizationDeps {
  readonly policies: Pick<AuthorizationPolicyRegistry, 'register'>;
}

/**
 * Module 23 registers what it owns (approved Module 23 decisions only; anything not listed stays denied). The scope is the Group (target type GROUP):
 * the MANAGEMENT/GROUP resolver registered by Module 20 decides, from server data and per role, who is the active manager of the group's school,
 * who is the Teacher of an ACTIVE group, and who is the Parent of a student currently in an ACTIVE group. No resolver is registered here.
 *   - SCHOOL_MANAGER: manage (add, change, remove) and read the schedule and its history of the groups of THEIR school.
 *   - TEACHER: read the schedule of the ACTIVE group they teach, and list their own weekly schedule (token-derived, across their schools).
 *   - PARENT: read the schedule of the ACTIVE group of their own child.
 *   - ORGANIZATION_MANAGER and MAIN_ADMIN: NO schedule permission (a scope never grants a permission).
 * Call once per process (a second registration is a configuration error by design).
 */
export function registerScheduleAuthorization(deps: ScheduleAuthorizationDeps): void {
  deps.policies.register({ code: SchedulePermissions.MANAGE, roles: ['SCHOOL_MANAGER'], scope: 'MANAGEMENT' });
  deps.policies.register({ code: SchedulePermissions.READ_HISTORY, roles: ['SCHOOL_MANAGER'], scope: 'MANAGEMENT' });
  deps.policies.register({ code: SchedulePermissions.READ, roles: ['SCHOOL_MANAGER', 'TEACHER', 'PARENT'], scope: 'MANAGEMENT' });
  deps.policies.register({ code: SchedulePermissions.LIST_OWN, roles: ['TEACHER'], scope: 'UNSCOPED' });
}
