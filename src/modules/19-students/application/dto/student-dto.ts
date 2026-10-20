import type { ParentAddressDto } from '../../../17-parents/public';
import type { Student } from '../../domain/entities/student';
import type { StudentHistoryEntry } from '../../domain/entities/student-history-entry';
import type { StudentStatus } from '../../domain/value-objects/student-status';

export interface StudentDto {
  readonly id: string;
  readonly schoolId: string;
  readonly organizationId: string;
  readonly parentId: string;
  readonly fullName: string;
  readonly nationalId: string;
  readonly joinDate: string;
  readonly status: StudentStatus;
  /** DERIVED, never stored: the Parent's CURRENT address (§28/§37). A Student has no address of their own; it changes when the Parent's changes. */
  readonly address: ParentAddressDto | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface StudentHistoryDto {
  readonly id: string;
  readonly studentId: string;
  readonly action: StudentHistoryEntry['action'];
  readonly actorId: string;
  readonly occurredAt: Date;
  readonly reason: string | null;
  readonly previousStatus: StudentStatus | null;
  readonly newStatus: StudentStatus | null;
  readonly previousFullName: string | null;
  readonly newFullName: string | null;
  readonly previousJoinDate: string | null;
  readonly newJoinDate: string | null;
}

/** What the Authorization Engine resolver and other modules need to know about a student, read from the server (never from the client). */
export interface StudentScopeDto {
  readonly id: string;
  readonly schoolId: string;
  readonly organizationId: string;
  readonly parentId: string;
  readonly status: StudentStatus;
}

export function toStudentDto(student: Student, address: ParentAddressDto | undefined): StudentDto {
  const s = student.snapshot;
  return {
    id: s.id,
    schoolId: s.schoolId,
    organizationId: s.organizationId,
    parentId: s.parentId,
    fullName: s.fullName,
    nationalId: s.nationalId,
    joinDate: s.joinDate,
    status: s.status,
    address: address ?? null,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

export const toStudentHistoryDto = (e: StudentHistoryEntry): StudentHistoryDto => ({ ...e });
