import type { ApproveSchoolResult, SchoolSubmissionResult } from '../../application/services/school-service';
import type { SchoolDto, SchoolManagerAssignmentDto } from '../../application/dto/school-dto';
import type { OrganizationDto } from '../../../13-organization-core/public';
import type { OrganizationRegistrationResult } from '../../application/services/organization-registration-service';

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export function serializeSchool(s: SchoolDto) {
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
    gps: { latitude: s.latitude, longitude: s.longitude, accuracyMeters: s.gpsAccuracyMeters },
    createdBy: s.createdBy,
    applicantUserId: s.applicantUserId,
    applicantName: s.applicantName,
    decidedBy: s.decidedBy,
    decidedAt: iso(s.decidedAt),
    rejectionReason: s.rejectionReason,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

export function serializeManager(m: SchoolManagerAssignmentDto) {
  return {
    id: m.id,
    schoolId: m.schoolId,
    userId: m.userId,
    source: m.source,
    assignedAt: m.assignedAt.toISOString(),
    assignedBy: m.assignedBy,
    revokedAt: iso(m.revokedAt),
    revokedBy: m.revokedBy,
    isActive: m.isActive,
  };
}

/** The applicant gets the school and their own user id: never a password, token or other account detail. */
export function serializeSubmission(r: SchoolSubmissionResult) {
  return { school: serializeSchool(r.school), applicant: { userId: r.applicant.userId, accountCreated: r.applicant.accountCreated } };
}

export function serializeApproval(r: ApproveSchoolResult) {
  return { school: serializeSchool(r.school), manager: r.manager ? serializeManager(r.manager) : null };
}

export function serializeOrganization(o: OrganizationDto) {
  return {
    id: o.id,
    code: o.code,
    name: o.name,
    status: o.status,
    countryId: o.countryId,
    address: { governorateId: o.governorateId, centerName: o.centerName, villageName: o.villageName },
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  };
}

/** The applicant gets the organization and their own user id: never a password, token or other account detail. */
export function serializeOrganizationRegistration(r: OrganizationRegistrationResult) {
  return { organization: serializeOrganization(r.organization), applicant: { userId: r.applicant.userId, accountCreated: r.applicant.accountCreated } };
}
