import type { RoleAssignment } from '../../domain/entities/role-assignment';
import type { RoleCode } from '../../domain/value-objects/role-code';

export interface RoleAssignmentDto {
  readonly id: string;
  readonly userId: string;
  readonly roleCode: RoleCode;
  readonly isActive: boolean;
  readonly assignedAt: Date;
  readonly assignedBy: string | null;
  readonly revokedAt: Date | null;
  readonly revokedBy: string | null;
}

export function toRoleAssignmentDto(a: RoleAssignment): RoleAssignmentDto {
  return {
    id: a.id,
    userId: a.userId,
    roleCode: a.roleCode,
    isActive: a.isActive,
    assignedAt: a.assignedAt,
    assignedBy: a.assignedBy,
    revokedAt: a.revokedAt,
    revokedBy: a.revokedBy,
  };
}
