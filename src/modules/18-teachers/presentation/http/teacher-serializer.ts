import type { TeacherDto, TeacherSchoolLinkDto } from '../../application/dto/teacher-dto';

const iso = (d: Date): string => d.toISOString();

/** The public JSON of a Teacher. The password (initial or chosen) and its hash never appear anywhere. */
export const serializeTeacher = (t: TeacherDto) => ({
  id: t.id,
  userId: t.userId,
  organizationId: t.organizationId,
  name: t.name,
  phone: t.phone,
  schoolIds: [...t.schoolIds],
  createdAt: iso(t.createdAt),
  updatedAt: iso(t.updatedAt),
});

export const serializeTeacherSchoolLink = (l: TeacherSchoolLinkDto) => ({
  id: l.id,
  teacherId: l.teacherId,
  schoolId: l.schoolId,
  linkedAt: iso(l.linkedAt),
  linkedBy: l.linkedBy,
  unlinkedAt: l.unlinkedAt ? iso(l.unlinkedAt) : null,
  unlinkedBy: l.unlinkedBy,
  isActive: l.isActive,
});
