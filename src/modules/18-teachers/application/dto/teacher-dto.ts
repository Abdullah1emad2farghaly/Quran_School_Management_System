import type { Teacher } from '../../domain/entities/teacher';
import type { TeacherSchoolLink } from '../../domain/entities/teacher-school-link';

export interface TeacherDto {
  readonly id: string;
  readonly userId: string;
  readonly organizationId: string;
  /** The account's canonical three-part personal name (Module 08). */
  readonly name: string;
  /** The normalized phone (the login identity, Module 08). */
  readonly phone: string;
  /** The schools this Teacher is currently linked to (all in the same organization). */
  readonly schoolIds: readonly string[];
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface TeacherSchoolLinkDto {
  readonly id: string;
  readonly teacherId: string;
  readonly schoolId: string;
  readonly linkedAt: Date;
  readonly linkedBy: string;
  readonly unlinkedAt: Date | null;
  readonly unlinkedBy: string | null;
  readonly isActive: boolean;
}

export function toTeacherDto(input: { teacher: Teacher; phone: string; name: string; links: readonly TeacherSchoolLink[] }): TeacherDto {
  const s = input.teacher.snapshot;
  return {
    id: s.id,
    userId: s.userId,
    organizationId: s.organizationId,
    name: input.name,
    phone: input.phone,
    schoolIds: input.links.filter((l) => l.isActive).map((l) => l.snapshot.schoolId),
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

export function toTeacherSchoolLinkDto(link: TeacherSchoolLink): TeacherSchoolLinkDto {
  const s = link.snapshot;
  return { id: s.id, teacherId: s.teacherId, schoolId: s.schoolId, linkedAt: s.linkedAt, linkedBy: s.linkedBy, unlinkedAt: s.unlinkedAt, unlinkedBy: s.unlinkedBy, isActive: link.isActive };
}
