import type { School } from '../../domain/entities/school';
import type { SchoolManagerAssignment, SchoolManagerSource } from '../../domain/entities/school-manager-assignment';
import type { SchoolStatus } from '../../domain/value-objects/school-status';
import type { SchoolType } from '../../domain/value-objects/school-type';

export interface SchoolDto {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly type: SchoolType;
  readonly status: SchoolStatus;
  readonly organizationId: string;
  /** The organization's country (derived, never client-chosen). */
  readonly countryId: string;
  readonly parentSchoolId: string | null;
  readonly governorateId: string;
  readonly centerId: string | null;
  readonly villageId: string | null;
  /** Official school centre (immutable after approval). */
  readonly latitude: number;
  readonly longitude: number;
  readonly gpsAccuracyMeters: number;
  /** Creator / requester (audit reference; NOT the manager relationship). */
  readonly createdBy: string;
  /** Name typed by the applicant in the submission form (null when not a public submission). */
  readonly applicantName: string | null;
  readonly decidedBy: string | null;
  readonly decidedAt: Date | null;
  readonly rejectionReason: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export function toSchoolDto(school: School): SchoolDto {
  const s = school.snapshot;
  return {
    id: s.id,
    code: s.code,
    name: s.name,
    type: s.type,
    status: s.status,
    organizationId: s.organizationId,
    countryId: s.countryId,
    parentSchoolId: s.parentSchoolId,
    governorateId: s.governorateId,
    centerId: s.centerId,
    villageId: s.villageId,
    latitude: s.gps.latitude,
    longitude: s.gps.longitude,
    gpsAccuracyMeters: s.gps.accuracyMeters,
    createdBy: s.createdBy,
    applicantName: s.applicantName,
    decidedBy: s.decidedBy,
    decidedAt: s.decidedAt,
    rejectionReason: s.rejectionReason,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

export interface SchoolManagerAssignmentDto {
  readonly id: string;
  readonly schoolId: string;
  readonly userId: string;
  readonly source: SchoolManagerSource;
  readonly assignedAt: Date;
  readonly assignedBy: string;
  readonly revokedAt: Date | null;
  readonly revokedBy: string | null;
  readonly isActive: boolean;
}

export function toSchoolManagerAssignmentDto(a: SchoolManagerAssignment): SchoolManagerAssignmentDto {
  const s = a.snapshot;
  return {
    id: s.id,
    schoolId: s.schoolId,
    userId: s.userId,
    source: s.source,
    assignedAt: s.assignedAt,
    assignedBy: s.assignedBy,
    revokedAt: s.revokedAt,
    revokedBy: s.revokedBy,
    isActive: a.isActive,
  };
}
