import type { AuthorizationPolicyRegistry, AuthorizationResolvers } from '../../../12-authorization-engine/public';
import type { SchoolLookup } from '../../../16-schools/public';
import type { TeacherService } from './teacher-service';

/** Permissions of the Teacher resource (registered ONLY through the shared Authorization Engine). */
export const TeacherPermissions = {
  CREATE: 'teachers.teacher.create',
  LIST: 'teachers.teacher.list',
  READ: 'teachers.teacher.read',
  READ_OWN: 'teachers.teacher.read-own',
  REMOVE_SCHOOL_LINK: 'teachers.school-link.remove',
} as const;

/** Scope target type of a Teacher (the SCHOOL target type belongs to Module 16 and its resolver is reused as is). */
export const TEACHER_TARGET_TYPE = 'TEACHER';

export interface TeacherAuthorizationDeps {
  readonly policies: Pick<AuthorizationPolicyRegistry, 'register'>;
  readonly resolvers: Pick<AuthorizationResolvers, 'registerScopeResolver'>;
  readonly teachers: Pick<TeacherService, 'listActiveSchoolIds'>;
  readonly schools: Pick<SchoolLookup, 'isSchoolManager'>;
}

/**
 * Module 18 registers what it owns (rules mirror the approved Parent rules; anything not listed stays denied):
 *   - SCHOOL_MANAGER: create a Teacher in THEIR school (scope target SCHOOL, resolved by Module 16: an active manager link to that exact school),
 *     list the Teachers of THEIR school, and read / remove the school link of a Teacher that is linked to a school they manage
 *     (scope target TEACHER, resolved below). A Teacher linked only to other schools is never reachable.
 *   - TEACHER: read their OWN profile only (`GET /teachers/me`: the record is derived from the verified token, no id is accepted).
 *   - ORGANIZATION_MANAGER and MAIN_ADMIN: NO Teacher permission. Having an organization-wide or platform role grants nothing here; an
 *     organization-wide Teacher rule needs its own approval. (MAIN_ADMIN has global scope in the engine configuration, but scope never grants a
 *     permission: the role is simply not granted any `teachers.*` permission.)
 * The MANAGEMENT/TEACHER scope resolver loads the Teacher's ACTIVE school links from the server and answers `true` only on positive proof: the
 * SCHOOL_MANAGER role with an active manager link to at least one of those schools.
 * Call once per process (a second registration is a configuration error by design).
 */
export function registerTeacherAuthorization(deps: TeacherAuthorizationDeps): void {
  const schoolManager = ['SCHOOL_MANAGER'] as const;
  deps.policies.register({ code: TeacherPermissions.CREATE, roles: schoolManager, scope: 'MANAGEMENT' });
  deps.policies.register({ code: TeacherPermissions.LIST, roles: schoolManager, scope: 'MANAGEMENT' });
  deps.policies.register({ code: TeacherPermissions.READ, roles: schoolManager, scope: 'MANAGEMENT' });
  deps.policies.register({ code: TeacherPermissions.REMOVE_SCHOOL_LINK, roles: schoolManager, scope: 'MANAGEMENT' });
  deps.policies.register({ code: TeacherPermissions.READ_OWN, roles: ['TEACHER'], scope: 'UNSCOPED' });

  deps.resolvers.registerScopeResolver('MANAGEMENT', TEACHER_TARGET_TYPE, {
    covers: async ({ userId, role, kind, target }) => {
      if (kind !== 'MANAGEMENT' || target.type !== TEACHER_TARGET_TYPE || role !== 'SCHOOL_MANAGER') return false;
      for (const schoolId of await deps.teachers.listActiveSchoolIds(target.id)) {
        if (await deps.schools.isSchoolManager(userId, schoolId)) return true;
      }
      return false;
    },
  });
}
