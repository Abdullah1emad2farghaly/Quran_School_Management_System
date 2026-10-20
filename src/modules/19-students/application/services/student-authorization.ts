import type { AuthorizationPolicyRegistry, AuthorizationResolvers } from '../../../12-authorization-engine/public';
import type { ParentLookup } from '../../../17-parents/public';
import type { SchoolLookup } from '../../../16-schools/public';
import type { TeacherLookup } from '../../../18-teachers/public';
import type { StudentGroupAccess } from '../ports/student-group-access';
import type { StudentService } from './student-service';

/** Permissions of the Student resource (registered ONLY through the shared Authorization Engine). */
export const StudentPermissions = {
  CREATE: 'students.student.create',
  LIST: 'students.student.list',
  READ: 'students.student.read',
  UPDATE: 'students.student.update',
  DEACTIVATE: 'students.student.deactivate',
  REACTIVATE: 'students.student.reactivate',
  ARCHIVE: 'students.student.archive',
  READ_HISTORY: 'students.student.read-history',
  LIST_OWN_CHILDREN: 'students.student.list-own-children',
} as const;

/** Scope target type of a Student (the SCHOOL target type belongs to Module 16 and its resolver is reused as is). */
export const STUDENT_TARGET_TYPE = 'STUDENT';

export interface StudentAuthorizationDeps {
  readonly policies: Pick<AuthorizationPolicyRegistry, 'register'>;
  readonly resolvers: Pick<AuthorizationResolvers, 'registerScopeResolver'>;
  readonly students: Pick<StudentService, 'findScopeById'>;
  readonly schools: Pick<SchoolLookup, 'isSchoolManager'>;
  readonly parents: Pick<ParentLookup, 'findByUserId'>;
  readonly teachers: Pick<TeacherLookup, 'findByUserId'>;
  readonly groupAccess: StudentGroupAccess;
}

/**
 * Module 19 registers what it owns (approved Module 19 decisions only; anything not listed stays denied):
 *   - SCHOOL_MANAGER: create, list, read, update, deactivate, reactivate and archive Students of THEIR school, and read their history
 *     (scope target SCHOOL for create/list, STUDENT for the rest; both resolved from server data, never from a client-claimed school).
 *   - PARENT: read ONLY their own linked children (`students.student.read` with the PARENT role: the resolver proves the Student's parent is
 *     the caller's Parent record) and list them (`GET /students/mine`, derived from the token). No write, no lifecycle.
 *   - TEACHER: read ONLY a Student of a group assigned to them (the resolver asks the `StudentGroupAccess` port, supplied by Module 20 and
 *     fail-closed until then) and only inside a school they are actively linked to. No write, no lifecycle, no listing.
 *   - ORGANIZATION_MANAGER and MAIN_ADMIN: NO Student permission (scope never grants a permission).
 * The MANAGEMENT/STUDENT resolver answers `true` only on positive proof and per ROLE: a role is never allowed through another role's proof.
 * Call once per process (a second registration is a configuration error by design).
 */
export function registerStudentAuthorization(deps: StudentAuthorizationDeps): void {
  const manager = ['SCHOOL_MANAGER'] as const;
  deps.policies.register({ code: StudentPermissions.CREATE, roles: manager, scope: 'MANAGEMENT' });
  deps.policies.register({ code: StudentPermissions.LIST, roles: manager, scope: 'MANAGEMENT' });
  deps.policies.register({ code: StudentPermissions.UPDATE, roles: manager, scope: 'MANAGEMENT' });
  deps.policies.register({ code: StudentPermissions.DEACTIVATE, roles: manager, scope: 'MANAGEMENT' });
  deps.policies.register({ code: StudentPermissions.REACTIVATE, roles: manager, scope: 'MANAGEMENT' });
  deps.policies.register({ code: StudentPermissions.ARCHIVE, roles: manager, scope: 'MANAGEMENT' });
  deps.policies.register({ code: StudentPermissions.READ_HISTORY, roles: manager, scope: 'MANAGEMENT' });
  deps.policies.register({ code: StudentPermissions.READ, roles: ['SCHOOL_MANAGER', 'PARENT', 'TEACHER'], scope: 'MANAGEMENT' });
  deps.policies.register({ code: StudentPermissions.LIST_OWN_CHILDREN, roles: ['PARENT'], scope: 'UNSCOPED' });

  deps.resolvers.registerScopeResolver('MANAGEMENT', STUDENT_TARGET_TYPE, {
    covers: async ({ userId, role, kind, target }) => {
      if (kind !== 'MANAGEMENT' || target.type !== STUDENT_TARGET_TYPE) return false;
      const student = await deps.students.findScopeById(target.id);
      if (!student) return false;
      switch (role) {
        case 'SCHOOL_MANAGER':
          return deps.schools.isSchoolManager(userId, student.schoolId);
        case 'PARENT': {
          const parent = await deps.parents.findByUserId(userId);
          return parent !== undefined && parent.id === student.parentId;
        }
        case 'TEACHER': {
          const teacher = await deps.teachers.findByUserId(userId);
          if (!teacher || !teacher.schoolIds.includes(student.schoolId)) return false;
          return deps.groupAccess.isStudentInGroupOfTeacher(student.id, teacher.id);
        }
        default:
          return false;
      }
    },
  });
}
