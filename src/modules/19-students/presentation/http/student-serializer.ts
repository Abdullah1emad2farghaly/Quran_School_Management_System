import type { ParentAddressDto } from '../../../17-parents/public';
import type { StudentDto, StudentHistoryDto } from '../../application/dto/student-dto';

const iso = (d: Date): string => d.toISOString();

const serializeAddress = (a: ParentAddressDto) => ({
  governorateId: a.governorateId,
  governorateName: a.governorateName,
  centerName: a.centerName,
  villageName: a.villageName,
  since: iso(a.since),
});

/** The public JSON of a Student (School Manager and the Student's own Parent). */
export const serializeStudent = (s: StudentDto) => ({
  id: s.id,
  schoolId: s.schoolId,
  organizationId: s.organizationId,
  parentId: s.parentId,
  fullName: s.fullName,
  nationalId: s.nationalId,
  joinDate: s.joinDate,
  status: s.status,
  address: s.address ? serializeAddress(s.address) : null,
  createdAt: iso(s.createdAt),
  updatedAt: iso(s.updatedAt),
});

/**
 * What a TEACHER sees of a Student of one of their groups: the minimum needed to teach. The National ID, the Parent reference and the
 * (Parent-derived) address are NOT included (data minimization; the approved decision only says a Teacher may READ their students).
 */
export const serializeStudentForTeacher = (s: StudentDto) => ({
  id: s.id,
  schoolId: s.schoolId,
  fullName: s.fullName,
  joinDate: s.joinDate,
  status: s.status,
});

export const serializeStudentHistory = (h: StudentHistoryDto) => ({
  id: h.id,
  studentId: h.studentId,
  action: h.action,
  actorId: h.actorId,
  occurredAt: iso(h.occurredAt),
  reason: h.reason,
  previousStatus: h.previousStatus,
  newStatus: h.newStatus,
  previousFullName: h.previousFullName,
  newFullName: h.newFullName,
  previousJoinDate: h.previousJoinDate,
  newJoinDate: h.newJoinDate,
});
