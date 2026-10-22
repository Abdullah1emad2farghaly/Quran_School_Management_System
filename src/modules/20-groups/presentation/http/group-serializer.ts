import type { GroupDto, GroupHistoryDto, GroupStudentDto, StudentAssignmentDto } from '../../application/dto/group-dto';

const iso = (d: Date): string => d.toISOString();
const isoOrNull = (d: Date | null): string | null => (d ? d.toISOString() : null);

/** The public JSON of a Group (School Manager and the Teacher of the group). */
export const serializeGroup = (g: GroupDto) => ({
  id: g.id,
  schoolId: g.schoolId,
  organizationId: g.organizationId,
  name: g.name,
  teacher: g.teacher ? { id: g.teacher.id, name: g.teacher.name } : null,
  learningMode: g.learningMode,
  progression: g.progression,
  startingSurah: g.startingSurah,
  status: g.status,
  createdAt: iso(g.createdAt),
  updatedAt: iso(g.updatedAt),
});

/** What the PARENT of a student in the group sees: the group's name and the Teacher's name only (no settings, no student list). */
export const serializeGroupForParent = (g: GroupDto) => ({ id: g.id, schoolId: g.schoolId, name: g.name, teacherName: g.teacher ? g.teacher.name : null });

export const serializeGroupStudent = (s: GroupStudentDto) => ({ studentId: s.studentId, fullName: s.fullName, status: s.status, assignedAt: iso(s.assignedAt) });

export const serializeStudentAssignment = (a: StudentAssignmentDto) => ({
  id: a.id,
  groupId: a.groupId,
  groupName: a.groupName,
  assignedAt: iso(a.assignedAt),
  assignedBy: a.assignedBy,
  unassignedAt: isoOrNull(a.unassignedAt),
  unassignedBy: a.unassignedBy,
  endReason: a.endReason,
});

export const serializeGroupHistory = (h: GroupHistoryDto) => ({
  id: h.id,
  groupId: h.groupId,
  action: h.action,
  actorId: h.actorId,
  occurredAt: iso(h.occurredAt),
  reason: h.reason,
  previousName: h.previousName,
  newName: h.newName,
  previousTeacherId: h.previousTeacherId,
  newTeacherId: h.newTeacherId,
  previousLearningMode: h.previousLearningMode,
  newLearningMode: h.newLearningMode,
  previousProgression: h.previousProgression,
  newProgression: h.newProgression,
  previousStartingSurah: h.previousStartingSurah,
  newStartingSurah: h.newStartingSurah,
});
