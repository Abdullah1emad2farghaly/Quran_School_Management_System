import type { AuthorizationPolicyRegistry } from '../../../12-authorization-engine/public';

/** Permissions of memorization (registered ONLY through the shared Authorization Engine). Codes are `<module>.<resource>.<action>`. */
export const MemorizationPermissions = {
  MANAGE_ASSIGNMENT: 'memorization.assignment.manage',
  RECORD: 'memorization.record.record',
  CORRECT: 'memorization.record.correct',
  READ_SESSION: 'memorization.session.read',
  READ_STUDENT: 'memorization.student.read',
} as const;

export interface MemorizationAuthorizationDeps {
  readonly policies: Pick<AuthorizationPolicyRegistry, 'register'>;
}

/**
 * Module 27 registers what it owns (approved Module 27 decisions); no scope resolver is added: it reuses Module 20's MANAGEMENT/GROUP resolver (the target is the
 * session's group, loaded on the server) and Module 19's MANAGEMENT/STUDENT resolver.
 *   - memorization.assignment.manage, memorization.record.record, memorization.record.correct: TEACHER only (the application further requires the session's Teacher; recording and
 *     correcting also go through Smart Guard). SCHOOL_MANAGER, ORGANIZATION_MANAGER, MAIN_ADMIN and PARENT/STUDENT have NONE: a School Manager can neither record nor correct.
 *   - memorization.session.read: SCHOOL_MANAGER (own school) and TEACHER (the application limits them to sessions assigned to them).
 *   - memorization.student.read: SCHOOL_MANAGER (own school) and PARENT (their own linked children only). A Student has no direct read access in this module.
 */
export function registerMemorizationAuthorization(deps: MemorizationAuthorizationDeps): void {
  deps.policies.register({ code: MemorizationPermissions.MANAGE_ASSIGNMENT, roles: ['TEACHER'], scope: 'MANAGEMENT' });
  deps.policies.register({ code: MemorizationPermissions.RECORD, roles: ['TEACHER'], scope: 'MANAGEMENT' });
  deps.policies.register({ code: MemorizationPermissions.CORRECT, roles: ['TEACHER'], scope: 'MANAGEMENT' });
  deps.policies.register({ code: MemorizationPermissions.READ_SESSION, roles: ['SCHOOL_MANAGER', 'TEACHER'], scope: 'MANAGEMENT' });
  deps.policies.register({ code: MemorizationPermissions.READ_STUDENT, roles: ['SCHOOL_MANAGER', 'PARENT'], scope: 'MANAGEMENT' });
}
