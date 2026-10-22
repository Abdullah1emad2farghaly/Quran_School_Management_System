import type { AuthorizationPolicyRegistry, AuthorizationResolvers } from '../../../12-authorization-engine/public';
import type { ParentLookup } from '../../../17-parents/public';
import type { SchoolLookup } from '../../../16-schools/public';
import type { TeacherLookup } from '../../../18-teachers/public';
import type { GroupService } from './group-service';

/** Permissions of the Group resource (registered ONLY through the shared Authorization Engine). */
export const GroupPermissions = {
  CREATE: 'groups.group.create',
  LIST: 'groups.group.list',
  READ: 'groups.group.read',
  UPDATE: 'groups.group.update',
  ARCHIVE: 'groups.group.archive',
  ASSIGN_TEACHER: 'groups.group.assign-teacher',
  READ_HISTORY: 'groups.group.read-history',
  LIST_STUDENTS: 'groups.group.list-students',
  ASSIGN_STUDENT: 'groups.group.assign-student',
  UNASSIGN_STUDENT: 'groups.group.unassign-student',
  MOVE_STUDENT: 'groups.group.move-student',
  LIST_OWN: 'groups.group.list-own',
  READ_STUDENT_ASSIGNMENTS: 'groups.student.read-assignments',
} as const;

/** Scope target type of a Group (the SCHOOL target type belongs to Module 16 and the STUDENT one to Module 19: both resolvers are reused as is). */
export const GROUP_TARGET_TYPE = 'GROUP';

export interface GroupAuthorizationDeps {
  readonly policies: Pick<AuthorizationPolicyRegistry, 'register'>;
  readonly resolvers: Pick<AuthorizationResolvers, 'registerScopeResolver'>;
  readonly groups: Pick<GroupService, 'findScopeById' | 'isParentOfAnAssignedStudent'>;
  readonly schools: Pick<SchoolLookup, 'isSchoolManager'>;
  readonly parents: Pick<ParentLookup, 'findByUserId'>;
  readonly teachers: Pick<TeacherLookup, 'findByUserId'>;
}

/**
 * Module 20 registers what it owns (approved Module 20 decisions only; anything not listed stays denied):
 *   - SCHOOL_MANAGER: create, list, read, update, archive groups of THEIR school, assign / change / remove the Teacher, assign / unassign / move
 *     students, list a group's students and read the history (scope target SCHOOL for create / list, GROUP for the rest, STUDENT for a
 *     student's assignment history; all resolved from server data, never from a client-claimed school).
 *   - TEACHER: read ONLY the ACTIVE groups they teach (and list their students), in a school they are actively linked to; list their own groups.
 *   - PARENT: read ONLY the ACTIVE group of one of their own children (the Parent view: name and Teacher name, no student list).
 *   - ORGANIZATION_MANAGER and MAIN_ADMIN: NO Group permission (a scope never grants a permission).
 * The MANAGEMENT/GROUP resolver answers `true` only on positive proof and per ROLE: a role is never allowed through another role's proof.
 * Call once per process (a second registration is a configuration error by design).
 */
export function registerGroupAuthorization(deps: GroupAuthorizationDeps): void {
  const manager = ['SCHOOL_MANAGER'] as const;
  for (const code of [GroupPermissions.CREATE, GroupPermissions.LIST, GroupPermissions.UPDATE, GroupPermissions.ARCHIVE, GroupPermissions.ASSIGN_TEACHER, GroupPermissions.READ_HISTORY, GroupPermissions.ASSIGN_STUDENT, GroupPermissions.UNASSIGN_STUDENT, GroupPermissions.MOVE_STUDENT, GroupPermissions.READ_STUDENT_ASSIGNMENTS]) {
    deps.policies.register({ code, roles: manager, scope: 'MANAGEMENT' });
  }
  deps.policies.register({ code: GroupPermissions.READ, roles: ['SCHOOL_MANAGER', 'TEACHER', 'PARENT'], scope: 'MANAGEMENT' });
  deps.policies.register({ code: GroupPermissions.LIST_STUDENTS, roles: ['SCHOOL_MANAGER', 'TEACHER'], scope: 'MANAGEMENT' });
  deps.policies.register({ code: GroupPermissions.LIST_OWN, roles: ['TEACHER'], scope: 'UNSCOPED' });

  deps.resolvers.registerScopeResolver('MANAGEMENT', GROUP_TARGET_TYPE, {
    covers: async ({ userId, role, kind, target }) => {
      if (kind !== 'MANAGEMENT' || target.type !== GROUP_TARGET_TYPE) return false;
      const group = await deps.groups.findScopeById(target.id);
      if (!group) return false;
      switch (role) {
        case 'SCHOOL_MANAGER':
          return deps.schools.isSchoolManager(userId, group.schoolId);
        case 'TEACHER': {
          const teacher = await deps.teachers.findByUserId(userId);
          return group.status === 'ACTIVE' && teacher !== undefined && group.teacherId === teacher.id && teacher.schoolIds.includes(group.schoolId);
        }
        case 'PARENT': {
          const parent = await deps.parents.findByUserId(userId);
          return group.status === 'ACTIVE' && parent !== undefined && deps.groups.isParentOfAnAssignedStudent(group.id, parent.id);
        }
        default:
          return false;
      }
    },
  });
}
