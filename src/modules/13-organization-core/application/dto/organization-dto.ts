import type { Organization } from '../../domain/entities/organization';
import type { OrganizationStatus } from '../../domain/value-objects/organization-status';

export interface OrganizationDto {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly status: OrganizationStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export const toOrganizationDto = (o: Organization): OrganizationDto => ({
  id: o.id,
  code: o.code,
  name: o.name,
  status: o.status,
  createdAt: o.createdAt,
  updatedAt: o.updatedAt,
});
