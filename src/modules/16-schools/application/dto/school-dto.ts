import type { School } from '../../domain/entities/school';
import type { SchoolManagerAssignment, SchoolManagerSource } from '../../domain/entities/school-manager-assignment';
import type { SchoolStatus } from '../../domain/value-objects/school-status';

export interface SchoolDto {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly status: SchoolStatus;
  readonly organizationId: string;
  /** The organization's country (derived, never client-chosen). */
  readonly countryId: string;
  readonly governorateId: string;
  /** Free text. */
  readonly centerName: string | null;
  readonly villageName: string | null;
  /** Official school centre (immutable after approval). */
  readonly latitude: number;
  readonly longitude: number;
  readonly gpsAccuracyMeters: number;
  /** Creator / requester (audit reference; NOT the manager relationship). */
  readonly createdBy: string;
  /** The user who asked to manage the school (public submission); null when an organization manager created it. */
  readonly applicantUserId: string | null;
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
    status: s.status,
    organizationId: s.organizationId,
    countryId: s.countryId,
    governorateId: s.governorateId,
    centerName: s.centerName,
    villageName: s.villageName,
    latitude: s.gps.latitude,
    longitude: s.gps.longitude,
    gpsAccuracyMeters: s.gps.accuracyMeters,
    createdBy: s.createdBy,
    applicantUserId: s.applicantUserId,
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
