import type { AuthorizationPolicyRegistry } from '../../../12-authorization-engine/public';

/** Permissions of the class sessions (registered ONLY through the shared Authorization Engine). */
export const SessionPermissions = {
  READ: 'sessions.session.read',
  LIST_OWN: 'sessions.session.list-own',
  CANCEL: 'sessions.session.cancel',
} as const;

export interface SessionAuthorizationDeps {
  readonly policies: Pick<AuthorizationPolicyRegistry, 'register'>;
}

/**
 * Module 24 registers what it owns. The scope is the Group (target type GROUP): the MANAGEMENT/GROUP resolver registered by Module 20 decides, from server
 * data and per role, who is the active manager of the group's school and who is the Teacher of an ACTIVE group. No resolver is registered here.
 *   - sessions.session.cancel (APPROVED by the project owner): the assigned TEACHER only; the application additionally requires that the caller is the session's own Teacher.
 *   - sessions.session.read, sessions.session.list-own (PROVISIONAL, pending confirmation, docs/CLASS-SESSIONS.md): SCHOOL_MANAGER of the group's school and the TEACHER of the group
 *     read sessions; a TEACHER lists their own sessions. PARENT, ORGANIZATION_MANAGER and MAIN_ADMIN have no session permission (deny by default).
 * Nobody has a permission to start, complete or create a session: those are system actions. Call once per process.
 */
export function registerSessionAuthorization(deps: SessionAuthorizationDeps): void {
  deps.policies.register({ code: SessionPermissions.READ, roles: ['SCHOOL_MANAGER', 'TEACHER'], scope: 'MANAGEMENT' });
  deps.policies.register({ code: SessionPermissions.LIST_OWN, roles: ['TEACHER'], scope: 'UNSCOPED' });
  deps.policies.register({ code: SessionPermissions.CANCEL, roles: ['TEACHER'], scope: 'MANAGEMENT' });
}
