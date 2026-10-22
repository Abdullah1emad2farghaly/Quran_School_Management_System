import type { PageRequest, PageResult } from '../../../00-shared-kernel/public';
import type { GroupSortKey } from '../../application/ports/group-repository';
import type { GroupService } from '../../application/services/group-service';
import { isGroupStatus, type GroupStatus } from '../../domain/value-objects/group-settings';
import { serializeGroup, serializeGroupForParent, serializeGroupHistory, serializeGroupStudent, serializeStudentAssignment } from './group-serializer';

export type GroupHandlerService = Pick<
  GroupService,
  | 'createGroup' | 'getGroup' | 'listGroupsOfSchool' | 'listOwnGroups' | 'listHistory' | 'updateGroup' | 'assignTeacher' | 'removeTeacher' | 'archiveGroup'
  | 'assignStudent' | 'unassignStudent' | 'moveStudent' | 'listStudentsOfGroup' | 'listAssignmentHistoryOfStudent'
>;

type Json = Record<string, unknown>;
const obj = (value: unknown): Json => (typeof value === 'object' && value !== null ? (value as Json) : {});

export interface GroupListRequest {
  readonly sort: { key: string; direction: 'asc' | 'desc' };
  readonly status: readonly string[] | undefined;
  readonly page: PageRequest;
}
export interface PagedRequest {
  readonly sort: { key: string; direction: 'asc' | 'desc' };
  readonly page: PageRequest;
}

const statuses = (value: readonly string[] | undefined): GroupStatus[] | undefined => value?.filter(isGroupStatus);

/**
 * Framework-free handlers behind the group routes: they map an already validated request to the application service and the response data.
 * The actor / user id and the authorized `role` always come from the verified token and the Authorization Engine, never from the body.
 */
export function createGroupHandlers(getService: () => GroupHandlerService) {
  return {
    createGroup: async (actorId: string, body: unknown) => {
      const b = obj(body);
      return serializeGroup(await getService().createGroup({ schoolId: b.schoolId as string, name: b.name, learningMode: b.learningMode, progression: b.progression, startingSurah: b.startingSurah, ...(b.teacherId ? { teacherId: b.teacherId as string } : {}) }, actorId));
    },

    /** A PARENT (authorized through their own child) gets the minimal view; the School Manager and the group's Teacher get the full one. */
    getGroup: async (groupId: string, role: string | undefined) => {
      const group = await getService().getGroup(groupId);
      return role === 'PARENT' ? serializeGroupForParent(group) : serializeGroup(group);
    },

    listGroupsOfSchool: async (schoolId: string, input: GroupListRequest): Promise<PageResult<ReturnType<typeof serializeGroup>>> => {
      const page = await getService().listGroupsOfSchool(schoolId, { sort: input.sort.key as GroupSortKey, direction: input.sort.direction, ...(input.status ? { status: statuses(input.status)! } : {}), page: input.page });
      return { ...page, items: page.items.map(serializeGroup) };
    },

    listOwnGroups: async (userId: string, input: PagedRequest): Promise<PageResult<ReturnType<typeof serializeGroup>>> => {
      const page = await getService().listOwnGroups(userId, input.page, input.sort.direction);
      return { ...page, items: page.items.map(serializeGroup) };
    },

    listHistory: async (groupId: string) => (await getService().listHistory(groupId)).map(serializeGroupHistory),

    updateGroup: async (groupId: string, actorId: string, body: unknown) => {
      const b = obj(body);
      const input = { ...(b.name !== undefined ? { name: b.name } : {}), ...(b.learningMode !== undefined ? { learningMode: b.learningMode } : {}), ...(b.progression !== undefined ? { progression: b.progression } : {}), ...(b.startingSurah !== undefined ? { startingSurah: b.startingSurah } : {}) };
      return serializeGroup(await getService().updateGroup(groupId, input, actorId));
    },

    assignTeacher: async (groupId: string, actorId: string, body: unknown) => serializeGroup(await getService().assignTeacher(groupId, obj(body).teacherId as string, actorId)),
    removeTeacher: async (groupId: string, actorId: string) => serializeGroup(await getService().removeTeacher(groupId, actorId)),
    archiveGroup: async (groupId: string, actorId: string, body: unknown) => serializeGroup(await getService().archiveGroup(groupId, obj(body).reason, actorId)),

    listStudents: async (groupId: string, input: PagedRequest): Promise<PageResult<ReturnType<typeof serializeGroupStudent>>> => {
      const page = await getService().listStudentsOfGroup(groupId, input.page, input.sort.direction);
      return { ...page, items: page.items.map(serializeGroupStudent) };
    },
    assignStudent: async (groupId: string, actorId: string, body: unknown) => serializeGroupStudent(await getService().assignStudent(groupId, obj(body).studentId as string, actorId)),
    unassignStudent: async (groupId: string, studentId: string, actorId: string): Promise<void> => getService().unassignStudent(groupId, studentId, actorId),
    moveStudent: async (groupId: string, studentId: string, actorId: string, body: unknown) => serializeGroupStudent(await getService().moveStudent(groupId, studentId, obj(body).targetGroupId as string, actorId)),

    listStudentAssignments: async (studentId: string) => (await getService().listAssignmentHistoryOfStudent(studentId)).map(serializeStudentAssignment),
  };
}
