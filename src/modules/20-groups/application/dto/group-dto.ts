import type { Group } from '../../domain/entities/group';
import type { GroupAssignment } from '../../domain/entities/group-assignment';
import type { GroupHistoryEntry } from '../../domain/entities/group-history-entry';
import type { GroupStatus, LearningMode, Progression } from '../../domain/value-objects/group-settings';
import type { AssignmentEndReason } from '../../domain/entities/group-assignment';

export interface GroupDto {
  readonly id: string;
  readonly schoolId: string;
  readonly organizationId: string;
  readonly name: string;
  /** The group's Teacher (Module 18) with the name stored on their account; null while the group has none. */
  readonly teacher: { readonly id: string; readonly name: string } | null;
  readonly learningMode: LearningMode;
  readonly progression: Progression;
  readonly startingSurah: number;
  readonly status: GroupStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** What the Authorization Engine resolver and other modules need to know about a group (read from the server, never from the client). */
export interface GroupScopeDto {
  readonly id: string;
  readonly schoolId: string;
  readonly teacherId: string | null;
  readonly status: GroupStatus;
}

export interface GroupStudentDto {
  readonly studentId: string;
  readonly fullName: string;
  readonly status: string;
  readonly assignedAt: Date;
}

export interface StudentAssignmentDto {
  readonly id: string;
  readonly groupId: string;
  readonly groupName: string | null;
  readonly assignedAt: Date;
  readonly assignedBy: string;
  readonly unassignedAt: Date | null;
  readonly unassignedBy: string | null;
  readonly endReason: AssignmentEndReason | null;
}

export type GroupHistoryDto = GroupHistoryEntry;

export function toGroupDto(group: Group, teacher: { id: string; name: string } | undefined): GroupDto {
  const s = group.snapshot;
  return {
    id: s.id,
    schoolId: s.schoolId,
    organizationId: s.organizationId,
    name: s.name,
    teacher: teacher ? { id: teacher.id, name: teacher.name } : null,
    learningMode: s.learningMode,
    progression: s.progression,
    startingSurah: s.startingSurah,
    status: s.status,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

export const toAssignmentDto = (a: GroupAssignment, groupName: string | null): StudentAssignmentDto => {
  const s = a.snapshot;
  return { id: s.id, groupId: s.groupId, groupName, assignedAt: s.assignedAt, assignedBy: s.assignedBy, unassignedAt: s.unassignedAt, unassignedBy: s.unassignedBy, endReason: s.endReason };
};
