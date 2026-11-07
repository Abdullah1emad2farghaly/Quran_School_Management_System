import type { AuthorizationPolicyRegistry } from '../../../12-authorization-engine/public';

/** Permissions of evaluations (registered ONLY through the shared Authorization Engine). Codes are `<module>.<resource>.<action>`. */
export const EvaluationPermissions = {
  RECORD: 'evaluation.record.record',
  READ_SESSION: 'evaluation.session.read',
  READ_STUDENT: 'evaluation.student.read',
} as const;

export interface EvaluationAuthorizationDeps {
  readonly policies: Pick<AuthorizationPolicyRegistry, 'register'>;
}

/**
 * Module 29 registers what it owns (approved Module 29 decisions); no scope resolver is added: it reuses Module 20's MANAGEMENT/GROUP resolver (the target is the session's
 * group, loaded on the server) and Module 19's MANAGEMENT/STUDENT resolver (a Parent only for their own linked child).
 *   - evaluation.record.record: the TEACHER of the ACTIVE group, in addition to Smart Guard. The ONLY write permission: it creates evaluations and modifies scores.
 *   - evaluation.session.read: SCHOOL_MANAGER and TEACHER; the application further limits a Teacher to the sessions assigned to them.
 *   - evaluation.student.read: SCHOOL_MANAGER (their school) and PARENT (their own linked children only).
 * There is NO correction permission and the School Manager has NO write permission (approved). ORGANIZATION_MANAGER, the geographic managers and MAIN_ADMIN have no direct
 * evaluation permission: they will read through the future Reports module. STUDENT has no login. Call once per process.
 */
export function registerEvaluationAuthorization(deps: EvaluationAuthorizationDeps): void {
  deps.policies.register({ code: EvaluationPermissions.RECORD, roles: ['TEACHER'], scope: 'MANAGEMENT' });
  deps.policies.register({ code: EvaluationPermissions.READ_SESSION, roles: ['SCHOOL_MANAGER', 'TEACHER'], scope: 'MANAGEMENT' });
  deps.policies.register({ code: EvaluationPermissions.READ_STUDENT, roles: ['SCHOOL_MANAGER', 'PARENT'], scope: 'MANAGEMENT' });
}
