import type { AuthorizationPolicyRegistry } from '../../../12-authorization-engine/public';

/** Permissions of revision (registered ONLY through the shared Authorization Engine). Codes are `<module>.<resource>.<action>`. */
export const RevisionPermissions = {
  MANAGE_ASSIGNMENT: 'revision.assignment.manage',
  RECORD: 'revision.record.record',
  CORRECT: 'revision.record.correct',
  READ_SESSION: 'revision.session.read',
  READ_STUDENT: 'revision.student.read',
} as const;

export interface RevisionAuthorizationDeps {
  readonly policies: Pick<AuthorizationPolicyRegistry, 'register'>;
}

/**
 * Module 28 registers what it owns (approved Module 28 decisions); no scope resolver is added: it reuses Module 20's MANAGEMENT/GROUP resolver (the target is the
 * session's group, loaded on the server) and Module 19's MANAGEMENT/STUDENT resolver.
 *   - revision.assignment.manage, revision.record.record, revision.record.correct: TEACHER only (the application further requires the session's Teacher; recording and
 *     correcting also go through Smart Guard). SCHOOL_MANAGER, ORGANIZATION_MANAGER, MAIN_ADMIN and PARENT/STUDENT have NONE: a School Manager can neither record nor correct.
 *   - revision.session.read: SCHOOL_MANAGER (own school) and TEACHER (the application limits them to sessions assigned to them).
 *   - revision.student.read: SCHOOL_MANAGER (own school) and PARENT (their own linked children only). A Student has no direct read access in this module.
 */
export function registerRevisionAuthorization(deps: RevisionAuthorizationDeps): void {
  deps.policies.register({ code: RevisionPermissions.MANAGE_ASSIGNMENT, roles: ['TEACHER'], scope: 'MANAGEMENT' });
  deps.policies.register({ code: RevisionPermissions.RECORD, roles: ['TEACHER'], scope: 'MANAGEMENT' });
  deps.policies.register({ code: RevisionPermissions.CORRECT, roles: ['TEACHER'], scope: 'MANAGEMENT' });
  deps.policies.register({ code: RevisionPermissions.READ_SESSION, roles: ['SCHOOL_MANAGER', 'TEACHER'], scope: 'MANAGEMENT' });
  deps.policies.register({ code: RevisionPermissions.READ_STUDENT, roles: ['SCHOOL_MANAGER', 'PARENT'], scope: 'MANAGEMENT' });
}
